#include "Win32PcmWorkerTransform.h"
#include "../pcm-worker/PcmWorkerProtocol.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstring>
#include <filesystem>
#include <mutex>
#include <thread>

#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#endif

namespace twilight::audio {
namespace {
using namespace pcm_worker;

uint64_t steadyMilliseconds() {
  return static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::steady_clock::now().time_since_epoch()).count());
}
uint64_t epochMilliseconds() {
  return static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::system_clock::now().time_since_epoch()).count());
}

class Worker final : public IPcmStreamTransform {
 public:
  explicit Worker(PcmWorkerSpec spec) : spec_(std::move(spec)) {
#if defined(_WIN32)
    watchdog_ = std::thread([this] {
      while (!stopping_.load()) {
        const auto deadline = deadline_.load();
        if (deadline && steadyMilliseconds() >= deadline) cancel();
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
      }
    });
#endif
  }
  ~Worker() override {
    stopping_ = true;
    cancel();
#if defined(_WIN32)
    if (watchdog_.joinable()) watchdog_.join();
    for (auto handle : {input_, output_, process_, job_}) if (handle) CloseHandle(handle);
#endif
  }

  bool prepare(const PcmStreamTransformInput& input, AudioFormat* output, std::string* error) override {
    if (prepared_ || !output || input.format.sampleFormat != AudioSampleFormat::Float32Interleaved ||
        input.format.sampleRate < 8000 || input.format.sampleRate > 768000 ||
        input.format.channelCount < 1 || input.format.channelCount > static_cast<int>(kMaximumChannels))
      return fail(error);
    if (!start(error)) return false;
    Init request{static_cast<uint32_t>(input.format.sampleRate),
                 static_cast<uint32_t>(input.format.channelCount), input.encodedBitrate};
    std::vector<uint8_t> bytes;
    if (!exchange(Operation::Init, &request, sizeof(request), bytes, error, 20000) ||
        bytes.size() != sizeof(Format)) return fail(error);
    Format format{};
    std::memcpy(&format, bytes.data(), sizeof(format));
    if (format.sampleRate < 8000 || format.sampleRate > 768000 || !format.channels ||
        format.channels > kMaximumChannels) return fail(error);
    inputChannels_ = input.format.channelCount;
    outputChannels_ = format.channels;
    *output = input.format;
    output->sampleRate = format.sampleRate;
    output->channelCount = format.channels;
    output->bitDepth = 32;
    output->sampleFormat = AudioSampleFormat::Float32Interleaved;
    prepared_ = true;
    return true;
  }

  bool push(const float* input, size_t frames, std::string* error) override {
    if (!prepared_ || finished_ || !input || !frames || frames > kMaximumFrames) return fail(error);
    const size_t samples = frames * inputChannels_;
    if (!std::all_of(input, input + samples, [](float value) { return std::isfinite(value); })) return fail(error);
    std::vector<uint8_t> reply;
    return exchange(Operation::Push, input, samples * sizeof(float), reply, error) &&
           (reply.empty() || fail(error));
  }

  bool pull(float* output, size_t capacityFrames, PcmStreamTransformReadResult* result,
            std::string* error) override {
    if (!prepared_ || !output || !result || !capacityFrames || capacityFrames > kMaximumFrames) return fail(error);
    Pull request{static_cast<uint32_t>(capacityFrames)};
    std::vector<uint8_t> bytes;
    if (!exchange(Operation::Pull, &request, sizeof(request), bytes, error) || bytes.size() < sizeof(Read))
      return fail(error);
    Read reply{};
    std::memcpy(&reply, bytes.data(), sizeof(reply));
    const size_t sampleCount = static_cast<size_t>(reply.frames) * outputChannels_;
    if (reply.frames > capacityFrames || bytes.size() != sizeof(Read) + sampleCount * sizeof(float) ||
        (reply.status != ReadStatus::Output && reply.frames != 0) ||
        (reply.status == ReadStatus::Output && !reply.frames) ||
        (reply.status == ReadStatus::Finished && !finished_) ||
        (reply.status == ReadStatus::NeedInput && finished_)) return fail(error);
    if (sampleCount) {
      std::memcpy(output, bytes.data() + sizeof(Read), sampleCount * sizeof(float));
      if (!std::all_of(output, output + sampleCount, [](float value) { return std::isfinite(value); }))
        return fail(error);
    }
    switch (reply.status) {
      case ReadStatus::NeedInput: result->status = PcmStreamTransformReadStatus::NeedInput; break;
      case ReadStatus::Output: result->status = PcmStreamTransformReadStatus::Output; break;
      case ReadStatus::Finished: result->status = PcmStreamTransformReadStatus::Finished; break;
      default: return fail(error);
    }
    result->frames = reply.frames;
    return true;
  }

