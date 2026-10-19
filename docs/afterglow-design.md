# Afterglow（余晖模式）设计——对照 ECHO Ultralight

> 对照项目：`D:\Project\ECHO`（社区版 Ultralight，见 `docs/ultralight-community.md`）
> 目标项目：Twilight Echo（Electron 43.5.0 + Vue 3 + 原生音频引擎 utility process）
> 状态：**已实现并定名 Afterglow（余晖）**；代码标识符统一为 `afterglow*`，本文第 1 章描述的是 ECHO 的 Ultralight 原型，后续章节的设计已按 Afterglow 落地。
> 说明：第 2 章之后的代码块与文件路径已按最终命名更新；若仍有 `UltraLight*` 字样，属于设计阶段的旧称或对 ECHO 原型的引用，当前实现请以 [`docs/afterglow-mode.md`](afterglow-mode.md) 为准。

---

## 1. ECHO 的 Ultralight 到底是什么

### 1.1 一句话定义

把**所有 UI 渲染器卸载**（销毁主窗口、桌面歌词、迷你播放器、宠物窗口），播放完全交给主进程里的 **Audio Core（原生宿主）**；期间保留一套**无渲染器的控制面**（托盘、全局快捷键、媒体键、Windows SMTC、任务栏恢复窗口），用户需要界面时**重建窗口并采纳实时状态**，而不是从磁盘回放。

关键不变量（这决定了它和「隐藏到托盘」的本质区别）：

1. **播放权威在原生宿主**，渲染器只是观察者/控制器。
2. **会话权威在磁盘**（主进程持续写回当前曲目/队列位置）。
3. **恢复 = 重建 + 采纳**（adopt），不是「重新启动播放」。
4. 不满足条件的播放**保持常驻**，不允许"能进不能出"。

### 1.2 进入条件（`getRendererUnloadPlaybackRejection`，`UltraLightModeService.ts:1019-1048`）

| 条件                                                                       | 不满足时的错误码                                                      |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 输出不是 `system`（必须走原生输出）                                        | `tray_renderer_unload_requires_native_output`                         |
| 原生宿主 ready（`state` 为 playing/loading/paused 时 `host` 必须 `ready`） | `...requires_ready_native_host`                                       |
| 整个队列都是本地文件（非 URL、非 unavailable）                             | `...requires_fully_local_queue`                                       |
| 队列中无无法解析的 CUE 分段                                                | `...rejects_unresolved_cue_queue`                                     |
| 当前播放项能映射到队列项                                                   | `...requires_local_queue_item`                                        |
| 自动进入时窗口必须已最小化/隐藏                                            | `background_renderer_unload_requires_minimized_or_hidden_main_window` |

### 1.3 进入流程（`performEntry`，`UltraLightModeService.ts:302-431`）

1. `phase='entering'`，取 `generation`，取消后台恢复定时器。
2. `syncQueueForRendererUnload()`：把持久化队列交给原生宿主（`syncQueueToBackend`）。
3. 再次校验（交接过期中用户可能已切歌/切输出）。
4. 注册恢复快捷键 `CommandOrControl+Shift+E`；注册媒体键兜底。
5. `ensureTray()`（Ultralight 期间托盘是一等控制面）。
6. `saveResumeFromAudioStatus()`：把当前播放位置/状态写入持久化会话。
7. `bindAudioStatusPersistence()`：主进程订阅 Audio Core `status`，持续写回会话 + 处理 `ended`。
8. `phase='active'`。
9. `minimize-auto` 时创建**渲染器无关的任务栏恢复窗口**（`BaseWindow`）。
10. `manual` 时获取后台暂停租约（暂停可重建的后台任务）。
11. 80ms 后 `destroyAllUiWindows()`：关 devtools、桌面歌词、迷你播放器、宠物窗口，然后 `destroy()` 所有剩余 `BrowserWindow`，再做一次可重建内存释放。

并发/失败：`isCurrentEntry(generation)` 在每个 await 之后重新确认；失败走 `fail()` 回滚 phase、注销快捷键、销毁恢复窗口、释放暂停租约。

### 1.4 Ultralight 期间的控制面

- **命令派发** `dispatch(action)`（`:598-688`）：15 个 `rendererFreeActions`（播放/暂停/上一首/下一首/停止/音量/快进快退/喜欢/随机/循环/静音/bossKey/倍速）直接调用 Audio Core；其余动作先 `restore()` 再转发给渲染器。
- **结构化控制** `control(request)`（`:768-809`）：动态岛、桌面歌词等辅助界面原本发给主窗口的 `MainWindowPlaybackControlRequest` 在这里被无渲染器实现。
- **播放推进**（`bindAudioStatusPersistence`，`:1164-1221`）：只在 Audio Core 确认 `ended` 且主窗口不存在时，按 `selectAdjacentItem()` 选下一首 → `playQueueItem()`；同时把宿主换曲写回会话。
- **任务栏**（`UltraLightTaskbarRestoreWindow.ts`）：一个透明、离屏、最小化的 `BaseWindow`，用原生 `ITaskbarList3` 提供缩略图按钮；`restore` 事件触发恢复。
- **SMTC**（`SmtcStatusSync.ts:316`）：`isUltraLightModeActive()` 时改走 `dispatchUltraLightModeSmtcCommand`。
- **后台任务**：`acquireBackgroundPauseLease('manual-ultralite')`，恢复后 `releaseBackgroundPauseLease`。

### 1.5 恢复流程（`restore`，`:433-596`）

1. `phase='restoring'`，`restoreAttemptId++`，合并并发恢复请求。
2. 写回 resume、解绑状态监听、注销自己注册的快捷键。
3. GPU 运行时变体：`app.relaunch()` 后退出（见 §1.7）。
4. `createMainWindow({ afterglowRestore: true })` → `ready-to-show` → 显示 → `waitForRendererStartupReady()`（探测 `data-echo-startup="ready"`，15s 超时）。
5. 恢复辅助窗口（桌面歌词/迷你播放器/宠物）→ 延迟释放后台暂停租约。
6. 恢复失败：`phase='active'` + 重新注册快捷键/媒体键，保持可再次恢复。

### 1.6 渲染器侧的配合点（ECHO）

- URL 带 `?afterglowRestore=1`（`ultraLightMode.ts`，`createMainWindow.ts:288-292`）。
- 启动遮罩跳过最短展示延时（`startupOverlay.ts:90`）。
- 恢复时**不重新套用持久化的音量/倍速**（`PlayerVolumeControl.tsx:160`、`PlayerSpeedControl.tsx:177`），避免在宿主正在播放时产生一次音量跳变。
- 恢复前用 `executeJavaScript` 把当前路由写进 `localStorage`（`:1288`），重建后回到原页面。
- `AppLayout` 通过 `isAfterglowRendererRestore()` 决定音频 hydration 策略。

### 1.7 ECHO 里**不建议**照搬的部分

- **GPU 变体**（`ultraLightGpuDisabled` → `app.relaunch` + `--echo-ultra-light-gpu-runtime`）：它把"进入/退出"变成整进程重启，必须额外处理单实例管道竞争、播放恢复重试、失败回退。Twilight Echo 的 DSP/输出事务和 audio service 恢复顺序远比 ECHO 复杂，收益（省 GPU 进程）不抵风险。
- **原生任务栏缩略图**（`TaskbarThumbnailCoverController` 依赖自研 native addon）。
- **宠物窗口 / 库 worker 常驻**：Twilight Echo 没有对应结构。
- **tray load-shedding 三级清理**：Twilight Echo 的后台任务由 utility process 承担，结构不同。

