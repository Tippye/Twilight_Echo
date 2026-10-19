#include "RealCoreAudioHost.h"

#include "CoreAudioCommon.h"

#if defined(__APPLE__) && defined(TAE_ENABLE_COREAUDIO)

#include <AudioToolbox/AudioToolbox.h>
#include <AudioUnit/AudioUnit.h>
#include <CoreAudio/CoreAudio.h>
#include <CoreFoundation/CoreFoundation.h>

#include <algorithm>
#include <cstring>
#include <mutex>
#include <unordered_map>
#include <utility>

namespace twilight::audio {

namespace {

constexpr size_t kMaxCoreAudioCallbackBuffers = 32;

struct DeviceLostListener {
  CoreAudioListenerToken token = 0;
  CoreAudioDeviceID deviceId = 0;
  CoreAudioDeviceLostCallback callback;
};

CoreAudioStreamBasicDescription toHostDescription(const AudioStreamBasicDescription& format) {
  CoreAudioStreamBasicDescription out;
  out.sampleRate = format.mSampleRate;
  out.formatID = format.mFormatID;
  out.formatFlags = format.mFormatFlags;
  out.bytesPerPacket = format.mBytesPerPacket;
  out.framesPerPacket = format.mFramesPerPacket;
  out.bytesPerFrame = format.mBytesPerFrame;
  out.channelsPerFrame = format.mChannelsPerFrame;
  out.bitsPerChannel = format.mBitsPerChannel;
  return out;
}

AudioStreamBasicDescription toNativeDescription(const CoreAudioStreamBasicDescription& format) {
  AudioStreamBasicDescription out{};
  out.mSampleRate = format.sampleRate;
  out.mFormatID = format.formatID;
  out.mFormatFlags = format.formatFlags;
  out.mBytesPerPacket = format.bytesPerPacket;
  out.mFramesPerPacket = format.framesPerPacket;
  out.mBytesPerFrame = format.bytesPerFrame;
  out.mChannelsPerFrame = format.channelsPerFrame;
  out.mBitsPerChannel = format.bitsPerChannel;
  return out;
}

bool bindHostBufferList(AudioBufferList* ioData, CoreAudioBufferList* out) {
  if (!ioData || !out || ioData->mNumberBuffers > out->buffers.size()) return false;
  out->setActiveBufferCount(ioData->mNumberBuffers);
  for (UInt32 index = 0; index < ioData->mNumberBuffers; ++index) {
    auto& buffer = out->bufferAt(static_cast<size_t>(index));
    buffer.numberChannels = ioData->mBuffers[index].mNumberChannels;
    buffer.dataByteSize = ioData->mBuffers[index].mDataByteSize;
    buffer.bindExternal(
        static_cast<uint8_t*>(ioData->mBuffers[index].mData),
        ioData->mBuffers[index].mDataByteSize);
  }
  return true;
}

void publishHostBufferSizes(AudioBufferList* ioData, const CoreAudioBufferList& hostList) {
  if (!ioData) return;
  const UInt32 buffers = std::min<UInt32>(ioData->mNumberBuffers, static_cast<UInt32>(hostList.bufferCount()));
  for (UInt32 index = 0; index < buffers; ++index) {
    const auto& buffer = hostList.bufferAt(static_cast<size_t>(index));
    ioData->mBuffers[index].mNumberChannels = buffer.numberChannels;
    ioData->mBuffers[index].mDataByteSize = buffer.dataByteSize;
  }
}

void silenceNative(AudioBufferList* ioData) {
  if (!ioData) return;
  for (UInt32 index = 0; index < ioData->mNumberBuffers; ++index) {
    if (ioData->mBuffers[index].mData && ioData->mBuffers[index].mDataByteSize > 0) {
      std::memset(ioData->mBuffers[index].mData, 0, ioData->mBuffers[index].mDataByteSize);
    }
  }
}

AudioObjectPropertyAddress deviceAlivePropertyAddress() {
  return AudioObjectPropertyAddress{
      kAudioDevicePropertyDeviceIsAlive,
      kAudioObjectPropertyScopeGlobal,
      kAudioObjectPropertyElementMain};
}

AudioObjectPropertyAddress hardwareDevicesPropertyAddress() {
  return AudioObjectPropertyAddress{
      kAudioHardwarePropertyDevices,
      kAudioObjectPropertyScopeGlobal,
      kAudioObjectPropertyElementMain};
}

bool coreAudioDeviceExists(AudioDeviceID deviceId) {
  AudioObjectPropertyAddress address = hardwareDevicesPropertyAddress();
  UInt32 size = 0;
  OSStatus status = AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &address, 0, nullptr, &size);
  if (status != noErr || size == 0 || size % sizeof(AudioDeviceID) != 0) return false;
  std::vector<AudioDeviceID> devices(size / sizeof(AudioDeviceID));
  status = AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, nullptr, &size, devices.data());
  if (status != noErr) return false;
  return std::find(devices.begin(), devices.end(), deviceId) != devices.end();
}

