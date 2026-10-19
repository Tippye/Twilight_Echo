#pragma once

// Formal decoder-unit fixture only. No application, external server process,
// commercial media, profile, or audio device is used.
#if defined(_WIN32) && defined(TAE_HAS_FFMPEG)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>
#include <ws2tcpip.h>

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavutil/channel_layout.h>
#include <libavutil/frame.h>
}

#include <algorithm>
#include <atomic>
#include <cassert>
#include <cstdint>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace twilight::audio::test {

inline std::vector<uint8_t> makeSparseIndexedFlac(
    bool indexed, int rate = 96000, int64_t frames = 90LL * 96000,
    std::vector<size_t>* frameOffsets = nullptr) {
  const AVCodec* codec = avcodec_find_encoder(AV_CODEC_ID_FLAC);
  assert(codec);
  AVCodecContext* encoder = avcodec_alloc_context3(codec);
  assert(encoder);
  encoder->sample_fmt = AV_SAMPLE_FMT_S32;
  encoder->sample_rate = rate;
  encoder->bits_per_raw_sample = 24;
  encoder->time_base = {1, rate};
  av_channel_layout_default(&encoder->ch_layout, 2);
  assert(avcodec_open2(encoder, codec, nullptr) == 0);
  AVFrame* frame = av_frame_alloc();
  AVPacket* packet = av_packet_alloc();
  assert(frame && packet && encoder->frame_size > 0);
  frame->format = encoder->sample_fmt;
  frame->sample_rate = rate;
  frame->nb_samples = encoder->frame_size;
  assert(av_channel_layout_copy(&frame->ch_layout, &encoder->ch_layout) == 0);
  assert(av_frame_get_buffer(frame, 0) == 0);
  struct Point { uint64_t sample, offset; uint16_t samples; };
  std::vector<Point> points;
  std::vector<uint8_t> payload;
  uint64_t nextPoint = 0;
  const auto collect = [&] {
    for (;;) {
      const int ret = avcodec_receive_packet(encoder, packet);
      if (ret == AVERROR(EAGAIN) || ret == AVERROR_EOF) break;
      assert(ret == 0);
      // The encoder may emit an empty final extradata update, not an audio
      // frame. Packet duration can be omitted; the submitted FLAC frame size
      // and its actual packet PTS determine the seekpoint's sample count.
      if (packet->size == 0) { av_packet_unref(packet); continue; }
      assert(packet->pts >= 0 && packet->pts < frames);
      if (frameOffsets) frameOffsets->push_back(payload.size());
      if (static_cast<uint64_t>(packet->pts) >= nextPoint) {
        points.push_back({static_cast<uint64_t>(packet->pts), payload.size(),
                          static_cast<uint16_t>(std::min<int64_t>(encoder->frame_size, frames - packet->pts))});
        nextPoint += 30ULL * rate;
      }
      payload.insert(payload.end(), packet->data, packet->data + packet->size);
      av_packet_unref(packet);
    }
  };
  uint32_t random = 0x6a09e667;
  for (int64_t first = 0; first < frames; first += encoder->frame_size) {
    assert(av_frame_make_writable(frame) == 0);
    frame->nb_samples = static_cast<int>(std::min<int64_t>(encoder->frame_size, frames - first));
    frame->pts = first;
    auto* data = reinterpret_cast<int32_t*>(frame->data[0]);
    for (int i = 0; i < frame->nb_samples * 2; ++i) {
      random = random * 1664525u + 1013904223u;
      data[i] = static_cast<int32_t>(random & 0xffffff00u);
    }
    assert(avcodec_send_frame(encoder, frame) == 0);
    collect();
  }
  assert(avcodec_send_frame(encoder, nullptr) == 0);
  collect();
  assert(encoder->extradata_size == 34 &&
         points.size() == static_cast<size_t>((frames - 1) / (30LL * rate) + 1));
  std::vector<uint8_t> bytes{'f', 'L', 'a', 'C'};
  const auto be = [&](uint64_t value, int width) {
    for (int i = width - 1; i >= 0; --i) bytes.push_back(static_cast<uint8_t>(value >> (i * 8)));
  };
  bytes.push_back(indexed ? 0 : 0x80);
  be(34, 3);
  bytes.insert(bytes.end(), encoder->extradata, encoder->extradata + 34);
  if (indexed) {
    bytes.push_back(0x83);
    be(points.size() * 18, 3);
    for (const auto& point : points) {
      be(point.sample, 8); be(point.offset, 8); be(point.samples, 2);
    }
  }
  if (frameOffsets) for (auto& offset : *frameOffsets) offset += bytes.size();
  bytes.insert(bytes.end(), payload.begin(), payload.end());
  av_packet_free(&packet); av_frame_free(&frame); avcodec_free_context(&encoder);
  return bytes;
}

