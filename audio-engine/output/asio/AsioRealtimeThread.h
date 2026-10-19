#pragma once

#include <Windows.h>

namespace twilight::audio::asio {

// The isolated driver's callbacks only signal an event; the parent worker is
// the audio render thread. It needs the same MMCSS scheduling as an in-process
// callback, especially when DSD buffers represent less than one millisecond.
class RealtimeThread final {
 public:
  RealtimeThread() {
    library_ = LoadLibraryExW(L"avrt.dll", nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32);
    if (library_) {
      const auto registerThread = reinterpret_cast<RegisterThread>(
          GetProcAddress(library_, "AvSetMmThreadCharacteristicsW"));
      revert_ = reinterpret_cast<RevertThread>(GetProcAddress(library_, "AvRevertMmThreadCharacteristics"));
      const auto setPriority = reinterpret_cast<SetPriority>(GetProcAddress(library_, "AvSetMmThreadPriority"));
      DWORD taskIndex = 0;
      if (registerThread && revert_) task_ = registerThread(L"Pro Audio", &taskIndex);
      if (task_ && setPriority) setPriority(task_, 1); // AVRT_PRIORITY_HIGH
    }
    if (!task_) {
      previousPriority_ = GetThreadPriority(GetCurrentThread());
      fallback_ = previousPriority_ != THREAD_PRIORITY_ERROR_RETURN &&
          previousPriority_ < THREAD_PRIORITY_HIGHEST &&
          SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST);
    }
  }

  ~RealtimeThread() {
    if (task_ && revert_) revert_(task_);
    if (fallback_) SetThreadPriority(GetCurrentThread(), previousPriority_);
    if (library_) FreeLibrary(library_);
  }

  RealtimeThread(const RealtimeThread&) = delete;
  RealtimeThread& operator=(const RealtimeThread&) = delete;

 private:
  using RegisterThread = HANDLE (WINAPI*)(LPCWSTR, LPDWORD);
  using RevertThread = BOOL (WINAPI*)(HANDLE);
  using SetPriority = BOOL (WINAPI*)(HANDLE, int);
  HMODULE library_ = nullptr;
  HANDLE task_ = nullptr;
  RevertThread revert_ = nullptr;
  int previousPriority_ = THREAD_PRIORITY_NORMAL;
  bool fallback_ = false;
};

}  // namespace twilight::audio::asio