---

## 2. Twilight Echo 现状盘点

### 2.1 已经具备的地基（这是可行的关键）

| 能力                        | 位置                                                                                                           | 说明                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 原生音频引擎独立进程        | `src/main/audioEngineServiceClient.ts`（`utilityProcess.fork`）、`src/main/audio/playbackController.ts`        | 渲染器销毁不影响播放；引擎在 utility process 里                  |
| 主进程持有原生队列          | `AudioEngineManager.queue` / `PlaybackController.queue`                                                        | 渲染器 `loadQueue` 后队列常驻主进程与引擎                        |
| 原生队列可自行换曲          | `playbackController.ts:1542-1559`（"A fully delegated native queue advances without a renderer EOF callback"） | 全量队列委托后，换曲不依赖渲染器                                 |
| **引擎时钟在主进程**        | `AudioEngineManager.startClock()`（`audioEngineManager.ts:723`）→ `playback.startClock()`（250ms `tick`）      | 渲染器不是 tick 的驱动者，窗口销毁后换曲/进度照样推进            |
| **主进程拿到 4Hz 播放状态** | `engineIpc.ts:826-833`（`'playback-info'`）                                                                    | 快照层直接订阅同一事件即可，无需新轮询                           |
| 播放会话主进程持久化        | `src/main/ipc/persistenceIpc.ts`、`src/main/persistence/playbackSessionStorage.ts`                             | `playback-session.json` + `playback-queue.json`，带 revision CAS |
| 关闭前落盘协调              | `src/main/app/window.ts:46-68`（`requestRendererPlaybackSessionSave`）、`src/renderer/src/App.vue:816`         | 主进程发 `app:save-playback-session`，渲染器 flush 后回调        |
| 托盘                        | `src/main/integrations/shortcutsTray.ts`                                                                       | 菜单含上一首/播放/下一首/播放模式/桌面歌词/迷你播放器            |
| 全局快捷键/媒体键           | 同上 `handleGlobalShortcutAction`                                                                              | 目前统一转发渲染器                                               |
| Windows SMTC                | `src/main/integrations/windowsSmtc.ts`                                                                         | **绑定主窗口 HWND**（`initializeWindowsSmtc`）                   |
| 任务栏缩略图                | `src/main/integrations/taskbarThumbar.ts`                                                                      | 绑定主窗口                                                       |
| 卫星窗口                    | `desktopLyrics.ts` / `miniPlayer.ts` / `dynamicIsland.ts` / `trayPlayer.ts`                                    | 各自有 destroy/show                                              |
| 界面记忆                    | `src/renderer/src/app/navigationSession.ts`（localStorage `twilight-echo:navigation-session:v1`）              | 窗口重建后自动回原页面                                           |
| 睡眠定时器                  | `src/main/sleepTimer.ts`（主进程）                                                                             | Afterglow 期间照常工作                                           |
| 原生引擎操作入口            | `src/main/audio/engineIpc.ts` 的 handler 内部逻辑                                                              | 全是 `ensureAudioEngineRuntime()` 直调，**只差一层可复用封装**   |

### 2.2 缺口清单（必须补的）

1. **主进程没有播放控制执行层**：所有命令都是 `webContents.send('player:shortcut' | 'miniPlayer:command')`（`shortcutsTray.ts:33`、`miniPlayer.ts:53`、`trayPlayer.ts:53`、`windowsSmtc.ts:49`、`remoteIpc.ts:70`）。主窗口不存在 = 全部门控失效。
2. **主进程没有播放状态快照**：`runtime.latestMiniPlayerState` 完全由渲染器 `miniPlayer:publishState` 推上来（`miniPlayer.ts:464-481`），托盘/SMTC/缩略图/托盘播放器全依赖它。
3. **主进程不写回播放会话**：只有渲染器写。
4. **销毁主窗口会顺手销毁 SMTC 和缩略图**（`window.ts:231-235`），而 SMTC 的 HWND 就是主窗口。
5. **`window-all-closed` 直接退出**（`lifecycle.ts:425-429`）。
6. **渲染器恢复时会"重放"状态**：
   - `onReady` 回调无条件 `syncSoftwareVolumeToEngine()` + `setPlaybackRate()`（`usePlayerStore.ts:2822-2836`）；
   - `restoredPlaybackPending` 会让 `applyNativePlaybackInfo` 在第一次事件时直接返回（`usePlayerStore.ts:1443`）；
   - `NativeQueueLoader.committed`（token → 逻辑索引映射）随渲染器消失（`nativeQueueLoader.ts:18-66`）；
   - 冷启动语义是"恢复曲目但暂停"（`playbackSessionController.ts` 的 `prepareQueueSelection` 置 `isPlaying=false`）。
7. **没有队列/窗口的生命周期状态机**：现有 `runtime.forceQuit` / `closingAfterPlaybackSessionSave` 只覆盖退出与关闭两条路径。

### 2.3 与 ECHO 的机制差异（决定了哪些必须改写）

| 维度           | ECHO                                      | Twilight Echo                                                        | 影响                                             |
| -------------- | ----------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------ |
| 音频宿主       | Audio Core（独立宿主进程）                | audio service（utility process）                                     | 都天然免疫窗口销毁 ✅                            |
| 播放状态来源   | `getAudioSession().getStatus()`           | `AudioEngineManager` + `runtime.latestMiniPlayerState`（渲染器推送） | **必须新增主进程快照器**                         |
| 会话持久化     | `getPlaybackSessionStore()`（主进程单例） | `persistenceIpc` 内部闭包 store                                      | **必须抽成单例供主进程复用**                     |
| SMTC           | 独立 native host 进程                     | native addon + 窗口 HWND                                             | 需要 anchor 窗口重绑                             |
| 任务栏恢复入口 | 原生缩略图 BaseWindow                     | Electron `setThumbarButtons`（窗口级）                               | Afterglow 期间缩略图按钮不可用，用 anchor + 托盘 |
| 控制路由       | 统一 `dispatch()` 抽象                    | 5 处独立 `webContents.send`                                          | 需要统一抽象后各处改路由                         |
| 恢复状态       | Audio Core 为主，`restore` 时回填         | 渲染器 store 自持                                                    | 需要 `adopt` 通道                                |

---

## 3. 目标设计

### 3.1 形态

```
                ┌──────────────────────────── main（Electron 主进程）────────────────────────────┐
托盘 / 媒体键 /   │  AfterglowModeService（phase: inactive→entering→active→restoring）              │
SMTC / 远程控制 ─►│      ├─ canEnterAfterglow()      校验（本地队列/原生输出/queue 已全量委托）      │
                │      ├─ RendererFreePlayback      dispatch()：直调 AudioEngineManager            │
                │      ├─ AfterglowSnapshot        buildSnapshot()：写 runtime.latestMiniPlayerState│
                │      ├─ PlaybackSessionService    主进程读写 playback-session.json（CAS）         │
                │      └─ AfterglowAnchorWindow    Windows：BaseWindow（任务栏 + SMTC HWND）       │
                └───────────────────────────────────┬──────────────────────────────────────────────┘
                                                    │ utilityProcess.fork
                                       ┌────────────▼─────────────┐
                                       │ audio service（原生引擎） │  播放/换曲 100% 不依赖窗口
                                       └──────────────────────────┘
```

### 3.2 不变量（写成测试）

