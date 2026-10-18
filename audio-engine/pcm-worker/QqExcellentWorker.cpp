#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <bcrypt.h>
#include <io.h>
#include <fcntl.h>

#include "PcmWorkerProtocol.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <limits>
#include <string>
#include <vector>

#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "bcrypt.lib")

// This executable has no account/session/network interface. The caller owns
// authorization and source binding. Native DLLs and models remain installed.
// Evidence: docs/aegis/work/2026-10-14-qqmusic-adaptation/qq-task13-quality-worker-projection.json.
namespace {
using namespace twilight::audio::pcm_worker;
static_assert(sizeof(void*) == 4, "QQ Music's installed DSP ABI is x86");
constexpr size_t kMaximumQueuedSamples = kMaximumPayload / sizeof(float);
constexpr size_t kNativeInputSamples = 8192 * 2;
constexpr size_t kNativeOutputSamples = kMaximumFrames * 2;
HANDLE gOutput = nullptr;
Header gRequest{};

bool writeAll(HANDLE handle, const void* data, size_t size) noexcept {
  const auto* bytes = static_cast<const uint8_t*>(data);
  while (size) {
    DWORD wrote = 0;
    const auto part = static_cast<DWORD>(std::min<size_t>(size, 65536));
    if (!WriteFile(handle, bytes, part, &wrote, nullptr) || !wrote) return false;
    bytes += wrote;
    size -= wrote;
  }
  return true;
}

enum class InputResult { Complete, CleanEof, Incomplete };
InputResult readAll(HANDLE handle, void* data, size_t size) noexcept {
  auto* bytes = static_cast<uint8_t*>(data);
  size_t gotTotal = 0;
  while (gotTotal < size) {
    DWORD got = 0;
    if (!ReadFile(handle, bytes + gotTotal,
                  static_cast<DWORD>(std::min<size_t>(size - gotTotal, 65536)), &got, nullptr))
      return gotTotal == 0 && GetLastError() == ERROR_BROKEN_PIPE ? InputResult::CleanEof
                                                               : InputResult::Incomplete;
    if (!got) return gotTotal ? InputResult::Incomplete : InputResult::CleanEof;
    gotTotal += got;
  }
  return InputResult::Complete;
}

bool reply(const Header& request, const void* body = nullptr, size_t size = 0,
           uint32_t status = 0) noexcept {
  Header response{};
  response.operation = request.operation;
  response.sequence = request.sequence;
  response.bytes = status ? 0 : static_cast<uint32_t>(size);
  response.status = status;
  return writeAll(gOutput, &response, sizeof(response)) &&
         (!response.bytes || writeAll(gOutput, body, response.bytes));
}

LONG WINAPI unhandledException(EXCEPTION_POINTERS*) noexcept {
  reply(gRequest, nullptr, 0, 1);
  TerminateProcess(GetCurrentProcess(), 1);
  return EXCEPTION_EXECUTE_HANDLER;
}

bool isolateNativeStdio(HANDLE* input) {
  *input = GetStdHandle(STD_INPUT_HANDLE);
  const HANDLE inheritedOutput = GetStdHandle(STD_OUTPUT_HANDLE);
  if (!*input || *input == INVALID_HANDLE_VALUE || !inheritedOutput ||
      inheritedOutput == INVALID_HANDLE_VALUE ||
      !DuplicateHandle(GetCurrentProcess(), inheritedOutput, GetCurrentProcess(), &gOutput,
                       0, FALSE, DUPLICATE_SAME_ACCESS)) return false;
  const HANDLE sink = CreateFileW(L"NUL", GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
                                  nullptr, OPEN_EXISTING, 0, nullptr);
  if (sink == INVALID_HANDLE_VALUE) return false;
  if (!SetStdHandle(STD_OUTPUT_HANDLE, sink) || !SetStdHandle(STD_ERROR_HANDLE, sink)) {
    CloseHandle(sink);
    return false;
  }
  // Loaded modules may use a separate CRT. Process handles are replaced before
  // DLL initialization; our own CRT descriptors are replaced too. IPC uses only
  // the retained Win32 handle, never printf/iostream/stdout.
  FILE* ignored = nullptr;
  if (freopen_s(&ignored, "NUL", "wb", stdout) != 0 ||
      freopen_s(&ignored, "NUL", "wb", stderr) != 0) return false;
  return true;
}

std::wstring installPath(HKEY hive) {
  HKEY key = nullptr;
  if (RegOpenKeyExW(hive, L"SOFTWARE\\Tencent\\QQMusic", 0,
                    KEY_QUERY_VALUE | KEY_WOW64_32KEY, &key) != ERROR_SUCCESS) return {};
  DWORD type = 0, size = 0;
  const auto first = RegQueryValueExW(key, L"Install", nullptr, &type, nullptr, &size);
  if (first != ERROR_SUCCESS || type != REG_SZ || size < sizeof(wchar_t) ||
      size > 65536 || size % sizeof(wchar_t)) {
    RegCloseKey(key);
    return {};
  }
  std::vector<wchar_t> value(size / sizeof(wchar_t) + 1, L'\0');
  const auto second = RegQueryValueExW(key, L"Install", nullptr, &type,
                                      reinterpret_cast<BYTE*>(value.data()), &size);
  RegCloseKey(key);
  if (second != ERROR_SUCCESS || type != REG_SZ || size < sizeof(wchar_t) ||
      size % sizeof(wchar_t) || size > (value.size() - 1) * sizeof(wchar_t) ||
      value[size / sizeof(wchar_t) - 1] != L'\0')
    return {};
  const std::wstring path(value.data());
  if (path.empty() || path.size() + 1 != size / sizeof(wchar_t) ||
      !std::filesystem::path(path).is_absolute()) return {};
  return path;
}

std::string utf8(const std::wstring& value) {
  if (value.empty() || value.size() > 32767 || value.find(L'\0') != std::wstring::npos) return {};
  const int count = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(),
                                       static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  if (count <= 0) return {};
  std::string result(static_cast<size_t>(count), '\0');
  if (WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()),
                          result.data(), count, nullptr, nullptr) != count) return {};
  return result;
}

