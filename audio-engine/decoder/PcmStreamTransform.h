#pragma once

#include "../core/AudioTypes.h"

#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>

namespace twilight::audio {

struct PcmStreamTransformInput {
  // Float32 interleaved at the decoded source rate and channel count. Device
  // resampling and channel routing have not run at this boundary.
  AudioFormat format;
  int64_t encodedBitrate = 0;
};

enum class PcmStreamTransformReadStatus {
  NeedInput,
  Output,
  Finished
};

struct PcmStreamTransformReadResult {
  PcmStreamTransformReadStatus status = PcmStreamTransformReadStatus::NeedInput;
  size_t frames = 0;
};

// Decode-worker interface, separate from the realtime, in-place DSP ABI.
// A successful push consumes the complete input block. pull() writes at most
// capacityFrames at the format returned by prepare(); Output requires frames>0,
// while NeedInput/Finished require frames==0. Format stays fixed per instance.
// finish() ends input exactly once; subsequent pulls must reach Finished and
// must not request more input. The implementation owns its EOF alignment policy.
class IPcmStreamTransform {
 public:
  virtual ~IPcmStreamTransform() = default;
  virtual bool prepare(
      const PcmStreamTransformInput& input,
      AudioFormat* outputFormat,
      std::string* error) = 0;
  virtual bool push(const float* input, size_t frames, std::string* error) = 0;
  virtual bool pull(
      float* output,
      size_t capacityFrames,
      PcmStreamTransformReadResult* result,
      std::string* error) = 0;
  virtual bool finish(std::string* error) = 0;

  // May run concurrently with prepare/push/pull/finish. It must be idempotent,
  // wake blocked operations, and remain cancelled if called before prepare.
  // Other methods and destruction are serialized by the decoder owner.
  virtual void cancel() noexcept = 0;
};

// The host binds a trusted per-source factory. A new instance is created on the
// first decode read after open or seek; an old native state is never reset/reused.
using PcmStreamTransformFactory = std::function<std::unique_ptr<IPcmStreamTransform>()>;

}  // namespace twilight::audio