bool coreAudioDeviceAlive(AudioDeviceID deviceId) {
  AudioObjectPropertyAddress address = deviceAlivePropertyAddress();
  UInt32 alive = 0;
  UInt32 size = sizeof(alive);
  const OSStatus status = AudioObjectGetPropertyData(deviceId, &address, 0, nullptr, &size, &alive);
  return status == noErr && alive != 0;
}

void notifyCoreAudioDeviceLostIfNeeded(DeviceLostListener* listener) {
  if (!listener || !listener->callback) return;
  const AudioDeviceID deviceId = static_cast<AudioDeviceID>(listener->deviceId);
  if (coreAudioDeviceExists(deviceId) && coreAudioDeviceAlive(deviceId)) return;
  const auto callback = listener->callback;
  callback("CoreAudio output device was removed or became unavailable");
}

OSStatus coreAudioDeviceLostListenerProc(
    AudioObjectID,
    UInt32 numberAddresses,
    const AudioObjectPropertyAddress* addresses,
    void* clientData) {
  auto* listener = static_cast<DeviceLostListener*>(clientData);
  if (!listener) return noErr;
  for (UInt32 index = 0; index < numberAddresses; ++index) {
    const AudioObjectPropertySelector selector = addresses[index].mSelector;
    if (selector == kAudioDevicePropertyDeviceIsAlive || selector == kAudioHardwarePropertyDevices) {
      notifyCoreAudioDeviceLostIfNeeded(listener);
      break;
    }
  }
  return noErr;
}

}  // namespace

struct RealCoreAudioHost::Impl {
  Impl() {
    callbackBufferList.buffers.resize(kMaxCoreAudioCallbackBuffers);
    callbackBufferList.setActiveBufferCount(0);
  }

  CoreAudioRenderCallback renderCallback;
  CoreAudioBufferList callbackBufferList;
  std::mutex listenerMutex;
  CoreAudioListenerToken nextListenerToken = 1;
  std::unordered_map<CoreAudioListenerToken, std::unique_ptr<DeviceLostListener>> deviceLostListeners;
};

RealCoreAudioHost::RealCoreAudioHost() : impl_(std::make_unique<Impl>()) {}

RealCoreAudioHost::~RealCoreAudioHost() = default;

bool RealCoreAudioHost::findOutputDevice(const std::string& requestedDeviceId, CoreAudioDeviceID* outDeviceId, std::string* error) {
  AudioDeviceID deviceId = kAudioObjectUnknown;
  const bool ok = coreaudio::findOutputDevice(requestedDeviceId, &deviceId, error);
  if (ok && outDeviceId) *outDeviceId = deviceId;
  return ok;
}

std::string RealCoreAudioHost::deviceName(CoreAudioDeviceID deviceId) {
  return coreaudio::deviceString(deviceId, kAudioObjectPropertyName);
}

int RealCoreAudioHost::outputChannelCount(CoreAudioDeviceID deviceId) {
  return coreaudio::outputChannelCount(deviceId);
}

double RealCoreAudioHost::getNominalSampleRate(CoreAudioDeviceID deviceId) {
  return coreaudio::nominalSampleRate(deviceId);
}

bool RealCoreAudioHost::setNominalSampleRate(CoreAudioDeviceID deviceId, double rate, std::string* error) {
  return coreaudio::setNominalSampleRate(deviceId, rate, error);
}

