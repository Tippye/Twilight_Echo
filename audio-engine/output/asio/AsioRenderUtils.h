#pragma once

#include "../../core/AudioTypes.h"
#include "IAsioHost.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>

namespace twilight::audio::asio {

inline int32_t floatToSignedInt(float sample, int bits) {
  const double clamped = std::isfinite(sample) ? std::clamp(static_cast<double>(sample), -1.0, 1.0) : 0.0;
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

inline int16_t floatToSignedInt16(float sample) {
  const double clamped = std::isfinite(sample) ? std::clamp(static_cast<double>(sample), -1.0, 1.0) : 0.0;
  return static_cast<int16_t>(std::clamp(
      std::llround(clamped * 32768.0),
      static_cast<long long>(std::numeric_limits<int16_t>::min()),
      static_cast<long long>(std::numeric_limits<int16_t>::max())));
}

inline int32_t floatToSignedInt24(float sample) {
  const double clamped = std::isfinite(sample) ? std::clamp(static_cast<double>(sample), -1.0, 1.0) : 0.0;
  return static_cast<int32_t>(std::clamp(std::llround(clamped * 8388608.0), -8388608LL, 8388607LL));
}

inline int32_t floatToSignedInt32(float sample) {
  const double clamped = std::isfinite(sample) ? std::clamp(static_cast<double>(sample), -1.0, 1.0) : 0.0;
  const long long value = std::clamp(
      std::llround(clamped * 2147483648.0),
      static_cast<long long>(std::numeric_limits<int32_t>::min()),
      static_cast<long long>(std::numeric_limits<int32_t>::max()));
  return static_cast<int32_t>(value);
}

inline void writeInt16ChannelFromFloatScratch(
    const float* channelSource,
    size_t frameCount,
    int channelStride,
    int16_t* output) {
  if (!output || frameCount == 0) return;
  const size_t stride = static_cast<size_t>(std::max(1, channelStride));
  for (size_t frame = 0; frame < frameCount; ++frame) {
    const float sample = channelSource ? channelSource[frame * stride] : 0.0f;
    output[frame] = floatToSignedInt16(sample);
  }
}

inline void writePackedInt24ChannelFromFloatScratch(
    const float* channelSource,
    size_t frameCount,
    int channelStride,
    uint8_t* output) {
  if (!output || frameCount == 0) return;
  const size_t stride = static_cast<size_t>(std::max(1, channelStride));
  for (size_t frame = 0; frame < frameCount; ++frame) {
    const float sample = channelSource ? channelSource[frame * stride] : 0.0f;
    const auto value = static_cast<uint32_t>(floatToSignedInt24(sample));
    output[frame * 3 + 0] = static_cast<uint8_t>(value & 0xff);
    output[frame * 3 + 1] = static_cast<uint8_t>((value >> 8) & 0xff);
    output[frame * 3 + 2] = static_cast<uint8_t>((value >> 16) & 0xff);
  }
}

inline void writeInt24In32ChannelFromFloatScratch(
    const float* channelSource,
    size_t frameCount,
    int channelStride,
    int32_t* output) {
  if (!output || frameCount == 0) return;
  const size_t stride = static_cast<size_t>(std::max(1, channelStride));
  for (size_t frame = 0; frame < frameCount; ++frame) {
    const float sample = channelSource ? channelSource[frame * stride] : 0.0f;
    output[frame] = static_cast<int32_t>(static_cast<uint32_t>(floatToSignedInt24(sample)) << 8);
  }
}

inline void writeInt32ChannelFromFloatScratch(
    const float* channelSource,
    size_t frameCount,
    int channelStride,
    int32_t* output) {
  if (!output || frameCount == 0) return;
  const size_t stride = static_cast<size_t>(std::max(1, channelStride));
  for (size_t frame = 0; frame < frameCount; ++frame) {
    const float sample = channelSource ? channelSource[frame * stride] : 0.0f;
    output[frame] = floatToSignedInt32(sample);
  }
}

inline size_t bytesPerSample(AudioSampleFormat format) {
  switch (format) {
    case AudioSampleFormat::DsdInt8Lsb1:
    case AudioSampleFormat::DsdInt8Msb1:
    case AudioSampleFormat::DsdInt8Ner8:
      return 1;
    case AudioSampleFormat::Int16Interleaved:
      return 2;
    case AudioSampleFormat::Int24Interleaved:
      return 3;
    case AudioSampleFormat::Int24In32Interleaved:
    case AudioSampleFormat::Int32Interleaved:
    case AudioSampleFormat::Float32Interleaved:
    default:
      return 4;
  }
}

inline size_t bytesPerSample(const AsioChannelFormat& format) {
  if (format.containerBits == 0 || format.containerBits % 8 != 0) return 0;
  return static_cast<size_t>(format.containerBits / 8);
}

// The engine keeps NER8 source frames packed in chronological LSB-first
// order. Its ASIO wire container is one DSD bit (0 or 1) in each byte.
inline size_t wireBytesForFrames(const AsioChannelFormat& format, size_t frames) {
  return frames * (format.dsdPacking == AsioDsdPacking::Ner8 ? 8 : bytesPerSample(format));
}

inline int driverSampleRate(const AudioFormat& format) {
  return format.sampleRate > 0 ? format.sampleRate : 0;
}

inline int callbackFrameRate(const AudioFormat& format) {
  if (format.sampleRate <= 0) return 0;
  if (!isDsdSampleFormat(format.sampleFormat)) return format.sampleRate;
  return format.sampleRate % 8 == 0 ? format.sampleRate / 8 : 0;
}

/**
 * The unit a driver's DSD-mode getBufferSize/createBuffers count refers to.
 *
 * The ASIO DSD extension describes buffers as "8 samples per byte" with the
 * sample rate set to the DSD bit rate, so a spec-literal driver counts 1-bit
 * samples and a buffer of N samples holds N/8 bytes. Dominant vendor drivers
 * instead count packed byte-frames — one frame = 8 DSD bits — which is the
 * model this backend writes with. The two interpretations differ by exactly 8x
 * in bytes-per-buffer, and writing byte-frames into a bit-counting driver
 * overflows its buffers 8x on every callback, so the callback cadence is the
 * only runtime evidence of which interpretation a driver uses.
 */
enum class DsdCallbackUnit : uint8_t {
  Unknown,
  /** Buffer size counts packed byte-frames: one frame = 8 DSD bits. */
  ByteFrames,
  /** Buffer size counts 1-bit samples: one buffer frame = bufferSize/8 bytes. */
  BitSamples,
};

inline DsdCallbackUnit classifyDsdCallbackUnit(double byteFramePeriodMs, double elapsedMs) {
  if (byteFramePeriodMs <= 0.0 || elapsedMs <= 0.0) return DsdCallbackUnit::Unknown;
  const double ratio = elapsedMs / byteFramePeriodMs;
  // BitSamples callbacks arrive ~8x faster than the byte-frame prediction.
  // The bands are disjoint with a gap between them, so timer jitter lands in
  // Unknown instead of flipping the verdict.
  if (ratio >= 0.5 && ratio <= 2.0) return DsdCallbackUnit::ByteFrames;
  if (ratio >= 0.0625 && ratio <= 0.25) return DsdCallbackUnit::BitSamples;
  return DsdCallbackUnit::Unknown;
}

/**
 * Probe state for which buffer unit a Native DSD driver counts, driven from the
 * render callback.
 *
 * Writes start conservative: one probe callback renders bufferSize/8 packed
 * byte-frames, which fits both interpretations (a byte-frame driver's buffer
 * holds 8x that; a bit-sample driver's holds exactly that), so neither
 * interpretation can overflow the driver's buffer during calibration. Once the
 * measured cadence latches one interpretation for `confirmCallbacks` consecutive
 * intervals, the unit widens to full byte-frames (ByteFrames) or stays at
 * bufferSize/8 (BitSamples). Unknown intervals never advance a streak.
 */
struct DsdRenderUnitProbe {
  uint32_t byteFrameStreak = 0;
  uint32_t bitSampleStreak = 0;
  bool confirmed = false;
};

enum class DsdRenderUnitDecision : uint8_t {
  /** Keep the current unit; the interval was ambiguous or below the streak. */
  Keep,
  /** Driver counts packed byte-frames; render the full declared buffer. */
  UseByteFrames,
  /** Driver counts 1-bit samples; keep rendering bufferSize/8 byte-frames. */
  UseBitSamples
};

inline DsdRenderUnitDecision advanceDsdRenderUnitProbe(
    DsdRenderUnitProbe& probe,
    DsdCallbackUnit observed,
    uint32_t confirmCallbacks) {
  if (probe.confirmed) return DsdRenderUnitDecision::Keep;
  switch (observed) {
    case DsdCallbackUnit::ByteFrames:
      ++probe.byteFrameStreak;
      probe.bitSampleStreak = 0;
      break;
    case DsdCallbackUnit::BitSamples:
      ++probe.bitSampleStreak;
      probe.byteFrameStreak = 0;
      break;
    case DsdCallbackUnit::Unknown:
      probe.byteFrameStreak = probe.bitSampleStreak = 0;
      return DsdRenderUnitDecision::Keep;
  }
  if (probe.byteFrameStreak >= confirmCallbacks) {
    probe.confirmed = true;
    return DsdRenderUnitDecision::UseByteFrames;
  }
  if (probe.bitSampleStreak >= confirmCallbacks) {
    probe.confirmed = true;
    return DsdRenderUnitDecision::UseBitSamples;
  }
  return DsdRenderUnitDecision::Keep;
}

inline uint8_t reverseBits(uint8_t value) {
  value = static_cast<uint8_t>(((value & 0xf0U) >> 4U) | ((value & 0x0fU) << 4U));
  value = static_cast<uint8_t>(((value & 0xccU) >> 2U) | ((value & 0x33U) << 2U));
  return static_cast<uint8_t>(((value & 0xaaU) >> 1U) | ((value & 0x55U) << 1U));
}

inline uint8_t nativeDsdIdleByte(AudioSampleFormat format) {
  // 0x69 is the conventional LSB-first DSD idle pattern. MSB1 transports the
  // same bitstream with each byte bit-reversed; NER8 keeps the byte unchanged.
  return format == AudioSampleFormat::DsdInt8Msb1 ? reverseBits(0x69) : 0x69;
}

inline void fillChannelIdle(uint8_t* output, const AsioChannelFormat& format, size_t frames) {
  if (!output) return;
  if (format.dsdPacking == AsioDsdPacking::Ner8) {
    for (size_t frame = 0; frame < frames; ++frame)
      for (size_t bit = 0; bit < 8; ++bit) output[frame * 8 + bit] = (0x69u >> bit) & 1u;
  } else {
    std::memset(output, isDsdSampleFormat(format.logicalFormat) ? nativeDsdIdleByte(format.logicalFormat) : 0,
                wireBytesForFrames(format, frames));
  }
}

inline bool isSupportedChannelFormat(const AsioChannelFormat& format) {
  switch (format.logicalFormat) {
    case AudioSampleFormat::Int16Interleaved:
      return format.containerBits == 16 && format.validBits == 16 &&
             !format.validBitsAreMostSignificant && format.dsdPacking == AsioDsdPacking::None;
    case AudioSampleFormat::Int24Interleaved:
      return format.containerBits == 24 && format.validBits == 24 &&
             !format.validBitsAreMostSignificant && format.dsdPacking == AsioDsdPacking::None;
    case AudioSampleFormat::Int24In32Interleaved:
      return format.containerBits == 32 && format.validBits == 24 &&
             format.dsdPacking == AsioDsdPacking::None;
    case AudioSampleFormat::Int32Interleaved:
      return format.containerBits == 32 &&
             (format.validBits == 16 || format.validBits == 18 || format.validBits == 20 || format.validBits == 32) &&
             format.dsdPacking == AsioDsdPacking::None;
    case AudioSampleFormat::Float32Interleaved:
      return (format.containerBits == 32 || format.containerBits == 64) && format.validBits == format.containerBits &&
             !format.validBitsAreMostSignificant && format.dsdPacking == AsioDsdPacking::None;
    case AudioSampleFormat::DsdInt8Lsb1:
      return format.containerBits == 8 && format.validBits == 1 &&
             format.dsdPacking == AsioDsdPacking::Lsb1;
    case AudioSampleFormat::DsdInt8Msb1:
      return format.containerBits == 8 && format.validBits == 1 &&
             format.dsdPacking == AsioDsdPacking::Msb1;
    case AudioSampleFormat::DsdInt8Ner8:
      return format.containerBits == 8 && format.validBits == 8 &&
             format.dsdPacking == AsioDsdPacking::Ner8;
    default:
      return false;
  }
}

inline bool channelFormatsMatch(const AsioChannelFormat& left, const AsioChannelFormat& right) {
  return left.logicalFormat == right.logicalFormat && left.containerBits == right.containerBits &&
         left.validBits == right.validBits && left.littleEndian == right.littleEndian &&
         left.validBitsAreMostSignificant == right.validBitsAreMostSignificant &&
         left.dsdPacking == right.dsdPacking;
}

inline const float* channelSourcePointer(
    const float* input,
    int sourceChannels,
    int outputChannel,
    ChannelRoutingMode routingMode) {
  if (!input || sourceChannels <= 0 || outputChannel < 0) return nullptr;
  if (sourceChannels == 1 &&
      (routingMode == ChannelRoutingMode::MonoToMultichannel || routingMode == ChannelRoutingMode::MonoToStereo)) {
    return outputChannel < 2 ? input : nullptr;
  }
  if (outputChannel >= sourceChannels) return nullptr;
  return input + static_cast<size_t>(outputChannel);
}

inline float channelSampleAt(const float* channelSource, size_t frame, int sourceChannels) {
  return channelSource ? channelSource[frame * static_cast<size_t>(std::max(1, sourceChannels))] : 0.0f;
}

inline bool canCopyPackedFloatChannelFromFloatScratch(
    const float* input,
    size_t frameCount,
    int sourceChannels,
    int outputChannel,
    ChannelRoutingMode routingMode,
    AudioSampleFormat sampleFormat,
    const uint8_t* output) {
  if (!input || !output || frameCount == 0 || sourceChannels != 1 ||
      sampleFormat != AudioSampleFormat::Float32Interleaved) {
    return false;
  }
  if (outputChannel == 0) return true;
  return outputChannel == 1 &&
         (routingMode == ChannelRoutingMode::MonoToStereo ||
          routingMode == ChannelRoutingMode::MonoToMultichannel);
}

inline void writePackedChannelFromFloatScratch(
    const float* input,
    size_t frameCount,
    int sourceChannels,
    int outputChannel,
    ChannelRoutingMode routingMode,
    AudioSampleFormat sampleFormat,
    uint8_t* output) {
  if (!output || frameCount == 0) return;
  if (canCopyPackedFloatChannelFromFloatScratch(
          input,
          frameCount,
          sourceChannels,
          outputChannel,
          routingMode,
          sampleFormat,
          output)) {
    std::memcpy(output, input, frameCount * sizeof(float));
    return;
  }

  const float* channelSource = channelSourcePointer(input, sourceChannels, outputChannel, routingMode);
  const int channelStride = std::max(1, sourceChannels);

  switch (sampleFormat) {
    case AudioSampleFormat::Int16Interleaved: {
      auto* out = reinterpret_cast<int16_t*>(output);
      writeInt16ChannelFromFloatScratch(channelSource, frameCount, channelStride, out);
      break;
    }
    case AudioSampleFormat::Int24Interleaved: {
      writePackedInt24ChannelFromFloatScratch(channelSource, frameCount, channelStride, output);
      break;
    }
    case AudioSampleFormat::Int24In32Interleaved: {
      auto* out = reinterpret_cast<int32_t*>(output);
      writeInt24In32ChannelFromFloatScratch(channelSource, frameCount, channelStride, out);
      break;
    }
    case AudioSampleFormat::Int32Interleaved: {
      auto* out = reinterpret_cast<int32_t*>(output);
      writeInt32ChannelFromFloatScratch(channelSource, frameCount, channelStride, out);
      break;
    }
    case AudioSampleFormat::Float32Interleaved:
    default: {
      auto* out = reinterpret_cast<float*>(output);
      for (size_t frame = 0; frame < frameCount; ++frame) {
        out[frame] = channelSampleAt(channelSource, frame, channelStride);
      }
      break;
    }
  }
}

inline void writePackedChannelFromFloatScratch(
    const float* input,
    size_t frameCount,
    int sourceChannels,
    int outputChannel,
    ChannelRoutingMode routingMode,
    const AsioChannelFormat& format,
    uint8_t* output) {
  if (!output || !isSupportedChannelFormat(format)) return;
  const bool nativeLayout = format.littleEndian &&
      format.containerBits == bytesPerSample(format.logicalFormat) * 8 &&
      (format.logicalFormat != AudioSampleFormat::Int32Interleaved || format.validBits == 32) &&
      (format.logicalFormat != AudioSampleFormat::Int24In32Interleaved || format.validBitsAreMostSignificant);
  if (nativeLayout) {
    writePackedChannelFromFloatScratch(input, frameCount, sourceChannels, outputChannel, routingMode,
                                      format.logicalFormat, output);
    return;
  }
  const auto* source = channelSourcePointer(input, sourceChannels, outputChannel, routingMode);
  const size_t wireBytes = bytesPerSample(format);
  for (size_t frame = 0; frame < frameCount; ++frame) {
    const float sample = channelSampleAt(source, frame, sourceChannels);
    uint64_t bits = 0;
    if (format.logicalFormat == AudioSampleFormat::Float32Interleaved) {
      if (wireBytes == 8) { const double value = sample; std::memcpy(&bits, &value, 8); }
      else { uint32_t value = 0; std::memcpy(&value, &sample, 4); bits = value; }
    } else {
      const int depth = format.validBits;
      const double finite = std::isfinite(sample) ? std::clamp(static_cast<double>(sample), -1.0, 1.0) : 0.0;
      const int64_t peak = int64_t{1} << (depth - 1);
      const int64_t value = std::clamp<int64_t>(std::llround(finite * peak), -peak, peak - 1);
      bits = static_cast<uint32_t>(value);
      if (format.validBitsAreMostSignificant) bits = static_cast<uint32_t>(bits << (format.containerBits - depth));
    }
    for (size_t byte = 0; byte < wireBytes; ++byte) {
      const size_t shift = (format.littleEndian ? byte : wireBytes - 1 - byte) * 8;
      output[frame * wireBytes + byte] = static_cast<uint8_t>(bits >> shift);
    }
  }
}

inline bool canCopyInterleavedTypedChannelToPlanar(
    size_t frameCount,
    int sourceChannels,
    int channel,
    size_t sampleStride) {
  return frameCount > 0 && channel == 0 && sampleStride > 0 && (sourceChannels == 1 || frameCount == 1);
}

inline void writeInterleavedTypedChannelToPlanar(
    const uint8_t* input,
    size_t frameCount,
    int sourceChannels,
    int channel,
    size_t sampleStride,
    uint8_t* output) {
  if (!input || !output || frameCount == 0 || sourceChannels <= 0 || channel < 0 || sampleStride == 0) return;
  if (canCopyInterleavedTypedChannelToPlanar(frameCount, sourceChannels, channel, sampleStride)) {
    std::memcpy(output, input, frameCount * sampleStride);
    return;
  }

  const size_t sourceStride = static_cast<size_t>(sourceChannels);
  const size_t channelOffset = static_cast<size_t>(channel);

  switch (sampleStride) {
    case 1: {
      for (size_t frame = 0; frame < frameCount; ++frame) {
        output[frame] = input[frame * sourceStride + channelOffset];
      }
      break;
    }
    case 2: {
      auto* out = reinterpret_cast<uint16_t*>(output);
      const auto* in = reinterpret_cast<const uint16_t*>(input);
      for (size_t frame = 0; frame < frameCount; ++frame) {
        out[frame] = in[frame * sourceStride + channelOffset];
      }
      break;
    }
    case 3: {
      for (size_t frame = 0; frame < frameCount; ++frame) {
        const size_t sourceOffset = (frame * sourceStride + channelOffset) * 3;
        const size_t outputOffset = frame * 3;
        output[outputOffset + 0] = input[sourceOffset + 0];
        output[outputOffset + 1] = input[sourceOffset + 1];
        output[outputOffset + 2] = input[sourceOffset + 2];
      }
      break;
    }
    case 4: {
      auto* out = reinterpret_cast<uint32_t*>(output);
      const auto* in = reinterpret_cast<const uint32_t*>(input);
      for (size_t frame = 0; frame < frameCount; ++frame) {
        out[frame] = in[frame * sourceStride + channelOffset];
      }
      break;
    }
    default: {
      for (size_t frame = 0; frame < frameCount; ++frame) {
        const size_t sourceOffset = (frame * sourceStride + channelOffset) * sampleStride;
        std::memcpy(output + frame * sampleStride, input + sourceOffset, sampleStride);
      }
      break;
    }
  }
}

inline bool canCopyInterleavedTypedChannelToPlanar(
    const AsioChannelFormat& format,
    size_t frameCount,
    int sourceChannels,
    int channel) {
  return isSupportedChannelFormat(format) &&
         format.dsdPacking != AsioDsdPacking::Ner8 &&
         format.littleEndian && format.containerBits == bytesPerSample(format.logicalFormat) * 8 &&
         (format.logicalFormat != AudioSampleFormat::Int32Interleaved || format.validBits == 32) &&
         (format.logicalFormat != AudioSampleFormat::Int24In32Interleaved ||
          format.validBitsAreMostSignificant) &&
         canCopyInterleavedTypedChannelToPlanar(
             frameCount, sourceChannels, channel, bytesPerSample(format));
}

inline void writeInterleavedTypedChannelToPlanar(
    const uint8_t* input,
    size_t frameCount,
    int sourceChannels,
    int channel,
    const AsioChannelFormat& format,
    uint8_t* output) {
  if (!input || !output || !isSupportedChannelFormat(format) || sourceChannels <= 0 || channel < 0 || channel >= sourceChannels) return;
  if (format.dsdPacking == AsioDsdPacking::Ner8) {
    for (size_t frame = 0; frame < frameCount; ++frame) {
      const uint8_t packed = input[frame * static_cast<size_t>(sourceChannels) + channel];
      for (size_t bit = 0; bit < 8; ++bit) output[frame * 8 + bit] = (packed >> bit) & 1u;
    }
    return;
  }
  const size_t sourceBytes = bytesPerSample(format.logicalFormat);
  const size_t wireBytes = bytesPerSample(format);
  const bool nativeLayout = format.littleEndian && sourceBytes == wireBytes &&
      (format.logicalFormat != AudioSampleFormat::Int32Interleaved || format.validBits == 32) &&
      (format.logicalFormat != AudioSampleFormat::Int24In32Interleaved || format.validBitsAreMostSignificant);
  if (nativeLayout) {
    writeInterleavedTypedChannelToPlanar(input, frameCount, sourceChannels, channel, sourceBytes, output);
    return;
  }
  for (size_t frame = 0; frame < frameCount; ++frame) {
    const auto* source = input + (frame * static_cast<size_t>(sourceChannels) + channel) * sourceBytes;
    uint64_t bits = 0;
    if (format.logicalFormat == AudioSampleFormat::Float32Interleaved && wireBytes == 8) {
      float sample = 0; std::memcpy(&sample, source, 4);
      const double widened = sample; std::memcpy(&bits, &widened, 8);
    } else {
      for (size_t byte = 0; byte < sourceBytes; ++byte) bits |= uint64_t{source[byte]} << (byte * 8);
      if ((format.logicalFormat == AudioSampleFormat::Int24In32Interleaved && !format.validBitsAreMostSignificant) ||
          (format.logicalFormat == AudioSampleFormat::Int32Interleaved && format.validBits < 32)) {
        // Canonical engine int32 is full-scale, and int24-in-32 is left aligned.
        // Arithmetic shifting retains the sign extension in a low-aligned wire
        // container. Integer input never passes through float here.
        const int32_t signedValue = static_cast<int32_t>(static_cast<uint32_t>(bits));
        const int32_t quantized = signedValue >> (32 - format.validBits);
        bits = static_cast<uint32_t>(quantized);
        if (format.validBitsAreMostSignificant) bits = static_cast<uint32_t>(bits << (32 - format.validBits));
      }
    }
    for (size_t byte = 0; byte < wireBytes; ++byte) {
      const size_t shift = (format.littleEndian ? byte : wireBytes - 1 - byte) * 8;
      output[frame * wireBytes + byte] = static_cast<uint8_t>(bits >> shift);
    }
  }
}

}  // namespace twilight::audio::asio
