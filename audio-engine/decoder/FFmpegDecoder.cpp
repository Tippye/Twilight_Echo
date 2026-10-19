#include "FFmpegDecoder.h"
#include "FFmpegFileInput.h"

#include "FFmpegDecoderUtils.h"
#include "FFmpegDsdRate.h"
#include "SacdIsoProbe.h"
#include "../core/DsdRate.h"
#include "../core/Utf8Path.h"
#include "../dsp/DspTypes.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <fstream>
#include <mutex>
#include <numeric>
#include <optional>
#include <string>
#include <vector>

#if defined(TAE_HAS_FFMPEG)
extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/avutil.h>
#include <libavutil/channel_layout.h>
#include <libavutil/dict.h>
#include <libavutil/error.h>
#include <libavutil/opt.h>
#include <libavutil/samplefmt.h>
#include <libswresample/swresample.h>
}
#endif

namespace twilight::audio {

#if defined(TAE_HAS_FFMPEG)
namespace {

std::string normalizeMetadataKey(std::string key) {
  std::transform(key.begin(), key.end(), key.begin(), [](unsigned char ch) {
    return static_cast<char>(std::toupper(ch));
  });
  return key;
}

std::string toLower(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
    return static_cast<char>(std::tolower(ch));
  });
  return value;
}

std::string extensionOf(const std::string& source) {
  const size_t slash = source.find_last_of("/\\");
  const size_t dot = source.find_last_of('.');
  if (dot == std::string::npos || (slash != std::string::npos && dot < slash)) return "";
  return toLower(source.substr(dot + 1));
}

std::optional<double> parseGainDb(const char* rawValue, bool r128) {
  if (!rawValue) return std::nullopt;
  std::string value(rawValue);
  value.erase(value.begin(), std::find_if(value.begin(), value.end(), [](unsigned char ch) {
                return !std::isspace(ch);
              }));
  value.erase(std::find_if(value.rbegin(), value.rend(), [](unsigned char ch) {
                return !std::isspace(ch);
              }).base(),
              value.end());
  if (value.empty()) return std::nullopt;

  std::string lower = value;
  std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char ch) {
    return static_cast<char>(std::tolower(ch));
  });

  char* end = nullptr;
  const double parsed = std::strtod(value.c_str(), &end);
  if (end == value.c_str()) return std::nullopt;
  if (r128 && lower.find("db") == std::string::npos) return parsed / 256.0;
  return parsed;
}

void readReplayGainDictionary(AVDictionary* metadata, ReplayGainInfo* replayGain) {
  if (!metadata || !replayGain) return;

  const AVDictionaryEntry* entry = nullptr;
  while ((entry = av_dict_get(metadata, "", entry, AV_DICT_IGNORE_SUFFIX)) != nullptr) {
    const std::string key = normalizeMetadataKey(entry->key ? entry->key : "");
    if (key == "REPLAYGAIN_TRACK_GAIN") {
      replayGain->trackGainDb = parseGainDb(entry->value, false);
    } else if (key == "REPLAYGAIN_ALBUM_GAIN") {
      replayGain->albumGainDb = parseGainDb(entry->value, false);
    } else if (key == "R128_TRACK_GAIN") {
      replayGain->r128TrackGainDb = parseGainDb(entry->value, true);
    } else if (key == "R128_ALBUM_GAIN") {
      replayGain->r128AlbumGainDb = parseGainDb(entry->value, true);
    }
  }
}

AudioSampleFormat mapSampleFormat(AVSampleFormat sampleFormat) {
  const AVSampleFormat packed = av_get_packed_sample_fmt(sampleFormat);
  switch (packed) {
    case AV_SAMPLE_FMT_S16:
      return AudioSampleFormat::Int16Interleaved;
    case AV_SAMPLE_FMT_S32:
      return AudioSampleFormat::Int32Interleaved;
    case AV_SAMPLE_FMT_FLT:
    case AV_SAMPLE_FMT_DBL:
      return AudioSampleFormat::Float32Interleaved;
    default:
      return AudioSampleFormat::Float32Interleaved;
  }
}

AudioSampleFormat sourceSampleFormat(int bitDepth, AVSampleFormat sampleFormat) {
  if (bitDepth > 0 && bitDepth <= 16) return AudioSampleFormat::Int16Interleaved;
  if (bitDepth > 16 && bitDepth <= 24) return AudioSampleFormat::Int24Interleaved;
  return mapSampleFormat(sampleFormat);
}

int sampleBitDepth(AVSampleFormat sampleFormat) {
  const AVSampleFormat packed = av_get_packed_sample_fmt(sampleFormat);
  switch (packed) {
    case AV_SAMPLE_FMT_U8:
      return 8;
    case AV_SAMPLE_FMT_S16:
      return 16;
    case AV_SAMPLE_FMT_S32:
    case AV_SAMPLE_FMT_FLT:
      return 32;
    case AV_SAMPLE_FMT_DBL:
      return 64;
    default:
      return av_get_bytes_per_sample(sampleFormat) * 8;
  }
}

bool codecLooksLossless(const AVCodecDescriptor* descriptor, const std::string& codecName) {
  if (descriptor && (descriptor->props & AV_CODEC_PROP_LOSSLESS) != 0) return true;
  const std::string normalized = toLower(codecName);
  return normalized == "flac" || normalized == "alac" || normalized == "wavpack" || normalized == "ape" ||
         normalized == "tta" || normalized == "pcm_s16le" || normalized == "pcm_s24le" ||
         normalized == "pcm_s32le" || normalized == "pcm_f32le" || normalized.rfind("pcm_", 0) == 0;
}

bool textMentions(const std::string& haystack, const std::string& needle) {
  return toLower(haystack).find(needle) != std::string::npos;
}

bool codecLooksDsd(AVCodecID codecId, const std::string& codecName, const std::string& containerName, const std::string& extension) {
  switch (codecId) {
    case AV_CODEC_ID_DSD_LSBF:
    case AV_CODEC_ID_DSD_MSBF:
    case AV_CODEC_ID_DSD_LSBF_PLANAR:
    case AV_CODEC_ID_DSD_MSBF_PLANAR:
      return true;
    default:
      break;
  }
  const std::string normalizedCodec = toLower(codecName);
  return normalizedCodec.rfind("dsd", 0) == 0 || normalizedCodec == "dsf" || normalizedCodec == "dff" ||
         normalizedCodec == "dst" || normalizedCodec == "dop" || normalizedCodec.find("dop") != std::string::npos ||
         extension == "dsf" || extension == "dff" || extension == "dop" ||
         textMentions(containerName, "dsd") || textMentions(containerName, "dsf") ||
         textMentions(containerName, "dff") || textMentions(containerName, "dsdiff") ||
         textMentions(containerName, "dop");
}