bool RealCoreAudioHost::supportsNominalSampleRate(CoreAudioDeviceID deviceId, double rate) {
  return coreaudio::supportsNominalSampleRate(deviceId, rate);
}

std::vector<double> RealCoreAudioHost::availableNominalSampleRates(CoreAudioDeviceID deviceId) {
  return coreaudio::availableNominalSampleRates(deviceId);
}

bool RealCoreAudioHost::deviceOutputStreamFormat(
    CoreAudioDeviceID deviceId,
    CoreAudioStreamBasicDescription* out,
    std::string* error) {
  if (!out) return false;
  AudioStreamBasicDescription native{};
  if (!coreaudio::deviceOutputStreamFormat(deviceId, &native, error)) return false;
  *out = toHostDescription(native);
  return true;
}

bool RealCoreAudioHost::hogModeOwnerPid(CoreAudioDeviceID deviceId, int32_t* ownerPid, std::string* error) {
  const auto address = coreaudio::hogModeAddress();
  if (!coreaudio::supportsHogMode(deviceId)) {
    if (error) *error = "设备不支持 Hog Mode 独占";
    return false;
  }
  pid_t currentOwner = -1;
  UInt32 size = sizeof(currentOwner);
  const OSStatus status = AudioObjectGetPropertyData(deviceId, &address, 0, nullptr, &size, &currentOwner);
  if (!coreaudio::ok(status, error, "无法读取 CoreAudio Hog Mode 现有拥有者")) return false;
  if (ownerPid) *ownerPid = static_cast<int32_t>(currentOwner);
  if (error) error->clear();
  return true;
}

bool RealCoreAudioHost::acquireHogMode(CoreAudioDeviceID deviceId, int32_t* existingOwnerPid, std::string* error) {
  int32_t owner = -1;
  if (!hogModeOwnerPid(deviceId, &owner, error)) return false;
  if (existingOwnerPid) *existingOwnerPid = owner;
  // Do not toggle an existing owner, including another output in this process.
  if (owner != -1) {
    if (error) *error = "CoreAudio 设备已被独占，PID " + std::to_string(owner);
    return false;
  }
  const auto address = coreaudio::hogModeAddress();
  pid_t value = -1;
  const OSStatus status = AudioObjectSetPropertyData(deviceId, &address, 0, nullptr, sizeof(value), &value);
  if (!coreaudio::ok(status, error, "无法获取 CoreAudio Hog Mode")) return false;
  for (int attempt = 0; attempt < 25; ++attempt) {
    if (!hogModeOwnerPid(deviceId, &owner, error)) break;
    if (owner == getpid()) {
      if (error) error->clear();
      return true;
    }
    if (owner != -1) break;
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }
  coreaudio::releaseHogMode(deviceId);
  if (error) *error = "CoreAudio Hog Mode 未取得设备所有权";
  return false;
}

void RealCoreAudioHost::releaseHogMode(CoreAudioDeviceID deviceId) {
  coreaudio::releaseHogMode(deviceId);
}

bool RealCoreAudioHost::findHalOutputUnit(std::string* error) {
  AudioComponentDescription description{};
  description.componentType = kAudioUnitType_Output;
  description.componentSubType = kAudioUnitSubType_HALOutput;
  description.componentManufacturer = kAudioUnitManufacturer_Apple;
  AudioComponent component = AudioComponentFindNext(nullptr, &description);
  if (!component) {
    if (error) *error = "无法找到 CoreAudio HAL Output AudioUnit";
    return false;
  }
  return true;
}

bool RealCoreAudioHost::newAudioUnit(CoreAudioAudioUnit* outUnit, std::string* error) {
  AudioComponentDescription description{};
  description.componentType = kAudioUnitType_Output;
  description.componentSubType = kAudioUnitSubType_HALOutput;
  description.componentManufacturer = kAudioUnitManufacturer_Apple;
  AudioComponent component = AudioComponentFindNext(nullptr, &description);
  if (!component) {
    if (error) *error = "无法找到 CoreAudio HAL Output AudioUnit";
    return false;
  }
  AudioUnit unit = nullptr;
  const OSStatus status = AudioComponentInstanceNew(component, &unit);
  if (!coreaudio::ok(status, error, "无法创建 CoreAudio AudioUnit")) return false;
  if (outUnit) *outUnit = reinterpret_cast<CoreAudioAudioUnit>(unit);
  return true;
}

