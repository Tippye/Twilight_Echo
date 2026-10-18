#pragma once

#include <filesystem>
#include <string>
#include <vector>

namespace twilight::audio::test {

struct PcmWavFixtureSpec {
  std::string name;
  int sampleRate = 48000;
  int channels = 2;
  int bitsPerSample = 16;
  int frameCount = 32;
  bool floatingPoint = false;
};

class TempAudioFixture {
 public:
  TempAudioFixture() = default;
  explicit TempAudioFixture(std::filesystem::path path);
  TempAudioFixture(const TempAudioFixture&) = delete;
  TempAudioFixture& operator=(const TempAudioFixture&) = delete;
  TempAudioFixture(TempAudioFixture&& other) noexcept;
  TempAudioFixture& operator=(TempAudioFixture&& other) noexcept;
  ~TempAudioFixture();

  const std::filesystem::path& path() const { return path_; }
  std::string string() const {
    const auto utf8 = path_.u8string();
    return std::string(reinterpret_cast<const char*>(utf8.data()), utf8.size());
  }
  void cleanup();

 private:
  std::filesystem::path path_;
};

TempAudioFixture writePcmWavFixture(const PcmWavFixtureSpec& spec);
TempAudioFixture writeDsfFixture(const std::string& name, int sampleRate = 2822400, int blockSizePerChannel = 4096);
std::vector<std::filesystem::path> findExternalAudioFixtures();

}  // namespace twilight::audio::test