1. `phase !== 'inactive'` 时 `runtime.mainWindow === null` 是**合法状态**，任何代码不得因此 panic 或退出。
2. Afterglow 期间任何播放命令**不得**依赖 `webContents`。
3. `restore` 完成前不得把 `phase` 置回 `inactive`；恢复失败必须回到 `active` 且保留恢复入口。
4. 进入被拒绝时，播放状态、窗口、快捷键、托盘**零副作用**。
5. 恢复后的渲染器显示的曲目/进度/播放态，以**引擎实时状态**为准，而非磁盘快照。

### 3.3 进入条件（Twilight Echo 版）

在 ECHO 基础上适配：

| 条件                                                    | 判定方式                                                                                                                                                                                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 原生引擎存在且 ready                                    | `runtime.audioEngineManager` 非空 + audio service 未崩溃（复用 `audioEngineReady` 的主进程侧等价物）                                                                                                                                                          |
| 非 `system` 输出（Twilight 用 WebAudio 兜底时禁止进入） | `rendererFallbackAllowed()` 为 false，且引擎 `nativePlaybackActive`                                                                                                                                                                                           |
| 队列源可继续播放                                        | 以**引擎实际加载的源**为准：`isAfterglowPlayableSource` 接受本地文件（盘符、UNC、POSIX、`file://`、CUE 文件）与 `http(s)` 流；拒绝 `twilight-media://`、blob、data。渲染层 `streamUrl` 可能仍是 `twilight-media://`，但主进程已解析成缓存/远端 URL 时不应误杀 |
| 当前项可映射                                            | `resolveAfterglowEngineMapping()` 把每个引擎条目映射回逻辑队列：全量委托用恒等映射，在线队列用渲染器快照里的 `nativeQueueIndices`（`NativeQueueLoader` 的 `queueIndices`），缺失时按 id/source 回退；当前引擎项必须映射成功                                   |
| 队列窗口                                                | 引擎队列可以短于逻辑队列（在线队列通常只有当前+下一首）。窗口模式下播完加载项会停止，服务在 6 秒后自动恢复界面（`AFTERGLOW_WINDOWED_AUTO_RESTORE_DELAY_MS`）                                                                                                  |
| 会话里有**队列快照**                                    | 渲染器卸载前通过 `app:afterglow:publishRendererSnapshot` 交给主进程（内存，不落盘）；`parseAfterglowRendererSnapshot` 校验非空、索引范围与可选的 `nativeQueueIndices`                                                                                         |
| 无进行中的 service crash / 恢复                         | `audioEngineRecoveryNotice === null` 的主进程等价位                                                                                                                                                                                                           |
| 不依赖播放记忆                                          | 渲染器在卸载前把队列快照交给主进程，仅保存在内存；播放记忆关闭时不会写续播记录                                                                                                                                                                                |

> 判定原则：**引擎能独立继续的源 + 能映射回逻辑队列**即可进入；不再要求整条队列离线。拒绝时给出"第 N 首"细节；窗口模式会自动恢复 UI。

### 3.4 进入流程（Twilight Echo 版）

```
enter(mode: 'manual'|'minimize-auto'|'hide-auto')
 1. 幂等：entryCompletion / isActive() 直接返回
 2. canEnterAfterglow() → 拒绝则 fail(reason)（零副作用）
 3. await flushRendererSession()            // 复用 requestRendererPlaybackSessionSave()
                                            //   渲染器会 flush 导航会话 + 播放会话 + 音量 + 播放列表
                                            //   Afterglow 需要**强制带 queue 快照**：给
                                            //   'app:save-playback-session' 加一个可选 options 参数
                                            //   （`{ includeQueue: true }`），preload 透传给回调，
                                            //   渲染器用 `savePlaybackSessionSnapshot({ queue: queue.value })` 写完整快照
 4. session = await playbackSessionService.load()
    快照 live: { trackId, queueIndex, position, state, playMode, volume, playbackRate }
    写回 resume（曲目/位置/queueIndex）→ save(CAS)
 5. bindEngineStatusPersistence()            // 订阅引擎 start-file / playbackInfo 变化
                                            //   → 更新 session + 刷新 tray/SMTC/托盘播放器快照
 6. registerRestoreShortcut('CommandOrControl+Shift+E')
    registerFallbackMediaKeys()             // MediaPlayPause / MediaNext / MediaPrevious / MediaStop
    ensureTray()
 7. Windows && mode==='minimize-auto' → createAnchorWindow({ taskbar: true })
    Windows && 其它 mode           → createAnchorWindow({ taskbar: false })  // 只为 SMTC
    rebindWindowsSmtc(anchorHandle)
 8. phase='active'
 9. saveWindowState(bounds)
10. destroySatelliteWindows(): desktopLyrics / miniPlayer / dynamicIsland / trayPlayer
11. runtime.mainWindow.webContents.send('app:afterglow-unloading') // 可选：渲染器做最后的 flush
    runtime.mainWindow.destroy()            // destroy 不触发 close，不进入 close 持久化流程
    runtime.mainWindow = null
12. 可选：releaseRebuildableMemory()（背景图解码缓存、页面级大对象由进程退出自然释放）
```

要点：

- **不要走 `win.close()`**：`close` 会触发 `closeWindowBehavior` 分支和 `requestRendererPlaybackSessionSave` 的二次流程；`destroy()` 才是"卸载渲染器"。
- 在 `window.ts` 的 `closed` 回调里加 `isAfterglowUnloading` 守卫，**不要**销毁 SMTC 和缩略图（前者由 anchor 重绑接管，后者在 Afterglow 期间本来就没有窗口）。
- `flushRendererSession()` 失败时**中止进入**（和 ECHO 的 `tray_renderer_unload_queue_sync_failed` 同构）。
- 队列**不重载**。既然要求"全量委托"，进入时只校验不写入，避免一次 `LoadQueue` 造成可听见的中断。

### 3.5 Afterglow 期间的控制面

#### 3.5.1 命令派发层（新增 `src/main/app/rendererFreePlayback.ts`）

```ts
export type RendererFreeCommand =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'toggle-play' }
  | { type: 'previous' }
  | { type: 'next' }
  | { type: 'stop' }
  | { type: 'seek'; positionSeconds: number }
  | { type: 'set-volume'; volume: number }
  | { type: 'set-play-mode'; mode: PlayMode }
  | { type: 'toggle-favorite' }

export async function dispatchRendererFree(command: RendererFreeCommand): Promise<void> {
  const engine = await ensureAudioEngineRuntime()
  // 串行化：同一时刻只允许一个传输动作（ECHO 的 operationLane）
}
```

需要同步改造的调用点（把"发 IPC"改成"先问 Afterglow，再走原路径"）：

| 调用点                                                   | 现状                                 | 改造                                                            |
| -------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------- |
| `shortcutsTray.ts:33 sendPlayerShortcut`                 | 直接 `webContents.send`              | `if (isAfterglowModeActive()) return dispatchRendererFree(...)` |
| `shortcutsTray.ts:161 sendMiniPlayerCommand`（托盘菜单） | 同上                                 | 同上；并在菜单顶部加"恢复界面"项                                |
| `windowsSmtc.ts:49 sendPlayerCommand`                    | 同上                                 | 同上（`seek/set-play-mode` 也要覆盖）                           |
| `trayPlayer.ts:53 forwardPlayerCommand`                  | 同上                                 | 同上（托盘播放器窗口在 Afterglow 中已销毁，仅防御）             |
| `remoteIpc.ts:70/92`                                     | 同上                                 | P3：远程控制也改走 dispatch，或明确不支持                       |
| `discord.ts`                                             | 由渲染器调用 `updateDiscordActivity` | P3：主进程按快照更新                                            |