bool sourceLooksSacdIso(const std::string& source) {
  return probeSacdIsoEntry(source).isSacdIso();
}

bool endsWithHost(const std::string& host, const std::string& suffix) {
  return host.size() >= suffix.size() && host.compare(host.size() - suffix.size(), suffix.size(), suffix) == 0;
}

bool hostLooksLikeNetEase(const std::string& source) {
  // Match hostnames such as music.163.com, p1.music.126.net, m701.music.126.net.
  const std::string lower = toLower(source);
  const size_t scheme = lower.find("://");
  if (scheme == std::string::npos) return false;
  size_t hostBegin = scheme + 3;
  size_t hostEnd = lower.find_first_of("/?#", hostBegin);
  if (hostEnd == std::string::npos) hostEnd = lower.size();
  // Strip userinfo if present (should never appear for authorized sources).
  const size_t at = lower.find('@', hostBegin);
  if (at != std::string::npos && at < hostEnd) hostBegin = at + 1;
  // Strip port.
  const size_t colon = lower.find(':', hostBegin);
  if (colon != std::string::npos && colon < hostEnd) hostEnd = colon;
  if (hostBegin >= hostEnd) return false;
  const std::string host = lower.substr(hostBegin, hostEnd - hostBegin);
  return host == "music.163.com" || endsWithHost(host, ".music.163.com") ||
         endsWithHost(host, ".126.net") || endsWithHost(host, ".163.com");
}

// FFmpeg expects CRLF-terminated header lines in the "headers" option.
std::string buildHttpOpenHeaders(const std::string& source) {
  std::string headers = "Accept: */*\r\nAccept-Language: zh-CN,zh;q=0.9,en;q=0.8\r\n";
  if (hostLooksLikeNetEase(source)) {
    headers += "Referer: https://music.163.com/\r\n";
  }
  return headers;
}

AVSampleFormat swrSampleFormatFor(AudioSampleFormat format) {
  switch (format) {
    case AudioSampleFormat::Int16Interleaved:
      return AV_SAMPLE_FMT_S16;
    case AudioSampleFormat::Int24Interleaved:
    case AudioSampleFormat::Int24In32Interleaved:
    case AudioSampleFormat::Int32Interleaved:
      return AV_SAMPLE_FMT_S32;
    case AudioSampleFormat::Float32Interleaved:
    default:
      return AV_SAMPLE_FMT_FLT;
  }
}

bool isTypedIntegerFormat(AudioSampleFormat format) {
  return format == AudioSampleFormat::Int16Interleaved || format == AudioSampleFormat::Int24Interleaved ||
         format == AudioSampleFormat::Int24In32Interleaved || format == AudioSampleFormat::Int32Interleaved;
}

}  // namespace
#endif

struct FFmpegDecoder::Impl {
  int (*interrupt)(void*) = nullptr;
  void* interruptContext = nullptr;
  AudioStreamInfo streamInfo;
  AudioFormat outputFormat;
  bool eof = false;
  std::atomic<bool> ioCancelled{false};
  FFmpegDecoder::ResamplerQuality resamplerQuality = FFmpegDecoder::ResamplerQuality::Native;
  // ICY StreamTitle snapshot (decode-thread writes; control/status may read).
  mutable std::mutex streamTitleMutex;
  std::string streamTitle;

  void cancelPendingIo() noexcept {
    ioCancelled.store(true, std::memory_order_release);
  }

  bool cancelled(std::string* error) const {
    if (ioCancelled.load(std::memory_order_acquire) ||
        (interrupt && interrupt(interruptContext))) {
      if (error) *error = "decode_cancelled";
      return true;
    }
    return false;
  }

#if defined(TAE_HAS_FFMPEG)
  AVFormatContext* formatContext = nullptr;
  FFmpegFileInput fileInput;
  AVCodecContext* codecContext = nullptr;
  AVPacket* packet = nullptr;
  AVFrame* frame = nullptr;
  SwrContext* swr = nullptr;
  int audioStreamIndex = -1;
  bool inputEof = false;
  bool resamplerFlushed = false;
  bool icyEnabled = false;
  std::vector<uint8_t> pending;
  std::vector<uint8_t> convertedScratch;
  size_t pendingFrameOffset = 0;
  bool exactSeek = false;
  bool exactFromStart = false;
  uint64_t exactTarget = 0;
  std::optional<int64_t> exactInputCursor;
  int64_t exactOutputCursor = 0;
  AVChannelLayout targetLayout{};
  // Only the FFmpeg IO owner thread reads/writes phase, byte progress and
  // deadlines. Cross-thread stop uses the existing cancellation atomic above.
  using IoClock = std::chrono::steady_clock;
  enum class IoPhase { None, Startup, Read, Seek };
  IoPhase ioPhase = IoPhase::None;
  IoClock::time_point ioIdleDeadline{};
  IoClock::time_point ioAbsoluteDeadline{};
  // Retained only for initial positioning after open/probe. Seek scopes also
  // cover precise seek's decode/preroll reads, then restore ordinary read IO.
  IoClock::time_point startupDeadline{};
  IoClock::time_point positioningDeadline{};
  bool positioning = false;
  int64_t ioLastBytes = 0;
  bool httpSource = false;
  bool ioTimedOut = false;
  std::string readFailure;
  bool readFailureWasCancelled = false;

  struct SeekBudgetScope {
    Impl& owner;
    bool previous;
    IoClock::time_point previousDeadline;
    SeekBudgetScope(Impl& impl, SeekPurpose purpose)
        : owner(impl), previous(impl.positioning), previousDeadline(impl.positioningDeadline) {
      if (!previous) owner.positioningDeadline = IoClock::now() + std::chrono::seconds(15);
      if (purpose == SeekPurpose::Startup) {
        owner.positioningDeadline = std::min(owner.positioningDeadline, owner.startupDeadline);
      }
      owner.positioning = true;
    }
    ~SeekBudgetScope() {
      owner.positioning = previous;
      owner.positioningDeadline = previousDeadline;
    }
  };

