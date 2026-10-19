# #132 后续修复与验证（2026-10-14）

关联问题：<https://github.com/Px-asen/Twilight_Echo/issues/132>。

## 用户文档的作用

已阅读 `TwilightEcho-1.3.0-independent-bug-analysis-2026-10-13.md` 全文，包括 2026-10-14 的补充取证。报告作为诊断证据使用；其中的建议没有作为用户操作授权或已证实的现场根因。

第十三节提供了最有价值的范围收缩：无声后渲染回调计数继续增长，原生位置不再推进、可视化返回 no-samples，且故障期没有服务重启。这支持检查输入帧断供与内部状态路径；不能仅靠恢复流程缺陷解释这次无声，也不能据此确认网络或流退役是根因。

报告引用的 F 盘原始 trace、转储及现场 profile 不在本工作区，本轮没有直接分析这些资产，也没有在报告对应用户的耳机/驱动上复现。

## 本轮修改

1. **重启重入**：`handleExit` 在通知 crash 监听器之前设置重启门禁并安排退避；监听器中的查询不能再绕过退避惰性创建另一服务。保留 fatal 与显式重试语义。
2. **旧请求回调越代**：fire-and-forget 的失败副作用检查服务代次；合并控制请求的 finally 同时检查代次和请求对象身份，避免旧音量/拖动请求释放或重复发送新代控制请求。报告 F3 描述的全局失败清理已有前次修复，本轮补齐仍存在的 finally 竞态。
3. **DSP ACK**：每次提交返回自己的 requested/applied revision 与结果；界面的全局状态仍反映最新提交。服务恢复等待恢复期间提交的最终配置。旧请求的迟到失败不会覆盖新配置成功后的错误状态，真实编译失败及 ACK 不匹配仍报告失败。
4. **解码取消与 I/O 期限**：普通 DecodeStream 的独立停止状态与外部 AutoMix 取消合并到 FFmpeg 中断回调。打开阶段不依赖初始为 false 的 running；拖动进度前取消旧读取，随后重置停止状态。远程打开/探测共用 15 秒期限，每次读取和跳转使用 10 秒期限；HTTP rw_timeout 为 10 秒。缓冲区满或暂停期间的空闲时间不计入下一次读取期限。读取错误在错误日志中保留错误码；但 EOF 状态和自动切歌仍将读取失败与正常结束合并，本节第十四部分记录了这项尚未修复的缺陷。
5. **直接原生诊断**：`GetPlaybackInfo` 在复制状态快照后，直接采样活动 PCM 解码流与渲染计数。采样不等待 pipeline 锁；忙碌、无活动流或 DSD 路径用 `decodeHealthAvailable=false` 标记。停止/退役和解码读取失败写入原生 ring。RPC 超时记录方法、服务代次、耗时和最多 16 项在途方法，不记录源地址或参数。

## 复测字段

诊断 JSON 的顶层 `diagnostics` 与 `outputInfo.diagnostics` 含以下字段：

| 字段                                            | 含义                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| decodeHealthAvailable                           | 本次是否取得活动 PCM worker 样本；false 不能当作解码停止                  |
| decodeStreamToken                               | 进程内流/跳转标识，不含歌曲地址                                           |
| decodeRunning / decodeEof / decodeStopRequested | 循环运行标志、EOF 与停止请求；须结合 stage 判断，running 不是独立线程心跳 |
| decodeStage                                     | idle、reading、writing、exited                                            |
| decodeBufferedFrames / decodeProducedFrames     | PCM 缓冲帧数、累计完成写入帧数                                            |
| decodeLastProgressAgeMs                         | 上一次完成写入距今时间；尚无产出时为 0                                    |
| liveRenderState                                 | 0 stopped、1 playing、2 paused                                            |
| liveRenderedFrames / liveRenderCallbackCount    | 直接读取的渲染位置帧数与回调完成计数，独立于 clock 的 info\_ 快照         |

