# ASIO 播放错误排查（2026-10-16）

输入：`TwilightEcho-diagnostics-2026-10-16T03-56-58-814Z.zip`；应用报告版本 `1.3.1-preview`。压缩包只作为诊断数据读取。以下时间均为北京时间（UTC+8）。代码核对基于当前工作区；诊断包不能证明用户安装包与当前 HEAD 完全相同。

## 结论

日志中存在两类故障，都被 UI 显示为“发生未知错误”：

1. **FLAC 尾部解码失败**：5 次原生 `decode.failed`，涉及 4 个脱敏源路径指纹。最符合“播完一首歌就报错”的描述。错误为 `Audio decoder receive failed, code: -1094995529`，即 FFmpeg `AVERROR_INVALIDDATA`（Invalid data found when processing input）。报错时播放位置都在曲目末尾附近。这些记录使用 LETECIEL MAGIVANT，输出为 44.1 kHz / int32 / 双声道，设备丢失、驱动重启、欠载计数均为 0。没有证据把这些解码失败归因于 ASIO 驱动。
2. **ASIO 回调停滞**：2 次 `asio_helper_callback_stalled`。它们是独立的输出故障，不能用解码错误解释。

仅凭本包无法确定无效数据来自文件尾部附加内容、损坏帧还是解码器兼容问题，也无法确定 ASIO 回调停滞的底层原因。包内没有原始音频；源指纹是脱敏路径标识，不是文件内容校验值。

## 复现记录

| 停止/报错时间 | 源路径指纹 | 位置 / 时长（秒） | 故障 |
| --- | --- | --- | --- |
| 10-15 22:01:42.882 | 75211cdc918ae2d8 | 47.613 / 345.093 | ASIO4ALL v2 回调停滞；此前有重置请求，累计驱动重启计数 18 |
| 10-16 01:36:59.847 | 7fa871766ea6594e | 254.667 / 254.667 | FLAC 无效数据 |
| 10-16 01:42:57.864 | 75211cdc918ae2d8 | 345.093 / 345.093 | FLAC 无效数据 |
| 10-16 01:49:01.127 | 75211cdc918ae2d8 | 345.231 / 345.093 | 同一路径再次解码失败 |
| 10-16 01:54:02.841 | e8c05357b72e979e | 299.347 / 299.347 | FLAC 无效数据 |
| 10-16 11:40:28.133 | 75d56543b2b7b580 | 0 / 271.773 | LETECIEL MAGIVANT 启动后回调数为 0，约 2.5 秒后停止 |
| 10-16 11:54:39.218 | dcf5fcd72e9cf9b3 | 366.507 / 366.507 | FLAC 无效数据 |

最后一次会话中，271.773 秒的曲目先正常结束并切到下一首；下一首播放到 366.507 秒时报错。因此不是每次 ASIO 初始化或每次切歌必然失败。

最新一次错误的顺序：

- 11:48:32 开始播放 FLAC（44.1 kHz / 16 bit / 双声道）。
- 11:54:36.651 解码线程报错，`decodeEof=false`。
- 11:54:37.491 健康采样显示累计产出 16,162,944 帧，恰为 366.5066667 秒；缓冲还剩 51,328 帧。
- 11:54:38.525 缓冲降为 6,272 帧，ASIO 回调仍在推进。
- 11:54:39.218 播放停止，发出 `end-file`，原因是 `error`。
- 11:54:39.238 UI 日志明确记录 `[error] unclassified failure: Audio decoder receive failed, code: -1094995529`。

累计帧数覆盖标称时长支持“尾部处理异常”的方向，但不足以证明文件完全有效或允许吞掉错误。

## 代码路径

