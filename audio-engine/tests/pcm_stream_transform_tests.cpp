#include "../decoder/FFmpegDecoder.h"
#include "AudioFixtureLibrary.h"

#include <algorithm>
#include <atomic>
#include <cassert>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

using namespace twilight::audio;
using namespace twilight::audio::test;

#if defined(TAE_HAS_FFMPEG)
namespace {

enum class Fault { None, InvalidFormat, OverCapacity, ZeroOutput, PrematureFinish, InputAfterFinish, NonFinite, ThrowPrepare };
enum class Block { None, Prepare, Pull };

struct FakeConfig {
  int rateMultiplier = 1;
  int outputChannels = 0;
  size_t maxPullFrames = 113;
  size_t tailFrames = 0;
  bool deferUntilFinish = false;
  Fault fault = Fault::None;
  Block block = Block::None;
};

struct FakeState {
  std::atomic<int> created{0};
  std::atomic<int> destroyed{0};
  std::atomic<int> finished{0};
  std::atomic<int> cancelled{0};
  std::atomic<size_t> inputFrames{0};
  std::vector<PcmStreamTransformInput> inputs;
  std::vector<std::thread::id> prepareThreads;
  std::mutex mutex;
  std::condition_variable wake;
  bool blockEntered = false;
};

class FakeTransform final : public IPcmStreamTransform {
 public:
  FakeTransform(std::shared_ptr<FakeState> state, FakeConfig config)
      : state_(std::move(state)), config_(config), id_(++state_->created) {}
  ~FakeTransform() override { ++state_->destroyed; }

  bool prepare(const PcmStreamTransformInput& input, AudioFormat* output, std::string* error) override {
    state_->inputs.push_back(input);
    state_->prepareThreads.push_back(std::this_thread::get_id());
    if (config_.fault == Fault::ThrowPrepare) throw std::runtime_error("synthetic prepare failure");
    if (config_.block == Block::Prepare && id_ == 1) return waitForCancel(error);
    input_ = input.format;
    output_ = input_;
    output_.sampleRate *= config_.rateMultiplier;
    if (config_.outputChannels > 0) output_.channelCount = config_.outputChannels;
    if (config_.fault == Fault::InvalidFormat) output_.sampleRate = 0;
    *output = output_;
    return true;
  }

  bool push(const float* input, size_t frames, std::string*) override {
    assert(!finished_);
    state_->inputFrames += frames;
    for (size_t frame = 0; frame < frames; ++frame) {
      for (int duplicate = 0; duplicate < config_.rateMultiplier; ++duplicate) {
        for (int channel = 0; channel < output_.channelCount; ++channel) {
          queued_.push_back(input[frame * input_.channelCount + std::min(channel, input_.channelCount - 1)]);
        }
      }
    }
    return true;
  }

  bool pull(float* output, size_t capacity, PcmStreamTransformReadResult* result, std::string* error) override {
    if (config_.block == Block::Pull && id_ == 1) return waitForCancel(error);
    if (config_.fault == Fault::OverCapacity) {
      *result = {PcmStreamTransformReadStatus::Output, capacity + 1};
      return true;
    }
    if (config_.fault == Fault::ZeroOutput) {
      *result = {PcmStreamTransformReadStatus::Output, 0};
      return true;
    }
    if (config_.fault == Fault::PrematureFinish) {
      *result = {PcmStreamTransformReadStatus::Finished, 0};
      return true;
    }
    const size_t channels = static_cast<size_t>(output_.channelCount);
    const size_t available = (queued_.size() - offset_) / channels;
    if (available > 0 && (!config_.deferUntilFinish || finished_)) {
      const size_t frames = std::min({capacity, config_.maxPullFrames, available});
      std::copy_n(queued_.data() + offset_, frames * channels, output);
      offset_ += frames * channels;
      if (config_.fault == Fault::NonFinite) output[0] = std::nanf("");
      *result = {PcmStreamTransformReadStatus::Output, frames};
      return true;
    }
    *result = {finished_ && config_.fault != Fault::InputAfterFinish
                   ? PcmStreamTransformReadStatus::Finished
                   : PcmStreamTransformReadStatus::NeedInput,
               0};
    return true;
  }