class FlacIndexHttpFixture {
 public:
  explicit FlacIndexHttpFixture(std::shared_ptr<const std::vector<uint8_t>> bytes) : bytes_(std::move(bytes)) {
    WSADATA data{};
    assert(WSAStartup(MAKEWORD(2, 2), &data) == 0);
    listener_ = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    assert(listener_ != INVALID_SOCKET);
    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    assert(bind(listener_, reinterpret_cast<sockaddr*>(&address), sizeof(address)) == 0);
    assert(listen(listener_, 16) == 0);
    int size = sizeof(address);
    assert(getsockname(listener_, reinterpret_cast<sockaddr*>(&address), &size) == 0);
    port_ = ntohs(address.sin_port);
    acceptor_ = std::thread([this] {
      while (!stopped_.load()) {
        const SOCKET client = accept(listener_, nullptr, nullptr);
        if (client == INVALID_SOCKET) break;
        const DWORD timeout = 1000;
        setsockopt(client, SOL_SOCKET, SO_SNDTIMEO, reinterpret_cast<const char*>(&timeout), sizeof(timeout));
        setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char*>(&timeout), sizeof(timeout));
        std::lock_guard lock(mutex_);
        clients_.push_back(client);
        workers_.emplace_back([this, client] { serve(client); });
      }
    });
  }
  ~FlacIndexHttpFixture() {
    stopped_.store(true);
    shutdown(listener_, SD_BOTH); closesocket(listener_);
    if (acceptor_.joinable()) acceptor_.join();
    {
      std::lock_guard lock(mutex_);
      for (const auto client : clients_) if (client != INVALID_SOCKET) shutdown(client, SD_BOTH);
    }
    for (auto& worker : workers_) worker.join();
    WSACleanup();
  }
  std::string url() const { return "http://127.0.0.1:" + std::to_string(port_) + "/fixture"; }
 private:
  void serve(SOCKET client) {
    std::string request;
    char buffer[2048];
    while (request.find("\r\n\r\n") == std::string::npos && request.size() < 16384) {
      const int count = recv(client, buffer, sizeof(buffer), 0);
      if (count <= 0) break;
      request.append(buffer, count);
    }
    uint64_t first = 0, last = bytes_->size() - 1;
    const auto range = request.find("Range: bytes=");
    const bool partial = range != std::string::npos;
    if (partial) {
      const auto start = range + std::strlen("Range: bytes=");
      const auto dash = request.find('-', start);
      assert(dash != std::string::npos);
      first = std::stoull(request.substr(start, dash - start));
      if (request[dash + 1] >= '0' && request[dash + 1] <= '9') last = std::stoull(request.substr(dash + 1));
      last = std::min<uint64_t>(last, bytes_->size() - 1);
    }
    const auto write = [&](const char* data, size_t size) {
      while (size && !stopped_.load()) {
        const int count = send(client, data, static_cast<int>(std::min<size_t>(size, 65536)), 0);
        if (count <= 0) return false;
        data += count; size -= count;
      }
      return size == 0;
    };
    if (first <= last && first < bytes_->size()) {
      std::string header = partial ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n";
      header += "Content-Type: audio/flac\r\nAccept-Ranges: bytes\r\nConnection: close\r\nContent-Length: " + std::to_string(last - first + 1) + "\r\n";
      if (partial) header += "Content-Range: bytes " + std::to_string(first) + "-" + std::to_string(last) + "/" + std::to_string(bytes_->size()) + "\r\n";
      header += "\r\n";
      if (write(header.data(), header.size())) write(reinterpret_cast<const char*>(bytes_->data() + first), static_cast<size_t>(last - first + 1));
    }
    {
      std::lock_guard lock(mutex_);
      const auto found = std::find(clients_.begin(), clients_.end(), client);
      if (found != clients_.end()) *found = INVALID_SOCKET;
      closesocket(client);
    }
  }
  std::shared_ptr<const std::vector<uint8_t>> bytes_;
  SOCKET listener_ = INVALID_SOCKET;
  uint16_t port_ = 0;
  std::atomic<bool> stopped_{false};
  std::mutex mutex_;
  std::vector<SOCKET> clients_;
  std::vector<std::thread> workers_;
  std::thread acceptor_;
};

}  // namespace twilight::audio::test
#endif
