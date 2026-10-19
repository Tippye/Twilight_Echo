#pragma once

#include "../../core/AudioTypes.h"
#include "../IOutputBackend.h"

#include <algorithm>
#include <cmath>
#include <chrono>
#include <thread>
#include <cstring>
#include <limits>
#include <string>
#include <vector>

#if defined(__APPLE__) && defined(TAE_ENABLE_COREAUDIO)
#include <AudioToolbox/AudioToolbox.h>
#include <AudioUnit/AudioUnit.h>
#include <CoreAudio/CoreAudio.h>
#include <CoreFoundation/CoreFoundation.h>
#include <unistd.h>

#ifndef kAudioObjectPropertyElementMain
#define kAudioObjectPropertyElementMain kAudioObjectPropertyElementMaster
#endif
#endif

namespace twilight::audio::coreaudio {

#if defined(__APPLE__) && defined(TAE_ENABLE_COREAUDIO)

inline std::string osStatusMessage(OSStatus status, const char* context) {
  char code[8] = {};
  const UInt32 be = CFSwapInt32HostToBig(static_cast<UInt32>(status));
  std::memcpy(code, &be, sizeof(UInt32));
  for (char& ch : code) {
    if (ch < 32 || ch > 126) ch = '.';
  }
  return std::string(context) + " (OSStatus " + std::to_string(status) + ", '" + code + "')";
}

inline bool ok(OSStatus status, std::string* error, const char* context) {
  if (status == noErr) return true;
  if (error) *error = osStatusMessage(status, context);
  return false;
}

inline std::string cfStringToUtf8(CFStringRef value) {
  if (!value) return {};
  char stack[512] = {};
  if (CFStringGetCString(value, stack, sizeof(stack), kCFStringEncodingUTF8)) {
    return stack;
  }
  const CFIndex length = CFStringGetLength(value);
  const CFIndex maxSize = CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8) + 1;
  if (maxSize <= 1) return {};
  std::string out(static_cast<size_t>(maxSize), '\0');
  if (!CFStringGetCString(value, out.data(), maxSize, kCFStringEncodingUTF8)) return {};
  out.resize(std::strlen(out.c_str()));
  return out;
}

inline std::string deviceString(AudioDeviceID id, AudioObjectPropertySelector selector) {
  AudioObjectPropertyAddress address{selector, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
  CFStringRef value = nullptr;
  UInt32 size = sizeof(value);
  if (AudioObjectGetPropertyData(id, &address, 0, nullptr, &size, &value) != noErr || !value) return {};
  std::string out = cfStringToUtf8(value);
  CFRelease(value);
  return out;
}

inline UInt32 deviceUInt32(
    AudioDeviceID id, AudioObjectPropertySelector selector, AudioObjectPropertyScope scope) {
  AudioObjectPropertyAddress address{selector, scope, kAudioObjectPropertyElementMain};
  UInt32 value = 0;
  UInt32 size = sizeof(value);
  if (AudioObjectGetPropertyData(id, &address, 0, nullptr, &size, &value) != noErr) return 0;
  return value;
}

inline double nominalSampleRate(AudioDeviceID id) {
  AudioObjectPropertyAddress address{
      kAudioDevicePropertyNominalSampleRate,
      kAudioObjectPropertyScopeGlobal,
      kAudioObjectPropertyElementMain};
  Float64 value = 0.0;
  UInt32 size = sizeof(value);
  if (AudioObjectGetPropertyData(id, &address, 0, nullptr, &size, &value) != noErr) return 0.0;
  return value;
}

inline int outputChannelCount(AudioDeviceID id) {
  AudioObjectPropertyAddress address{
      kAudioDevicePropertyStreamConfiguration,
      kAudioDevicePropertyScopeOutput,
      kAudioObjectPropertyElementMain};
  UInt32 size = 0;
  if (AudioObjectGetPropertyDataSize(id, &address, 0, nullptr, &size) != noErr || size == 0) return 0;
  std::vector<uint8_t> storage(size);
  if (AudioObjectGetPropertyData(id, &address, 0, nullptr, &size, storage.data()) != noErr) return 0;
  auto* list = reinterpret_cast<AudioBufferList*>(storage.data());
  int channels = 0;
  for (UInt32 i = 0; i < list->mNumberBuffers; ++i) {
    channels += static_cast<int>(list->mBuffers[i].mNumberChannels);
  }
  return channels;
}

inline AudioSampleFormat sampleFormatFromStreamDescription(const AudioStreamBasicDescription& format) {
  if (format.mFormatID != kAudioFormatLinearPCM) return AudioSampleFormat::Float32Interleaved;
  if ((format.mFormatFlags & kAudioFormatFlagIsFloat) != 0 && format.mBitsPerChannel == 32) {
    return AudioSampleFormat::Float32Interleaved;
  }
  if ((format.mFormatFlags & kAudioFormatFlagIsSignedInteger) != 0) {
    if (format.mBitsPerChannel <= 16) return AudioSampleFormat::Int16Interleaved;
    if (format.mBitsPerChannel == 24 && format.mBytesPerFrame == format.mChannelsPerFrame * 3) {
      return AudioSampleFormat::Int24Interleaved;
    }
    if (format.mBitsPerChannel == 24) return AudioSampleFormat::Int24In32Interleaved;
    if (format.mBitsPerChannel >= 32) return AudioSampleFormat::Int32Interleaved;
  }
  return AudioSampleFormat::Float32Interleaved;
}

inline bool defaultOutputDevice(AudioDeviceID* out, std::string* error) {
  AudioObjectPropertyAddress address{
      kAudioHardwarePropertyDefaultOutputDevice,
      kAudioObjectPropertyScopeGlobal,
      kAudioObjectPropertyElementMain};
  UInt32 size = sizeof(*out);
  const OSStatus status =
      AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, nullptr, &size, out);
  return ok(status, error, "无法读取 CoreAudio 默认输出设备");
}

