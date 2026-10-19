#include "AsioControlThread.h"

#include <Windows.h>
#include <objbase.h>

#include <vector>

namespace twilight::audio::asio_windows {

AsioControlThread::~AsioControlThread() {
  stop();
}

std::shared_ptr<AsioControlThread::State> AsioControlThread::sharedState() const {
  std::lock_guard lock(stateMutex_);
  return state_;
}

bool AsioControlThread::start(std::string* error) {
  std::lock_guard lifecycle(lifecycleMutex_);
  std::shared_ptr<State> state;
  {
    std::lock_guard stateLock(stateMutex_);
    if (!thread_.joinable()) {
      // A previous stop() may have abandoned a wedged worker. It still owns the old
      // state, so hand this object a clean one instead of racing the runaway thread.
      state_ = std::make_shared<State>();
    }
    state = state_;
  }

  std::unique_lock lock(state->mutex);
  if (state->running) return state->initializationSucceeded;
  if (thread_.joinable()) {
    lock.unlock();
    thread_.join();
    lock.lock();
  }
  state->ready = false;
  state->stopping = false;
  state->exited = false;
  state->unhealthy = false;
  thread_ = std::thread([state] { worker(state); });
  state->condition.wait(lock, [&state] { return state->ready; });
  if (!state->initializationSucceeded && error) *error = "ASIO control thread failed to initialize COM";
  return state->initializationSucceeded;
}

void AsioControlThread::stop() {
  std::lock_guard lifecycle(lifecycleMutex_);
  auto state = sharedState();
  {
    std::lock_guard lock(state->mutex);
    if (!state->running && !thread_.joinable()) return;
    state->stopping = true;
  }
  state->condition.notify_all();
  if (!thread_.joinable()) return;

  bool exited = false;
  {
    std::unique_lock lock(state->mutex);
    exited = state->condition.wait_for(lock, std::chrono::seconds(3), [&state] {
      return state->exited || !state->running;
    });
  }
  if (exited) {
    thread_.join();
    return;
  }

  // The worker is stuck inside a driver call. Leaking one thread and its state is
  // strictly better than hanging process shutdown forever.
  state->unhealthy = true;
  thread_.detach();
}

bool AsioControlThread::healthy() const {
  auto state = sharedState();
  std::lock_guard lock(state->mutex);
  return state->running && state->initializationSucceeded && !state->stopping && !state->unhealthy.load();
}

void AsioControlThread::setMaintenance(std::function<void()> maintenance) {
  auto state = sharedState();
  std::lock_guard lock(state->mutex);
  state->maintenance = std::move(maintenance);
}

void* AsioControlThread::systemReference() const {
  auto state = sharedState();
  std::lock_guard lock(state->mutex);
  return state->window;
}

void AsioControlThread::markUnhealthy() {
  sharedState()->unhealthy = true;
}

std::thread::id AsioControlThread::workerThreadId() const {
  auto state = sharedState();
  std::lock_guard lock(state->mutex);
  return state->threadId;
}

bool AsioControlThread::submit(std::function<void()> command) {
  auto state = sharedState();
  {
    std::lock_guard lock(state->mutex);
    if (!state->running || state->stopping || state->unhealthy) return false;
    state->commands.push(std::move(command));
  }
  state->condition.notify_one();
  return true;
}

void AsioControlThread::worker(std::shared_ptr<State> state) {
  const HRESULT comResult = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  const bool comReady = SUCCEEDED(comResult);
  HWND window = nullptr;
  if (comReady) {
    window = CreateWindowExW(
        WS_EX_TOOLWINDOW, L"STATIC", L"Twilight Echo ASIO", WS_POPUP, 0, 0, 0, 0, nullptr, nullptr, GetModuleHandleW(nullptr), nullptr);
  }
  {
    std::lock_guard lock(state->mutex);
    state->threadId = std::this_thread::get_id();
    state->window = window;
    state->initializationSucceeded = comReady && window != nullptr;
    state->running = state->initializationSucceeded;
    state->ready = true;
    state->exited = !state->running;
  }
  state->condition.notify_all();
  if (!comReady || !window) {
    if (comReady) CoUninitialize();
    return;
  }

  for (;;) {
    std::vector<std::function<void()>> commands;
    std::function<void()> maintenance;
    {
      std::unique_lock lock(state->mutex);
      state->condition.wait_for(lock, std::chrono::milliseconds(10), [&state] {
        return state->stopping || !state->commands.empty();
      });
      if (state->stopping) break;
      while (!state->commands.empty()) {
        commands.push_back(std::move(state->commands.front()));
        state->commands.pop();
      }
      maintenance = state->maintenance;
    }
    for (auto& command : commands) command();
    if (maintenance) maintenance();
    MSG message{};
    while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
      TranslateMessage(&message);
      DispatchMessageW(&message);
    }
  }

  DestroyWindow(window);
  CoUninitialize();
  {
    std::lock_guard lock(state->mutex);
    state->window = nullptr;
    state->threadId = {};
    state->running = false;
    state->initializationSucceeded = false;
    state->maintenance = nullptr;
    state->exited = true;
  }
  state->condition.notify_all();
}

}  // namespace twilight::audio::asio_windows