bool RealCoreAudioHost::enableIOBus(CoreAudioAudioUnit unit, bool input, bool enable, std::string* error) {
  UInt32 value = enable ? 1 : 0;
  const OSStatus status = AudioUnitSetProperty(
      reinterpret_cast<AudioUnit>(unit),
      kAudioOutputUnitProperty_EnableIO,
      input ? kAudioUnitScope_Input : kAudioUnitScope_Output,
      input ? 1 : 0,
      &value,
      sizeof(value));
  return coreaudio::ok(status, error, input ? "无法启用 CoreAudio 输入总线" : "无法启用 CoreAudio 输出总线");
}

bool RealCoreAudioHost::bindDevice(CoreAudioAudioUnit unit, CoreAudioDeviceID deviceId, std::string* error) {
  const OSStatus status = AudioUnitSetProperty(
      reinterpret_cast<AudioUnit>(unit),
      kAudioOutputUnitProperty_CurrentDevice,
      kAudioUnitScope_Global,
      0,
      &deviceId,
      sizeof(deviceId));
  return coreaudio::ok(status, error, "无法绑定 CoreAudio 输出设备");
}

bool RealCoreAudioHost::applyBufferSize(CoreAudioDeviceID deviceId, uint32_t preferredBufferSize, std::string* error) {
  (void)error;
  coreaudio::applyBufferSize(deviceId, preferredBufferSize);
  return true;
}

uint32_t RealCoreAudioHost::currentBufferFrameSize(CoreAudioDeviceID deviceId) {
  return coreaudio::currentBufferFrameSize(deviceId);
}

uint32_t RealCoreAudioHost::estimatedOutputLatencyFrames(CoreAudioDeviceID deviceId) {
  return coreaudio::deviceOutputLatencyFrames(static_cast<AudioDeviceID>(deviceId));
}


bool RealCoreAudioHost::setStreamFormat(
    CoreAudioAudioUnit unit,
    bool input,
    const CoreAudioStreamBasicDescription& format,
    std::string* error) {
  AudioStreamBasicDescription native = toNativeDescription(format);
  const OSStatus status = AudioUnitSetProperty(
      reinterpret_cast<AudioUnit>(unit),
      kAudioUnitProperty_StreamFormat,
      input ? kAudioUnitScope_Input : kAudioUnitScope_Output,
      input ? 0 : 1,
      &native,
      sizeof(native));
  return coreaudio::ok(status, error, input ? "无法设置 CoreAudio 输入流格式" : "无法设置 CoreAudio 输出流格式");
}

bool RealCoreAudioHost::setRenderCallback(CoreAudioAudioUnit unit, CoreAudioRenderCallback callback, std::string* error) {
  impl_->renderCallback = std::move(callback);
  AURenderCallbackStruct renderCallback{};
  renderCallback.inputProc = [](void* userData, AudioUnitRenderActionFlags*, const AudioTimeStamp*, UInt32, UInt32 frameCount, AudioBufferList* ioData) -> OSStatus {
    auto* self = static_cast<RealCoreAudioHost*>(userData);
    if (!self || !self->impl_->renderCallback) return noErr;
    CoreAudioBufferList& hostList = self->impl_->callbackBufferList;
    if (!bindHostBufferList(ioData, &hostList)) {
      silenceNative(ioData);
      return noErr;
    }
    const size_t rendered = self->impl_->renderCallback(frameCount, hostList);
    publishHostBufferSizes(ioData, hostList);
    return rendered <= frameCount ? noErr : noErr;
  };
  renderCallback.inputProcRefCon = this;
  const OSStatus status = AudioUnitSetProperty(
      reinterpret_cast<AudioUnit>(unit),
      kAudioUnitProperty_SetRenderCallback,
      kAudioUnitScope_Input,
      0,
      &renderCallback,
      sizeof(renderCallback));
  return coreaudio::ok(status, error, "无法设置 CoreAudio 渲染回调");
}