这些数值是各原子字段的相邻采样，不是整个 worker 的原子一致快照。正常缓冲区满/暂停也会处于 writing 或长时间不产出，需结合渲染状态、缓冲帧数和相邻样本。常规状态日志排除频繁变化的计数与阶段参与去重；完整即时字段仍在诊断导出中。原生 ring 新事件为 `decode_stop_requested`、`decode_read_failed`，应用日志新增 `audio-service-rpc-timeout`。

## 验证

- 三项确定性回归在修复前 HEAD 的真实类上全部失败：crash 监听器绕过退避、旧控制 finally 干扰新代请求、重叠 DSP ACK 混入全局 pending。修复后通过。
- `pnpm run test:audio-manager`：465 项通过，已把 DSP orchestrator 测试加入标准入口。
- 原生完整 CTest：49 项通过，1 项 ASIO 跨 DLL fixture 因本机条件跳过；FFmpeg、切歌、缓冲区、DSP 与性能测试通过。
- 新的阻塞解码模拟验证停止和 seek 取消，以及不经 clock 刷新的直接健康字段；真实 FFmpeg 本地文件验证取消后的 seek/读取恢复。
- `pnpm run test:audio-network-stall`：2 项真实 FFmpeg 测试通过。localhost HTTP 服务分别保持连接但不发送响应、发送 WAV 前缀后永久停止发送；分别验证打开与读取在其期限内结束并保留读取错误。探测也可能耗费时间，所以打开与读取期限分别验证。需要先构建真实 FFmpeg native 测试程序，路径可用 `TAE_NATIVE_TEST_DIR` 指定。
- 主进程和界面类型检查、定向 ESLint、electron-vite 构建与 renderer 资源预算检查通过。

## 交付与剩余边界

### Windows 复测安装包

2026-10-14 17:36（Asia/Shanghai）已生成 `dist/TwilightEcho-1.3.1-preview-setup.exe`，版本保持 `1.3.1-preview`，大小 146,861,434 字节（约 140.1 MiB）。同目录已重新生成 `.sha256`、`.blockmap` 和 `latest.yml`。

安装包 SHA-256：

```text
ec73399203bac82f0807ddda7d1efb0ae6f29a5e7eedc6db057cc3bca0a2454b
```

原生构建入口 `run-audio-engine-mingw.cjs build` 确认所有目标为最新构建，并重新暂存到隔离目录；`pnpm run build` 重新完成类型检查、应用构建、字体清理和 renderer 预算验证。使用 `TAE_AUDIO_ENGINE_STAGE_DIR` 调用标准 Windows release 打包流程，把隔离目录的本轮 DLL/addon/helper 合入完整资源，同时保留 VST3、SMTC、模型和运行库。

打包后的验证：

- Windows executable branding、241 个包的 JS 依赖闭包、6 个原生产品文件的 x64 架构/strip/体积及发布能力一致性检查均通过。
- 从实际 NSIS 安装包直接解出 `app.asar` 和音频资源；18 个音频资源文件与 `win-unpacked` 逐一哈希一致，主进程、音频服务和 preload 的 JS 与本轮 `out` 构建一致。
- 对本轮未 strip 的 DLL/addon/helper 副本执行同样的 strip，哈希与安装包内文件一致，排除误装旧开发 DLL。安装包内主 DLL 的 SHA-256 为 `096fa1c87709a2b63624d2ba1d651fecf323799e1d7a8e7c45495abfa9647f1b`。
- 使用包内 Electron 43.5.0 的 Node 模式加载实际从安装包解出的 addon，调用 `GetPlaybackInfo`；顶层及 `outputInfo` 的 diagnostics 均包含本轮新增的 12 个健康字段。此检查验证原生加载与诊断序列化，没有启动完整播放器或执行用户设备长时间播放。

完整本地核对结果保存在 `node_modules/.cache/issue132/package-verification.json`。可直接使用上述安装包复测 #132。

### 开发目录与现场复测边界