inline bool findOutputDevice(const std::string& requested, AudioDeviceID* out, std::string* error) {
  if (requested.empty() || requested == "auto" || requested == "default") {
    return defaultOutputDevice(out, error);
  }

  AudioObjectPropertyAddress address{
      kAudioHardwarePropertyDevices,
      kAudioObjectPropertyScopeGlobal,
      kAudioObjectPropertyElementMain};
  UInt32 size = 0;
  OSStatus status = AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &address, 0, nullptr, &size);
  if (!ok(status, error, "无法枚举 CoreAudio 设备")) return false;
  std::vector<AudioDeviceID> devices(size / sizeof(AudioDeviceID));
  status = AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, nullptr, &size, devices.data());
  if (!ok(status, error, "无法读取 CoreAudio 设备列表")) return false;

  for (AudioDeviceID candidate : devices) {
    if (outputChannelCount(candidate) <= 0) continue;
    const std::string uid = deviceString(candidate, kAudioDevicePropertyDeviceUID);
    const std::string name = deviceString(candidate, kAudioObjectPropertyName);
    if (uid == requested || name == requested) {
      *out = candidate;
      return true;
    }
  }

  if (error) *error = "无法找到请求的 CoreAudio 输出设备：" + requested;
  return false;
}

inline void applyBufferSize(AudioDeviceID deviceId, uint32_t preferredBufferSize) {
  if (preferredBufferSize == 0 || deviceId == kAudioObjectUnknown) return;
  AudioObjectPropertyAddress address{
      kAudioDevicePropertyBufferFrameSize,
      kAudioDevicePropertyScopeOutput,
      kAudioObjectPropertyElementMain};
  Boolean writable = false;
  if (AudioObjectIsPropertySettable(deviceId, &address, &writable) != noErr || writable == 0) return;
  UInt32 frames = preferredBufferSize;
  AudioObjectSetPropertyData(deviceId, &address, 0, nullptr, sizeof(frames), &frames);
}

inline uint32_t currentBufferFrameSize(AudioDeviceID deviceId) {
  if (deviceId == kAudioObjectUnknown) return 0;
  return deviceUInt32(
      deviceId,
      kAudioDevicePropertyBufferFrameSize,
      kAudioDevicePropertyScopeOutput);
}

inline uint32_t deviceOutputLatencyFrames(AudioDeviceID deviceId) {
  if (deviceId == kAudioObjectUnknown) return 0;
  const uint32_t deviceLatency = deviceUInt32(
      deviceId,
      kAudioDevicePropertyLatency,
      kAudioDevicePropertyScopeOutput);
  const uint32_t safetyOffset = deviceUInt32(
      deviceId,
      kAudioDevicePropertySafetyOffset,
      kAudioDevicePropertyScopeOutput);
  return deviceLatency + safetyOffset;
}


