#include "FfmpegFlacIndexFixture.h"
#include "../decoder/FFmpegDecoder.h"
#include "../decoder/FFmpegDecoderUtils.h"
#include "../core/SharedInputFile.h"
#include "../dsp/DspTypes.h"
#include "AudioFixtureLibrary.h"
#include "FfmpegHttpProbe.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <cassert>
#include <cmath>
#include <chrono>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iomanip>
#include <memory>
#include <sstream>
#include <string>
#include <system_error>
#include <vector>

using namespace twilight::audio;
using namespace twilight::audio::test;

namespace {

std::string readTextFile(const std::filesystem::path& path) {
  std::ifstream input(path);
  std::ostringstream buffer;
  buffer << input.rdbuf();
  return buffer.str();
}

void assertDecoderInt24AppendAvoidsUnalignedInt32Reads() {
  const std::filesystem::path sourcePath =
      std::filesystem::path(__FILE__).parent_path().parent_path() / "decoder" / "FFmpegDecoderUtils.h";
  const std::string source = readTextFile(sourcePath);
  if (source.empty() || source.find("reinterpret_cast<const int32_t*>(source)") != std::string::npos) {
    std::abort();
  }
}

void assertDecoderContinuesWhenResamplerOutputsNoSamples() {
  const std::filesystem::path sourcePath =
      std::filesystem::path(__FILE__).parent_path().parent_path() / "decoder" / "FFmpegDecoder.cpp";
  const std::string source = readTextFile(sourcePath);
  if (source.empty() || source.find("return ok && !pending.empty();") != std::string::npos ||
      source.find("if (pending.empty())") == std::string::npos) {
    std::abort();
  }
}

void assertDecoderReportsPcm(const std::string& name, int bitsPerSample) {
  const auto fixture = writePcmWavFixture({name, 48000, 2, bitsPerSample, 32, false});
  FFmpegDecoder decoder;
  std::string error;
  assert(decoder.open(fixture.string(), &error));
  const AudioStreamInfo stream = decoder.streamInfo();
  assert(stream.sourceLossless);
  assert(!stream.isDsd);
  assert(stream.sourceFormat.sampleRate == 48000);
  assert(stream.sourceFormat.channelCount == 2);
  assert(stream.sourceFormat.bitDepth == bitsPerSample);
  assert(stream.decodedFormat.sampleRate == 48000);
  assert(stream.decodedFormat.channelCount == 2);
  assert(stream.decodedFormat.bitDepth == bitsPerSample);
  if (bitsPerSample == 16) {
    assert(stream.decodedFormat.sampleFormat == AudioSampleFormat::Int16Interleaved);
  } else if (bitsPerSample == 24) {
    assert(stream.decodedFormat.sampleFormat == AudioSampleFormat::Int24Interleaved);
  } else {
    assert(stream.decodedFormat.sampleFormat == AudioSampleFormat::Int32Interleaved);
  }
  decoder.close();
}

void assertDecoderCancellationCanBeResetBeforeSeek() {
  const auto fixture = writePcmWavFixture({"twilight-cancel-reset.wav", 48000, 2, 16, 8192, false});
  FFmpegDecoder decoder;
  std::atomic<bool> cancelled{true};
  decoder.setInterrupt([](void* context) -> int {
    return static_cast<std::atomic<bool>*>(context)->load();
  }, &cancelled);
  std::string error;
  assert(!decoder.open(fixture.string(), &error));
  cancelled = false;
  error.clear();
  assert(decoder.open(fixture.string(), &error));
  const auto format = decoder.outputFormat();
  std::vector<uint8_t> samples(256 * audioFormatBytesPerFrame(format));
  PcmBlock block{format, samples.data(), 256, samples.size()};
  assert(decoder.readFrames(block, &error) > 0);
  cancelled = true;
  assert(decoder.readFrames(block, &error) == 0);
  assert(error == "decode_cancelled");
  cancelled = false;
  error.clear();
  assert(decoder.seek(0.0, &error));
  assert(decoder.readFrames(block, &error) > 0);
}

void assertRemoteIoHasDeadline(const std::string& source, bool readStall) {
  FFmpegDecoder decoder;
  std::string error;
  const auto started = std::chrono::steady_clock::now();
  const bool opened = decoder.open(source, &error);
  if (!readStall) {
    assert(!opened);
    assert(std::chrono::steady_clock::now() - started < std::chrono::seconds(18));
    return;
  }
  assert(opened);
  assert(std::chrono::steady_clock::now() - started < std::chrono::seconds(18));
  const auto readStarted = std::chrono::steady_clock::now();
  const auto format = decoder.outputFormat();
  std::vector<uint8_t> bytes(2048 * audioFormatBytesPerFrame(format));
  PcmBlock block{format, bytes.data(), 2048, bytes.size()};
  size_t frames = 0;
  while (error.empty()) {
    const auto read = decoder.readFrames(block, &error);
    frames += read;
    if (read == 0) break;
  }
  assert(frames > 0);
  assert(!error.empty());
  // A timeout is a terminal read failure, not a normal end of the song. The
  // next read must retain its reason rather than silently becoming EOF.
  assert(!decoder.eof());
  const auto failure = error;
  error.clear();
  assert(decoder.readFrames(block, &error) == 0);
  assert(error == failure);
  assert(!decoder.eof());
  assert(std::chrono::steady_clock::now() - readStarted < std::chrono::seconds(18));
}

void assertDecoderTailZeroHelperPreservesCopiedFrames() {
  AudioFormat format;
  format.sampleRate = 48000;
  format.channelCount = 2;
  format.bitDepth = 32;
  format.sampleFormat = AudioSampleFormat::Float32Interleaved;

  std::vector<uint8_t> bytes(3 * audioFormatBytesPerFrame(format), 0x7f);
  PcmBlock block;
  block.format = format;
  block.data = bytes.data();
  block.frames = 3;
  block.byteSize = bytes.size();

  ffmpeg::zeroPcmBlockTail(block, 1);

  const size_t bytesPerFrame = audioFormatBytesPerFrame(format);
  for (size_t i = 0; i < bytesPerFrame; ++i) {
    assert(bytes[i] == 0x7f);
  }
  for (size_t i = bytesPerFrame; i < bytes.size(); ++i) {
    assert(bytes[i] == 0);
  }
}

void assertDecoderDirectPendingHelperShrinksToActualSamples() {
  std::vector<uint8_t> pending = {0xaa, 0xbb};
  const size_t start = pending.size();
  uint8_t* write = ffmpeg::resizePendingForDirectWrite(
      pending,
      4,
      AudioSampleFormat::Float32Interleaved);
  assert(write == pending.data() + start);
  assert(pending.size() == start + 4 * sizeof(float));

  ffmpeg::commitPendingDirectWrite(
      pending,
      start,
      2,
      AudioSampleFormat::Float32Interleaved);
  assert(pending.size() == start + 2 * sizeof(float));
  assert(pending[0] == 0xaa);
  assert(pending[1] == 0xbb);

  assert(ffmpeg::resizePendingForDirectWrite(
             pending,
             4,
             AudioSampleFormat::Int24Interleaved) == nullptr);
}

void assertDecoderReportsDsdFallbackWhenSupported() {
  const auto fixture = writeDsfFixture("twilight-decoder-dsd64.dsf");
  FFmpegDecoder decoder;
  std::string error;
  if (!decoder.open(fixture.string(), &error)) {
    std::cout << "Skipping DSF decoder fixture: " << error << std::endl;
    return;
  }

  const AudioStreamInfo stream = decoder.streamInfo();
  assert(stream.isDsd);
  assert(stream.dsdMode == DsdMode::Pcm);
  assert(stream.dsdRate == 64);
  assert(stream.sourceLossless);
  assert(stream.sourceFormat.sampleRate == 2822400);
  assert(stream.sourceFormat.channelCount == 2);
  assert(stream.sourceFormat.bitDepth == 1);
  assert(stream.decodedFormat.channelCount == 2);
  assert(stream.decodedFormat.bitDepth == 32);
  assert(stream.decodedFormat.sampleFormat == AudioSampleFormat::Float32Interleaved);
  assert(stream.decodedFormat.sampleRate > 0);
  decoder.close();
}

std::filesystem::path pathFromUtf8Bytes(const std::string& utf8) {
  return std::filesystem::path(reinterpret_cast<const char8_t*>(utf8.c_str()));
}

void assertSharedFilePreservesReadAndSeekAfterDeletion() {
  const auto path = std::filesystem::temp_directory_path() /
      pathFromUtf8Bytes("twilight-shared-\xe4\xb8\xad\xe6\x96\x87.bin");
  std::vector<char> bytes(70000);
  for (size_t i = 0; i < bytes.size(); ++i) bytes[i] = static_cast<char>(i % 127);
  { std::ofstream file(path, std::ios::binary); file.write(bytes.data(), bytes.size()); }
  SharedInputFile file;
  auto missing = path;
  missing += ".missing";
  file.open(missing);
  assert(!file);
  file.open(path);
  assert(file.is_open());
  std::array<char, 128> read{};
  file.read(read.data(), 5);
  assert(file.tellg() == 5);
  file.seekg(10, std::ios::cur);
  assert(file.tellg() == 15);
  file.read(read.data(), 6);
  assert(std::equal(read.begin(), read.begin() + 6, bytes.begin() + 15));
  file.seekg(-4, std::ios::end);
  file.read(read.data(), 8);
  assert(file.eof());
  assert(file.gcount() == 4);
  file.clear();
  file.seekg(33333, std::ios::beg);
  file.read(read.data(), read.size());
  assert(std::equal(read.begin(), read.end(), bytes.begin() + 33333));
  auto renamed = path;
  renamed += ".renamed";
  std::error_code fsError;
  std::filesystem::rename(path, renamed, fsError);
  assert(!fsError);
  assert(std::filesystem::remove(renamed, fsError));
  assert(!fsError);
  file.seekg(64000, std::ios::beg);
  file.read(read.data(), read.size());
  assert(file.gcount() == static_cast<std::streamsize>(read.size()));
  assert(std::equal(read.begin(), read.end(), bytes.begin() + 64000));
  file.close();
}

void assertDecoderOpensUtf8Path() {
  const std::string chinesePath = "\xe4\xb8\xad\xe6\x96\x87\xe8\xb7\xaf\xe5\xbe\x84";
  const std::filesystem::path unicodeDir =
      std::filesystem::temp_directory_path() / pathFromUtf8Bytes("twilight-" + chinesePath);
  std::error_code fsError;
  std::filesystem::create_directories(unicodeDir, fsError);
  assert(!fsError);

  const auto fixtureName = (unicodeDir / pathFromUtf8Bytes("twilight-" + chinesePath + "-s16.wav")).u8string();
  auto fixture = writePcmWavFixture(
      {std::string(reinterpret_cast<const char*>(fixtureName.data()), fixtureName.size()), 48000, 2, 16, 32, false});
  assert(std::filesystem::exists(fixture.path()));

  FFmpegDecoder decoder;
  std::string error;
  const bool opened = decoder.open(fixture.string(), &error);
  if (!opened) {
    std::fprintf(stderr, "UTF-8 path fixture failed to decode: %s\nerror: %s\n", fixture.string().c_str(), error.c_str());
  }
  assert(opened);
  assert(decoder.streamInfo().source == fixture.string());
  assert(decoder.streamInfo().sourceFormat.sampleRate == 48000);
  assert(decoder.streamInfo().sourceFormat.channelCount == 2);
  decoder.close();

  fixture.cleanup();
  std::filesystem::remove(unicodeDir, fsError);
}

void assertOpenDecoderAllowsFileRenameAndDeletion() {
  const auto fixture = writePcmWavFixture(
      {"twilight-decoder-file-sharing.wav", 48000, 2, 16, 96000, false});
  FFmpegDecoder decoder;
  std::string error;
  assert(decoder.open(fixture.string(), &error));
  AudioFormat output = decoder.streamInfo().decodedFormat;
  output.bitDepth = 32;
  output.sampleFormat = AudioSampleFormat::Float32Interleaved;
  assert(decoder.setOutputFormat(output, &error));
  auto renamed = fixture.path();
  renamed += ".renamed.wav";
  std::error_code fsError;
  std::filesystem::rename(fixture.path(), renamed, fsError);
  if (fsError) std::cerr << "Open decoder blocks rename: " << fsError.message() << std::endl;
  assert(!fsError);
  assert(std::filesystem::remove(renamed, fsError));
  assert(!fsError);
  // Continue through the original handle, including a seek beyond the IO buffer.
  assert(decoder.seek(1.0, &error));
  std::vector<float> samples(1024 * 2);
  assert(decoder.readFrames(samples.data(), 1024, &error) > 0);
  decoder.close();
}

void assertFailedDecoderOpenReleasesFile() {
  const auto path = std::filesystem::temp_directory_path() / "twilight-decoder-invalid.wav";
  { std::ofstream file(path, std::ios::binary); file << "invalid audio"; }
  FFmpegDecoder decoder;
  std::string error;
  assert(!decoder.open(path.string(), &error));
#if defined(_WIN32)
  // Delete sharing alone could hide a leaked handle. An exclusive open proves
  // the failed decoder released its input before returning to the caller.
  const HANDLE exclusive = CreateFileW(path.c_str(), GENERIC_READ, 0, nullptr,
                                       OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  assert(exclusive != INVALID_HANDLE_VALUE);
  CloseHandle(exclusive);
#endif
  assert(std::filesystem::remove(path));
}

#if defined(TAE_HAS_FFMPEG)
void assertPreciseSeekMatchesContinuousPcm() {
  constexpr int sourceRate = 44100;
  constexpr size_t sourceFrames = sourceRate * 3 + 137;
  const auto fixture = writePcmWavFixture({"twilight-precise-seek.wav", sourceRate, 2, 16,
      static_cast<int>(sourceFrames), false});
  for (const int targetRate : {44100, 48000, 88200, 96000, 176400, 192000}) {
    for (const auto quality : {FFmpegDecoder::ResamplerQuality::Native, FFmpegDecoder::ResamplerQuality::Ultra}) {
      FFmpegDecoder decoder;
      std::string error;
      assert(decoder.open(fixture.string(), &error));
      AudioFormat format = decoder.outputFormat();
      format.sampleRate = targetRate; format.bitDepth = 32;
      format.sampleFormat = AudioSampleFormat::Float32Interleaved;
      decoder.setResamplerQuality(quality);
      assert(decoder.setOutputFormat(format, &error));
      std::vector<float> reference((targetRate * 4) * 2);
      const auto count = decoder.readFrames(reference.data(), reference.size()/2, &error);
      assert(count > static_cast<size_t>(targetRate * 3));
      reference.resize(count * 2);
      for (const uint64_t first : {uint64_t(0), uint64_t(1), uint64_t(1023),
          uint64_t(targetRate * 2 + 37), uint64_t(count - 123)}) {
        assert(decoder.seekOutputFrame(first, &error));
        std::vector<float> actual(257 * 2);
        const auto got = decoder.readFrames(actual.data(), 257, &error);
        assert(got == std::min<size_t>(257, count - first));
        for (size_t i = 0; i < got*2; ++i) {
          if (std::abs(actual[i] - reference[first*2+i]) > 1e-5f) {
            std::fprintf(stderr, "precise seek mismatch rate=%d frame=%llu sample=%zu actual=%g expected=%g\n",
                targetRate, (unsigned long long)first, i, actual[i], reference[first*2+i]);
            std::abort();
          }
        }
      }
    }
  }
}

void assertPreciseSeekMatchesExternalPcm(const std::string& source) {
  for (const int rate : {44100, 48000, 88200, 96000, 176400, 192000}) {
    FFmpegDecoder reference, seeked;
    std::string error;
    assert(reference.open(source, &error));
    assert(seeked.open(source, &error));
    AudioFormat format = reference.outputFormat();
    format.sampleRate = rate; format.bitDepth = 32; format.sampleFormat = AudioSampleFormat::Float32Interleaved;
    assert(reference.setOutputFormat(format, &error));
    assert(seeked.setOutputFormat(format, &error));
    const double duration = reference.streamInfo().durationSeconds;
    assert(duration > 10 && format.channelCount <= 2);
    const std::vector<uint64_t> positions{0, 1, static_cast<uint64_t>(2ULL * rate + 37),
        static_cast<uint64_t>(std::floor((duration-4) * rate)) + 17};
    const auto channels = static_cast<size_t>(format.channelCount);
    std::vector<float> scratch(4096 * channels), expected(257 * channels), actual(expected.size());
    uint64_t cursor = 0;
    float maximumError = 0;
    for (const auto first : positions) {
      if (first < cursor) {
        reference.close(); assert(reference.open(source, &error));
        assert(reference.setOutputFormat(format, &error)); cursor = 0;
      }
      while (cursor < first) {
        const auto request = std::min<uint64_t>(4096, first-cursor);
        const auto got = reference.readFrames(scratch.data(),request,&error);
        assert(got == request); cursor += got;
      }
      assert(reference.readFrames(expected.data(),257,&error) == 257); cursor += 257;
      if (!seeked.seekOutputFrame(first,&error)) {
        std::fprintf(stderr,"precise seek failed rate=%d frame=%llu error=%s\n",rate,(unsigned long long)first,error.c_str());std::abort();
      }
      assert(seeked.readFrames(actual.data(),257,&error) == 257);
      for (size_t i=0;i<actual.size();++i) {
        maximumError=std::max(maximumError,std::abs(actual[i]-expected[i]));
        if (std::abs(actual[i]-expected[i])>1e-5f) {
          std::fprintf(stderr,"compressed precise seek mismatch rate=%d frame=%llu sample=%zu actual=%g expected=%g\n",
              rate,(unsigned long long)first,i,actual[i],expected[i]);std::abort();
        }
      }
    }
    std::cout << "{\"rate\":" << rate << ",\"positions\":4,\"maximumPcmError\":" << maximumError << "}" << std::endl;
  }
}

#if defined(_WIN32)
void assertOrdinaryIndexedHttpFlacSeekMatchesContinuousPcm() {
  const auto bytes = std::make_shared<const std::vector<uint8_t>>(makeSparseIndexedFlac(true));
  const auto path = std::filesystem::temp_directory_path() / "twilight-http-indexed-flac-unit.flac";
  { std::ofstream output(path, std::ios::binary); output.write(reinterpret_cast<const char*>(bytes->data()), bytes->size()); }
  TempAudioFixture file(path);
  FlacIndexHttpFixture server(bytes);
  for (const int rate : {96000, 48000}) {
    FFmpegDecoder reference, actual;
    std::string error;
    assert(reference.open(file.string(), &error));
    assert(actual.open(server.url(), &error));
    auto format = reference.outputFormat();
    format.sampleRate = rate; format.bitDepth = 32; format.sampleFormat = AudioSampleFormat::Float32Interleaved;
    assert(reference.setOutputFormat(format, &error));
    assert(actual.setOutputFormat(format, &error));
    assert(actual.streamInfo().sourceFormat.sampleRate == 96000);
    assert(actual.streamInfo().sourceFormat.bitDepth == 24);
    uint64_t cursor = 0;
    std::vector<float> scratch(4096 * 2), expected(257 * 2), found(expected.size());
    for (const double seconds : {1.234567, 30.125, 82.1721875, 89.25, 1.234567, 82.1721875, 0.0}) {
      const auto target = static_cast<uint64_t>(std::llround(seconds * rate));
      if (target < cursor) {
        reference.close(); assert(reference.open(file.string(), &error));
        assert(reference.setOutputFormat(format, &error)); cursor = 0;
      }
      while (cursor < target) {
        const auto count = static_cast<size_t>(std::min<uint64_t>(4096, target - cursor));
        assert(reference.readFrames(scratch.data(), count, &error) == count); cursor += count;
      }
      assert(reference.readFrames(expected.data(), 257, &error) == 257); cursor += 257;
      assert(actual.seek(static_cast<double>(target) / rate, &error));
      assert(actual.readFrames(found.data(), 257, &error) == 257);
      for (size_t i = 0; i < expected.size(); ++i) {
        if (std::abs(expected[i] - found[i]) > 1e-5f) {
          std::fprintf(stderr, "indexed HTTP ordinary seek PCM mismatch rate=%d frame=%llu sample=%zu\n", rate, static_cast<unsigned long long>(target), i);
          std::abort();
        }
      }
    }
  }
  // A file without SEEKTABLE must retain the original binary seek path.
  // Its explicit precise-frame API still has to return the reference window.
  {
    auto plain = std::make_shared<const std::vector<uint8_t>>(makeSparseIndexedFlac(false));
    FlacIndexHttpFixture noIndex(plain);
    FFmpegDecoder reference, actual;
    std::string error;
    assert(reference.open(file.string(), &error));
    assert(actual.open(noIndex.url(), &error));
    auto format = reference.outputFormat();
    format.bitDepth = 32; format.sampleFormat = AudioSampleFormat::Float32Interleaved;
    assert(reference.setOutputFormat(format, &error));
    assert(actual.setOutputFormat(format, &error));
    const uint64_t target = static_cast<uint64_t>(std::llround(82.1721875 * format.sampleRate));
    uint64_t cursor = 0;
    std::vector<float> scratch(8192), expected(514), found(514);
    while (cursor < target) {
      const auto count = static_cast<size_t>(std::min<uint64_t>(4096, target - cursor));
      assert(reference.readFrames(scratch.data(), count, &error) == count); cursor += count;
    }
    assert(reference.readFrames(expected.data(), 257, &error) == 257);
    assert(actual.seekOutputFrame(target, &error));
    assert(actual.readFrames(found.data(), 257, &error) == 257);
    for (size_t i = 0; i < expected.size(); ++i) assert(std::abs(found[i] - expected[i]) <= 1e-5f);
    assert(actual.seek(2.125, &error));
    assert(actual.readFrames(found.data(), 257, &error) == 257);
  }
  // A dishonest seekpoint must not turn a successful packet-positioning ACK
  // into audio from beyond the target. This reuses a real later frame offset
  // while deliberately giving it the first entry's timestamp.
  {
    auto dishonest = std::make_shared<std::vector<uint8_t>>(*bytes);
    constexpr size_t table = 4 + 4 + 34 + 4;
    std::copy_n(dishonest->begin() + table + 2 * 18 + 8, 8, dishonest->begin() + table + 8);
    FlacIndexHttpFixture invalid(dishonest);
    FFmpegDecoder actual;
    std::string error;
    assert(actual.open(invalid.url(), &error));
    auto format = actual.outputFormat();
    format.bitDepth = 32; format.sampleFormat = AudioSampleFormat::Float32Interleaved;
    assert(actual.setOutputFormat(format, &error));
    for (const double seconds : {0.0, 0.5, 1.234567}) {
      error.clear();
      if (actual.seek(seconds, &error)) {
        std::fprintf(stderr, "dishonest indexed HTTP seek accepted a late frame as target seconds=%.6f\n", seconds);
        std::abort();
      }
      assert(error == "Precise PCM seek began beyond the requested frame");
    }
  }
  std::cout << "{\"indexedHttpRates\":2,\"positionsPerRate\":7,\"windowFrames\":257,"
               "\"noTablePreciseFallback\":true,\"dishonestIndexRejected\":true}\n";
}
#endif

void assertDecoderResamplesWithQualityTier(
    FFmpegDecoder::ResamplerQuality quality,
    const char* fixtureName) {
  // The fixture has to outrun the widest filter we configure: Ultra uses filter_size 64,
  // and swr cannot centre a 64-tap filter on an input shorter than its half-length, so a
  // 32-frame fixture legitimately decodes to nothing on that tier.
  constexpr size_t kInputFrames = 1024;
  const auto fixture =
      writePcmWavFixture({fixtureName, 44100, 2, 16, static_cast<int>(kInputFrames), false});
  FFmpegDecoder decoder;
  decoder.setResamplerQuality(quality);
  std::string error;
  assert(decoder.open(fixture.string(), &error));

  AudioFormat target = decoder.streamInfo().sourceFormat;
  target.sampleRate = 96000;
  target.bitDepth = 32;
  target.sampleFormat = AudioSampleFormat::Float32Interleaved;
  // Every tier — including the SoX tiers on FFmpeg builds without libsoxr —
  // must initialize a working resampler (graceful fallback, never a failure).
  assert(decoder.setOutputFormat(target, &error));

  std::vector<float> frames(4096 * 2, 0.0f);
  const size_t decoded = decoder.readFrames(frames.data(), 4096, &error);
  assert(decoded > 0);
  bool nonZero = false;
  for (size_t i = 0; i < decoded * 2; ++i) {
    if (frames[i] != 0.0f) {
      nonZero = true;
      break;
    }
  }
  assert(nonZero);

  // Drain to EOF and check we got the whole stream, not the stream minus the resampler's
  // buffered tail. 1024 frames at 44100 -> 96000 is ~2229 frames; swr holds back roughly
  // a filter length, so skipping the flush lands near 2160 and trips the lower bound.
  size_t total = decoded;
  while (true) {
    std::vector<float> more(4096 * 2, 0.0f);
    const size_t got = decoder.readFrames(more.data(), 4096, &error);
    if (got == 0) break;
    total += got;
  }
  const size_t expected = kInputFrames * 96000 / 44100;
  assert(total > expected - 32);
  assert(total < expected + 64);
  decoder.close();
}

void assertDecoderSoxrTiersProbeAndFallBackGracefully() {
  // Force re-probing so this test exercises the runtime detection path even
  // if another test already touched the resampler.
  soxrRuntimeStateStorage().store(0);
  assert(soxrRuntimeAvailability() == SoxrRuntimeState::Unknown);

  assertDecoderResamplesWithQualityTier(
      FFmpegDecoder::ResamplerQuality::SoxrHq, "twilight-decoder-soxr-hq.wav");
  // The probe must have produced a definitive answer either way.
  const SoxrRuntimeState afterHq = soxrRuntimeAvailability();
  assert(afterHq != SoxrRuntimeState::Unknown);

  assertDecoderResamplesWithQualityTier(
      FFmpegDecoder::ResamplerQuality::SoxrVhq, "twilight-decoder-soxr-vhq.wav");
  assert(soxrRuntimeAvailability() == afterHq);

  // Once soxr is known-unavailable, the decoder must skip re-probing and go
  // straight to the Ultra swr fallback; the classic tiers stay untouched.
  soxrRuntimeStateStorage().store(2);
  assertDecoderResamplesWithQualityTier(
      FFmpegDecoder::ResamplerQuality::SoxrVhq, "twilight-decoder-soxr-fallback.wav");
  assert(soxrRuntimeAvailability() == SoxrRuntimeState::Unavailable);

  assertDecoderResamplesWithQualityTier(
      FFmpegDecoder::ResamplerQuality::Ultra, "twilight-decoder-swr-ultra.wav");
  assertDecoderResamplesWithQualityTier(
      FFmpegDecoder::ResamplerQuality::Native, "twilight-decoder-swr-native.wav");

  // Leave the probe state clean for other suites in this process.
  soxrRuntimeStateStorage().store(0);
}
#endif

void assertDecoderOpensExternalFixturesWhenProvided() {
  const auto fixtures = findExternalAudioFixtures();
  if (fixtures.empty()) return;

  for (const auto& fixture : fixtures) {
    if (fixture.extension() == ".iso" || fixture.extension() == ".ISO") continue;
    FFmpegDecoder decoder;
    std::string error;
    const bool opened = decoder.open(fixture.string(), &error);
    if (!opened) {
      std::fprintf(stderr, "External fixture failed to decode: %s\nerror: %s\n", fixture.string().c_str(), error.c_str());
    }
    assert(opened);
    assert(decoder.streamInfo().source == fixture.string());
    assert(decoder.streamInfo().sourceFormat.sampleRate > 0);
    assert(decoder.streamInfo().sourceFormat.channelCount > 0);
    assert(decoder.streamInfo().decodedFormat.sampleRate > 0);
    assert(decoder.streamInfo().decodedFormat.channelCount > 0);
    decoder.close();
  }
}

}  // namespace

int main(int argc,char** argv) {
#if defined(TAE_HAS_FFMPEG)
#if defined(_WIN32)
  if(argc==2 && std::string(argv[1])=="--http-flac-index-unit") {
    assertOrdinaryIndexedHttpFlacSeekMatchesContinuousPcm(); return 0;
  }
#endif
  if(argc==4 && std::string(argv[1])=="--http-seek-budget-probe") {
    return runFfmpegHttpSeekBudgetProbe(argv[2], argv[3]);
  }
  if(argc==4 && std::string(argv[1])=="--http-read-probe") {
    return runFfmpegHttpProbe(argv[2], std::stoi(argv[3]), false);
  }
  if(argc==4 && std::string(argv[1])=="--http-seek-probe") {
    return runFfmpegHttpProbe(argv[2], std::stoi(argv[3]), true);
  }
  if(argc==4 && std::string(argv[1])=="--http-stop-open-probe") {
    return runFfmpegHttpProbe(argv[2], std::stoi(argv[3]), false, true);
  }
  if(argc==4 && std::string(argv[1])=="--http-stop-read-probe") {
    return runFfmpegHttpProbe(argv[2], std::stoi(argv[3]), false, false, true);
  }
  if(argc==4 && std::string(argv[1])=="--http-restart-read-probe") {
    return runFfmpegHttpProbe(argv[2], std::stoi(argv[3]), false, false, true, true);
  }
  if (argc == 3 && std::string(argv[1]) == "--network-open-timeout-probe") {
    assertRemoteIoHasDeadline(argv[2], false); return 0;
  }
  if (argc == 3 && std::string(argv[1]) == "--network-read-timeout-probe") {
    assertRemoteIoHasDeadline(argv[2], true); return 0;
  }
  if(argc==3 && std::string(argv[1])=="--precise-seek-probe") {
    assertPreciseSeekMatchesExternalPcm(argv[2]);return 0;
  }
#else
  if (argc == 3 && std::string(argv[1]).rfind("--network-", 0) == 0) {
    std::cerr << "Network stall probes require a real FFmpeg build\n";
    return 1;
  }
#endif
  assertSharedFilePreservesReadAndSeekAfterDeletion();
  assertDecoderInt24AppendAvoidsUnalignedInt32Reads();
  assertDecoderContinuesWhenResamplerOutputsNoSamples();
  assertDecoderTailZeroHelperPreservesCopiedFrames();
  assertDecoderDirectPendingHelperShrinksToActualSamples();
#if defined(TAE_HAS_FFMPEG)
  assertDecoderReportsPcm("twilight-fixture-s16.wav", 16);
  assertDecoderReportsPcm("twilight-fixture-s24.wav", 24);
  assertDecoderReportsPcm("twilight-fixture-s32.wav", 32);
  assertDecoderCancellationCanBeResetBeforeSeek();
  assertDecoderReportsDsdFallbackWhenSupported();
  assertDecoderSoxrTiersProbeAndFallBackGracefully();
  assertPreciseSeekMatchesContinuousPcm();
  assertDecoderOpensUtf8Path();
  assertOpenDecoderAllowsFileRenameAndDeletion();
  assertFailedDecoderOpenReleasesFile();
  assertDecoderOpensExternalFixturesWhenProvided();
#endif
  return 0;
}