- `audio-engine/decoder/FFmpegDecoder.cpp:507–524`：`avcodec_receive_frame()` 返回非 EOF、非 EAGAIN 错误时调用 `failRead()`，保存终止错误。
- `audio-engine/core/AudioPipeline.cpp`：`decodeLoop()` 保存错误，`consumeDecodeError()` 等待已有有效 PCM 缓冲播放完再上报。这解释了先听完整首、随后报错的现象。
- `audio-engine/core/TwilightAudioEngine.cpp`：消费解码错误后停止播放，不走正常 EOF 自动推进。
- `src/main/audio/playbackController.ts:1572`：停止时读取 `lastError`，发出错误结束事件。
- `src/renderer/src/stores/usePlayerStore.ts:2851`：把错误交给 `presentErrorDetail()`。
- `src/shared/errors/presentError.ts`：只识别结构化错误及网络/鉴权等英文模式；上述原生英文错误未被分类，落到 `error.generic.unknown`。这是“未知错误”文案的确定原因，原始错误并未从日志中丢失。
- `audio-engine/output/asio/AsioHelperHost.cpp:540`：已启动状态下回调心跳超时，会中止 helper 并上报 `asio_helper_callback_stalled`。日志只能确认触发了这条路径，不能证明是驱动、设备占用、进程调度或宿主交互导致。

提交 `0ad90664` 将解码失败与正常 EOF 分离并传递到播放控制层；这是近期开始显式暴露此类错误的一条相关变更，不能据此认定该提交制造了无效音频数据。

## 后续验证与修复方向

1. 取得任意一个末尾报错的原始 FLAC（例如时长 366.507 秒的文件），用与安装包同版本的 FFmpeg 做全量解码和 FLAC 完整性检查，并检查尾部附加数据。对同一文件比较 WASAPI 与 ASIO；当前包没有相应的 WASAPI 对照证据。
2. 在有原始样本的前提下决定是否增加受约束的尾部容错；不能只按“接近 duration”将所有解码失败转成 EOF，否则会掩盖损坏和截断。
3. 将原生解码错误和 ASIO 回调停滞接入本地化错误分类，分别显示可理解的原因，而非“未知错误”。
4. 对 ASIO 启动停滞单独采集 helper/驱动侧启动与首回调记录，复测 LETECIEL MAGIVANT；重启后同一路径能够播放，提示应关注启动时序和设备状态，但原因仍需验证。

本次完成日志与代码路径排查，未修改播放实现，也未进行用户设备上的硬件复现。

## 原始样本验证：柊 - Do As Infinity.flac

随后用户提供 `C:/Users/XOS/Downloads/柊 - Do As Infinity.flac`。已在临时副本上完整解码，原文件未修改。

- 文件大小：32,912,696 字节。
- SHA-256：`9ffe8321ef063923dc680c18d01f8ffdd5f30bd374bb7d1d51044c3cfbd02ad3`。
- STREAMINFO：44,100 Hz、双声道、16 bit、11,985,204 帧，即 271.773333333 秒。
- STREAMINFO 内声明的原始 PCM MD5：`993a2a430398952260b3441a1a3aacea`。
- 使用当前项目 `FFmpegDecoder.cpp`、`FFmpegFileInput.h` 和本地项目依赖 libavcodec 63.1.102 编译临时探针；不经过输出设备，直接完整读取至 EOF。
- Int16、Int32、Float32 三种输出路径均产出 11,985,204 帧，`eof=true`，无错误。
- Int16 解码所得 PCM MD5 为 `993a2a430398952260b3441a1a3aacea`，与文件声明值完全相同。

**结论更新：提供的这首样本完整性校验通过，当前解码器未复现尾部无效数据错误，不能把该文件判为损坏。**

该样本的时长和精确帧数，与最新诊断会话中正常结束的首曲完全一致：原生日志 `native-14392-1792122235755-06e20c64893e25fa-0.active.jsonl` 第 278–281 行显示 streamToken=1 产出 11,985,204 帧、`eof=true`，随后自动进入 streamToken=2。后者时长为 366.506666667 秒，才是 11:54:36.651 解码失败的曲目。参数一致不能单独证明是同一文件，诊断包未提供音频内容哈希。

因此，最新会话的证据是“4:31.773 曲目正常播完并自动切到下一首，6:06.507 曲目末尾失败”，而非所提供的 4:31.773 样本已复现故障。若用户明确在这首之后就停止，仍需该次复现的日志与下一首文件一起核对；不能仅由当前单文件解码通过排除设备或队列问题。

探针保存在 `tmp/flac_sample_probe.cpp`，二进制为 `tmp/flac_sample_probe.exe`。此验证不依赖真实 ASIO 设备，不构成 ASIO 连续播放硬件验证。播放实现仍未修改。
