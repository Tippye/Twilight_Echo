#include "../decoder/FFmpegDecoder.h"
#include "../decoder/Win32PcmWorkerTransform.h"
#include "AudioFixtureLibrary.h"

#include <cassert>
#include <chrono>
#include <cmath>
#include <iostream>
#include <vector>

using namespace twilight::audio;
using namespace twilight::audio::test;

static uint64_t expiresAt() {
  return static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::system_clock::now().time_since_epoch()).count()) + 60000;
}

static std::vector<float> decode(FFmpegDecoder& decoder) {
  std::vector<float> output, block(4096 * 2);
  std::string error;
  for (unsigned count = 0; count < 1000; ++count) {
    const auto frames = decoder.readFrames(block.data(), 4096, &error);
    assert(error.empty());
    output.insert(output.end(), block.begin(), block.begin() + frames * 2);
    if (!frames) { assert(decoder.eof()); break; }
    assert(count < 999);
  }
  assert(!output.empty());
  for (const auto value : output) assert(std::isfinite(value));
  return output;
}

int main(int argc, char** argv) {
  // Local installed QQ resources are optional, never a hermetic CI dependency.
  if (argc != 2) return 77;
  PcmWorkerSpec spec{argv[1], {}, expiresAt()};
  AudioFormat format;
  format.sampleRate = 48000;
  format.channelCount = 2;
  format.bitDepth = 32;
  format.sampleFormat = AudioSampleFormat::Float32Interleaved;
  std::string error;
  {
    auto worker = createPcmWorkerTransform(spec);
    AudioFormat processed;
    assert(worker->prepare({format, 1000000}, &processed, &error));
    assert(error.empty() && processed.sampleRate == 96000 && processed.channelCount == 2);
  }
  auto fixture = writePcmWavFixture({"qq-excellent-parent-synthetic.wav", 48000, 2, 24, 96000});
  FFmpegDecoder plain;
  assert(plain.open(fixture.string(), &error) && plain.setOutputFormat(format, &error));
  const auto dry = decode(plain);
  assert(dry.size() == 192000);
  unsigned generations = 0;
  FFmpegDecoder effect;
  effect.setPcmStreamTransformFactory([&] { ++generations; return createPcmWorkerTransform(spec); });
  assert(effect.open(fixture.string(), &error) && effect.setOutputFormat(format, &error));
  const auto first = decode(effect);
  assert(generations == 1 && first != dry);
  // The native SDK exposes queued output, not a duration-exact tail finalizer.
  assert(first.size() > 160000 && first.size() < dry.size());
  assert(effect.outputFormat().sampleRate == 48000);
  assert(effect.seek(0.5, &error));
  const auto seeked = decode(effect);
  assert(generations == 2 && seeked.size() < first.size());
  FFmpegDecoder repeated;
  repeated.setPcmStreamTransformFactory([&] { return createPcmWorkerTransform(spec); });
  assert(repeated.open(fixture.string(), &error) && repeated.setOutputFormat(format, &error));
  assert(repeated.seek(0.5, &error));
  assert(decode(repeated) == seeked);
  {
    auto cancelled = createPcmWorkerTransform(spec);
    cancelled->cancel();
    AudioFormat ignored;
    assert(!cancelled->prepare({format, 1000000}, &ignored, &error));
  }
  std::cout << "parent/source-F32/real-x86-HSR/final-SWR, EOF, seek-recreate and precancel passed; frames="
            << first.size() / 2 << " seekFrames=" << seeked.size() / 2 << '\n';
}
