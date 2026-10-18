#pragma once

#include "../decoder/FFmpegDecoder.h"

#include <algorithm>
#include <chrono>
#include <iostream>
#include <string>
#include <thread>
#include <vector>

// This diagnostic entry point accepts only an ephemeral loopback fixture. It
// emits timing/count/classification facts, never a URL or decoded PCM sample.
inline int runFfmpegHttpProbe(const std::string& url, int interruptMs, bool seek,
                            bool cancelOpen = false, bool cancelRead = false,
                            bool restartAfterCancel = false) {
  using namespace twilight::audio;
  using Clock = std::chrono::steady_clock;
  if (url.rfind("http://127.0.0.1:", 0) != 0 || interruptMs < 0 || interruptMs > 30000) return 2;
  const auto begin = Clock::now();
  struct Interrupt {
    bool enabled;
    Clock::time_point deadline;
  } interrupt{interruptMs > 0, begin + std::chrono::milliseconds(interruptMs)};
  FFmpegDecoder decoder;
  decoder.setInterrupt([](void* raw) {
    const auto* state = static_cast<const Interrupt*>(raw);
    return state->enabled && Clock::now() >= state->deadline ? 1 : 0;
  }, &interrupt);
  std::thread cancellation;
  const auto requestCancellation = [&] {
    cancellation = std::thread([&] {
      std::this_thread::sleep_for(std::chrono::milliseconds(150));
      decoder.cancelPcmStreamTransform();
    });
  };
  if (cancelOpen) requestCancellation();
  std::string error;
  const bool opened = decoder.open(url, &error);
  const auto openedAt = Clock::now();
  bool configured = false;
  bool sought = !seek;
  size_t frames = 0;
  if (opened) {
    auto format = decoder.outputFormat();
    format.sampleFormat = AudioSampleFormat::Float32Interleaved;
    format.bitDepth = 32;
    configured = decoder.setOutputFormat(format, &error);
    if (configured) {
      if (cancelRead) requestCancellation();
      std::vector<float> samples(2048 * static_cast<size_t>(std::max(1, format.channelCount)));
      if (seek) sought = decoder.seek(35.0, &error);
      if (sought) {
        while (frames < 10000000 && error.empty()) {
          const auto count = decoder.readFrames(samples.data(), 2048, &error);
          frames += count;
          if (!count) break;
        }
      }
    }
  }
  if (cancellation.joinable()) cancellation.join();
  const bool cancelledBeforeRestart = error == "decode_cancelled";
  const auto framesBeforeRestart = frames;
  bool restarted = false;
  if (restartAfterCancel && configured && cancelledBeforeRestart) {
    error.clear();
    restarted = decoder.restartPcmStreamTransform(&error);
    // The loopback fixture responds to this control event by releasing its
    // held response body. There is no media data in this output.
    std::cout << "{\"event\":\"resume-source\"}" << std::endl;
    std::vector<float> samples(2048 * static_cast<size_t>(std::max(1, decoder.outputFormat().channelCount)));
    while (restarted && frames < 10000000 && error.empty()) {
      const auto count = decoder.readFrames(samples.data(), 2048, &error);
      frames += count;
      if (!count) break;
    }
  }
  const auto ms = [](auto duration) { return std::chrono::duration<double, std::milli>(duration).count(); };
  std::cout << "{\"opened\":" << (opened ? "true" : "false")
            << ",\"configured\":" << (configured ? "true" : "false")
            << ",\"sought\":" << (sought ? "true" : "false")
            << ",\"error\":" << (!error.empty() ? "true" : "false")
            << ",\"cancelled\":" << (error == "decode_cancelled" ? "true" : "false")
            << ",\"cancelledBeforeRestart\":" << (cancelledBeforeRestart ? "true" : "false")
            << ",\"restarted\":" << (restarted ? "true" : "false")
            << ",\"framesBeforeRestart\":" << framesBeforeRestart
            << ",\"framesAfterRestart\":" << (restartAfterCancel ? frames - framesBeforeRestart : 0)
            << ",\"timeout\":" << (error == "network_io_timeout" ? "true" : "false")
            << ",\"eof\":" << (decoder.eof() ? "true" : "false")
            << ",\"frames\":" << frames
            << ",\"openMs\":" << ms(openedAt - begin)
            << ",\"totalMs\":" << ms(Clock::now() - begin) << "}\n";
  return 0;
}