#### 3.5.2 状态快照层（新增 `src/main/app/afterglowSnapshot.ts`）

主进程按需构建 `MiniPlayerStateSnapshot`（与渲染器 `buildMiniPlayerStateSnapshot` 同构）：

```
track      ← session.queue[session.queueIndex]（title/artist/album/cover/format/sampleRate…）
isPlaying  ← playbackInfo.state === 'playing'
isLoading  ← playbackInfo.state 过渡 + pendingNativeSource !== null
currentTime← playbackInfo.position
duration   ← playbackInfo.duration
playbackRate/volume/playMode/queueIndex/queueLength ← playbackInfo
favorite   ← 可选：主进程读 playlists/library（第一版可置 favoriteAvailable=false）
```

写回 `runtime.latestMiniPlayerState` 后调用现有的 `runtime.refreshTrayMenu?.()`、`runtime.refreshWindowsSmtc?.()`，托盘/气泡/缩略图/Discord 就都恢复了。**不要**再调用 `publishTrayPlayerState`（窗口已销毁）。

订阅源：`runtime.audioEngineManager.on('playback-info', ...)`。已经核实 `AudioEngineManager.startClock()` 在引擎初始化时启动 250ms 的主进程 tick（`audioEngineManager.ts:723`、`playbackController.ts:1030-1034`），`engineIpc.ts:826-833` 只是把同一事件转给主窗口。因此**窗口销毁后换曲、进度、`ended` 边界照常产生**，快照层需要做的只是注册一个主进程监听器（并在 `will-quit` 时移除）。

同理，`engineIpc` 里的 `broadcastPlayerLifecycleEvents(info)`（睡眠定时器边界）也在主进程，不受影响。真正"只在有窗口时才跑"的只有 `runtime.mainWindow?.webContents.send(...)` 这一行。

#### 3.5.3 会话写回（新增 `src/main/app/playbackSessionService.ts`）

把 `persistenceIpc.ts` 里的三个 store 抽成模块级单例：

```ts
// src/main/persistence/playbackSessionStore.ts
export const playbackSessionStore = ...   // VersionedDataStore
export const playbackQueueStore = ...
export const playbackSessionStorage = new PlaybackSessionStorage(...)
```

`persistenceIpc` 改为 import 单例（行为不变）。`playbackSessionService` 提供：

- `flushFromRenderer()` → 复用 `requestRendererPlaybackSessionSave()`
- `recordEngineAdvance(trackId, queueIndex, position)` → 读 session → 改当前项/位置 → `save(expectedRevision)`
- 防抖：位置每 5s 落盘一次；换曲立即落盘；队列未变时只写 `playback-session.json`（不重写 queue 文件）

### 3.6 恢复流程

```
restore(pendingNavigation?)
 1. phase==='inactive' → 若窗口存在则 focus（保持与 ECHO 一致的幂等）
 2. phase==='restoring' → 返回同一个 Promise（合并并发）
 3. 取消所有定时器（entry 定时器、位置落盘定时器、anchor 刷新）
 4. 写回最后一次 resume，解绑引擎状态监听
 5. unregisterSelfShortcuts()
 6. window = createWindow({ afterglowRestore: true })
      → loadFile(index.html, { query: { afterglowRestore: '1' } })
 7. 等 ready-to-show → show/focus
 8. 把 SMTC 重绑到新主窗口 HWND → destroyAnchorWindow()
      （顺序很重要：先重绑再销毁 anchor，避免媒体会话出现空窗；
        销毁 anchor 越晚，任务栏里"两个图标"的闪烁越久，因此紧跟 ready-to-show）
 9. 等渲染器 adopt 完成（`app:afterglow:adopt-complete`）→ phase='inactive'
      - 15s 超时视为"恢复完成但 adopt 未知"：仍然 phase='inactive'，渲染器下次
        playback-info 事件会自愈；日志记录失败原因
10. 恢复卫星窗口（桌面歌词/迷你播放器按设置）
11. flush 期间挂起的导航动作
恢复失败（窗口未创建/加载失败/超时）：
  phase='active'，重新注册快捷键/媒体键，重新创建 anchor，error 写入 status
```

**并发要点**：复制 ECHO 的 `restoreAttemptId` + `generation` 双游标；恢复期间再次触发 `restore` 直接复用；恢复期间 `enter` 直接返回当前状态。

### 3.7 渲染器侧接管（改动最集中、最容易出 bug 的地方）

#### 3.7.1 为什么不能"重新 loadQueue"

`engineIpc.loadQueue` 会走 `resolveAuthorizationBatch(resolveAuthorizedPlaybackSource)`，把 `source` 改写成授权后的真实路径（`engineIpc.ts:965-969`）；而 `PlaybackController.loadQueue` 的幂等短路条件是 **`queueToken` 存在 + `JSON.stringify(nextQueue) === this.queueJson` + `nextQueueIndex === playbackInfo.queueIndex` 三者同时成立**才直接返回。渲染器手里的队列对象经过主进程授权改写后通常不再逐字段相等 ⇒ 一旦调用 `loadQueue` 就要走 `native.LoadQueue` 的完整加载路径（可能中断当前播放）。

结论：恢复时**绝不调用 `loadQueue` / `play`**，只做状态采纳。

#### 3.7.2 三个渲染器改动

1. **`NativeQueueLoader.adopt(...)`**（`src/renderer/src/utils/nativeQueueLoader.ts`）

   ```ts
   /** Afterglow restore: adopt the queue identity already held by main. */
   adopt(queue: readonly Track[], info: { queueIndex: number; queueToken?: string }): void
   ```

   对"全本地全量队列"而言索引是恒等的；`adopt` 只需建立 `committed = { token, entries: [{id, index, queueEntryId}] }`，让后续 `findLogicalIndex` 能命中。token 由 `app:afterglow:restore-state` 返回（`AudioEngineManager.getQueueToken()` 公开方法已存在）。

2. **`playbackSessionController.adoptNativeSession(snapshot)`**

   与 `restorePlaybackSession` 的区别：
   - `queue`/`queueIndex`/`currentTrack` 来自 live 快照（不是磁盘快照）；
   - `position` 用 `playbackInfo.position`；
   - `isPlaying = state === 'playing'`，`nativePlaybackActive = true`；
   - **不**调用 `setPlayModeInternal`（避免一次 `setPlayMode` 写引擎）；
   - **不**碰 `loadQueue`；
   - 保留 lyrics 加载、封面 hydrate、A-B 循环清理等副作用逻辑。

3. **`usePlayerStore.adoptLiveNativeState(snapshot)`**
   - 清 `restoredPlaybackPending`、置 `nativePlaybackActive=true`；
   - 在 `onReady` 回调里加 `restoreMode` 闸门：
     ```ts
     if (!restoreFromAfterglow) {
       syncSoftwareVolumeToEngine()
       api.setPlaybackRate(playbackRate.value)
     }
     ```
   - `volume`/`playbackRate` 直接用引擎返回的值，避免"设置里的旧值"覆盖正在播放的宿主。

#### 3.7.3 渲染器入口分支（`main.ts` / `App.vue`）

`main.ts` 已有 `new URLSearchParams(window.location.search)`，新增：

```ts
const afterglowRestore = query.get('afterglowRestore') === '1'
```

