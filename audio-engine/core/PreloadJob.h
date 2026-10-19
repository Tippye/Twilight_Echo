#pragma once

#include "../automix-native/am_cancel.h"

#include <atomic>
#include <memory>
#include <thread>
#include <utility>

namespace twilight::audio {

// One owned preparation slot, no work queue. The control owner serializes
// prepare/launch/join outside its engine mutex; cancellation never joins.
class PreloadJob {
 public:
  using Cancellation = std::shared_ptr<ta_am_cancel>;
  ~PreloadJob() { cancel(); join(); }

  static Cancellation cancellation() {
    return Cancellation(ta_am_cancel_create(), ta_am_cancel_free);
  }
  void prepare(const Cancellation& token) {
    cancellation_.store(token, std::memory_order_release);
  }
  template<class Task> void launch(const Cancellation& token, Task&& task) {
    worker_ = std::thread([this, token, task = std::forward<Task>(task)]() mutable {
      task();
      release(token);
    });
  }
  void cancel() noexcept {
    const auto token = cancellation_.load(std::memory_order_acquire);
    if (token) ta_am_cancel_request(token.get());
  }
  void release(const Cancellation& token) noexcept {
    auto expected = token;
    cancellation_.compare_exchange_strong(expected, Cancellation{},
        std::memory_order_acq_rel, std::memory_order_acquire);
  }
  void join() { if (worker_.joinable()) worker_.join(); }

 private:
  std::atomic<Cancellation> cancellation_;
  std::thread worker_;
};

}  // namespace twilight::audio