inline std::vector<double> availableNominalSampleRates(AudioDeviceID id) {
  std::vector<double> rates;
  AudioObjectPropertyAddress address{
      kAudioDevicePropertyAvailableNominalSampleRates,
      kAudioObjectPropertyScopeGlobal,
      kAudioObjectPropertyElementMain};
  UInt32 size = 0;
  if (AudioObjectGetPropertyDataSize(id, &address, 0, nullptr, &size) != noErr || size == 0) return rates;
  std::vector<uint8_t> storage(size);
  if (AudioObjectGetPropertyData(id, &address, 0, nullptr, &size, storage.data()) != noErr) return rates;
  const auto* ranges = reinterpret_cast<const AudioValueRange*>(storage.data());
  const size_t count = size / sizeof(AudioValueRange);
  for (size_t i = 0; i < count; ++i) {
    if (ranges[i].mMinimum == ranges[i].mMaximum) {
      rates.push_back(ranges[i].mMinimum);
    } else {
      rates.push_back(ranges[i].mMinimum);
      rates.push_back(ranges[i].mMaximum);
    }
  }
  return rates;
}

inline bool supportsNominalSampleRate(AudioDeviceID id, double rate) {
  AudioObjectPropertyAddress address{
      kAudioDevicePropertyAvailableNominalSampleRates,
      kAudioObjectPropertyScopeGlobal,
      kAudioObjectPropertyElementMain};
  UInt32 size = 0;
  if (AudioObjectGetPropertyDataSize(id, &address, 0, nullptr, &size) != noErr || size == 0) return false;
  std::vector<AudioValueRange> ranges(size / sizeof(AudioValueRange));
  if (ranges.empty() || AudioObjectGetPropertyData(id, &address, 0, nullptr, &size, ranges.data()) != noErr) return false;
  for (const auto& range : ranges) {
    if (rate >= range.mMinimum - 0.5 && rate <= range.mMaximum + 0.5) return true;
  }
  return false;
}