把它通过 `app.provide('afterglowRestore', ...)` 或一个模块级单例传给 `App.vue`；`App.vue` 的 `onMounted` 分支：

```ts
if (afterglowRestore) {
  const state = await window.api.app.getAfterglowRestoreState()
  playbackSessionPersistence.adoptNativeSessionState(state)   // 不走 restoreSavedPlaybackSession
  await window.api.app.notifyAfterglowAdoptComplete()
} else {
  await playbackSessionPersistence.restoreSavedPlaybackSession(...)
}
```

导航会话（localStorage）无需特殊处理：`navigationPersistence.start()` 会自动回原页面；但进入 Afterglow 前必须 flush（`requestRendererPlaybackSessionSave` 的渲染器 handler 里已经调了 `navigationPersistence.flush()`）。

#### 3.7.4 Afterglow flush（渲染器侧新增的一个回调）

`App.vue` 里现有的 `onSavePlaybackSession` 回调保持不变；新增一个只在 Afterglow 进入时走的分支（拿到 `{ includeQueue: true }` 时）：

```ts
if (options?.includeQueue) {
  // 有播放记忆时照旧写 session；无论开关如何，都把内存快照交给主进程。
  await playbackSessionPersistence.savePlaybackSessionWithQueue()
  await window.api.app.afterglow.publishRendererSnapshot({
    queue: queue.value.map((entry) => ({ ...entry })),
    queueIndex: queueIndex.value,
    track: { ...currentTrack.value },
    position: currentTime.value,
    playMode: playMode.value,
    volume: volume.value,
    playbackRate: playbackRate.value
  })
}
```

`PlaybackSessionWriter.save()` 已经处理 revision CAS 与队列引用（`playbackSessionWriter.ts:47-54`）；`publishRendererSnapshot` 只是一次性内存交接，主进程用 `parseAfterglowRendererSnapshot` 校验后保存，不落盘。

> 播放记忆仅为用户偏好：关闭时 `playbackSessionService` 进入 `memoryOnly` 模式，不进写 `playback-session.json`；恢复后 `clearRuntimeSnapshot()` 丢弃内存会话。

### 3.8 Windows 的 anchor 窗口（SMTC + 任务栏）

新增 `src/main/app/afterglowAnchorWindow.ts`：

```ts
new BaseWindow({
  width: 320,
  height: 180,
  x: -32000,
  y: -32000,
  show: false,
  title: 'Twilight Echo',
  icon,
  skipTaskbar: entryMode !== 'minimize-auto',
  minimizable: true,
  closable: false,
  opacity: 0
})
// 任务栏存在时：showInactive() + minimize()，'restore' 事件 → restoreAfterglowMode()
```

- `skipTaskbar:false` 的 anchor 让用户从任务栏点回来（仅 `minimize-auto`）。
- `windowsSmtc.initializeWindowsSmtc()` 改为接受 handle provider（`() => runtime.mainWindow ?? anchorWindow`），并新增 `rebindWindowsSmtc(handle)`。
- `taskbarThumbar`：`BaseWindow` 没有 `setThumbarButtons`，Afterglow 期间**放弃缩略图按钮**（托盘仍有全套控制）。
- 非 Windows：不创建 anchor，恢复入口 = 托盘 + 快捷键（macOS 还有 Dock `activate`）。

### 3.9 设置项

新增 `AppSettings`（`src/shared/appSettings.ts` + `src/main/core/settings.ts` 默认值/规范化）：

```ts
/** 'off' | 'minimize' | 'hide' | 'minimizeOrHide' */
afterglowAutoEntry?: AfterglowAutoEntry
```

- 默认 `'off'`（和 ECHO 一样默认关闭）。
- 依赖项：仅 `closeWindowBehavior !== 'miniPlayer'`（迷你播放器本身是渲染器）。播放记忆关闭不影响进入。
- 手动进入：设置页"立即进入 Afterglow"按钮（调用 `app:afterglow:enter`）。
- 恢复快捷键按 `Ctrl/⌘+Shift+E` → `Ctrl/⌘+Shift+Alt+E` → `Ctrl/⌘+Alt+Shift+Backspace` 依次尝试，状态里返回实际注册的组合。
- **不引入** `afterglowGpuDisabled`。
- 设置页落点：`SystemSettingsSection.vue` 内新增一组"性能 / 后台播放"（或新建 `PerformanceSettingsSection.vue` 并在 `SettingsPage.vue` 的 sections 注册）。文案中文，与现有风格一致。

### 3.10 与现有窗口行为的优先级

```
用户点关闭:
  closeWindowBehavior === 'tray'        → hide()（+ 若 afterglowAutoEntry 含 hide → 隐藏后进入 Afterglow）
  closeWindowBehavior === 'miniPlayer'  → showMiniPlayer()（不进入 Afterglow；迷你播放器本身就是渲染器）
  'quit'                                → 原流程不变
用户最小化:
  afterglowAutoEntry 含 minimize       → enter('minimize-auto')
  否则                                   → 原行为
托盘菜单"恢复界面" / 托盘双击 / second-instance / activate / Ctrl+Shift+E:
  isAfterglowModeActive()              → restoreAfterglowMode()
```

注意：`closeWindowBehavior === 'miniPlayer'` 与 Afterglow 互斥，界面上要说明。

---

## 4. 代码落点清单

### 4.1 shared