  bool finish(std::string*) override {
    assert(!finished_);
    finished_ = true;
    ++state_->finished;
    queued_.insert(queued_.end(), config_.tailFrames * output_.channelCount, 0.125f);
    return true;
  }

  void cancel() noexcept override {
    {
      std::lock_guard lock(state_->mutex);
      cancelled_ = true;
      ++state_->cancelled;
    }
    state_->wake.notify_all();
  }

 private:
  bool waitForCancel(std::string* error) {
    std::unique_lock lock(state_->mutex);
    state_->blockEntered = true;
    state_->wake.notify_all();
    state_->wake.wait(lock, [this] { return cancelled_; });
    if (error) *error = "synthetic transform cancelled";
    return false;
  }

  std::shared_ptr<FakeState> state_;
  FakeConfig config_;
  int id_;
  AudioFormat input_;
  AudioFormat output_;
  std::vector<float> queued_;
  size_t offset_ = 0;
  bool finished_ = false;
  bool cancelled_ = false;
};

PcmStreamTransformFactory factoryFor(const std::shared_ptr<FakeState>& state, FakeConfig config = {}) {
  return [state, config] { return std::make_unique<FakeTransform>(state, config); };
}

AudioFormat floatFormat(int rate, int channels = 2) {
  AudioFormat format;
  format.sampleRate = rate;
  format.channelCount = channels;
  format.bitDepth = 32;
  format.sampleFormat = AudioSampleFormat::Float32Interleaved;
  return format;
}

std::vector<float> readAll(FFmpegDecoder& decoder, std::string* error, size_t chunk = 337) {
  std::vector<float> samples;
  std::vector<float> buffer(chunk * decoder.outputFormat().channelCount);
  for (size_t iteration = 0; iteration < 10000; ++iteration) {
    error->clear();
    const size_t frames = decoder.readFrames(buffer.data(), chunk, error);
    samples.insert(samples.end(), buffer.begin(), buffer.begin() + frames * decoder.outputFormat().channelCount);
    if (!error->empty() || frames == 0) return samples;
  }
  assert(false && "Decoder did not reach EOF in a bounded synthetic stream");
  return {};
}

std::vector<float> decodeReference(const std::string& path, const AudioFormat& format) {
  FFmpegDecoder decoder;
  std::string error;
  assert(decoder.open(path, &error));
  assert(decoder.setOutputFormat(format, &error));
  auto samples = readAll(decoder, &error);
  assert(error.empty());
  assert(decoder.eof());
  return samples;
}

void assertSame(const std::vector<float>& actual, const std::vector<float>& expected) {
  assert(actual.size() == expected.size());
  for (size_t i = 0; i < actual.size(); ++i) {
    assert(std::isfinite(actual[i]));
    assert(std::abs(actual[i] - expected[i]) <= 0.000002f);
  }
}

TempAudioFixture writeFloatReference(const std::vector<float>& samples, int rate, int channels) {
  const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
  const auto path = std::filesystem::temp_directory_path() /
      ("twilight-transform-reference-" + std::to_string(stamp) + ".wav");
  std::ofstream output(path, std::ios::binary);
  const auto le16 = [&](uint16_t value) {
    output.put(static_cast<char>(value));
    output.put(static_cast<char>(value >> 8));
  };
  const auto le32 = [&](uint32_t value) {
    for (int byte = 0; byte < 4; ++byte) output.put(static_cast<char>(value >> (byte * 8)));
  };
  output.write("RIFF", 4); le32(36 + static_cast<uint32_t>(samples.size() * sizeof(float)));
  output.write("WAVEfmt ", 8); le32(16); le16(3); le16(static_cast<uint16_t>(channels));
  le32(rate); le32(rate * channels * sizeof(float)); le16(channels * sizeof(float)); le16(32);
  output.write("data", 4); le32(static_cast<uint32_t>(samples.size() * sizeof(float)));
  for (float sample : samples) {
    uint32_t bits;
    std::memcpy(&bits, &sample, sizeof(bits));
    le32(bits);
  }
  assert(output.good());
  return TempAudioFixture(path);
}

void identityPreservesNativeInputAndHostResampling() {
  const auto fixture = writePcmWavFixture({"twilight-transform-identity.wav", 44100, 1, 16, 2048, false});
  const auto output = floatFormat(48000, 2);
  const auto expected = decodeReference(fixture.string(), output);
  auto state = std::make_shared<FakeState>();
  FFmpegDecoder decoder;
  decoder.setPcmStreamTransformFactory(factoryFor(state));
  std::string error;
  assert(decoder.open(fixture.string(), &error));
  const auto bitrate = decoder.streamInfo().bitrate;
  assert(decoder.setOutputFormat(output, &error));
  assert(state->created == 0);
  std::vector<float> actual;
  std::thread reader([&] { actual = readAll(decoder, &error); });
  const auto readerId = reader.get_id();
  reader.join();
  assert(error.empty());
  assertSame(actual, expected);
  assert(state->inputs.size() == 1);
  assert(state->inputs[0].format.sampleRate == 44100);
  assert(state->inputs[0].format.channelCount == 1);
  assert(state->inputs[0].format.sampleFormat == AudioSampleFormat::Float32Interleaved);
  assert(state->inputs[0].encodedBitrate == bitrate && bitrate > 0);
  assert(state->prepareThreads[0] == readerId);
  assert(state->inputFrames == 2048);
  assert(state->finished == 1);
  assert(decoder.streamInfo().sourceFormat.sampleRate == 44100);
  assert(decoder.outputFormat().sampleRate == 48000);
}

void changedRateAndChannelsUseActualTransformFormat() {
  const auto fixture = writePcmWavFixture({"twilight-transform-rate.wav", 48000, 2, 32, 1537, true});
  const auto original = decodeReference(fixture.string(), floatFormat(48000));
  std::vector<float> doubledMono;
  for (size_t frame = 0; frame < original.size() / 2; ++frame) {
    doubledMono.push_back(original[frame * 2]);
    doubledMono.push_back(original[frame * 2]);
  }
  const auto processedFixture = writeFloatReference(doubledMono, 96000, 1);
  const auto expected = decodeReference(processedFixture.string(), floatFormat(48000));
  auto state = std::make_shared<FakeState>();
  FakeConfig config;
  config.rateMultiplier = 2;
  config.outputChannels = 1;
  config.maxPullFrames = 71;
  FFmpegDecoder decoder;
  decoder.setPcmStreamTransformFactory(factoryFor(state, config));
  std::string error;
  assert(decoder.open(fixture.string(), &error));
  assert(decoder.setOutputFormat(floatFormat(48000), &error));
  const auto actual = readAll(decoder, &error, 59);
  assert(error.empty());
  assertSame(actual, expected);
  assert(actual.size() == 1537 * 2);
  assert(state->inputs[0].format.sampleRate == 48000);
  assert(state->inputs[0].format.channelCount == 2);
  assert(decoder.streamInfo().sourceFormat.sampleRate == 48000);
  assert(decoder.streamInfo().decodedFormat.sampleRate == 48000);
}

void finishDrainsBufferedOutputAndTailExactlyOnce() {
  const auto fixture = writePcmWavFixture({"twilight-transform-eof.wav", 48000, 2, 32, 19, true});
  auto expected = decodeReference(fixture.string(), floatFormat(48000));
  expected.insert(expected.end(), 7 * 2, 0.125f);
  auto state = std::make_shared<FakeState>();
  FakeConfig config;
  config.deferUntilFinish = true;
  config.tailFrames = 7;
  config.maxPullFrames = 1;
  FFmpegDecoder decoder;
  decoder.setPcmStreamTransformFactory(factoryFor(state, config));
  std::string error;
  assert(decoder.open(fixture.string(), &error));
  assert(decoder.setOutputFormat(floatFormat(48000), &error));
  assertSame(readAll(decoder, &error, 3), expected);
  assert(error.empty() && decoder.eof());
  assert(state->finished == 1);
  float more[4]{};
  assert(decoder.readFrames(more, 2, &error) == 0);
  assert(state->finished == 1);
}

void seekAndReopenCreateFreshInstances() {
  const auto fixture = writePcmWavFixture({"twilight-transform-seek.wav", 48000, 2, 32, 4096, true});
  const auto expected = decodeReference(fixture.string(), floatFormat(48000));
  auto state = std::make_shared<FakeState>();
  FFmpegDecoder decoder;
  decoder.setPcmStreamTransformFactory(factoryFor(state));
  std::string error;
  assert(decoder.open(fixture.string(), &error));
  assert(decoder.setOutputFormat(floatFormat(48000), &error));
  float prefix[64]{};
  assert(decoder.readFrames(prefix, 32, &error) == 32);
  assert(state->created == 1);
  decoder.cancelPcmStreamTransform();
  assert(decoder.seek(0, &error));
  assert(state->destroyed == 1 && state->created == 1);
  assertSame(readAll(decoder, &error), expected);
  assert(error.empty() && state->created == 2);
  decoder.close();
  assert(state->destroyed == 2);
  assert(decoder.open(fixture.string(), &error));
  assert(decoder.setOutputFormat(floatFormat(48000), &error));
  assertSame(readAll(decoder, &error), expected);
  assert(error.empty() && state->created == 3);
  decoder.setPcmStreamTransformFactory({});
  assert(state->destroyed == 3);
  assert(decoder.open(fixture.string(), &error));
  assert(decoder.setOutputFormat(floatFormat(48000), &error));
  assertSame(readAll(decoder, &error), expected);
  assert(error.empty() && state->created == 3);
}

void preciseSeekDoesNotInventAnEffectTimeline() {
  const auto fixture = writePcmWavFixture({"twilight-transform-precise.wav", 48000, 2, 32, 23, true});
  auto state = std::make_shared<FakeState>();
  FFmpegDecoder decoder;
  decoder.setPcmStreamTransformFactory(factoryFor(state));
  std::string error;
  assert(decoder.open(fixture.string(), &error));
  assert(!decoder.seekOutputFrame(3, &error));
  assert(error.find("unsupported") != std::string::npos);
  assert(state->created == 0);
}

void invalidTransformResultsFailInsteadOfBypassing(Fault fault) {
  const auto fixture = writePcmWavFixture({"twilight-transform-invalid.wav", 48000, 2, 32, 97, true});
  auto state = std::make_shared<FakeState>();
  FakeConfig config;
  config.fault = fault;
  FFmpegDecoder decoder;
  decoder.setPcmStreamTransformFactory(factoryFor(state, config));
  std::string error;
  assert(decoder.open(fixture.string(), &error));
  assert(decoder.setOutputFormat(floatFormat(48000), &error));
  const auto samples = readAll(decoder, &error);
  assert(!error.empty());
  assert(!decoder.eof());
  if (fault != Fault::InputAfterFinish) assert(samples.empty());
  error.clear();
  float more[4]{};
  assert(decoder.readFrames(more, 2, &error) == 0);
  assert(!error.empty());
}

void cancelWakesBlockedOperationsAndSeekRecreates(Block block) {
  const auto fixture = writePcmWavFixture({"twilight-transform-cancel.wav", 48000, 2, 32, 101, true});
  auto state = std::make_shared<FakeState>();
  FakeConfig config;
  config.block = block;
  FFmpegDecoder decoder;
  decoder.setPcmStreamTransformFactory(factoryFor(state, config));
  std::string error;
  assert(decoder.open(fixture.string(), &error));
  assert(decoder.setOutputFormat(floatFormat(48000), &error));
  size_t read = 999;
  std::thread reader([&] {
    float output[64]{};
    read = decoder.readFrames(output, 32, &error);
  });
  {
    std::unique_lock lock(state->mutex);
    assert(state->wake.wait_for(lock, std::chrono::seconds(2), [&] { return state->blockEntered; }));
  }
  decoder.cancelPcmStreamTransform();
  reader.join();
  assert(read == 0 && error.find("cancel") != std::string::npos);
  assert(!decoder.eof());
  error.clear();
  assert(decoder.seek(0, &error));
  assert(state->destroyed == 1);
  assertSame(readAll(decoder, &error), decodeReference(fixture.string(), floatFormat(48000)));
  assert(error.empty() && state->created == 2);
}

void cancelBeforeFirstReadDoesNotStartAWorker() {
  const auto fixture = writePcmWavFixture({"twilight-transform-pre-cancel.wav", 48000, 2, 32, 17, true});
  auto state = std::make_shared<FakeState>();
  FFmpegDecoder decoder;
  decoder.setPcmStreamTransformFactory(factoryFor(state));
  std::string error;
  assert(decoder.open(fixture.string(), &error));
  assert(decoder.setOutputFormat(floatFormat(48000), &error));
  decoder.cancelPcmStreamTransform();
  float samples[4]{};
  assert(decoder.readFrames(samples, 2, &error) == 0);
  assert(error == "decode_cancelled" && state->created == 0);
  error.clear();
  assert(decoder.seek(0, &error));
  assert(!readAll(decoder, &error).empty());
  assert(error.empty() && state->created == 1);
}

void restartIsIdempotentAndPreservesUncancelledPendingPcm() {
  const auto fixture = writePcmWavFixture({"twilight-transform-restart.wav", 48000, 2, 32, 4096, true});
  auto state = std::make_shared<FakeState>();
  FFmpegDecoder decoder;
  decoder.setPcmStreamTransformFactory(factoryFor(state));
  std::string error;
  assert(decoder.open(fixture.string(), &error));
  assert(decoder.setOutputFormat(floatFormat(48000), &error));
  std::vector<float> prefix(32 * 2);
  assert(decoder.readFrames(prefix.data(), 32, &error) == 32);
  assert(decoder.restartPcmStreamTransform(&error));
  assert(state->created == 1 && state->destroyed == 0);
  const auto rest = readAll(decoder, &error);
  prefix.insert(prefix.end(), rest.begin(), rest.end());
  assertSame(prefix, decodeReference(fixture.string(), floatFormat(48000)));
  assert(error.empty());
  assert(decoder.seek(0, &error));
  assert(decoder.restartPcmStreamTransform(&error));
  assert(state->created == 1 && state->destroyed == 1);
  assertSame(readAll(decoder, &error), decodeReference(fixture.string(), floatFormat(48000)));
  assert(error.empty() && state->created == 2);
}

void restartAfterCancellationRecreatesWithoutReusingNativeState() {
  const auto fixture = writePcmWavFixture({"twilight-transform-resume.wav", 48000, 2, 32, 8192, true});
  auto state = std::make_shared<FakeState>();
  FFmpegDecoder decoder;
  decoder.setPcmStreamTransformFactory(factoryFor(state));
  std::string error;
  assert(decoder.open(fixture.string(), &error));
  assert(decoder.setOutputFormat(floatFormat(48000), &error));
  float prefix[64]{};
  assert(decoder.readFrames(prefix, 32, &error) == 32);
  decoder.cancelPcmStreamTransform();
  assert(decoder.setOutputFormat(floatFormat(44100), &error));
  assert(decoder.restartPcmStreamTransform(&error));
  assert(state->created == 1 && state->destroyed == 1);
  assert(decoder.restartPcmStreamTransform(&error));
  (void)readAll(decoder, &error);
  assert(error.empty() && state->created == 2 && decoder.eof());
}

}  // namespace
#endif

int main() {
#if defined(TAE_HAS_FFMPEG)
  identityPreservesNativeInputAndHostResampling();
  changedRateAndChannelsUseActualTransformFormat();
  finishDrainsBufferedOutputAndTailExactlyOnce();
  seekAndReopenCreateFreshInstances();
  preciseSeekDoesNotInventAnEffectTimeline();
  for (const auto fault : {Fault::InvalidFormat, Fault::OverCapacity, Fault::ZeroOutput,
                          Fault::PrematureFinish, Fault::InputAfterFinish, Fault::NonFinite, Fault::ThrowPrepare})
    invalidTransformResultsFailInsteadOfBypassing(fault);
  cancelWakesBlockedOperationsAndSeekRecreates(Block::Prepare);
  cancelWakesBlockedOperationsAndSeekRecreates(Block::Pull);
  cancelBeforeFirstReadDoesNotStartAWorker();
  restartIsIdempotentAndPreservesUncancelledPendingPcm();
  restartAfterCancellationRecreatesWithoutReusingNativeState();
  std::cout << "17 PCM stream transform scenarios passed\n";
  return 0;
#else
  std::cout << "PCM stream transform tests require an FFmpeg-enabled build\n";
  return 77;
#endif
}