新版原生 DLL、Node addon 与 ASIO helper 已构建并暂存在 `node_modules/.cache/issue132/native`。将它们暂存到开发资源目录 `resources/audio-engine` 时，旧 DLL 被运行中的进程占用，复制因 EBUSY 失败；该目录仍为旧原生版本。新安装包已通过隔离暂存解决打包时的 DLL 占用。旧开发原生文件备份在 `node_modules/.cache/issue132/native-before`。应用主进程构建在 `out/main`。这些构建资产不纳入源码 diff。

关闭使用本工作区的播放器窗口及后台进程后，从仓库根目录执行以下命令，再启动开发版，即可让新版 JS 与新版原生文件同时生效：

```powershell
node scripts/stage-audio-engine.cjs --build-dir "$env:TAE_MINGW_BUILD_DIR"
```

本轮 Windows 安装包已同时包含新版 JS 与新版原生文件。开发版不要只更新 JS 后继续使用旧 DLL。

这是已复现缺陷的修复，以及远程阻塞候选路径的取消/期限补齐，不是报告第十三节首次无声的完整因果证明。同步预加载尚未迁移到独立 worker，仍可能在其有限 I/O 期限内占用 transport 锁。新的直接字段和停止原因用于继续区分读取断供、内部取消、渲染空帧与 clock 状态问题。

复测必须同时使用本轮 JS 与本轮 DLL。发生无声时，在停止/切歌前导出音频诊断，保留原生 ring；重点对照 streamToken、stage、缓冲/产出帧数、直接渲染计数和是否出现停止/退役事件。没有把本地测试结果作为用户设备长时间播放通过的证明，也没有发布版本或回复 GitHub issue。

## 十四、用户 1 诊断包复核（2026-10-14 14:45Z）

本节只记录用户 1 提供的 `TwilightEcho-diagnostics-2026-10-14T14-45-40-346Z.zip`。截图中另一位用户基于描述得出的“暂停淡出后增益没有恢复”是待验证假设，不能替代该包中的事件证据。

ZIP SHA-256 为 `c648627ae4d581bbe4b7c0da0adc04545d8e568d7cbb774c7660d8eff3140b2d`。清单中 14 个文件的校验值全部通过；没有导出缺失项、采集器失败、日志丢失或写盘错误。时间线含 23,312 项事件；27 条无效行不能当作有效证据。实际加载的 addon / DLL 哈希与上一轮交付的诊断安装包一致，排除了用户 1 使用旧原生文件的情况。导出是在重启后完成，因此当前进程快照不是故障时刻快照；本次以保留会话及问题标记为依据。已将白名单证据保存为 `docs/audit-evidence/issue-132-user1-diagnostics-2026-10-14.json`。

### 14.1 用户 1 的故障链

故障前的活动流为远程 FLAC（指纹 `c6b973f5b4b84f1c`，streamToken=8），音量在所有相关 `playback-state` 记录中均为 `0.33`：

| UTC | 证据 |
| --- | --- |
| 14:40:22.272 | streamToken=8 仍在 `writing`，缓冲 96000 帧，已产出 147456 帧。 |
| 14:40:24.014–14:40:25.071 | 解码阶段进入 `reading`；源消费计数仍短暂增加。 |
| 14:40:26.129 | 缓冲降为 0，源消费停在 38370452；`zeroFilledFrames` 开始增加，`emptyOutputCount` 为 89。 |
| 14:40:28.243–14:40:31.413 的有效样本 | 仍是 `playing + reading + decodeRunning`，源消费计数不变；回调继续，约每秒补 48000 帧零帧，空输出计数持续增加。 |
| 14:40:29.180 | 用户标记问题；标记快照中的 `decodeLastProgressAgeMs` 已为 5606 ms，音量仍为 0.33。 |
| 14:40:31.416 | 原生记录 `incident.empty-output`：缓冲 0、源帧未消费、回调仍完成、clock heartbeat 仍增长。 |
| 14:40:33.257 | FFmpeg `read` 返回 `-1414092869`（`AVERROR_EXIT`），记录 `timeoutOrCancel=true`；这与当前 10 秒远程 I/O 截止时间相符。 |
| 14:40:33.454 | 已准备好的 preload streamToken=9 被提升，约 0.3 秒后新音源开始产出。 |