| 文件                                  | 改动                                                                                                                                                                                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/afterglowMode.ts`（新增） | `AfterglowModePhase`、`AfterglowModeStatus`、`AfterglowAutoEntry`、`afterglowRendererRestoreQueryKey`、`isAfterglowRendererRestore(search)`、`AfterglowRestoreState`、`AfterglowTransportCommand`、快捷键→命令映射（queue 元信息 + live playback） |
| `src/shared/appSettings.ts`           | `afterglowAutoEntry` 字段 + 默认值类型                                                                                                                                                                                                             |
| `src/shared/ipcChannels.ts`           | 未新增条目：`app:afterglow:*` 以字面量写在 IPC/preload 模块中，由 `report:ipc-channels:baseline` 纳入基线                                                                                                                                          |

### 4.2 main

| 文件                                                                                              | 改动                                                                                                                               |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/app/AfterglowModeService.ts`（新增，核心）                                              | phase 状态机、enter/restore、拒绝条件、快捷键、anchor 协调、卫星窗口销毁/恢复                                                      |
| `src/main/app/rendererFreePlayback.ts`（新增）                                                    | `dispatchRendererFree()`、`canDispatchWithoutRenderer()`、操作串行化                                                               |
| `src/main/app/afterglowSnapshot.ts`（新增）                                                       | `buildSnapshot()`、`updateAfterglowPresentation()`                                                                                 |
| `src/main/app/playbackSessionService.ts`（新增）                                                  | 主进程写回会话（换曲/位置/防抖）+ `flushFromRenderer()`                                                                            |
| `src/main/app/afterglowAnchorWindow.ts`（新增）                                                   | BaseWindow 生命周期 + 任务栏恢复 + 'restore' 事件                                                                                  |
| `src/main/app/afterglowRestoreReadiness.ts`（新增）                                               | 等渲染器 ready（IPC + 超时）+ 时间线日志                                                                                           |
| `src/main/persistence/playbackSessionStore.ts`（新增，从 `ipc/persistenceIpc.ts` 抽出）           | store 单例                                                                                                                         |
| `src/main/audio/engineActions.ts`（新增，从 `engineIpc.ts` 抽取）                                 | 供 IPC 与 `rendererFreePlayback` 共用的动作（含 `scheduleSoftwareVolumePersist`、`outputTest.stop()`）                             |
| `src/main/audio/engineIpc.ts`                                                                     | handler 改为调用 `engineActions`；新增 `getQueueSnapshot` 相关 IPC（或走内部调用）                                                 |
| `src/main/audio/audioEngineManager.ts`                                                            | 暴露 `getQueueSnapshot(): readonly AudioEngineQueueItem[]`（或 `getAfterglowQueueIdentity()`）                                     |
| `src/main/app/window.ts`                                                                          | `createWindow({ afterglowRestore })`；`minimize` 钩子；`closed` 里加 `isAfterglowUnloading` 守卫；恢复时跳过 `closeWindowBehavior` |
| `src/main/app/lifecycle.ts`                                                                       | `window-all-closed` 守卫；`second-instance`/`activate` 先走 restore；`will-quit` 释放 anchor/监听                                  |
| `src/main/app/settingsRuntime.ts`                                                                 | `afterglowAutoEntry` 变更时同步 `AfterglowModeService`（若关闭自动进入且当前由自动进入触发，可选恢复）                             |
| `src/main/ipc/afterglowModeIpc.ts`（新增）                                                        | `assertTrustedIpcSender` + 6 支 handler（status / enter / restore / restoreState / rendererReady / adoptComplete）                 |
| `src/main/ipc/data.ts`                                                                            | 注册 `afterglowModeIpc`                                                                                                            |
| `src/main/core/settings.ts`                                                                       | 默认值 + `normalizeAfterglowAutoEntry`                                                                                             |
| `src/main/integrations/shortcutsTray.ts`                                                          | `sendPlayerShortcut`/`sendMiniPlayerCommand` 路由；托盘"恢复界面"项；托盘点击先 restore                                            |
| `src/main/integrations/windowsSmtc.ts`                                                            | handle provider + `rebindWindowsSmtc()` + 无渲染器时的命令路由                                                                     |
| `src/main/integrations/taskbarThumbar.ts`                                                         | Afterglow 激活时跳过刷新（无窗口）                                                                                                 |
| `src/main/integrations/desktopLyrics.ts` / `miniPlayer.ts` / `dynamicIsland.ts` / `trayPlayer.ts` | 提供 `closeXxxWindow()` / `restoreXxxAfterAfterglow()`（多数已有 destroy/show，补齐恢复入口）                                      |
| `src/main/remote/remoteIpc.ts`                                                                    | P3：命令路由                                                                                                                       |

### 4.3 preload

