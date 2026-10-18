#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace twilight::audio {
// Main-process-authorized, per-source processing metadata. No credentials or
// remote media address. Never projected to renderer status or queue exports.
struct PcmWorkerSpec {
  std::string executable;
  std::vector<std::string> arguments;
  uint64_t expiresAt = 0;
};
}  // namespace twilight::audio