这条链路说明该包中可确认的是**远程音源读取停顿导致解码缓冲耗尽，渲染回调继续运行但输出补零**。没有证据显示故障由音量被设为 0、Pause 淡出未清除、设备丢失或 DSP ACK 失败引起。服务代次也没有更换；相关 `GetPlaybackInfo` 请求持续完成。

14:40:27.185 和 14:40:32.475 的健康样本标为 `available=false / pipeline-lock-busy`，不据此判断解码状态。这一限制不影响前后有效样本显示的断供。约 50,400 帧是相邻约 1.05 秒采样之间的增量，对应 48 kHz 的实时补零速率。

从 14:37:06.875 的健康样本起，streamToken=8 已是 streamToken=7 的预加载流；14:40:20.971 才被提升，已闲置至少 **194.096 秒**。源码中的预加载 PCM ring 约为 2 秒，满后 `writeBlocking` 阻塞解码线程，因而不会持续读取其 HTTP 连接。切换后该流总产出只有 206,848 帧（48 kHz 下 **4.309 秒**），随后 `reading` 不再推进。这使“预加载连接长期闲置后断供”成为优先候选；日志没有 HTTP 服务端状态、TCP 证据或成功读包记录，尚不能确认具体 CDN、网络或连接错误。

问题标记中的界面位置为 7.686 秒，实际源消费只有 4.309 秒。`PlaybackController.resolveNativeTickPosition` 在原生位置停止、落后于软件位置时继续使用软件位置，解释了为何进度条还能前进。`underrun=0` 表示后端没有报告欠载；渲染回调按时交付了零帧，不代表源音频正常。`lastError` 为空同样不能否定 FFmpeg 错误，当前解码失败只写日志而未进入播放错误状态。

### 14.2 与截图假设的边界

截图描述的暂停 200 ms 淡出属于另一条候选链路。当前引擎的暂停记录会保留用户音量并标出 `perfectReasonCode=pause_fade_active`，恢复路径会清除临时淡出状态；用户 1 的故障窗口没有 Pause/Resume RPC，也没有 `SetVolume(0)`。因此不能用用户 1 的 ZIP 证明截图假设，也不能用截图假设解释用户 1 的远程读取停顿。

要验证第二位用户的假设，需要该用户在同一版本复现后导出 ZIP，并重点检查 Pause/Resume 前后的 `playback-state`、`pause_fade_active`、音量、streamToken、缓冲/产出计数以及是否出现输出配置应用事件。若恢复后状态为 `playing`、音量非零、解码和源消费继续增长但实际听感仍为数字静音，则还需要补充输出非静音帧计数才能把“增益为零”与“音频设备未发声”分开。

### 14.3 当前修复判断

这份包确认了 H1 的现场形态，并验证本轮加入的远程读取期限确实能结束 FFmpeg 阻塞；它没有证明 #132 的所有用户都由同一根因触发。当前 `FFmpegDecoder::decodeOneFrame` 在非 EOF 读取错误时也设置 `eof=true`；`DecodeStream::decodeLoop` 收到零帧后执行 `markEof()`，渲染路径因此把当前歌曲当作已结束并提升 preload。本次 239.213 秒的歌曲只消费了约 4.309 秒就被截断。超时释放了阻塞，却没有保证当前歌曲继续播放，这是已确认的客户端缺陷。

下一步修复需将 **正常 EOF、读取失败、主动取消** 分开，保留取消和 I/O 期限，在工作线程上处理同一首歌的可控重连/错误上报，并检查预加载与长期暂停后的连接恢复。断供期间的位置和状态应反映真实源消费。提前切到下一首会继续丢掉当前歌曲，不能作为这条链路的正确修复。诊断线程保持只采集、不恢复。

### 14.4 本地受控复现与对照