| 文件                                               | 改动                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/preload/domains/afterglowApi.ts`（新增）      | `getStatus/enter/restore/getRestoreState/rendererReady/adoptComplete/onUnloading` |
| `src/preload/index.ts` + `index.d.ts` + `types.ts` | 挂 `window.api.app.afterglow`                                                     |
| `src/preload/sandboxBoundary.test.ts`              | 断言新 API 只暴露白名单方法                                                       |

### 4.4 renderer

| 文件                                                                                                             | 改动                                                                    |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `src/renderer/src/main.ts`                                                                                       | 解析 `afterglowRestore` 查询参数                                        |
| `src/renderer/src/App.vue`                                                                                       | `onMounted` 分支 adopt；ready 通知；`:816` 的 flush handler 不变        |
| `src/renderer/src/app/usePlaybackSessionPersistence.ts`                                                          | `adoptNativeSessionState(state)`                                        |
| `src/renderer/src/stores/player/playbackSessionController.ts`                                                    | `adoptNativeSession`（无引擎写入版 restore）                            |
| `src/renderer/src/stores/usePlayerStore.ts`                                                                      | `adoptLiveNativeState`、`restoreMode` 闸门、`onReady` 跳过音量/倍速重放 |
| `src/renderer/src/utils/nativeQueueLoader.ts`                                                                    | `adopt(queue, { queueIndex, queueToken })`                              |
| `src/renderer/src/components/settings-page/SystemSettingsSection.vue`（或新建 `PerformanceSettingsSection.vue`） | 开关 + "立即进入"按钮 + 状态展示（当前 phase / 恢复快捷键提示）         |
| `src/renderer/src/components/SettingsPage.vue`                                                                   | 若新建 section，注册导航与 panel                                        |
| `src/renderer/src/types/settings.ts`                                                                             | 设置类型同步                                                            |

### 4.5 脚本 / 文档 / 测试基线

| 文件                                       | 改动                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `package.json`                             | 新增 `test:afterglow`；把关键用例并入 `test:app`                                                  |
| `scripts/ipc-channel-report.cjs` 基线      | 运行 `pnpm report:ipc-channels:baseline` 重新生成 `docs/audit-evidence/ipc-channel-baseline.json` |
| `docs/afterglow-mode.md`（新增，用户文档） | 行为说明、限制、恢复方式                                                                          |
| `README.md`                                | 功能列表提一句（可选）                                                                            |

---

## 5. 分阶段实施计划

### P0 — 地基（不改变任何现有行为，可独立合并）

1. `shared/afterglowMode.ts` 类型；`AppSettings.afterglowAutoEntry` 默认 `'off'`。
2. 抽出 `playbackSessionStore` 单例、`engineActions` 动作层、`AudioEngineManager.getQueueSnapshot()`。
3. `rendererFreePlayback.dispatch()` + `afterglowSnapshot.build()`。
4. 新增 IPC + preload + 设置页开关（"最小化/隐藏时进入 Afterglow"，默认关）。
5. 托盘加"恢复界面"项（P0 阶段只是占位；Afterglow 激活时才是主入口）。

**验收**：新增 `pnpm test:afterglow`；现有 `test:app` 全绿；IPC baseline 更新；设置开关可持久化。

### P1 — 手动 Afterglow（核心闭环）

1. `AfterglowModeService`：`enter('manual')` / `restore()` / `getStatus()` / 拒绝条件。
2. 进入：flush → 快照 → 快捷键 → 托盘 → 销毁窗口。
3. 恢复：重建窗口 + `afterglowRestore` 查询参数 + 渲染器 adopt + ready 握手。
4. 渲染器 adopt 三件套。
5. 托盘/媒体键/SMTC 命令路由到 dispatch。

**验收**（真机，Windows）：

- 本地专辑队列播放中手动进入 → 任务管理器确认主窗口渲染进程消失、audible 继续、托盘菜单切歌生效、媒体键生效、SMTC 仍显示曲目且可控；
- `Ctrl+Shift+E` 恢复 → 窗口回到原页面、进度与曲目与引擎一致、UI 显示"播放中"、**不出现**音量/倍速跳变、**不**重新加载队列（日志中无 `LoadQueue`）；
- 播放中进入 → 队列自然播到下一首 → 恢复后 UI 显示新曲目；
- 流媒体/CUE/system 输出下点击进入 → 被拒绝且无副作用。

### P2 — 自动进入 + Windows anchor

1. `minimize` 钩子 + `hide`（托盘关闭）路径。
2. `AfterglowAnchorWindow`（任务栏恢复 + SMTC 重绑）。
3. `second-instance` / `activate` / 托盘双击 → restore。
4. `window-all-closed` 守卫、`will-quit` 清理。

**验收**：最小化自动进入后，任务栏图标可点击恢复；SMTC 在 anchor 上仍可用；隐藏到托盘后恢复路径正常；退出应用不残留 anchor。

### P3 — 周边一致性

1. 桌面歌词/迷你播放器/动态岛/托盘播放器在进入时销毁、恢复后按设置重建。
2. 远程控制、Discord RPC 改走主进程快照/派发（或明确声明 Afterglow 期间不可用）。
3. 快照层节流：`playback-info` 4Hz，按曲目/状态/播放模式去重，进度单独轻量更新。
4. 可重建内存释放（背景图缓存等）。

**验收**：Afterglow 期间桌面歌词/迷你播放器不会以"空数据"窗口存在；恢复后它们的设置与位置不丢。

### P4 — 可选增强

- 原生 taskbar 缩略图（需新增 native addon）。
- GPU 变体（**不建议**，除非有明确需求与充分测试资源）。
- 听歌统计/遥测主进程化。

---

## 6. 风险与坑（按优先级）

> 已核实、**不再是风险**的两点：引擎 tick 在主进程（`audioEngineManager.ts:723`）；`playback-info` 事件在主进程产生（`engineIpc.ts:826`）。下面只列真正需要处理的坑。

| #   | 风险                                      | 现象                                                                                           | 规避                                                                                             |
| --- | ----------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | `window-all-closed`                       | 销毁最后一个窗口 → 应用直接退出                                                                | 在 `lifecycle.ts:425` 加 `if (isAfterglowModeActive() \|\| hasAnchorWindow()) return`            |
| 2   | `closed` 回调销毁 SMTC/缩略图             | 恢复后 SMTC 消失；或 anchor 重绑时双重初始化                                                   | `window.ts:231` 加 `afterglowUnloading` 守卫；SMTC 只在 restore/adopt 完成后重绑                 |
| 3   | 恢复时 `onReady` 重放音量/倍速            | 恢复瞬间音量跳变（宿主音量与设置不一致时）                                                     | `restoreMode` 闸门；adopt 时以引擎值覆盖渲染器值                                                 |
| 4   | `restoredPlaybackPending`                 | 首个 playbackInfo 被丢弃，UI 卡在暂停                                                          | `adoptLiveNativeState` 里清除；并保证 `nativePlaybackActive=true`                                |
| 5   | `NativeQueueLoader` token 失配            | 换曲后高亮/进度不同步                                                                          | `adopt()` 采纳主进程 token；全本地全量队列索引恒等                                               |
| 6   | 恢复时误调 `loadQueue`                    | 真正重载队列造成中断                                                                           | 只 adopt 不 load；测试断言恢复期间无 `LoadQueue`                                                 |
| 7   | 会话 CAS 冲突                             | 主进程写回与残余渲染器写并发                                                                   | 进入前 `await flushRendererSession()`；销毁后再开始写；`VersionedDataStore` 冲突时重读重试       |
| 8   | 队列非全本地/窗口化                       | 换曲映射错误、引擎播放列表与 UI 不一致                                                         | 进入条件硬拒绝（§3.3）                                                                           |
| 9   | 快照节流                                  | `playback-info` 4Hz，若每次都重建托盘菜单/SMTC 更新会浪费 CPU                                  | 快照层按"曲目/状态/播放模式变化"去重，进度单独走轻量字段（参考 ECHO 的 `createPresentationKey`） |
| 10  | ASIO/独占/DSD 输出                        | 窗口销毁理论上不影响 utility process，但设备热插拔监听绑定主窗口                               | 在 `deviceHotplug` 上确认；必要时把监听移到主进程常驻                                            |
| 11  | 卫星窗口恢复时序                          | 恢复后迷你播放器/桌面歌词不出现或空白                                                          | 等主渲染器 `adopt-complete` 再恢复；参考 `restoreAuxiliaryWindows` 的延后策略                    |
| 12  | 恢复失败                                  | 用户"回不来"                                                                                   | 失败回 `active` 并重新注册快捷键 + anchor + 托盘提示                                             |
| 13  | 开发模式 `ELECTRON_RENDERER_URL`          | HMR 重载会丢掉内存中的 token/会话（开发期正常）                                                | adopt 逻辑以主进程状态为准；开发期可用 `--no-hmr` 验证                                           |
| 14  | 新增 IPC                                  | `scripts/ipc-channel-consistency.test.cjs` 基线失败                                            | 重新生成 baseline，并在 PR 里说明                                                                |
| 15  | 单实例/second-instance                    | 二次启动时没有窗口可聚焦，看起来"没反应"                                                       | `second-instance` 先 restore                                                                     |
| 16  | 托盘"点击"与"双击"                        | Afterglow 下 `restoreMainWindowFromMiniPlayer` 空转                                            | 托盘回调先判断 `isAfterglowModeActive()`                                                         |
| 17  | 遥测/听歌统计                             | Afterglow 期间不计时（遥测 `observePlayback` 在主进程仍工作，但渲染器的 listening stats 不会） | 文档声明；P3 可主进程化                                                                          |
| 18  | 关闭按钮的语义                            | 用户以为"关闭=退出"，结果变成后台卸载                                                          | 首次进入时托盘气泡提示；设置项写清楚；快捷键提示                                                 |
| 19  | macOS/Linux                               | 无 anchor，Dock `activate` 行为不同                                                            | `app.on('activate')` 改为统一 restore；非 Windows 不显示任务栏相关文案                           |
| 20  | `requestRendererPlaybackSessionSave` 超时 | 渲染器繁忙时进入失败                                                                           | 失败即中止（不销毁窗口），给出提示；不做"强制进入"                                               |

---

## 7. 工作量与验证

### 7.1 规模估算（对照 ECHO）

| 部分            | ECHO 实际                     | Twilight Echo 预估                             |
| --------------- | ----------------------------- | ---------------------------------------------- |
| 生命周期服务    | ~1400 行 + 61KB 测试          | ~900–1200 行 + 测试                            |
| 无渲染器控制面  | 内嵌在服务里                  | ~300–450 行（拆成独立模块）                    |
| 任务栏/SMTC     | ~270 行 + native              | ~150 行（BaseWindow + 重绑）                   |
| 渲染器接管      | 少量判定（Audio Core 已权威） | ~250–400 行（adopt 三件套）                    |
| 设置/UI/preload | ~120 行                       | ~250 行                                        |
| 合计            |                               | **约 2000–2500 行生产代码 + 1500–2500 行测试** |

### 7.2 验证清单

- `pnpm typecheck`（node + web）
- `pnpm test:afterglow`（新增）
- `pnpm test:app`（含 `window.test.ts`、`closePersistence.test.ts`、`ipc-channel-consistency.test.cjs`、`architecture-boundaries.test.cjs`）
- `pnpm lint`（改动文件）
- 真机：Windows 最小化/托盘/手动三条路径 × 本地队列/流媒体/CUE 三种队列 × 播放/暂停/播完 三种状态
- 内存：进入前后用任务管理器比较**私有工作集**（不是工作集总和），记录主进程/GPU/渲染进程三项；参考 `docs/memory-optimization-2026-10-15.md` 的测量口径
- 音频：进入/恢复前后对比输出采样率、DSD/ASIO 状态、DSP 链是否被重建（不应重建）

### 7.3 验收指标（建议写进 PR 描述）

- 进入后：主窗口渲染进程消失；音频继续；托盘/SMTC/媒体键可控；内存私有工作集下降可量化。
- 恢复后：页面位置、曲目、进度、播放态、音量、倍速与引擎一致；无 `LoadQueue`；无音量跳变。
- 拒绝路径：不支持的播放状态下，窗口、快捷键、托盘、播放零变化。

---

## 8. 结论

Twilight Echo **已经具备**实现 Afterglow 的两个最硬前提：原生引擎在独立 utility process、主进程持有全量原生队列并可自行推进。真正缺的是主进程侧的**三个"无渲染器"能力**：

1. **命令执行层**（把散落在 5 处的 `webContents.send` 收口成 `dispatch()`）；
2. **状态快照层**（用引擎状态 + 会话数据替代渲染器推送的 `MiniPlayerStateSnapshot`）；
3. **会话写回层**（主进程在无渲染器期间维护 `playback-session.json`）。

加上一层生命周期状态机和渲染器的 **adopt（而非 replay）** 通道，即可得到与 ECHO 行为等价、但不需要 GPU 重启和原生任务栏扩展的 Afterglow。

建议按 P0 → P1 → P2 推进：P0 可独立合并且不改变任何现有行为，P1 完成核心闭环，P2 补齐最小化自动进入与 Windows 任务栏恢复。

---

## 9. 实现状态（Afterglow）

### 9.1 已落地

| 模块                | 文件                                                                                                                                                     | 作用                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 契约与纯函数        | `src/shared/afterglowMode.ts`                                                                                                                            | phase/status/restore-state、恢复快捷键候选、可续播源判定、引擎→逻辑队列映射、播放模式映射、快捷键→传输命令映射 |
| 生命周期            | `src/main/app/AfterglowModeService.ts`                                                                                                                   | enter/restore/phase、拒绝条件、快捷键（含回退）、媒体键、窗口队列自动恢复、卫星窗口销毁与恢复、失败回退        |
| 无渲染器播放        | `src/main/app/rendererFreePlayback.ts`                                                                                                                   | play/pause/next/prev/stop/seek/mute/volume/rate/play-mode，串行化 + 输出测试停止                               |
| 状态快照            | `src/main/app/afterglowSnapshot.ts`                                                                                                                      | 订阅引擎 `playback-info`，重建 `MiniPlayerStateSnapshot`，刷新托盘/SMTC/远程状态/Discord，维护引擎→逻辑索引    |
| 会话写回            | `src/main/app/playbackSessionService.ts`                                                                                                                 | 进入前 flush（带队列）、无界面期间写回曲目/位置、CAS 冲突重试、内存快照                                        |
| 持久化单例          | `src/main/persistence/playbackSessionStore.ts`                                                                                                           | 主进程与 IPC 共用同一份 playback-session/queue store                                                           |
| Windows anchor      | `src/main/app/afterglowAnchorWindow.ts`                                                                                                                  | 无渲染器窗口：任务栏恢复入口 + SMTC 句柄                                                                       |
| IPC                 | `src/main/ipc/afterglowModeIpc.ts`、`src/preload/domains/afterglowApi.ts`                                                                                | status/enter/restore/getRestoreState/adoptComplete/publishRendererSnapshot                                     |
| 渲染器接管          | `usePlayerStore.adoptAfterglowRestore`、`NativeQueueLoader.adopt`（支持 `nativeQueueIndices`）、`usePlaybackSessionPersistence.adoptLivePlaybackSession` | 采纳引擎实时状态，不重载队列、不重启播放、不重放音量/倍速                                                      |
| 在线队列            | `resolveAfterglowEngineMapping` + 快照 `nativeQueueIndices` + 窗口自动恢复                                                                               | 续播引擎已加载的当前/下一首；窗口播完 6 秒后恢复界面                                                           |
| 在线队列 core（P1） | `AfterglowQueueCore` + `createAfterglowSourceResolver` + native `queueHotUpdate`                                                                         | 无渲染器时按 lookahead 解析/热追加、刷新 upcoming URL；失败或旧引擎回退窗口模式                                |
| 原生热更新（P0）    | `audio-engine` 的 `AppendQueueItems` / `UpdateQueueItemSource` / `GetQueueState` + `[契约文档](afterglow-queue-hot-update.md)`                           | 不重建队列即可追加/刷新在线 URL；capability `queueHotUpdate` 协商，旧引擎回退窗口模式                          |
| 设置页              | `AfterglowSettingsSection.vue`                                                                                                                           | 状态展示、"立即进入"、自动进入下拉（默认关闭）                                                                 |
| 远程控制            | `src/main/remote/remoteIpc.ts`                                                                                                                           | 传输/音量/播放模式在无渲染器时走主进程；状态与封面镜像到 Web 远程                                              |
| 托盘入口            | `src/main/integrations/shortcutsTray.ts`                                                                                                                 | 未激活时提供「进入余晖模式」，拒绝原因用系统通知说明                                                           |
| Discord             | `src/main/app/afterglowSnapshot.ts`                                                                                                                      | 无渲染器时由主进程维持听歌状态                                                                                 |

自动进入：`afterglowAutoEntry = off | minimize | hide | minimizeOrHide`，默认 `off`。
恢复入口：托盘"恢复界面（显示实际快捷键）"、托盘图标单击、`Ctrl/⌘+Shift+E`（被占用时自动回退到 `Ctrl/⌘+Shift+Alt+E`、`Ctrl/⌘+Alt+Shift+Backspace`）、二次启动、macOS `activate`、任务栏图标（Windows 最小化进入时）。

### 9.2 与 ECHO 的差异（有意为之）

- **不移植 GPU 重启变体**：Twilight Echo 的 DSP/输出事务在整进程重启下风险过高。
- **在线队列走原生热更新**：具备 `queueHotUpdate` 时由主进程 core 按 lookahead 解析并追加/刷新，不重建队列；旧引擎或解析失败时回退"窗口续播"。不做整队列预解析（只 lookahead 2）和磁盘缓存（P4）。
- **缩略图按钮在卸载期间不可用**：`BaseWindow` 没有 `setThumbarButtons`；托盘、SMTC 与 Web 远程已覆盖传输控制。
- **喜欢、心动模式、随机模式切换在卸载期间降级**：喜欢依赖渲染器收藏数据；随机已在进入前固化进队列；心动是渲染器流。
- **听歌统计**在卸载期间暂停（遥测的 `observePlayback` 仍在主进程工作）。

### 9.3 验证

- `pnpm test:afterglow`
- 受影响套件：`usePlayerStore.test.ts`、`usePlaybackSessionPersistence.test.ts`、`nativeQueueLoader.test.ts`、`window.test.ts`、`closePersistence.test.ts`、`sandboxBoundary.test.ts`
- `typecheck:node` / `typecheck:web`、`eslint`、`electron-vite build`
- IPC 基线已重新生成（`docs/audit-evidence/ipc-channel-baseline.json`）
- 真机验收仍需按 §7.2 在 Windows 上跑一遍三条进入路径 × 三类队列。

### 9.4 已知风险（实现层面复核过）

- 引擎的 `nativePlaybackActive` 必须在进入时仍为 `true`；暂停状态保持不变（只有 stop/失败播放会清除）。若未来引擎在暂停时清除该标志，暂停进入会被拒绝（界面保持常驻），不会误卸载。
- `window.destroy()` 是否同步触发 `closed` 依赖 Electron 实现；`afterglowUnloading` 标记由 `closed` 消费，并用 1s 兜底清除，避免影响后续窗口。
- 快照层复用主进程已有的 250ms tick 与 `playback-info` 事件，未新增轮询。
- Web 远程封面在主进程按同一套 `cover://` 缓存解析为 data URL（超过 180KB 会先缩放）；不可解析的远程封面保持上一帧。