  struct IoOperation {
    Impl& owner;
    IoOperation(Impl& impl, IoPhase phase) : owner(impl) {
      owner.ioPhase = owner.httpSource ? phase : IoPhase::None;
      owner.ioTimedOut = false;
      owner.ioLastBytes = owner.formatContext && owner.formatContext->pb
          ? owner.formatContext->pb->bytes_read : 0;
      const auto now = IoClock::now();
      if (phase == IoPhase::Startup) owner.startupDeadline = now + std::chrono::seconds(15);
      owner.ioIdleDeadline = now + std::chrono::seconds(phase == IoPhase::Seek || owner.positioning ? 5 : 15);
      owner.ioAbsoluteDeadline = phase == IoPhase::Read
          ? IoClock::time_point::max() : now + std::chrono::seconds(15);
      if (phase == IoPhase::Startup) {
        owner.ioAbsoluteDeadline = std::min(owner.ioAbsoluteDeadline, owner.startupDeadline);
      }
      if (owner.positioning) {
        owner.ioAbsoluteDeadline = std::min(owner.ioAbsoluteDeadline, owner.positioningDeadline);
      }
    }
    ~IoOperation() { owner.ioPhase = IoPhase::None; }
  };

  static int interruptIo(void* context) {
    auto& owner = *static_cast<Impl*>(context);
    if (owner.ioCancelled.load(std::memory_order_acquire) ||
        (owner.interrupt && owner.interrupt(owner.interruptContext))) return 1;
    if (owner.ioPhase == IoPhase::None) return 0;
    const auto now = IoClock::now();
    if (now >= owner.ioAbsoluteDeadline) {
      owner.ioTimedOut = true;
      return 1;
    }
    if ((owner.ioPhase == IoPhase::Read || owner.ioPhase == IoPhase::Seek) &&
        owner.formatContext && owner.formatContext->pb) {
      const auto bytes = owner.formatContext->pb->bytes_read;
      if (bytes != owner.ioLastBytes) {
        owner.ioLastBytes = bytes;
        owner.ioIdleDeadline = now + std::chrono::seconds(owner.ioPhase == IoPhase::Seek || owner.positioning ? 5 : 15);
      }
    }
    if (now < owner.ioIdleDeadline) return 0;
    owner.ioTimedOut = true;
    return 1;
  }

  bool ioError(std::string* error, const char* operation, int ffmpegError) const {
    if (cancelled(error)) return false;
    if (error) {
      if (ioTimedOut) {
        *error = "network_io_timeout";
      } else {
        *error = (httpSource ? std::string("network_") : std::string("audio_")) + operation + "_failed";
        // Preserve the stable failure class while retaining the numeric cause.
        // Do not append FFmpeg prose, which may contain a source URL or path.
        if (ffmpegError < 0) *error += " [averror=" + std::to_string(ffmpegError) + "]";
      }
    }
    return false;
  }

  static std::string avError(int code) {
    char buffer[AV_ERROR_MAX_STRING_SIZE] = {};
    av_strerror(code, buffer, sizeof(buffer));
    return buffer;
  }

  void resetPending() {
    pending.clear();
    pendingFrameOffset = 0;
  }

  static std::string dictValue(AVDictionary* metadata, const char* key) {
    if (!metadata || !key) return {};
    const AVDictionaryEntry* entry = av_dict_get(metadata, key, nullptr, 0);
    if (!entry || !entry->value) return {};
    return entry->value;
  }

  static std::string extractStreamTitle(AVDictionary* metadata) {
    if (!metadata) return {};
    // ICY StreamTitle is the primary radio metadata field; fall back to common tags.
    const char* keys[] = {"StreamTitle", "icy-title", "title", "TITLE", "streamtitle"};
    for (const char* key : keys) {
      std::string value = dictValue(metadata, key);
      if (!value.empty()) return value;
    }
    return {};
  }

  void refreshStreamTitleFromContext() {
    if (!formatContext) return;
    std::string title = extractStreamTitle(formatContext->metadata);
    if (title.empty() && audioStreamIndex >= 0 &&
        audioStreamIndex < static_cast<int>(formatContext->nb_streams) &&
        formatContext->streams[audioStreamIndex]) {
      title = extractStreamTitle(formatContext->streams[audioStreamIndex]->metadata);
    }
    if (title.empty()) return;
    // Trim whitespace / control characters common in ICY payloads.
    while (!title.empty() &&
           (static_cast<unsigned char>(title.front()) <= 0x20 || title.front() == '\'')) {
      title.erase(title.begin());
    }
    while (!title.empty() &&
           (static_cast<unsigned char>(title.back()) <= 0x20 || title.back() == '\'')) {
      title.pop_back();
    }
    if (title.empty()) return;
    std::lock_guard lock(streamTitleMutex);
    if (streamTitle != title) streamTitle = std::move(title);
  }

  void close() {
    cancelPendingIo();
    if (swr) {
      swr_free(&swr);
    }
    av_channel_layout_uninit(&targetLayout);
    if (frame) {
      av_frame_free(&frame);
    }
    if (packet) {
      av_packet_free(&packet);
    }
    if (codecContext) {
      avcodec_free_context(&codecContext);
    }
    if (formatContext) {
      avformat_close_input(&formatContext);
    }
    fileInput.close();
    audioStreamIndex = -1;
    inputEof = false;
    resamplerFlushed = false;
    icyEnabled = false;
    eof = false;
    resetPending();
    exactSeek = false;
    exactInputCursor.reset();
    streamInfo = {};
    outputFormat = {};
    {
      std::lock_guard lock(streamTitleMutex);
      streamTitle.clear();
    }
  }