使用上一轮隔离暂存的真实 addon、FFmpeg 与 Windows WASAPI 共享输出，测试进程音量为 0；未操作正在运行的用户播放器。队列为本地 12 秒 WAV → 远程 180 秒 WAV → 本地 30 秒 WAV。HTTP 服务支持 Range，并在 TCP 写入出现反压时暂停供数。

| 场景 | 控制条件 | 实际结果 |
| --- | --- | --- |
| 健康连接 | 反压消失后继续发送数据。 | 远程流在预加载后正常消费，至测试结束没有有效断供样本，没有 FFmpeg 错误，也没有提前切歌。 |
| 模拟闲置后断供 | 写入反压持续 3 秒后，测试服务停止供数，但保持 TCP 连接且不发送 EOF。 | 远程流消费 376,832 帧（7.851 秒）后耗尽；32 个 250 ms 的有效快照显示 `reading + buffer=0`、源消费不增、回调增加。独立 sampler 记录 `incident.empty-output`；读取约 10 秒后返回 `AVERROR_EXIT`，提前进入第三首，`lastError` 仍为空。 |

第二种场景与用户 1 的原生事件顺序一致。它证明真实引擎遇到这种连接故障会产生该现场形态，并暴露错误归为 EOF 的行为；**模拟的 3 秒服务端闲置策略不是用户 CDN 的实测策略**，不能据此断言外部断供的具体原因。两次服务均出现两次 HTTP Range 请求，第二次从 WAV 数据起始偏移 44 开始；源码的持续连接读取在预加载 ring 填满后受到反压。

原始测试数据和脚本保存在本地 `node_modules/.cache/issue132/preload-idle-probe.cjs`、`idle-healthy-1791992898723/result.json`、`idle-stale-1791992920200/result.json`，供本工作区复查。测试摘要另存 `docs/audit-evidence/issue-132-investigation-tests-2026-10-14.json`。

### 14.5 暂停与输出配置假设的测试边界

重新运行 `twilight_runtime_queue_reroute_tests.exe` 的全部 137 个用例，退出码为 0。另用真实 pipeline / engine 和已有 fake backend 测试三个顺序：暂停淡出时提交配置、暂停完成后提交配置、恢复后提交配置；分别覆盖 `wasapi`、`wasapi-exclusive`、`asio`，九种组合全部恢复到预期信号幅度 `0.25 × 0.6 = 0.15`，用户音量保持 0.6，`pause_fade_active` 消失。

测试向暂停状态注入相当于 33 分钟的回调帧，验证暂停不消费源帧且恢复后有信号；另外验证 8 声道 / 96 kHz 的 PauseFade 在淡出完成后清除即可恢复原幅度。**这是压缩执行的回调帧测试，不是 33 分钟墙钟暂停测试；fake backend 也不代表用户的虚拟声卡、驱动或 Windows 会话音量。** 本地测试没有复现截图所说的永久零增益，不能因此排除用户 2 的现场故障。

源码恢复路径 `AudioPipeline::togglePause` 在发布 `Playing` 前已执行 `pauseFade_.clear()`；主进程输出事务保存并恢复用户音量，配置与暂停/音量操作共用串行入口。单独的 `output-config-applied` 是配置 revision 的应用通知，不能当作设备确实重开的证据。若用户 2 的原始包确认源帧持续消费而声音仍为零，下一步应采集实际应用音量、淡出剩余帧/增益、输出信号峰值或非零帧计数，并核对真实路由及 Windows 会话音量；现有计数无法区分所有这些情形。

本轮新增调查文档及白名单证据，没有修改播放或音量业务逻辑，也没有生成新的安装包。用户 2 还需提供故障当时的完整诊断 ZIP，最好在停止、切歌或重启之前标记问题并导出；截图中的 AI 结论按待验证假设处理。

## 15. 2026-10-15：远程断供恢复与错误分类修复

本节记录用户授权后的实际修复，保留此前的常驻诊断、界面样式及工作区其他修改。目标是修复用户 1 已确认的客户端故障链；用户 2 的永久零增益假设仍缺少原始诊断包，不能据此声称已经修复其现场故障。