bool RealCoreAudioHost::audioUnitInitialize(CoreAudioAudioUnit unit, std::string* error) {
  return coreaudio::ok(AudioUnitInitialize(reinterpret_cast<AudioUnit>(unit)), error, "无法初始化 CoreAudio AudioUnit");
}

bool RealCoreAudioHost::audioUnitStart(CoreAudioAudioUnit unit, std::string* error) {
  return coreaudio::ok(AudioOutputUnitStart(reinterpret_cast<AudioUnit>(unit)), error, "无法启动 CoreAudio 输出");
}

void RealCoreAudioHost::audioUnitStop(CoreAudioAudioUnit unit) {
  AudioOutputUnitStop(reinterpret_cast<AudioUnit>(unit));
}

void RealCoreAudioHost::audioUnitUninitialize(CoreAudioAudioUnit unit) {
  AudioUnitUninitialize(reinterpret_cast<AudioUnit>(unit));
}

void RealCoreAudioHost::disposeAudioUnit(CoreAudioAudioUnit unit) {
  AudioComponentInstanceDispose(reinterpret_cast<AudioUnit>(unit));
}

CoreAudioListenerToken RealCoreAudioHost::addDeviceLostListener(
    CoreAudioDeviceID deviceId,
    CoreAudioDeviceLostCallback callback,
    std::string* error) {
  if (!callback) {
    if (error) *error = "CoreAudio device lost callback is empty";
    return 0;
  }

  auto listener = std::make_unique<DeviceLostListener>();
  {
    std::lock_guard lock(impl_->listenerMutex);
    listener->token = impl_->nextListenerToken++;
  }
  listener->deviceId = deviceId;
  listener->callback = std::move(callback);
  auto* rawListener = listener.get();

  AudioObjectPropertyAddress aliveAddress = deviceAlivePropertyAddress();
  OSStatus status = AudioObjectAddPropertyListener(
      static_cast<AudioDeviceID>(deviceId),
      &aliveAddress,
      coreAudioDeviceLostListenerProc,
      rawListener);
  if (!coreaudio::ok(status, error, "无法监听 CoreAudio 设备在线状态")) return 0;

  AudioObjectPropertyAddress devicesAddress = hardwareDevicesPropertyAddress();
  status = AudioObjectAddPropertyListener(
      kAudioObjectSystemObject,
      &devicesAddress,
      coreAudioDeviceLostListenerProc,
      rawListener);
  if (!coreaudio::ok(status, error, "无法监听 CoreAudio 设备列表变化")) {
    AudioObjectRemovePropertyListener(
        static_cast<AudioDeviceID>(deviceId),
        &aliveAddress,
        coreAudioDeviceLostListenerProc,
        rawListener);
    return 0;
  }

  const CoreAudioListenerToken token = listener->token;
  {
    std::lock_guard lock(impl_->listenerMutex);
    impl_->deviceLostListeners[token] = std::move(listener);
  }
  if (error) error->clear();
  return token;
}

void RealCoreAudioHost::removeDeviceLostListener(CoreAudioDeviceID deviceId, CoreAudioListenerToken token) {
  std::unique_ptr<DeviceLostListener> listener;
  {
    std::lock_guard lock(impl_->listenerMutex);
    auto it = impl_->deviceLostListeners.find(token);
    if (it == impl_->deviceLostListeners.end()) return;
    listener = std::move(it->second);
    impl_->deviceLostListeners.erase(it);
  }

  AudioObjectPropertyAddress aliveAddress = deviceAlivePropertyAddress();
  AudioObjectRemovePropertyListener(
      static_cast<AudioDeviceID>(deviceId),
      &aliveAddress,
      coreAudioDeviceLostListenerProc,
      listener.get());
  AudioObjectPropertyAddress devicesAddress = hardwareDevicesPropertyAddress();
  AudioObjectRemovePropertyListener(
      kAudioObjectSystemObject,
      &devicesAddress,
      coreAudioDeviceLostListenerProc,
      listener.get());
}

std::unique_ptr<ICoreAudioHost> createRealCoreAudioHost() {
  return std::make_unique<RealCoreAudioHost>();
}

}  // namespace twilight::audio

#endif