inline bool setNominalSampleRate(AudioDeviceID id, double rate, std::string* error) {
  AudioObjectPropertyAddress address{
      kAudioDevicePropertyNominalSampleRate,
      kAudioObjectPropertyScopeGlobal,
      kAudioObjectPropertyElementMain};
  Float64 value = rate;
  const OSStatus status = AudioObjectSetPropertyData(id, &address, 0, nullptr, sizeof(value), &value);
  if (!ok(status, error, "无法设置 CoreAudio 设备标称采样率")) return false;
  // HAL changes are asynchronous; only publish a rate after the device confirms it.
  for (int attempt = 0; attempt < 25; ++attempt) {
    if (std::abs(nominalSampleRate(id) - rate) < 0.5) {
      if (error) error->clear();
      return true;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }
  if (error) *error = "CoreAudio 设备采样率切换未生效";
  return false;
}

inline AudioObjectPropertyAddress hogModeAddress() {
  return {kAudioDevicePropertyHogMode, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
}

inline bool supportsHogMode(AudioDeviceID id) {
  const auto address = hogModeAddress();
  Boolean writable = false;
  return id != kAudioObjectUnknown && AudioObjectHasProperty(id, &address) &&
         AudioObjectIsPropertySettable(id, &address, &writable) == noErr && writable;
}

inline void releaseHogMode(AudioDeviceID id) {
  if (id == kAudioObjectUnknown) return;
  const auto address = hogModeAddress();
  pid_t owner = -1;
  UInt32 size = sizeof(owner);
  // Hog Mode is a toggle. Never write it unless this process still owns it.
  if (AudioObjectGetPropertyData(id, &address, 0, nullptr, &size, &owner) == noErr && owner == getpid()) {
    AudioObjectSetPropertyData(id, &address, 0, nullptr, sizeof(owner), &owner);
  }
}

inline bool deviceOutputStreamFormat(AudioDeviceID id, AudioStreamBasicDescription* out, std::string* error) {
  if (!out) return false;
  *out = {};
  AudioObjectPropertyAddress streamAddress{
      kAudioDevicePropertyStreams,
      kAudioDevicePropertyScopeOutput,
      kAudioObjectPropertyElementMain};
  UInt32 size = 0;
  if (AudioObjectGetPropertyDataSize(id, &streamAddress, 0, nullptr, &size) != noErr || size == 0) {
    if (error) *error = "无法读取 CoreAudio 输出流列表";
    return false;
  }
  std::vector<AudioStreamID> streams(size / sizeof(AudioStreamID));
  if (AudioObjectGetPropertyData(id, &streamAddress, 0, nullptr, &size, streams.data()) != noErr || streams.empty()) {
    if (error) *error = "无法读取 CoreAudio 输出流";
    return false;
  }

  AudioObjectPropertyAddress formatAddress{
      kAudioStreamPropertyVirtualFormat,
      kAudioObjectPropertyScopeGlobal,
      kAudioObjectPropertyElementMain};
  UInt32 formatSize = sizeof(*out);
  const OSStatus status = AudioObjectGetPropertyData(streams[0], &formatAddress, 0, nullptr, &formatSize, out);
  return ok(status, error, "无法读取 CoreAudio 流虚拟格式");
}

inline int32_t floatToSignedInt(float sample, int bits) {
  const double clamped = std::clamp(static_cast<double>(sample), -1.0, 1.0);
  if (bits == 16) {
    return static_cast<int32_t>(std::clamp(
        std::llround(clamped * 32768.0),
        static_cast<long long>(std::numeric_limits<int16_t>::min()),
        static_cast<long long>(std::numeric_limits<int16_t>::max())));
  }
  if (bits == 24) {
    return static_cast<int32_t>(std::clamp(std::llround(clamped * 8388608.0), -8388608LL, 8388607LL));
  }
  const long long value = std::clamp(
      std::llround(clamped * 2147483648.0),
      static_cast<long long>(std::numeric_limits<int32_t>::min()),
      static_cast<long long>(std::numeric_limits<int32_t>::max()));
  return static_cast<int32_t>(value);
}

inline void packFloatToPcm(
    const float* input,
    size_t frameCount,
    int channelCount,
    AudioSampleFormat sampleFormat,
    uint8_t* output) {
  if (!input || !output || frameCount == 0 || channelCount <= 0) return;

  const size_t sampleCount = frameCount * static_cast<size_t>(channelCount);
  switch (sampleFormat) {
    case AudioSampleFormat::Int16Interleaved: {
      auto* out = reinterpret_cast<int16_t*>(output);
      for (size_t i = 0; i < sampleCount; ++i) {
        out[i] = static_cast<int16_t>(floatToSignedInt(input[i], 16));
      }
      break;
    }
    case AudioSampleFormat::Int24Interleaved: {
      for (size_t i = 0; i < sampleCount; ++i) {
        const auto value = static_cast<uint32_t>(floatToSignedInt(input[i], 24));
        output[i * 3 + 0] = static_cast<uint8_t>(value & 0xff);
        output[i * 3 + 1] = static_cast<uint8_t>((value >> 8) & 0xff);
        output[i * 3 + 2] = static_cast<uint8_t>((value >> 16) & 0xff);
      }
      break;
    }
    case AudioSampleFormat::Int24In32Interleaved: {
      auto* out = reinterpret_cast<int32_t*>(output);
      for (size_t i = 0; i < sampleCount; ++i) {
        out[i] = static_cast<int32_t>(static_cast<uint32_t>(floatToSignedInt(input[i], 24)) << 8);
      }
      break;
    }
    case AudioSampleFormat::Int32Interleaved: {
      auto* out = reinterpret_cast<int32_t*>(output);
      for (size_t i = 0; i < sampleCount; ++i) {
        out[i] = floatToSignedInt(input[i], 32);
      }
      break;
    }
    case AudioSampleFormat::Float32Interleaved:
      std::memcpy(output, input, sampleCount * sizeof(float));
      break;
    default:
      std::fill(output, output + sampleCount * sizeof(float), 0);
      break;
  }
}

inline AudioFormat dopCandidateForRequestedFormat(const AudioFormat& requestedFormat) {
  if (isDopCarrierFormat(requestedFormat)) return requestedFormat;

  AudioFormat candidate;
  candidate.channelCount = requestedFormat.channelCount;
  candidate.bitDepth = 24;
  candidate.sampleFormat = AudioSampleFormat::Int24Interleaved;
  switch (requestedFormat.sampleRate) {
    case 2822400:
      candidate.sampleRate = 176400;
      return candidate;
    case 5644800:
      candidate.sampleRate = 352800;
      return candidate;
    default:
      return {};
  }
}

inline DopRuntimeFacts unprovenDopRuntimeFacts(
    const AudioFormat& requestedFormat,
    const AudioFormat& actualFormat,
    const std::string& reason) {
  DopRuntimeFacts facts;
  const AudioFormat candidateFormat = dopCandidateForRequestedFormat(requestedFormat);
  const bool dopLikeRequest = requestedFormat.sampleRate >= 2500000 || isDopCarrierFormat(requestedFormat);
  if (!dopLikeRequest && !isDopCarrierFormat(actualFormat)) return facts;

  facts.state = DopRuntimeFactState::Unproven;
  facts.candidateFormat = candidateFormat;
  facts.actualFormat = isDopCarrierFormat(actualFormat) ? actualFormat : AudioFormat{};
  facts.reason = reason;
  return facts;
}

#endif

}  // namespace twilight::audio::coreaudio
