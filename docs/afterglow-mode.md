# Afterglow（余晖模式）

> 界面退场，音乐继续。Twilight Echo 把 UI 渲染器全部卸载以释放内存，由原生音频引擎
> 继续播放；托盘、媒体键、系统媒体控制和局域网遥控仍可操作。

## 使用

设置 → **系统与关于 → 运行与性能 → 余晖模式（Afterglow）**：

- **立即进入**：手动卸载界面。
- **自动进入**：可选「仅最小化时 / 仅隐藏到托盘时 / 最小化或隐藏时」，默认关闭。

恢复方式（任选）：

- 托盘菜单「恢复界面（快捷键）」
- 单击/双击托盘图标
- `Ctrl/⌘+Shift+E`（被其他程序占用时自动回退到 `Ctrl/⌘+Shift+Alt+E`、`Ctrl/⌘+Alt+Shift+Backspace`，托盘菜单会显示实际可用的组合）
- 再次启动应用（单实例会唤起恢复）
- Windows：从任务栏图标恢复（仅「最小化自动进入」时保留任务栏入口）
- macOS：Dock `activate`

不需要打开设置也能从托盘进入：托盘菜单第一项「进入余晖模式（后台播放）」；不满足条件时会弹系统通知说明原因（例如"队列里有流媒体或不可用文件"）。

## 能进入的条件

余晖只处理**原生引擎已经完整接管**的播放，避免出现"界面没了、控制也没了"：

| 条件                                                        | 不满足时                      |
| ----------------------------------------------------------- | ----------------------------- |
| 原生输出（非渲染器 WebAudio 兜底）                          | 保持界面常驻                  |
| 原生播放处于 playing/paused 且宿主 ready                    | 保持界面常驻                  |
| **引擎实际加载的源**可继续播放：本机文件、CUE、`http(s)` 流 | 保持界面常驻，并提示"第 N 首" |
| 当前播放能映射回逻辑队列                                    | 保持界面常驻                  |
| 能注册到恢复快捷键（自动进入时允许无快捷键，靠托盘恢复）    | 手动进入会失败                |

不需要「播放记忆」：渲染器在卸载前会把队列快照交给主进程，只保存在内存里；恢复后由渲染器接管，不会写入续播记录。若开启了播放记忆，主进程仍会顺带维护进度，意外退出后可按原设置恢复。**快照会先转成纯 JSON**（Vue reactive proxy 不能被 structured clone，否则会报“保存播放状态失败”）；**磁盘持久化失败不会阻止进入**：快照先交接，播放状态/队列的落盘只是 best-effort。

**在线队列**：原生引擎支持 `queueHotUpdate`（capability）时，主进程 `AfterglowQueueCore` 会在后台按需解析后续曲目并热追加/刷新 URL，不需要重建队列；解析失败、断网或旧引擎不具备该能力时，退回"窗口"模式：只播引擎已加载的当前 + 下一首。本地队列仍然是完整离线播放。

**队列播完或播放停止**（包括在线 URL 失败、用户主动停止）后约 6 秒自动恢复界面，不会留下不可见的停止播放器；单曲队列播完也会回到界面。

失败会返回结构化原因（IPC 状态里的 `error`），设置页和托盘通知都会显示可读说明；队列相关失败会带序号，例如"队列里有无法在后台继续的音源（队列第 12 首）"。

> CUE 专辑已支持。若在线队列的窗口只有 1 首，进入后会自动在播完时恢复界面，不会留下不可见的停止播放器。

## 恢复时发生什么

1. 主进程写回当前曲目/进度/播放模式，重建主窗口（带 `afterglowRestore=1`）。
2. 渲染器**采纳（adopt）** 引擎实时状态：队列、当前曲目、进度、播放态、音量、倍速。
3. 渲染器**不会**调用 `loadQueue` / `play`，因此不会中断正在播放的音频，也不会出现音量跳变。
4. 恢复原页面（导航会话保存在 localStorage）、按需恢复桌面歌词/迷你播放器。
5. 恢复失败时回到「已卸载」状态并保留恢复入口，不会把用户困住。

## 卸载期间仍然可用

- 托盘：上一首/播放暂停/下一首/播放模式（顺序、列表循环、单曲循环）/音量
- 全局快捷键与媒体键
- Windows SMTC（系统媒体弹窗、蓝牙耳机按键）
- 局域网遥控（播放/暂停/切歌/进度/音量/播放模式与封面；队列编辑类命令需要恢复界面）
- Discord 听歌状态（启用时）
- 睡眠定时器

## 已知限制

- 卸载期间不提供：喜欢按钮、心动模式、随机模式编辑、桌面歌词/迷你播放器窗口、任务栏缩略图按钮。
- 听歌统计在卸载期间暂停；遥测仍由主进程记录。
- 只卸载 UI 渲染器；原生音频服务、主进程与（启用时的）GPU 进程继续运行。
- 在线队列依赖 provider 的 `getPlaybackUrl`（当前支持 NCM 等实现了该能力的插件）；解析失败/断网时播完已加载窗口后自动恢复界面。原生层已具备不重建队列的热更新契约（见 `afterglow-queue-hot-update.md`）。
- CUE 专辑已支持；无法映射回逻辑队列的异常状态会被拒绝。

## 实现位置

| 层                                   | 文件                                                                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 契约/纯函数                          | `src/shared/afterglowMode.ts`                                                                                                    |
| 生命周期                             | `src/main/app/AfterglowModeService.ts`                                                                                           |
| 无渲染器传输                         | `src/main/app/rendererFreePlayback.ts`                                                                                           |
| 状态快照（托盘/SMTC/远程/Discord）   | `src/main/app/afterglowSnapshot.ts`                                                                                              |
| 会话写回                             | `src/main/app/playbackSessionService.ts`                                                                                         |
| Windows anchor（任务栏 + SMTC 句柄） | `src/main/app/afterglowAnchorWindow.ts`                                                                                          |
| IPC/preload                          | `src/main/ipc/afterglowModeIpc.ts`、`src/preload/domains/afterglowApi.ts`                                                        |
| 渲染器采纳                           | `src/renderer/src/stores/usePlayerStore.ts`（`adoptAfterglowRestore`）、`src/renderer/src/utils/nativeQueueLoader.ts`（`adopt`） |
| 设置界面                             | `src/renderer/src/components/settings-page/AfterglowSettingsSection.vue`                                                         |
| 原生队列热更新                       | `audio-engine` 的 `AppendQueueItems` / `UpdateQueueItemSource` / `GetQueueState`；契约见 `docs/afterglow-queue-hot-update.md`    |
| 在线队列维护（core）                 | `src/main/app/afterglowQueueCore.ts`（lookahead/TTL/映射）、`afterglowSourceResolver.ts`（provider → 原生源）                    |
| 设计与对照                           | `docs/afterglow-design.md`                                                                                                       |

## 验证

```bash
pnpm test:afterglow
pnpm typecheck
```

真机验收建议：本机文件队列播放中手动进入 → 托盘切歌/调音量/媒体键 → 按恢复快捷键 →
检查页面/曲目/进度/播放态/音量/倍速与引擎一致，且日志中没有新的 `LoadQueue`。