bool matchesHash(const std::filesystem::path& path, const char* expected, HANDLE* retained) {
  HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr,
                            OPEN_EXISTING, FILE_FLAG_SEQUENTIAL_SCAN, nullptr);
  if (file == INVALID_HANDLE_VALUE) return false;
  BCRYPT_ALG_HANDLE algorithm = nullptr;
  BCRYPT_HASH_HANDLE hash = nullptr;
  std::array<UCHAR, 32> digest{};
  bool success = BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) >= 0 &&
                 BCryptCreateHash(algorithm, &hash, nullptr, 0, nullptr, 0, 0) >= 0;
  std::array<UCHAR, 65536> bytes{};
  while (success) {
    DWORD got = 0;
    if (!ReadFile(file, bytes.data(), static_cast<DWORD>(bytes.size()), &got, nullptr)) {
      success = false;
      break;
    }
    if (!got) break;
    success = BCryptHashData(hash, bytes.data(), got, 0) >= 0;
  }
  if (success) success = BCryptFinishHash(hash, digest.data(), static_cast<ULONG>(digest.size()), 0) >= 0;
  if (hash) BCryptDestroyHash(hash);
  if (algorithm) BCryptCloseAlgorithmProvider(algorithm, 0);
  if (!success) { CloseHandle(file); return false; }
  constexpr char hex[] = "0123456789abcdef";
  for (size_t index = 0; index < digest.size(); ++index) {
    if (expected[index * 2] != hex[digest[index] >> 4] ||
        expected[index * 2 + 1] != hex[digest[index] & 15]) {
      CloseHandle(file);
      return false;
    }
  }
  if (expected[64] != '\0') { CloseHandle(file); return false; }
  *retained = file;
  return true;
}

