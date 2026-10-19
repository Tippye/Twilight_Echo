#pragma once

#include "../IOutputBackend.h"
#include "ICoreAudioHost.h"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstring>

namespace twilight::audio::coreaudio {

// Scatter an interleaved client block into HAL channel groups without allocations.
inline void scatterFloatOutput(const float* input, size_t frames, int channels, CoreAudioBufferList& output) {
  size_t channelOffset = 0;
  for (size_t index = 0; index < output.bufferCount(); ++index) {
    auto& buffer = output.bufferAt(index);
    if (!buffer.hasData()) {
      channelOffset += buffer.numberChannels;
      continue;
    }
    std::memset(buffer.writableData(), 0, buffer.byteSize());
    const size_t groupChannels = buffer.numberChannels;
    const size_t groupFrames = groupChannels > 0
        ? std::min(frames, buffer.byteSize() / sizeof(float) / groupChannels) : 0;
    auto* samples = reinterpret_cast<float*>(buffer.writableData());
    for (size_t frame = 0; frame < groupFrames; ++frame) {
      for (size_t channel = 0; channel < groupChannels; ++channel) {
        if (channelOffset + channel < static_cast<size_t>(channels)) {
          samples[frame * groupChannels + channel] = input[frame * channels + channelOffset + channel];
        }
      }
    }
    buffer.dataByteSize = static_cast<uint32_t>(buffer.byteSize());
    channelOffset += groupChannels;
  }
}

inline size_t renderFloatCallbackWithTailSilence(
    float* output,
    size_t frameCount,
    int channelCount,
    const RenderCallback& callback) {
  if (!output || frameCount == 0 || channelCount <= 0) return 0;

  size_t renderedFrames = 0;
  if (callback) {
    renderedFrames = std::min(callback(output, frameCount), frameCount);
  }

  if (renderedFrames < frameCount) {
    const size_t renderedSamples = renderedFrames * static_cast<size_t>(channelCount);
    const size_t totalSamples = frameCount * static_cast<size_t>(channelCount);
    std::fill(output + renderedSamples, output + totalSamples, 0.0f);
  }
  return renderedFrames;
}

inline size_t renderTypedCallbackWithTailSilence(
    uint8_t* output,
    size_t frameCount,
    const AudioFormat& format,
    const TypedRenderCallback& callback) {
  const size_t bytesPerFrame = audioFormatBytesPerFrame(format);
  if (!output || frameCount == 0 || bytesPerFrame == 0) return 0;

  PcmBlock block;
  block.format = format;
  block.data = output;
  block.frames = frameCount;
  block.byteSize = frameCount * bytesPerFrame;

  size_t renderedFrames = 0;
  if (callback) {
    renderedFrames = std::min(callback(block), frameCount);
  }

  if (renderedFrames < frameCount) {
    const size_t renderedBytes = renderedFrames * bytesPerFrame;
    const size_t totalBytes = frameCount * bytesPerFrame;
    std::memset(output + renderedBytes, 0, totalBytes - renderedBytes);
  }
  return renderedFrames;
}

}  // namespace twilight::audio::coreaudio