  bool finish(std::string* error) override {
    if (!prepared_ || finished_) return fail(error);
    std::vector<uint8_t> reply;
    if (!exchange(Operation::Finish, nullptr, 0, reply, error) || !reply.empty()) return fail(error);
    finished_ = true;
    return true;
  }

  void cancel() noexcept override {
    cancelled_ = true;
#if defined(_WIN32)
    std::lock_guard<std::mutex> lock(processMutex_);
    if (job_) TerminateJobObject(job_, 1);
    if (process_) TerminateProcess(process_, 1);
#endif
  }

 private:
  bool fail(std::string* error) {
    if (error) *error = "PCM 音效工作进程不可用或已取消";
    cancel();
    return false;
  }
  bool live() const { return !cancelled_.load() && spec_.expiresAt > epochMilliseconds(); }

#if defined(_WIN32)
  static std::wstring wide(const std::string& input) {
    if (input.empty() || input.find('\0') != std::string::npos) return {};
    int count = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, input.data(), static_cast<int>(input.size()), nullptr, 0);
    if (count <= 0) return {};
    std::wstring result(count, L'\0');
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, input.data(), static_cast<int>(input.size()), result.data(), count);
    return result;
  }
  static std::wstring quote(const std::wstring& input) {
    std::wstring output = L"\"";
    size_t slashes = 0;
    for (const auto ch : input) {
      if (ch == L'\\') { ++slashes; continue; }
      output.append(ch == L'"' ? slashes * 2 + 1 : slashes, L'\\');
      output += ch;
      slashes = 0;
    }
    output.append(slashes * 2, L'\\');
    return output + L'"';
  }
#endif

  bool start(std::string* error) {
#if defined(_WIN32)
    if (!live() || spec_.arguments.size() > 8 || spec_.executable.size() > 4096) return fail(error);
    const auto executable = wide(spec_.executable);
    if (executable.empty() || !std::filesystem::path(executable).is_absolute()) return fail(error);
    std::wstring command = quote(executable);
    for (const auto& argument : spec_.arguments) {
      const auto value = wide(argument);
      if (argument.size() > 4096 || (!argument.empty() && value.empty())) return fail(error);
      command += L" " + quote(value);
    }
    SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
    HANDLE childInput = nullptr, childOutput = nullptr, nullError = nullptr;
    auto cleanup = [&] {
      for (auto handle : {childInput, childOutput, nullError}) if (handle) CloseHandle(handle);
    };
    if (!CreatePipe(&childInput, &input_, &security, 65536) ||
        !CreatePipe(&output_, &childOutput, &security, 65536) ||
        !SetHandleInformation(input_, HANDLE_FLAG_INHERIT, 0) ||
        !SetHandleInformation(output_, HANDLE_FLAG_INHERIT, 0)) {
      cleanup(); return fail(error);
    }
    nullError = CreateFileW(L"NUL", GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
                            &security, OPEN_EXISTING, 0, nullptr);
    if (nullError == INVALID_HANDLE_VALUE) { nullError = nullptr; cleanup(); return fail(error); }
    STARTUPINFOEXW startup{};
    startup.StartupInfo.cb = sizeof(startup);
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = childInput;
    startup.StartupInfo.hStdOutput = childOutput;
    startup.StartupInfo.hStdError = nullError;
    SIZE_T attributeBytes = 0;
    InitializeProcThreadAttributeList(nullptr, 1, 0, &attributeBytes);
    std::vector<uint8_t> attributes(attributeBytes);
    startup.lpAttributeList = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attributes.data());
    const HANDLE handles[] = {childInput, childOutput, nullError};
    if (!InitializeProcThreadAttributeList(startup.lpAttributeList, 1, 0, &attributeBytes)) {
      cleanup(); return fail(error);
    }
    if (!UpdateProcThreadAttribute(startup.lpAttributeList, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                                   const_cast<HANDLE*>(handles), sizeof(handles), nullptr, nullptr)) {
      DeleteProcThreadAttributeList(startup.lpAttributeList); cleanup(); return fail(error);
    }
    wchar_t windowsPath[MAX_PATH + 1]{};
    const auto pathLength = GetWindowsDirectoryW(windowsPath, MAX_PATH);
    if (!pathLength || pathLength >= MAX_PATH) {
      DeleteProcThreadAttributeList(startup.lpAttributeList); cleanup(); return fail(error);
    }
    std::wstring environment = std::wstring(L"SystemRoot=") + windowsPath;
    environment.push_back(L'\0');
    environment += std::wstring(L"WINDIR=") + windowsPath;
    environment.append(2, L'\0');
    PROCESS_INFORMATION process{};
    const auto cwd = std::filesystem::path(executable).parent_path().wstring();
    const bool created = CreateProcessW(executable.c_str(), command.data(), nullptr, nullptr, TRUE,
        CREATE_NO_WINDOW | CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT,
        environment.data(), cwd.c_str(), &startup.StartupInfo, &process) != FALSE;
    DeleteProcThreadAttributeList(startup.lpAttributeList);
    cleanup();
    if (!created) return fail(error);
    bool started = false;
    {
      std::lock_guard<std::mutex> lock(processMutex_);
      process_ = process.hProcess;
      job_ = CreateJobObjectW(nullptr, nullptr);
      JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
      limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
      started = live() && job_ && SetInformationJobObject(job_, JobObjectExtendedLimitInformation,
          &limits, sizeof(limits)) && AssignProcessToJobObject(job_, process_) &&
          ResumeThread(process.hThread) != static_cast<DWORD>(-1);
    }
    CloseHandle(process.hThread);
    if (!started) return fail(error);
    return true;