class Native final {
 public:
  ~Native() { close(); }
  Native() = default;
  Native(const Native&) = delete;
  Native& operator=(const Native&) = delete;

  bool initialize(const Init& input, Format* output) {
    if (initialized_ || !output || input.channels != 2 || input.encodedBitrate < 0) return false;
    // Native host precedence is rate>90000, then integer kbps>500. The former
    // currently has no proved active effect at96k and returnsNULL at192k.
    const int target = input.sampleRate > 90000 ? 2 : input.encodedBitrate / 1000 > 500 ? 1 : 0;
    if (target == 2 || (input.sampleRate != 44100 && input.sampleRate != 48000)) return false;
    std::wstring installed = installPath(HKEY_LOCAL_MACHINE);
    if (installed.empty()) installed = installPath(HKEY_CURRENT_USER);
    if (installed.empty()) return false;
    const std::filesystem::path root(installed);
    struct Pin { const wchar_t* name; const char* digest; };
    const Pin pins[] = {
        {L"qmcpcom.dll", "7aa3b585aa5862466262ce0a74133e8b3171d96d4362bd9447c988d7fdac04c3"},
        {L"onnxruntime.dll", "a4758e94486ef75a9c4ee82f91378eb3919c888cb1520976a6cf1b5df5626749"},
        {L"IPPWrapper.dll", "5fa10925b7a2351e74128b183b8b660696ff49ec45adc086aa3f533cb563e317"},
        {L"resae\\SSHrs\\excellent-hq.res", "d0ba8bab2e515dd124550d5a447629a9edebf25ee94e0dcd65779a389654fd81"},
        {L"resae\\SSHrs\\excellent-sq.res", "21f87eaa519e9a43ae95d51cca069e80d68fb06262bd66139f6d84231343d239"},
        {L"resae\\superspace\\excellent.dat", "50d5a578d9be7cf7d931616d26ea30f9327e5d74cef0d7c072c67c9b4de32c9b"}};
    for (const auto& pin : pins) {
      HANDLE file = nullptr;
      if (!matchesHash(root / pin.name, pin.digest, &file)) return false;
      // Deny writes and replacement from hashing through the entire source.
      pinnedFiles_.push_back(file);
    }
    const auto qmcPath = root / L"qmcpcom.dll";
    const auto onnxPath = root / L"onnxruntime.dll";
    const auto modelPath = root / L"resae" / L"SSHrs" /
                           (target == 1 ? L"excellent-sq.res" : L"excellent-hq.res");
    model_ = utf8(modelPath.wstring());
    onnx_ = utf8(onnxPath.wstring());
    local_ = utf8((root / L"resae").wstring());
    if (model_.empty() || onnx_.empty() || local_.empty() ||
        !SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_DEFAULT_DIRS)) return false;
    directory_ = AddDllDirectory(root.c_str());
    if (!directory_) return false;
    constexpr DWORD flags = LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS;
    qmc_ = LoadLibraryExW(qmcPath.c_str(), nullptr, flags);
    onnxLibrary_ = LoadLibraryExW(onnxPath.c_str(), nullptr, flags);
    if (!qmc_ || !onnxLibrary_) return false;
    create_ = reinterpret_cast<Create>(GetProcAddress(qmc_, "qmcpcom_ss_hsr_create_inst"));
    input_ = reinterpret_cast<Input>(GetProcAddress(qmc_, "qmcpcom_ss_hsr_processf_input"));
    output_ = reinterpret_cast<Output>(GetProcAddress(qmc_, "qmcpcom_ss_hsr_processf_output"));
    destroy_ = reinterpret_cast<Destroy>(GetProcAddress(qmc_, "qmcpcom_ss_hsr_destroy_inst"));
    const auto setLocal = reinterpret_cast<SetLocal>(GetProcAddress(qmc_, "qmcpcom_ss_set_local_effect_path"));
    if (!create_ || !input_ || !output_ || !destroy_ || !setLocal || setLocal(local_.c_str()) != 0)
      return false;
    int rate = static_cast<int>(input.sampleRate);
    handle_ = create_(rate, 2, 1, target, 3, model_.c_str(), onnx_.c_str(), &rate, "2", 1.0f);
    const uint32_t expected = target == 1 ? 96000 : input.sampleRate;
    if (!handle_ || rate != static_cast<int>(expected)) return false;
    initialized_ = true;
    *output = Format{static_cast<uint32_t>(rate), 2};
    return true;
  }

  bool push(const std::vector<uint8_t>& bytes) {
    if (!initialized_ || finishing_ || bytes.empty() || bytes.size() % (2 * sizeof(float)) ||
        bytes.size() / (2 * sizeof(float)) > kMaximumFrames) return false;
    const size_t samples = bytes.size() / sizeof(float);
    std::vector<float> input(samples);
    std::memcpy(input.data(), bytes.data(), bytes.size());
    if (!std::all_of(input.begin(), input.end(), [](float value) { return std::isfinite(value); }))
      return false;
    for (size_t at = 0; at < samples;) {
      const size_t count = std::min(kNativeInputSamples, samples - at);
      int available = 0;
      if (input_(handle_, input.data() + at, static_cast<int>(count), &available) != 0 ||
          available < 0 || !drain()) return false;
      at += count;
    }
    return true;
  }

  bool finish() {
    if (!initialized_ || finishing_) return false;
    int available = 0;
    // Stop input and query all available output. The original consumer also
    // uses NULL/0 as an ordinary queue query; it is not an SDK EOF-finalizer.
    // Held lookahead tail remains a documented native boundary.
    if (input_(handle_, nullptr, 0, &available) != 0 || available < 0 || !drain()) return false;
    finishing_ = true;
    return true;
  }

  bool pull(uint32_t capacityFrames, std::vector<uint8_t>* result) {
    if (!initialized_ || !result || !capacityFrames || capacityFrames > kMaximumFrames) return false;
    const size_t samples = std::min<size_t>(queued_.size() - readAt_, capacityFrames * 2);
    if (samples % 2) return false;
    Read read{samples ? ReadStatus::Output : finishing_ ? ReadStatus::Finished : ReadStatus::NeedInput,
              static_cast<uint32_t>(samples / 2)};
    result->resize(sizeof(read) + samples * sizeof(float));
    std::memcpy(result->data(), &read, sizeof(read));
    if (samples) std::memcpy(result->data() + sizeof(read), queued_.data() + readAt_, samples * sizeof(float));
    readAt_ += samples;
    if (readAt_ == queued_.size()) {
      queued_.clear();
      readAt_ = 0;
    }
    return true;
  }

 private:
  using Create = void* (__cdecl*)(int, int, int, int, int, const char*, const char*, int*, const char*, float);
  using Input = int (__cdecl*)(void*, const float*, int, int*);
  using Output = int (__cdecl*)(void*, float*, int, int*);
  using Destroy = void (__cdecl*)(void**);
  using SetLocal = int (__cdecl*)(const char*);
  bool drain() {
    std::array<float, kNativeOutputSamples> block{};
    for (size_t attempt = 0; attempt < 128; ++attempt) {
      int produced = 0;
      const int code = output_(handle_, block.data(), static_cast<int>(block.size()), &produced);
      if (produced < 0 || produced > static_cast<int>(block.size()) || produced % 2 ||
          (code != 0 && !(code == 1003 && produced == 0))) return false;
      if (!produced) return true;
      if (!std::all_of(block.begin(), block.begin() + produced,
                       [](float value) { return std::isfinite(value); }) ||
          queued_.size() - readAt_ + static_cast<size_t>(produced) > kMaximumQueuedSamples) return false;
      if (readAt_) {
        queued_.erase(queued_.begin(), queued_.begin() + static_cast<std::ptrdiff_t>(readAt_));
        readAt_ = 0;
      }
      queued_.insert(queued_.end(), block.begin(), block.begin() + produced);
    }
    return false;
  }
  void close() noexcept {
    if (handle_ && destroy_) destroy_(&handle_);
    // Global SS2/ONNX state is process-scoped. There is no proved independent
    // teardown contract for unloading those modules with their global workers
    // alive. Keep modules, search cookie and read-only pins until process exit.
    // This executable accepts one Init; the parent owns a disposable process.
    handle_ = nullptr;
    onnxLibrary_ = qmc_ = nullptr;
    directory_ = nullptr;
  }
  HMODULE qmc_ = nullptr, onnxLibrary_ = nullptr;
  DLL_DIRECTORY_COOKIE directory_ = nullptr;
  Create create_ = nullptr;
  Input input_ = nullptr;
  Output output_ = nullptr;
  Destroy destroy_ = nullptr;
  void* handle_ = nullptr;
  bool initialized_ = false, finishing_ = false;
  std::string model_, onnx_, local_;
  std::vector<float> queued_;
  std::vector<HANDLE> pinnedFiles_;
  size_t readAt_ = 0;
};