  bool configureOutputResampler(const AudioFormat& requestedFormat, std::string* error) {
    const AudioFormat format = requestedFormat;
    if (!codecContext) {
      if (error) *error = "解码器尚未打开";
      return false;
    }
    if (format.sampleRate <= 0 || format.channelCount <= 0) {
      if (error) *error = "请求的输出格式无效";
      return false;
    }
    if (streamInfo.isDsd && isTypedIntegerFormat(format.sampleFormat)) {
      if (error) *error = "DSD PCM fallback 只能输出 Float32 工作格式";
      return false;
    }

    if (swr) {
      swr_free(&swr);
    }
    av_channel_layout_uninit(&targetLayout);
    av_channel_layout_default(&targetLayout, format.channelCount);

    const auto allocateSwr = [&]() -> int {
      if (swr) swr_free(&swr);
      return swr_alloc_set_opts2(
          &swr,
          &targetLayout,
          swrSampleFormatFor(format.sampleFormat),
          format.sampleRate,
          &codecContext->ch_layout,
          codecContext->sample_fmt,
          codecContext->sample_rate,
          0,
          nullptr);
    };
    const auto applySwrQuality = [&](ResamplerQuality quality) {
      switch (quality) {
        case ResamplerQuality::Ultra:
          av_opt_set_int(swr, "filter_size", 64, 0);
          av_opt_set_int(swr, "phase_shift", 10, 0);
          av_opt_set_double(swr, "cutoff", 0.99, 0);
          break;
        case ResamplerQuality::High:
          av_opt_set_int(swr, "filter_size", 32, 0);
          av_opt_set_int(swr, "phase_shift", 10, 0);
          av_opt_set_double(swr, "cutoff", 0.97, 0);
          break;
        case ResamplerQuality::Native:
        default:
          av_opt_set_int(swr, "filter_size", 16, 0);
          av_opt_set_int(swr, "phase_shift", 8, 0);
          av_opt_set_double(swr, "cutoff", 0.90, 0);
          break;
      }
    };

    int ret = allocateSwr();
    if (ret < 0 || !swr) {
      if (error) *error = "无法分配解码重采样器";
      return false;
    }

    const bool wantsSoxr = resamplerQuality == ResamplerQuality::SoxrHq ||
                           resamplerQuality == ResamplerQuality::SoxrVhq;
    bool initialized = false;
    if (wantsSoxr && soxrRuntimeAvailability() != SoxrRuntimeState::Unavailable) {
      // Probe the SoX engine at runtime. FFmpeg accepts the "resampler"/"engine"
      // option name even when libsoxr is absent — the failure only shows up at
      // swr_init ("Requested resampling engine is unavailable").
      const int engineSet = av_opt_set(swr, "resampler", "soxr", 0);
      if (engineSet >= 0) {
        av_opt_set_int(
            swr,
            "precision",
            resamplerQuality == ResamplerQuality::SoxrVhq ? 28 : 20,
            0);
        if (swr_init(swr) >= 0) {
          initialized = true;
          reportSoxrRuntimeAvailability(true);
        }
      }
      if (!initialized) {
        reportSoxrRuntimeAvailability(false);
        // Recreate with the default swr engine; a failed init leaves the
        // context poisoned with the unavailable engine selection.
        ret = allocateSwr();
        if (ret < 0 || !swr) {
          if (error) *error = "无法分配解码重采样器";
          return false;
        }
      }
    }

    if (!initialized) {
      // Soxr tiers degrade to the strongest built-in swr settings when the
      // engine is unavailable, keeping playback honest instead of failing.
      applySwrQuality(wantsSoxr ? ResamplerQuality::Ultra : resamplerQuality);
      ret = swr_init(swr);
      if (ret < 0) {
        if (error) *error = "无法初始化解码重采样器，错误码：" + std::to_string(ret);
        return false;
      }
    }

    outputFormat = format;
    if (outputFormat.bitDepth <= 0) {
      outputFormat.bitDepth = effectivePcmBitDepth(outputFormat);
    }
    streamInfo.decodedFormat = outputFormat;
    // A brand new swr context has nothing buffered yet, so the drain has to be re-armed.
    resamplerFlushed = false;
    resetPending();
    return true;
  }

  bool decodeError(std::string* error, const std::string& message) {
    if (error && error->empty()) *error = message;
    return false;
  }

  // Drains whatever the resampler still holds once the decoder has run dry. swr keeps up
  // to a filter-length of history buffered, so without this the tail of every resampled
  // track is silently dropped -- and an input shorter than the filter (Ultra uses
  // filter_size 64) decodes to nothing at all.
  bool flushResampler(std::string* error) {
    if (!swr || !codecContext) return true;
    const int pendingOut = swr_get_out_samples(swr, 0);
    if (pendingOut <= 0) return true;
    return convertSamples(nullptr, 0, pendingOut, error);
  }

  bool convertFrame(std::string* error) {
    if (!swr) {
      if (error) *error = "解码重采样器尚未初始化";
      return false;
    }

    int skip = 0;
    if (exactSeek) {
      const auto* stream = formatContext->streams[audioStreamIndex];
      const int64_t pts = frame->best_effort_timestamp;
      if (pts == AV_NOPTS_VALUE || codecContext->sample_rate <= 0) {
        if (error) *error = "Precise PCM seek requires frame timestamps";
        return false;
      }
      const auto origin = stream->start_time == AV_NOPTS_VALUE ? 0 : stream->start_time;
      int64_t first = av_rescale_q_rnd(pts - origin, stream->time_base,
          AVRational{1, codecContext->sample_rate}, AV_ROUND_NEAR_INF);
      if (!exactInputCursor) {
        // Some codecs have already removed priming samples without updating
        // the first frame PTS (FFmpeg's skipped-samples warning). At source
        // start the decoded first sample is the same sample as normal open.
        if (exactFromStart) first = 0;
        // Start on the global rational resampling grid. After preroll, the
        // filter phase matches decoding from source time zero.
        const int period = codecContext->sample_rate /
            std::gcd(codecContext->sample_rate, outputFormat.sampleRate);
        const int64_t aligned = std::max<int64_t>(0, first + period - 1) / period * period;
        if (aligned - first >= frame->nb_samples) return true;
        skip = static_cast<int>(aligned - first);
        exactInputCursor = aligned;
        exactOutputCursor = aligned / period *
            (outputFormat.sampleRate / std::gcd(codecContext->sample_rate, outputFormat.sampleRate));
      } else if (std::abs(first - *exactInputCursor) > 1) {
        if (error) *error = "Precise PCM seek encountered discontinuous timestamps";
        return false;
      }
      *exactInputCursor = first + frame->nb_samples;
    }
    const int inputSamples = frame->nb_samples - skip;
    const int outSamples = static_cast<int>(av_rescale_rnd(
        swr_get_delay(swr, codecContext->sample_rate) + inputSamples,
        outputFormat.sampleRate,
        codecContext->sample_rate,
        AV_ROUND_UP));
    if (outSamples <= 0) return true;
    if (!skip) return convertSamples(
        const_cast<const uint8_t**>(frame->extended_data), inputSamples, outSamples, error);
    const bool planar = av_sample_fmt_is_planar(codecContext->sample_fmt);
    const int planes = planar ? codecContext->ch_layout.nb_channels : 1;
    std::vector<const uint8_t*> input(planes);
    const size_t stride = av_get_bytes_per_sample(codecContext->sample_fmt) *
        (planar ? 1 : codecContext->ch_layout.nb_channels);
    for (int channel = 0; channel < planes; ++channel) input[channel] = frame->extended_data[channel] + skip * stride;
    return convertSamples(input.data(), inputSamples, outSamples, error);
  }