#else
    return fail(error);
#endif
  }

  bool exchange(Operation operation, const void* input, size_t size, std::vector<uint8_t>& result,
                std::string* error, uint64_t timeoutMs = 5000) {
#if defined(_WIN32)
    if (!live() || size > kMaximumPayload) return fail(error);
    deadline_ = steadyMilliseconds() + timeoutMs;
    struct ClearDeadline { std::atomic<uint64_t>& value; ~ClearDeadline() { value = 0; } } clear{deadline_};
    Header request{};
    request.operation = operation;
    request.sequence = ++sequence_;
    request.bytes = static_cast<uint32_t>(size);
    auto write = [&](const void* data, size_t length) {
      const auto* bytes = static_cast<const uint8_t*>(data);
      while (length && live()) {
        DWORD wrote = 0;
        if (!WriteFile(input_, bytes, static_cast<DWORD>(std::min<size_t>(length, 65536)), &wrote, nullptr) || !wrote)
          return false;
        bytes += wrote; length -= wrote;
      }
      return !length;
    };
    auto read = [&](void* data, size_t length) {
      auto* bytes = static_cast<uint8_t*>(data);
      while (length && live()) {
        DWORD available = 0, got = 0;
        if (!PeekNamedPipe(output_, nullptr, 0, nullptr, &available, nullptr)) return false;
        if (!available) {
          if (WaitForSingleObject(process_, 0) != WAIT_TIMEOUT) return false;
          std::this_thread::sleep_for(std::chrono::milliseconds(1));
          continue;
        }
        if (!ReadFile(output_, bytes, static_cast<DWORD>(std::min<size_t>(length, available)), &got, nullptr) || !got)
          return false;
        bytes += got; length -= got;
      }
      return !length;
    };
    Header response{};
    if (!write(&request, sizeof(request)) || (size && !write(input, size)) || !read(&response, sizeof(response)) ||
        response.magic != kMagic || response.version != kVersion || response.operation != operation ||
        response.sequence != request.sequence || response.status != 0 || response.bytes > kMaximumPayload)
      return fail(error);
    result.resize(response.bytes);
    if (response.bytes && !read(result.data(), result.size())) return fail(error);
    return live() || fail(error);
#else
    return fail(error);
#endif
  }

  PcmWorkerSpec spec_;
  std::atomic<bool> cancelled_{false}, stopping_{false};
  std::atomic<uint64_t> deadline_{0};
  uint32_t sequence_ = 0, inputChannels_ = 0, outputChannels_ = 0;
  bool prepared_ = false, finished_ = false;
#if defined(_WIN32)
  HANDLE input_ = nullptr, output_ = nullptr, process_ = nullptr, job_ = nullptr;
  std::mutex processMutex_;
  std::thread watchdog_;
#endif
};
}  // namespace

std::unique_ptr<IPcmStreamTransform> createPcmWorkerTransform(PcmWorkerSpec spec) {
  return std::make_unique<Worker>(std::move(spec));
}
}  // namespace twilight::audio