int run(HANDLE input) {
  Native native;
  bool initialized = false;
  uint32_t sequence = 0;
  for (;;) {
    Header request{};
    const auto read = readAll(input, &request, sizeof(request));
    if (read == InputResult::CleanEof) return 0;
    gRequest = request;
    if (read != InputResult::Complete || request.magic != kMagic || request.version != kVersion ||
        request.status || request.bytes > kMaximumPayload || !request.sequence ||
        request.sequence != sequence + 1 ||
        static_cast<uint32_t>(request.operation) < static_cast<uint32_t>(Operation::Init) ||
        static_cast<uint32_t>(request.operation) > static_cast<uint32_t>(Operation::Close)) {
      reply(request, nullptr, 0, 1);
      return 1;
    }
    sequence = request.sequence;
    std::vector<uint8_t> bytes(request.bytes);
    if (request.bytes && readAll(input, bytes.data(), bytes.size()) != InputResult::Complete) {
      reply(request, nullptr, 0, 1);
      return 1;
    }
    bool success = false;
    std::vector<uint8_t> response;
    switch (request.operation) {
      case Operation::Init:
        if (!initialized && bytes.size() == sizeof(Init)) {
          Init init{};
          Format format{};
          std::memcpy(&init, bytes.data(), sizeof(init));
          success = native.initialize(init, &format);
          if (success) {
            initialized = true;
            response.resize(sizeof(format));
            std::memcpy(response.data(), &format, sizeof(format));
          }
        }
        break;
      case Operation::Push: success = initialized && native.push(bytes); break;
      case Operation::Pull:
        if (initialized && bytes.size() == sizeof(Pull)) {
          Pull pull{};
          std::memcpy(&pull, bytes.data(), sizeof(pull));
          success = native.pull(pull.capacityFrames, &response);
        }
        break;
      case Operation::Finish: success = initialized && bytes.empty() && native.finish(); break;
      case Operation::Close:
        if (bytes.empty() && reply(request)) return 0;
        break;
    }
    if (!success) {
      reply(request, nullptr, 0, 1);
      return 1;
    }
    if (!reply(request, response.data(), response.size())) return 1;
  }
}
}  // namespace

int wmain(int argc, wchar_t**) {
  SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX | SEM_NOOPENFILEERRORBOX);
  HANDLE input = nullptr;
  if (argc != 1 || !isolateNativeStdio(&input)) return 1;
  SetUnhandledExceptionFilter(unhandledException);
  int result = 1;
  try { result = run(input); }
  catch (...) { reply(gRequest, nullptr, 0, 1); }
  if (gOutput) CloseHandle(gOutput);
  return result;
}
