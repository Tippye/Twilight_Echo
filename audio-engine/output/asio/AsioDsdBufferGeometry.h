#pragma once

#include "AsioRenderUtils.h"

namespace twilight::audio::asio {

// Called only at the actual driver callback boundary. Worker wake-ups and
// backlog-drain intervals cannot establish physical driver buffer units.
class DsdBufferGeometry {
 public:
  void reset(size_t driverFrames, int semanticRate, bool expandedNer8, uint32_t confirmations) {
    frames_ = driverFrames;
    rate_ = semanticRate;
    expanded_ = expandedNer8;
    confirmations_ = std::clamp<uint32_t>(confirmations, 2, 8);
    capacity_ = std::max<size_t>(1, driverFrames / 8);
    lastTimeNs_ = 0;
    callbacks_ = 0;
    probe_ = {};
  }

  void observe(uint64_t timestampNs) {
    const uint64_t previous = lastTimeNs_;
    lastTimeNs_ = timestampNs;
    if (expanded_ || rate_ <= 0 || ++callbacks_ <= 2 || previous == 0 || timestampNs <= previous) {
      if (!probe_.confirmed) probe_.byteFrameStreak = probe_.bitSampleStreak = 0;
      return;
    }
    const double expectedMs = static_cast<double>(frames_) * 8000.0 / rate_;
    const double elapsedMs = static_cast<double>(timestampNs - previous) / 1000000.0;
    const auto decision = advanceDsdRenderUnitProbe(probe_, classifyDsdCallbackUnit(expectedMs, elapsedMs), confirmations_);
    if (decision == DsdRenderUnitDecision::UseByteFrames) capacity_ = frames_;
  }

  size_t capacity() const { return capacity_; }
  bool confirmed() const { return expanded_ || probe_.confirmed; }

 private:
  size_t frames_ = 0, capacity_ = 0;
  int rate_ = 0;
  bool expanded_ = false;
  uint32_t confirmations_ = 2, callbacks_ = 0;
  uint64_t lastTimeNs_ = 0;
  DsdRenderUnitProbe probe_;
};

}  // namespace twilight::audio::asio