  // inputData == nullptr / inputSamples == 0 flushes the resampler instead of feeding it.
  bool convertSamples(const uint8_t** inputData, int inputSamples, int outSamples, std::string* error) {
    const int channels = std::max(1, outputFormat.channelCount);
    const AVSampleFormat swrOutputFormat = swrSampleFormatFor(outputFormat.sampleFormat);
    const size_t swrBytesPerSample = static_cast<size_t>(std::max(1, av_get_bytes_per_sample(swrOutputFormat)));
    const size_t outputSamples = static_cast<size_t>(outSamples) * static_cast<size_t>(channels);
    const bool directPendingWrite = ffmpeg::canDirectWriteConvertedSamples(outputFormat.sampleFormat);
    const size_t pendingStart = pending.size();
    uint8_t* directOutput = directPendingWrite
                                ? ffmpeg::resizePendingForDirectWrite(pending, outputSamples, outputFormat.sampleFormat)
                                : nullptr;
    if (!directPendingWrite) {
      convertedScratch.resize(outputSamples * swrBytesPerSample);
    }
    uint8_t* outData[] = {directPendingWrite ? directOutput : convertedScratch.data()};
    const int actualSamples = swr_convert(swr, outData, outSamples, inputData, inputSamples);
    if (actualSamples < 0) {
      if (directPendingWrite) pending.resize(pendingStart);
      if (error) *error = "解码重采样失败，错误码：" + std::to_string(actualSamples);
      return false;
    }

    const size_t actualOutputSamples = static_cast<size_t>(actualSamples) * static_cast<size_t>(channels);
    if (directPendingWrite) {
      ffmpeg::commitPendingDirectWrite(pending, pendingStart, actualOutputSamples, outputFormat.sampleFormat);
    } else {
      ffmpeg::appendConvertedSamples(
          convertedScratch.data(),
          actualOutputSamples,
          outputFormat.sampleFormat,
          &pending);
    }
    if (exactSeek) {
      if (exactOutputCursor < 0 || static_cast<uint64_t>(exactOutputCursor) > exactTarget) {
        if (error) *error = "Precise PCM seek began beyond the requested frame";
        resetPending(); return false;
      }
      const uint64_t remaining = exactTarget - static_cast<uint64_t>(exactOutputCursor);
      exactOutputCursor += actualSamples;
      if (remaining >= static_cast<uint64_t>(actualSamples)) {
        resetPending();
      } else {
        pendingFrameOffset = static_cast<size_t>(remaining);
        exactSeek = false;
      }
    }
    return true;
  }

  // Runs the resampler drain exactly once per stream, so the EOF exits below cannot loop
  // on a flush that keeps reporting leftovers.
  bool drainResamplerOnce(std::string* error) {
    if (resamplerFlushed) return true;
    resamplerFlushed = true;
    return flushResampler(error);
  }

  bool decodeOneFrameImpl(std::string* error) {
    resetPending();
    if (!readFailure.empty()) {
      if (error) *error = readFailure;
      return false;
    }

    while (true) {
      if (cancelled(error)) return false;
      int ret = avcodec_receive_frame(codecContext, frame);
      if (ret == 0) {
        const bool ok = convertFrame(error);
        av_frame_unref(frame);
        if (!ok) return false;
        if (pending.empty()) {
          continue;
        }
        return true;
      }
      if (ret == AVERROR_EOF) {
        if (!drainResamplerOnce(error)) return false;
        if (!pending.empty()) return true;
        eof = true;
        return false;
      }
      if (ret != AVERROR(EAGAIN)) {
        if (error) *error = "解码器接收音频帧失败，错误码：" + std::to_string(ret);
        return false;
      }

      if (inputEof) {
        ret = avcodec_send_packet(codecContext, nullptr);
        if (ret == AVERROR_EOF) {
          if (!drainResamplerOnce(error)) return false;
          if (!pending.empty()) return true;
          eof = true;
          return false;
        }
        if (ret < 0 && ret != AVERROR(EAGAIN)) {
          if (error) *error = "解码器收尾失败，错误码：" + std::to_string(ret);
          return false;
        }
        continue;
      }

      {
        IoOperation io(*this, IoPhase::Read);
        ret = av_read_frame(formatContext, packet);
      }
      const int storedIoError = formatContext->pb ? formatContext->pb->error : 0;
      if (ioTimedOut || cancelled(nullptr) || (ret < 0 && (ret != AVERROR_EOF ||
          (storedIoError < 0 && storedIoError != AVERROR_EOF)))) {
        av_packet_unref(packet);
        readFailureWasCancelled = cancelled(nullptr);
        ioError(&readFailure, "read", storedIoError < 0 && storedIoError != AVERROR_EOF ? storedIoError : ret);
        if (error) *error = readFailure;
        return false;
      }
      if (ret == AVERROR_EOF) {
        inputEof = true;
        continue;
      }

      // ICY metadata can land in format-context tags between packets on live streams.
      if (icyEnabled) refreshStreamTitleFromContext();

      if (packet->stream_index == audioStreamIndex) {
        ret = avcodec_send_packet(codecContext, packet);
        av_packet_unref(packet);
        if (ret < 0 && ret != AVERROR(EAGAIN)) {
          if (error) *error = "解码器提交音频包失败，错误码：" + std::to_string(ret);
          return false;
        }
      } else {
        av_packet_unref(packet);
      }
    }
  }

  bool decodeOneFrame(std::string* error) {
    try {
      return decodeOneFrameImpl(error);
    } catch (const std::exception& exception) {
      return decodeError(error, std::string("PCM decode pipeline failed: ") + exception.what());
    } catch (...) {
      return decodeError(error, "PCM decode pipeline failed");
    }
  }
#else
  void close() {
    cancelPendingIo();
    streamInfo = {};
    outputFormat = {};
    eof = false;
    {
      std::lock_guard lock(streamTitleMutex);
      streamTitle.clear();
    }
  }

  void refreshStreamTitleFromContext() {}
#endif
};