### 15.1 修复行为

- FFmpeg 的正常 EOF、读取/解码失败和主动取消分开处理。非 EOF 错误缓存为终止读取错误，后续读取仍返回同一错误，不能转为正常 EOF。成功跳转或重新打开后清除该错误。
- 有限时长的 HTTP/HTTPS PCM 音源遇到读取失败时，在解码工作线程上最多重连两次。重新验证音源格式及长度、恢复输出格式和重采样配置，并从“已经写入 ring 的下一源帧”精确恢复，保留缓冲中的有效音频；不能从落后的渲染位置重播已排队的样本。
- ring 写入因预加载或暂停阻塞至少 5 秒后，在消费恢复时主动刷新远程连接。缓冲中的约 2 秒 PCM 提供播放前置数据，控制及实时回调线程不执行网络重连。普通播放不会因这项策略周期性重开连接。
- 单次故障最多两次重连，只有再次成功产出至少 5 秒 PCM 才恢复重试额度。保留既有打开、探测、跳转和读取的有限 I/O 预算，停止、切歌和跳转可取消重连；被取消的打开如果关闭了旧解码上下文，后续跳转会先恢复有效上下文。
- 不对没有稳定时长的直播或 DSD 流应用 PCM 重连。不能恢复的读取失败在有效缓冲耗尽后停止当前歌曲，保留队列位置和错误，报告 `end-file: error`，不会自动提升下一首，也不会触发正常 EOF 的睡眠计时边界。
- 原生有效采样确认 `playing + reading/reconnecting + ring=0` 时，界面进度使用实际源消费位置。最终读取错误也采用实际位置，并清除同一音源尚未确认的跳转目标。
- 错误停止后，用户主动点击播放按钮会从最后消费位置重新打开原曲；状态轮询和取证采样不会触发这次重试。

重连的诊断事件包括 `decode.connection-idle`、`decode.reconnect.start/complete/failed` 和 `decode.failed`，关联 streamToken、尝试次数、恢复帧及耗时。健康采样新增 `decodeStage=reconnecting`。独立诊断线程仍只负责取证。

### 15.2 可重复的验证入口

新增 `scripts/audio-remote-recovery.test.cjs`，由独立 Node 进程加载实际 addon/DLL，在静音 WASAPI 共享输出下播放。测试 HTTP 服务保持失效 TCP 连接打开、不发 EOF，支持 Range，并使恢复连接正常或返回 503。初始 WAV 探测请求及从偏移 44 开始的数据请求归属同一故障阶段，避免只对被 FFmpeg 放弃的探测连接注入故障。

在 Windows PowerShell 中指定隔离编译目录后运行：

```powershell
$env:TAE_AUDIO_NODE = 'D:/Project/Twilight_Echo/node_modules/.cache/issue132-recovery/native/twilight_audio_node.node'
pnpm run test:audio-remote-recovery
```

`TAE_REMOTE_RECOVERY_EVIDENCE` 可指定独立结果目录；`TAE_RECOVERY_PRELOAD_SECONDS=210` 配合 `node --test --test-name-pattern=preload-idle scripts/audio-remote-recovery.test.cjs` 验证超过用户现场 194 秒的预加载闲置。测试服务的闲置断供规则是受控故障注入，不是用户 CDN 策略的实测结果。

### 15.3 验证结果

