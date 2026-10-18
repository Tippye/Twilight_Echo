#include "AudioFixtureLibrary.h"
#include "../core/Utf8Path.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <system_error>

namespace twilight::audio::test {
namespace {

void writeLe16(std::ofstream& out, uint16_t value) {
  out.put(static_cast<char>(value & 0xff));
  out.put(static_cast<char>((value >> 8) & 0xff));
}

void writeLe32(std::ofstream& out, uint32_t value) {
  writeLe16(out, static_cast<uint16_t>(value & 0xffff));
  writeLe16(out, static_cast<uint16_t>((value >> 16) & 0xffff));
}

void writeLe64(std::ofstream& out, uint64_t value) {
  writeLe32(out, static_cast<uint32_t>(value & 0xffffffffULL));
  writeLe32(out, static_cast<uint32_t>((value >> 32) & 0xffffffffULL));
}

std::filesystem::path tempPathFor(const std::string& name) {
  return std::filesystem::temp_directory_path() / utf8Path(name);
}

std::string lowercaseExtension(const std::filesystem::path& path) {
  std::string extension = path.extension().string();
  std::transform(extension.begin(), extension.end(), extension.begin(), [](unsigned char ch) {
    return static_cast<char>(std::tolower(ch));
  });
  return extension;
}

bool isSupportedExternalFixture(const std::filesystem::path& path) {
  static constexpr std::array<const char*, 11> kExtensions = {
      ".wav", ".flac", ".mp3", ".m4a", ".aac", ".ogg", ".opus", ".dsf", ".dff", ".aiff", ".iso"};
  const std::string extension = lowercaseExtension(path);
  return std::find(kExtensions.begin(), kExtensions.end(), extension) != kExtensions.end();
}

std::string readTextFile(const std::filesystem::path& path) {
  std::ifstream file(path, std::ios::binary);
  if (!file) return {};
  std::ostringstream buffer;
  buffer << file.rdbuf();
  return buffer.str();
}

std::string parseJsonStringAt(const std::string& json, size_t quote) {
  if (quote >= json.size() || json[quote] != '"') return {};
  std::string value;
  for (size_t i = quote + 1; i < json.size(); ++i) {
    const char ch = json[i];
    if (ch == '"') return value;
    if (ch != '\\' || i + 1 >= json.size()) {
      value.push_back(ch);
      continue;
    }
    const char escaped = json[++i];
    switch (escaped) {
      case '\\':
      case '"':
      case '/':
        value.push_back(escaped);
        break;
      case 'n':
        value.push_back('\n');
        break;
      case 'r':
        value.push_back('\r');
        break;
      case 't':
        value.push_back('\t');
        break;
      default:
        value.push_back(escaped);
        break;
    }
  }
  return {};
}

void collectManifestKeyPaths(
    const std::string& json,
    const std::string& key,
    const std::filesystem::path& baseDir,
    std::vector<std::filesystem::path>* fixtures) {
  if (!fixtures) return;
  const std::string needle = "\"" + key + "\"";
  size_t pos = 0;
  while ((pos = json.find(needle, pos)) != std::string::npos && fixtures->size() < 256) {
    const size_t colon = json.find(':', pos + needle.size());
    if (colon == std::string::npos) break;
    const size_t quote = json.find('"', colon + 1);
    if (quote == std::string::npos) break;
    std::filesystem::path candidate(parseJsonStringAt(json, quote));
    if (!candidate.empty()) {
      if (candidate.is_relative()) candidate = baseDir / candidate;
      if (isSupportedExternalFixture(candidate)) fixtures->push_back(candidate);
    }
    pos = quote + 1;
  }
}

std::vector<std::filesystem::path> findExternalAudioFixturesFromManifest() {
  const char* rawManifest = std::getenv("TAE_AUDIO_FIXTURE_MANIFEST");
  if (!rawManifest || std::string(rawManifest).empty()) return {};
  const std::filesystem::path manifestPath(rawManifest);
  const std::string json = readTextFile(manifestPath);
  if (json.empty()) return {};

  std::vector<std::filesystem::path> fixtures;
  const std::filesystem::path baseDir = manifestPath.parent_path();
  collectManifestKeyPaths(json, "path", baseDir, &fixtures);
  collectManifestKeyPaths(json, "source", baseDir, &fixtures);
  collectManifestKeyPaths(json, "file", baseDir, &fixtures);
  std::sort(fixtures.begin(), fixtures.end());
  fixtures.erase(std::unique(fixtures.begin(), fixtures.end()), fixtures.end());
  return fixtures;
}

}  // namespace

TempAudioFixture::TempAudioFixture(std::filesystem::path path) : path_(std::move(path)) {}

TempAudioFixture::TempAudioFixture(TempAudioFixture&& other) noexcept : path_(std::move(other.path_)) {
  other.path_.clear();
}

TempAudioFixture& TempAudioFixture::operator=(TempAudioFixture&& other) noexcept {
  if (this != &other) {
    cleanup();
    path_ = std::move(other.path_);
    other.path_.clear();
  }
  return *this;
}

TempAudioFixture::~TempAudioFixture() {
  cleanup();
}

void TempAudioFixture::cleanup() {
  if (path_.empty()) return;
  std::error_code ignored;
  std::filesystem::remove(path_, ignored);
  path_.clear();
}

TempAudioFixture writePcmWavFixture(const PcmWavFixtureSpec& spec) {
  const auto path = tempPathFor(spec.name);
  const int bytesPerSample = spec.bitsPerSample / 8;
  const int dataBytes = spec.frameCount * spec.channels * bytesPerSample;
  const uint16_t formatTag = spec.floatingPoint ? 3 : 1;

  std::ofstream out(path, std::ios::binary);
  out.write("RIFF", 4);
  writeLe32(out, 36 + static_cast<uint32_t>(dataBytes));
  out.write("WAVE", 4);
  out.write("fmt ", 4);
  writeLe32(out, 16);
  writeLe16(out, formatTag);
  writeLe16(out, static_cast<uint16_t>(spec.channels));
  writeLe32(out, static_cast<uint32_t>(spec.sampleRate));
  writeLe32(out, static_cast<uint32_t>(spec.sampleRate * spec.channels * bytesPerSample));
  writeLe16(out, static_cast<uint16_t>(spec.channels * bytesPerSample));
  writeLe16(out, static_cast<uint16_t>(spec.bitsPerSample));
  out.write("data", 4);
  writeLe32(out, static_cast<uint32_t>(dataBytes));

  for (int frame = 0; frame < spec.frameCount; ++frame) {
    for (int channel = 0; channel < spec.channels; ++channel) {
      if (spec.floatingPoint) {
        const float value = static_cast<float>(frame) / static_cast<float>(std::max(1, spec.frameCount));
        out.write(reinterpret_cast<const char*>(&value), sizeof(value));
      } else if (spec.bitsPerSample == 16) {
        writeLe16(out, static_cast<uint16_t>(frame * 64));
      } else if (spec.bitsPerSample == 24) {
        const int32_t value = frame * 512;
        out.put(static_cast<char>(value & 0xff));
        out.put(static_cast<char>((value >> 8) & 0xff));
        out.put(static_cast<char>((value >> 16) & 0xff));
      } else {
        writeLe32(out, static_cast<uint32_t>(frame * 1024));
      }
    }
  }

  return TempAudioFixture(path);
}

TempAudioFixture writeDsfFixture(const std::string& name, int sampleRate, int blockSizePerChannel) {
  const auto path = tempPathFor(name);
  constexpr uint32_t kChannels = 2;
  const uint32_t blockSize = static_cast<uint32_t>(std::max(1, blockSizePerChannel));
  const uint64_t dataBytes = static_cast<uint64_t>(kChannels) * blockSize;
  const uint64_t fileSize = 28 + 52 + 12 + dataBytes;

  std::ofstream out(path, std::ios::binary);
  out.write("DSD ", 4);
  writeLe64(out, 28);
  writeLe64(out, fileSize);
  writeLe64(out, 0);
  out.write("fmt ", 4);
  writeLe64(out, 52);
  writeLe32(out, 1);
  writeLe32(out, 0);
  writeLe32(out, 2);
  writeLe32(out, kChannels);
  writeLe32(out, static_cast<uint32_t>(sampleRate));
  writeLe32(out, 1);
  writeLe64(out, static_cast<uint64_t>(blockSize) * 8);
  writeLe32(out, blockSize);
  writeLe32(out, 0);
  out.write("data", 4);
  writeLe64(out, 12 + dataBytes);
  for (uint64_t i = 0; i < dataBytes; ++i) out.put(static_cast<char>(0x69));

  return TempAudioFixture(path);
}

std::vector<std::filesystem::path> findExternalAudioFixtures() {
  auto manifestFixtures = findExternalAudioFixturesFromManifest();
  if (!manifestFixtures.empty()) return manifestFixtures;

  const char* rawDir = std::getenv("TAE_AUDIO_FIXTURES_DIR");
  if (!rawDir || std::string(rawDir).empty()) return {};

  std::error_code error;
  const std::filesystem::path root(rawDir);
  if (!std::filesystem::exists(root, error) || !std::filesystem::is_directory(root, error)) return {};

  std::vector<std::filesystem::path> fixtures;
  for (const auto& entry : std::filesystem::recursive_directory_iterator(root, error)) {
    if (error) break;
    if (!entry.is_regular_file(error)) continue;
    if (!isSupportedExternalFixture(entry.path())) continue;
    fixtures.push_back(entry.path());
    if (fixtures.size() >= 64) break;
  }
  std::sort(fixtures.begin(), fixtures.end());
  return fixtures;
}

}  // namespace twilight::audio::test