FFmpegDecoder::FFmpegDecoder() : impl_(std::make_unique<Impl>()) {}

FFmpegDecoder::~FFmpegDecoder() {
  close();
}

void FFmpegDecoder::setInterrupt(int (*callback)(void*), void* context) {
  impl_->interrupt = callback;
  impl_->interruptContext = context;
}

void FFmpegDecoder::cancelPendingIo() noexcept {
  impl_->cancelPendingIo();
}

bool FFmpegDecoder::restartCancelledIo(std::string* error) {
  if (!impl_->ioCancelled.load(std::memory_order_acquire)) return true;
#if defined(TAE_HAS_FFMPEG)
  if (impl_->readFailureWasCancelled) {
    impl_->readFailure.clear();
    impl_->readFailureWasCancelled = false;
    // FFmpeg caches an interrupted read in AVIO. Only this explicitly
    // classified cancellation may be cleared for a joined reader's restart.
    if (impl_->formatContext && impl_->formatContext->pb) {
      impl_->formatContext->pb->error = 0;
      impl_->formatContext->pb->eof_reached = 0;
    }
  }
#endif
  (void)error;
  impl_->ioCancelled.store(false, std::memory_order_release);
  return true;
}

bool FFmpegDecoder::open(const std::string& source, std::string* error) {
  close();
  impl_->ioCancelled.store(false, std::memory_order_release);
  if (impl_->interrupt && impl_->interrupt(impl_->interruptContext)) {
    if (error) *error = "decode_cancelled";
    return false;
  }

#if defined(TAE_HAS_FFMPEG)
  // Every failed open must release its partially allocated IO and decoder.
  const auto cleanup = [](Impl* impl) { impl->close(); };
  std::unique_ptr<Impl, decltype(cleanup)> failedOpen(impl_.get(), cleanup);
  if (sourceLooksSacdIso(source)) {
    const SacdIsoEntryProbe probe = probeSacdIsoEntry(source);
    const SacdDstProviderSelection dstProvider = selectSacdDstProvider(avcodec_find_decoder_by_name(kSacdDstCodecName) != nullptr, nullptr);
    if (error) {
      *error = probe.reason.empty() ? kSacdIsoUnsupportedReason : probe.reason;
      if (!dstProvider.available && !dstProvider.reason.empty()) {
        *error += "; " + dstProvider.reason;
      }
    }
    return false;
  }

  static bool ffmpegNetworkInitialized = false;
  if (!ffmpegNetworkInitialized) {
    int initRet = avformat_network_init();
    if (initRet < 0) {
      if (error) *error = "FFmpeg 网络初始化失败，错误码：" + std::to_string(initRet);
      return false;
    }
    ffmpegNetworkInitialized = true;
  }

  // Enable ICY metadata for live HTTP(S) radio streams so StreamTitle updates appear.
  const bool looksHttp =
      source.rfind("http://", 0) == 0 || source.rfind("https://", 0) == 0 ||
      source.rfind("HTTP://", 0) == 0 || source.rfind("HTTPS://", 0) == 0;
  impl_->httpSource = looksHttp;
  impl_->readFailure.clear();
  impl_->readFailureWasCancelled = false;
  Impl::IoOperation startup(*impl_, Impl::IoPhase::Startup);
  AVDictionary* openOptions = nullptr;
  if (looksHttp) {
    av_dict_set(&openOptions, "icy", "1", 0);
    // Prefer reconnect behavior for flaky radio CDNs without blocking open forever.
    av_dict_set(&openOptions, "reconnect", "1", 0);
    av_dict_set(&openOptions, "reconnect_streamed", "1", 0);
    av_dict_set(&openOptions, "reconnect_delay_max", "5", 0);
    // NetEase (and many CDNs) reject bare FFmpeg clients. Attach a browser-like
    // UA and, for NetEase hosts, the music.163.com Referer so stream open succeeds.
    av_dict_set(
        &openOptions,
        "user_agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36",
        0);
    av_dict_set(&openOptions, "headers", buildHttpOpenHeaders(source).c_str(), 0);
    impl_->icyEnabled = true;
  }

  // Highly periodic PCM can outscore WAV in FFmpeg's generic MPEG-TS probe.
  // Prefer WAV only after validating the local container signature; a renamed
  // non-WAV file and all network sources retain ordinary format discovery.
  const AVInputFormat* inputFormat = nullptr;
  if (!looksHttp && (extensionOf(source) == "wav" || extensionOf(source) == "wave")) {
    std::array<char, 12> header{};
    SharedInputFile input(utf8Path(source), std::ios::binary);
    input.read(header.data(), header.size());
    if (input.gcount() == static_cast<std::streamsize>(header.size()) &&
        (std::memcmp(header.data(), "RIFF", 4) == 0 || std::memcmp(header.data(), "RF64", 4) == 0 ||
         std::memcmp(header.data(), "RIFX", 4) == 0) && std::memcmp(header.data() + 8, "WAVE", 4) == 0) {
      inputFormat = av_find_input_format("wav");
    }
  }
  if (!impl_->fileInput.open(source, &impl_->formatContext)) {
    av_dict_free(&openOptions);
    if (error) *error = "无法打开本地音频文件";
    return false;
  }
  if (!impl_->formatContext) impl_->formatContext = avformat_alloc_context();
  if (!impl_->formatContext) {
    av_dict_free(&openOptions);
    if (error) *error = "Cannot allocate demuxer";
    return false;
  }
  impl_->formatContext->interrupt_callback = {Impl::interruptIo, impl_.get()};
  int ret = avformat_open_input(&impl_->formatContext, source.c_str(), inputFormat, &openOptions);
  av_dict_free(&openOptions);
  if (ret < 0 || Impl::interruptIo(impl_.get())) {
    if (looksHttp || impl_->cancelled(nullptr)) return impl_->ioError(error, "open", ret);
    if (error) *error = "打开音频失败，错误码：" + std::to_string(ret);
    return false;
  }

  ret = avformat_find_stream_info(impl_->formatContext, nullptr);
  if (ret < 0 || Impl::interruptIo(impl_.get())) {
    if (looksHttp || impl_->cancelled(nullptr)) return impl_->ioError(error, "probe", ret);
    if (error) *error = "解析音频信息失败，错误码：" + std::to_string(ret);
    return false;
  }

  ret = av_find_best_stream(impl_->formatContext, AVMEDIA_TYPE_AUDIO, -1, -1, nullptr, 0);
  if (ret < 0) {
    if (error) *error = "未找到音频流";
    return false;
  }
  impl_->audioStreamIndex = ret;

  AVStream* stream = impl_->formatContext->streams[impl_->audioStreamIndex];
  const AVCodecParameters* params = stream->codecpar;
  const AVCodec* codec = avcodec_find_decoder(params->codec_id);
  if (!codec) {
    if (error) *error = "当前音频格式没有可用解码器";
    return false;
  }

  impl_->codecContext = avcodec_alloc_context3(codec);
  if (!impl_->codecContext) {
    if (error) *error = "无法分配解码器上下文";
    return false;
  }

  ret = avcodec_parameters_to_context(impl_->codecContext, params);
  if (ret < 0) {
    if (error) *error = "无法读取解码参数，错误码：" + std::to_string(ret);
    return false;
  }

  ret = avcodec_open2(impl_->codecContext, codec, nullptr);
  if (ret < 0) {
    if (error) *error = "无法打开解码器，错误码：" + std::to_string(ret);
    return false;
  }

  impl_->packet = av_packet_alloc();
  impl_->frame = av_frame_alloc();
  if (!impl_->packet || !impl_->frame) {
    if (error) *error = "无法分配解码缓冲";
    return false;
  }

  const int parameterChannels = params->ch_layout.nb_channels;
  const int decodedChannels = impl_->codecContext->ch_layout.nb_channels;
  const int channels = std::max(1, parameterChannels > 0 ? parameterChannels : decodedChannels);
  const int rawBitDepth = params->bits_per_raw_sample > 0
                              ? params->bits_per_raw_sample
                              : (params->bits_per_coded_sample > 0 ? params->bits_per_coded_sample : 0);
  const int decodedBitDepth = sampleBitDepth(impl_->codecContext->sample_fmt);
  const AVCodecDescriptor* descriptor = avcodec_descriptor_get(params->codec_id);
  const std::string codecName = codec->name ? codec->name : "未知";
  const std::string containerName =
      impl_->formatContext->iformat
          ? (impl_->formatContext->iformat->long_name ? impl_->formatContext->iformat->long_name
                                                      : (impl_->formatContext->iformat->name ? impl_->formatContext->iformat->name : ""))
          : "";
  const bool sourceDsd = codecLooksDsd(params->codec_id, codecName, containerName, extensionOf(source));
  const bool dopCarrier = sourceDsd && (textMentions(codecName, "dop") || textMentions(containerName, "dop"));
  const int reportedSampleRate = params->sample_rate > 0 ? params->sample_rate : impl_->codecContext->sample_rate;
  // Raw-DSD demuxers report the post-decimation PCM rate; the engine wants the DSD bit
  // rate here. See FFmpegDsdRate.h.
  const int sourceSampleRate = ffmpeg::dsdSampleRateFromCodecRate(params->codec_id, reportedSampleRate);

  impl_->streamInfo.source = source;
  impl_->streamInfo.codec = codecName;
  impl_->streamInfo.bitrate =
      params->bit_rate > 0 ? params->bit_rate : impl_->formatContext->bit_rate;
  impl_->streamInfo.sourceFormat.sampleRate = sourceSampleRate;
  impl_->streamInfo.sourceFormat.channelCount = channels;
  impl_->streamInfo.sourceFormat.bitDepth = sourceDsd ? 1 : (rawBitDepth > 0 ? rawBitDepth : decodedBitDepth);
  impl_->streamInfo.sourceFormat.sampleFormat =
      sourceDsd ? AudioSampleFormat::Float32Interleaved : sourceSampleFormat(rawBitDepth, impl_->codecContext->sample_fmt);
  impl_->streamInfo.decodedFormat = impl_->streamInfo.sourceFormat;
  impl_->streamInfo.sourceLossless = sourceDsd || codecLooksLossless(descriptor, codecName);
  impl_->streamInfo.isDsd = sourceDsd;
  impl_->streamInfo.dsdMode = sourceDsd ? DsdMode::Pcm : DsdMode::Pcm;
  impl_->streamInfo.dsdRate = sourceDsd ? inferDsdRate(sourceSampleRate, dopCarrier) : 0;
  readReplayGainDictionary(impl_->formatContext->metadata, &impl_->streamInfo.replayGain);
  readReplayGainDictionary(stream->metadata, &impl_->streamInfo.replayGain);

  if (stream->duration != AV_NOPTS_VALUE) {
    impl_->streamInfo.durationSeconds = static_cast<double>(stream->duration) * av_q2d(stream->time_base);
  } else if (impl_->formatContext->duration != AV_NOPTS_VALUE) {
    impl_->streamInfo.durationSeconds =
        static_cast<double>(impl_->formatContext->duration) / static_cast<double>(AV_TIME_BASE);
  }

  impl_->refreshStreamTitleFromContext();
  {
    std::lock_guard lock(impl_->streamTitleMutex);
    impl_->streamInfo.streamTitle = impl_->streamTitle;
  }

  AudioFormat defaultOutput = impl_->streamInfo.sourceFormat;
  if (sourceDsd && impl_->codecContext->sample_rate > 0) {
    defaultOutput.sampleRate = impl_->codecContext->sample_rate;
    defaultOutput.bitDepth = 32;
    defaultOutput.sampleFormat = AudioSampleFormat::Float32Interleaved;
  }
  if (!setOutputFormat(defaultOutput, error)) return false;
  failedOpen.release();
  return true;
#else
  (void)source;
  if (error) *error = "当前构建未启用音频解码支持";
  return false;
#endif
}

