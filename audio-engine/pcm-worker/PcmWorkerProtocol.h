#pragma once

#include <cstdint>

// Private, credential-free IPC between the decoder and an isolated PCM worker.
// No pointers, native size_t, paths or source URLs cross this boundary.
namespace twilight::audio::pcm_worker {
constexpr uint32_t kMagic = 0x4d435054;
constexpr uint32_t kVersion = 1;
constexpr uint32_t kMaximumPayload = 2 * 1024 * 1024;
constexpr uint32_t kMaximumFrames = 16384;
constexpr uint32_t kMaximumChannels = 8;
enum class Operation : uint32_t { Init = 1, Push = 2, Pull = 3, Finish = 4, Close = 5 };
enum class ReadStatus : uint32_t { NeedInput = 0, Output = 1, Finished = 2 };
#pragma pack(push, 1)
struct Header {
  uint32_t magic = kMagic;
  uint32_t version = kVersion;
  Operation operation = Operation::Init;
  uint32_t sequence = 0;
  uint32_t bytes = 0;
  uint32_t status = 0;
};
struct Init {
  uint32_t sampleRate;
  uint32_t channels;
  int64_t encodedBitrate;
};
struct Format { uint32_t sampleRate; uint32_t channels; };
struct Pull { uint32_t capacityFrames; };
struct Read { ReadStatus status; uint32_t frames; };
#pragma pack(pop)
static_assert(sizeof(Header) == 24 && sizeof(Init) == 16 && sizeof(Format) == 8 && sizeof(Read) == 8);
}  // namespace twilight::audio::pcm_worker