| 验证 | 结果 |
| --- | --- |
| 原生 CTest | 50 项注册，49 项通过，1 项可选 ASIO 跨 DLL 测试跳过；运行时 executable 完成 140 个场景。 |
| 精确重连续播 | fake decoder 注入零帧失败及带有效尾帧的失败，逐帧核对 65,536 个连续输出帧，没有重复或漏帧。 |
| 取消重连 | 阻塞的重新打开可被停止及跳转在 300 ms 内取消；跳转会恢复被关闭的上下文。 |
| 真实 FFmpeg I/O 期限 | 打开和读取不返回的网络探针均通过；读取失败保持非 EOF。 |
| 真实 HTTP 断供 | 预加载连接失效、暂停后失效、读取超时和持续失败，四种场景全部通过；安装包实际 DLL 也全部通过。 |
| 长时间预加载 | 210 秒本地曲目的播放期间，远程预加载连接模拟失效；提升后从第 96,256 帧刷新，42 ms 内恢复，继续同一首歌至 14.13 秒，无提前切歌。 |
| 持续网络故障 | 原曲停在 10.922667 秒；两次重连均失败后保持 queueIndex=0，lastError 非空，没有进入下一首。 |
| 主进程音频管理 | 469/469，通过断供进度、错误边界、待确认跳转、用户主动重试及原有服务/DSP/队列回归。 |
| 渲染及播放路由 | 767/767，通过；前端只对 `reason=eof` 进行正常自动推进。 |
| 静态及构建检查 | Node/Vue 类型检查、变更文件 ESLint、diff whitespace 检查、生产构建及渲染预算通过。 |

构建与测试并发的一次音频管理运行中，原有 service-client 时间阈值测试失败（replacement probe 次数尚未达到断言值）；保留该次日志为 `audio-manager-recovery-timing-failure.log`，在构建结束后完整重跑 469 项通过。没有修改该测试或服务超时行为。

从安装包提取的 DLL 在独立静音 WASAPI 共享进程中额外连续播放 **300.377 秒**。有效健康证据覆盖 298.609 秒，共 297 个采样，最大间隔 1045 ms；空输出异常和补零为 0，日志丢失为 0，最大队列 9687 字节，磁盘增长 3,183,844 字节（约 0.61 MiB/分钟）。最后定期样本的平均回调耗时为 14.997 µs、峰值 205 µs、deadline 占用 0.150%，没有 deadline miss。本轮是 5 分钟播放检查；此前日志交付的 30 分钟基线结果仍保留在 `docs/diagnostics-validation-2026-10-14.md`，不将旧结果冒充为新 DLL 的 30 分钟测试。

### 15.4 Windows 复测交付

- 安装包：`dist/TwilightEcho-1.3.1-preview-setup.exe`，同名文件已重新生成。
- SHA-256：`cf4b113c2008ccd470d7f016daaa393996a49f40583d350ce74bff41b193ccaf`。
- 校验文件：`dist/TwilightEcho-1.3.1-preview-setup.exe.sha256`。
- 包内 DLL：`bba6b3e4bb480d702537145b91fa86030f81dcee995377029c622ec5f7be637f`。
- 包内 addon：`4c4d18d24a040b40bdb72505582adc4cd8ffab87522a0f70efc688becc693f6f`。N-API 接口没有变化，去除符号后的 addon 与上一轮相同；引擎 DLL 已更新。

从最终 NSIS 包提取实际资源，以隔离配置运行；主进程与日志 worker 的字节内容与生产构建完全一致，DLL/addon 的身份与诊断 ZIP 内记录相符，且与新编译文件去除符号后的哈希一致。人工标记、真实前端异常、独立原生采样、日志 worker 的 asar 加载、秘密信息脱敏、可信 IPC 来源校验及逐文件 ZIP 校验全部通过。最终导出含 370 条有效事件，无采集失败、日志丢失或写盘错误；无效行按清单计数保留，不能作为证据使用。发布过程完成原生去符号、244 个生产依赖闭包及 Windows 品牌检查。

验证摘要、重连事件、原生身份和诊断包结果保存为 `docs/audit-evidence/issue-132-recovery-2026-10-15.json`。详细 HTTP 结果及包内运行证据保留在本地 `node_modules/.cache/issue132-recovery/`。没有停止用户播放器、覆盖运行中的 DLL 或修改用户安装配置。

请两位用户用新包复测。若仍无声，在切歌、停止或重启之前标记问题并导出完整诊断 ZIP；用户 2 的包可用于区分源读取断供、增益状态及实际输出路由问题。只有用户现场复测才能确认其问题已经消失。