void FFmpegDecoder::close() {
  impl_->close();
}

bool FFmpegDecoder::setOutputFormat(const AudioFormat& format, std::string* error) {
#if defined(TAE_HAS_FFMPEG)
  return impl_->configureOutputResampler(format, error);
#else
  (void)format;
  if (error) *error = "当前构建未启用音频解码支持";
  return false;
#endif
}

void FFmpegDecoder::setResamplerQuality(ResamplerQuality quality) {
  impl_->resamplerQuality = quality;
}

size_t FFmpegDecoder::readFrames(float* output, size_t frameCount, std::string* error) {
  if (!output || frameCount == 0) return 0;
  if (impl_->outputFormat.sampleFormat != AudioSampleFormat::Float32Interleaved) {
    std::fill(output, output + frameCount * static_cast<size_t>(std::max(1, impl_->outputFormat.channelCount)), 0.0f);
    return 0;
  }

  PcmBlock block;
  block.format = impl_->outputFormat;
  block.data = reinterpret_cast<uint8_t*>(output);
  block.frames = frameCount;
  block.byteSize = frameCount * audioFormatBytesPerFrame(block.format);
  return readFrames(block, error);
}

size_t FFmpegDecoder::readFrames(PcmBlock& output, std::string* error) {
  if (impl_->cancelled(error)) return 0;
  if (!output.data || output.frames == 0) return 0;

#if defined(TAE_HAS_FFMPEG)
  if (!impl_->codecContext || !impl_->swr) {
    ffmpeg::zeroPcmBlock(output);
    return 0;
  }
  if (!pcmFormatsExactMatch(output.format, impl_->outputFormat)) {
    ffmpeg::zeroPcmBlock(output);
    return 0;
  }

  const size_t channels = static_cast<size_t>(std::max(1, impl_->outputFormat.channelCount));
  const size_t bytesPerFrame = audioFormatBytesPerFrame(impl_->outputFormat);
  if (bytesPerFrame == 0) {
    ffmpeg::zeroPcmBlock(output);
    return 0;
  }
  size_t copiedFrames = 0;

  while (copiedFrames < output.frames) {
    if (impl_->cancelled(error)) break;
    const size_t pendingFrames =
        impl_->pending.size() / bytesPerFrame > impl_->pendingFrameOffset
            ? impl_->pending.size() / bytesPerFrame - impl_->pendingFrameOffset
            : 0;
    if (pendingFrames == 0) {
      if (!impl_->decodeOneFrame(error)) break;
      continue;
    }

    const size_t toCopy = std::min(output.frames - copiedFrames, pendingFrames);
    const size_t srcOffset = impl_->pendingFrameOffset * bytesPerFrame;
    const size_t dstOffset = copiedFrames * bytesPerFrame;
    std::memcpy(output.data + dstOffset, impl_->pending.data() + srcOffset, toCopy * bytesPerFrame);

    impl_->pendingFrameOffset += toCopy;
    copiedFrames += toCopy;
    if (impl_->pendingFrameOffset >= impl_->pending.size() / bytesPerFrame) {
      impl_->resetPending();
    }
  }

  ffmpeg::zeroPcmBlockTail(output, copiedFrames);
  return copiedFrames;
#else
  (void)error;
  ffmpeg::zeroPcmBlock(output);
  return 0;
#endif
}

bool FFmpegDecoder::seek(double seconds, std::string* error, SeekPurpose purpose) {
#if defined(TAE_HAS_FFMPEG)
  if (!impl_->formatContext || impl_->audioStreamIndex < 0) return false;
  // The transport owner has stopped/joined the old reader before seeking.
  impl_->ioCancelled.store(false, std::memory_order_release);
  impl_->readFailure.clear();
  impl_->readFailureWasCancelled = false;
  Impl::SeekBudgetScope positioning(*impl_, purpose);
  Impl::IoOperation io(*impl_, Impl::IoPhase::Seek);
  AVStream* stream = impl_->formatContext->streams[impl_->audioStreamIndex];
  const int64_t timestamp = static_cast<int64_t>(seconds / av_q2d(stream->time_base));
  const int ret = av_seek_frame(impl_->formatContext, impl_->audioStreamIndex, timestamp, AVSEEK_FLAG_BACKWARD);
  if (ret < 0 || Impl::interruptIo(impl_.get())) {
    if (impl_->httpSource || impl_->cancelled(nullptr)) return impl_->ioError(error, "seek", ret);
    if (error) *error = "音频跳转失败，错误码：" + std::to_string(ret);
    return false;
  }
  avcodec_flush_buffers(impl_->codecContext);
  // Decoder flush does not clear swr history from the old playback position.
  if (impl_->swr) {
    swr_close(impl_->swr);
    if (swr_init(impl_->swr) < 0) { if (error) *error = "Unable to reset seek resampler"; return false; }
  }
  impl_->inputEof = false;
  impl_->resamplerFlushed = false;
  impl_->eof = false;
  impl_->resetPending();
  impl_->exactSeek = false;
  impl_->exactInputCursor.reset();
  return true;
#else
  (void)seconds;
  (void)purpose;
  if (error) *error = "当前构建未启用音频解码支持";
  return false;
#endif
}

bool FFmpegDecoder::seekOutputFrame(uint64_t frame, std::string* error, SeekPurpose purpose) {
#if defined(TAE_HAS_FFMPEG)
  if (!impl_->formatContext || !impl_->swr || impl_->outputFormat.sampleRate <= 0 ||
      frame >= static_cast<uint64_t>(INT64_MAX)) return false;
  // One second supplies codec and resampler history, bounded independent of
  // song duration. The final trim is in integer output frames, not seconds.
  const auto rate = static_cast<uint64_t>(impl_->outputFormat.sampleRate);
  const auto preroll = frame > rate ? frame - rate : 0;
  Impl::SeekBudgetScope positioning(*impl_, purpose);
  if (!seek(static_cast<double>(preroll) / rate, error, purpose)) return false;
  impl_->exactSeek = true;
  impl_->exactFromStart = preroll == 0;
  impl_->exactTarget = frame;
  impl_->exactInputCursor.reset();
  while (impl_->exactSeek) {
    if (!impl_->decodeOneFrame(error)) {
      if (error && error->empty()) *error = "Precise PCM seek reached end of source";
      impl_->exactSeek = false;
      return false;
    }
  }
  return true;
#else
  (void)frame;
  (void)purpose;
  if (error) *error = "当前构建未启用音频解码支持";
  return false;
#endif
}

bool FFmpegDecoder::eof() const {
  return impl_->eof;
}

const AudioStreamInfo& FFmpegDecoder::streamInfo() const {
  return impl_->streamInfo;
}

const AudioFormat& FFmpegDecoder::outputFormat() const {
  return impl_->outputFormat;
}

std::string FFmpegDecoder::streamTitle() const {
  std::lock_guard lock(impl_->streamTitleMutex);
  return impl_->streamTitle;
}

void FFmpegDecoder::pollStreamMetadata() {
#if defined(TAE_HAS_FFMPEG)
  impl_->refreshStreamTitleFromContext();
  {
    std::lock_guard lock(impl_->streamTitleMutex);
    impl_->streamInfo.streamTitle = impl_->streamTitle;
  }
#else
  // No-op without FFmpeg.
#endif
}

}  // namespace twilight::audio
