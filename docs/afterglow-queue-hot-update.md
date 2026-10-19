# 原生队列热更新契约（queueHotUpdate v1）

> 状态：P0 契约 + P1 主进程 `AfterglowQueueCore` 已实现并通过原生单测、core 单测与真实播放原型验证。
> 适用：Afterglow 在线续播（路线 C），以及任何需要"不重建队列就追加/刷新音频地址"的主进程消费者。

## 1. 目标与非目标

**目标**

- 在**不调用 `LoadQueue`、不打断当前解码流**的前提下，向队尾追加已解析的曲目；
- 在下一首真正开始前，把即将过期的 provider URL 热更新为新鲜 URL；
- 让宿主拿到**稳定、绝对、单调**的原生索引与队列修订号，用于逻辑队列映射和恢复。

**非目标**

- 不允许修改当前正在解码条目的 source（v1 直接拒绝）；
- 不提供删除/重排/裁剪（索引必须稳定，避免恢复映射失效）；
- 不承诺在线曲目之间仍然 gapless/AutoMix（source 刷新会使旧预加载失效）；
- 不做 provider 解析、重试、TTL 策略（这些属于主进程 core）。

## 2. 原生 API

### 2.1 C ABI（`audio-engine/include/twilight_audio_engine.h`）

| API                                                         | 语义                                                                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `TAE_AppendQueueItems(engine, items_json, out_first_index)` | 原子追加一个 JSON 数组；`out_first_index` 返回首个追加项的原生索引；任何一项非法则整批不生效          |
| `TAE_UpdateQueueItemSource(engine, index, source)`          | 替换**非当前**条目的 source；同 source 幂等；越界/当前项/空 source 返回 `TAE_RESULT_INVALID_ARGUMENT` |
| `TAE_GetQueueState(engine, buffer, size, required)`         | 返回 `{revision,size,currentIndex,upcomingIndex,playMode}` JSON，走既有 size-probe 模式               |

`TAE_GetEngineCapabilities()` 新增：

```json
"queueHotUpdate": {
  "version": 1,
  "append": true,
  "updateSource": true,
  "upcomingIndex": true
}
```

`TAE_GetPlaybackInfo()` 新增字段：

- `queueRevision: number`：队列内容修订号，任何 load/append/remove/update 递增；
- `upcomingQueueIndex: number`：`upcomingTrack` 的绝对原生索引，无下一首为 `-1`。

### 2.2 N-API（`audio-engine/napi/twilight_audio_node.cpp`）

- `AppendQueueItems(itemsJson)` → `undefined`（宿主用本地镜像/`GetQueueState` 计算首索引）；
- `UpdateQueueItemSource(index, source)` → `undefined`；
- `GetQueueState()` → JSON 字符串。

> 该桥接层是"薄转发"，不承载策略。旧引擎没有这些导出时，宿主必须按 `typeof`/capability 降级。

### 2.3 主进程绑定

- `NativeAudioBinding.AppendQueueItems?/UpdateQueueItemSource?/GetQueueState?`
- `PlaybackController.appendQueueItems(items)`：校验、调用原生、同步本地队列镜像、保持 `queueToken` 不变、发 `queue-appended`；
- `PlaybackController.updateQueueItemSource(index, source)`：拒绝当前项、同步镜像、发 `queue-item-source-updated`；
- `PlaybackController.readQueueState()`：优先 `callAsync('GetQueueState')`，否则同步绑定；
- `AudioEngineManager` 暴露同名方法，供 `AfterglowQueueCore` 使用。

## 3. 不变量（实现/测试必须保持）

1. **索引稳定**：append 只追加，返回索引等于操作前 size；一次会话内不删除、不重排。
2. **当前项不可热改**：`index == currentIndex()` 一律拒绝，避免与已打开的 decoder 脱节。
3. **原子追加**：批量解析全部成功后一次性提交；失败不改变队列与 revision。
4. **修订号单调**：内容变更递增；`setPlayMode`/`setCurrentIndex` 不递增。
5. **预加载一致性**：更新或追加导致 `upcoming` 身份变化时，原生在控制线程刷新 `preloadNext`；
   `AudioPipeline` 通过 `sameQueueSegment` 检测 source 变化并 retire 旧 preload，绝不会用旧 URL 播放新条目。
6. **线程安全**：队列变更走 `transportMutex_`；`mutex_` 只保护队列/info；pipeline 调用在 `mutex_` 之外；
   tick 线程与控制线程之间的竞态由"身份比较 + preload 失效"兜底，不在渲染线程分配/加锁。
7. **事件分层**：append/update 发专有事件；`queue-change` 仍只代表整队列重载，避免插件高频广播。
8. **恢复友好**：`PlaybackInfo.queueRevision` 与 `upcomingQueueIndex` 让宿主无需重载即可重建映射。

## 4. 事件

| 事件                        | payload                       | 时机                                                            |
| --------------------------- | ----------------------------- | --------------------------------------------------------------- |
| `queue-appended`            | `{firstIndex,count,revision}` | 追加成功且 count > 0                                            |
| `queue-item-source-updated` | `{index,revision,preload}`    | source 实际变化；`preload` 为 `refreshed`/`not_needed`/`failed` |

事件只由原生发出；主进程 `PlaybackController` 另发同名 IPC 内事件供 core 使用。

## 5. 使用协议（core 侧）

P1 已落地 `src/main/app/afterglowQueueCore.ts`：

- `lookahead` 默认 2：原生队列始终保留"当前 + 2 首"的已解析窗口；
- `refreshMarginMs` 默认 120s：upcoming 的 provider URL 进入过期余量时调用 `updateQueueItemSource`；
- 所有 provider/append/update 串行化；`stop()` 后到达的 resolve 结果直接丢弃；
- 解析失败按 logical index 做 30s 退避，不重复打 provider；
- append 索引不等于本地镜像长度、或原生队列 size 与映射漂移 → 立即停止维护并上报，避免"错位播放"；
- 映射每次增长都通过 `onMappingChanged` 写回 `afterglowSnapshot`，恢复时 `nativeQueueIndices` 覆盖整个原生队列；
- 能力缺失（旧引擎）时不启动 core，保持 v0"窗口播完自动恢复"。

启动条件（`AfterglowModeService.startQueueCore`）：native `queueHotUpdate.append/updateSource` 可用即启动；窗口队列会追加，完整队列只做 upcoming URL 刷新。播放停止（队列播完、在线 URL 失败或用户停止）后 6 秒自动恢复 UI，不再要求 `windowedQueue`。

使用方协议：

1. 启动时读取 capability；缺失则回退"窗口续播"（v0）。
2. 只 append **已解析**的后续项；未解析/解析失败的项绝不进入原生队列。
3. 记录 `nativeBaseIndex`：第一次 append 的 `firstIndex` 必须等于本地镜像长度；不等则视为引擎状态异常，停止维护并恢复 UI。
4. 下一首开始前（TTL 剩余 < 预计时长 + 60s）调用 `updateQueueItemSource(upcomingQueueIndex, freshUrl)`。
5. append/update 串行化；恢复/退出时先取消在途解析，再释放映射。
6. 解析失败：重试有限次后停止追加，让已加载窗口播完并自动恢复界面。

## 6. 已知限制与后续

- **无 gapless 保证**：source 刷新会让预加载重建；在线场景接受可感知的换曲间隙（需真机观测）。
- **不裁剪**：长会话队列只增不减；每项仅元数据，内存可接受；P4 再评估 `trimBefore` + base offset。
- **shuffle**：append 会 `rebuildPlayOrder`；在线维护期间 core 应把原生 playMode 设为 `sequential`，退出时恢复用户模式。
- **当前项 URL 过期**：已打开的流继续；网络中断/解码失败由 core 的失败策略恢复 UI，不做透明重连。
- **C ABI 只增不改**；能力以 `queueHotUpdate.version` 协商；弃用需跨两个 minor 并先发 capability 降级信号。

## 7. 验证证据（P0/P1）

- 原生单测：`twilight_queue_tests`（append 原子性/索引/当前项拒绝/revision）；
- 引擎 smoke：`twilight_audio_tests`（C ABI append/update/state/capability/PlaybackInfo 字段）；
- core 单测：`src/main/app/afterglowQueueCore.test.ts`（lookahead、TTL 刷新、重复模式、append 失败、映射漂移、stop 取消）；
- 真实播放原型（`.cache/queue-hot-prototype`，4s/4s/4s/3s WAV）：
  1. 加载 `[A,B]` 播放 A；
  2. 播放中更新 B → B2；
  3. A 结束自动切到 **B2**（未使用旧 preload）；
  4. 播放中 append C；
  5. B2 结束切到 **C**，全程 `state=playing`、无 `LoadQueue`；
- core + 原生联合原型：
  - `nativeQueueIndices=[0]`、lookahead=2 → core 自动 append B/C，映射 `[0,1,2]`，A→B→C 连续；
  - 加载 `[A,B]` 后 core 在播放中把 upcoming 刷新为 B2，A→B2 连续；
- 命令：
  - `cmake --build audio-engine/build/default --target twilight_queue_tests twilight_audio_tests --config Debug`
  - `audio-engine/build/default/Debug/twilight_queue_tests.exe`
  - `audio-engine/build/default/Debug/twilight_audio_tests.exe`
  - Node 原型见会话记录（使用 MinGW 构建 + 本地 WAV）。

## 8. 维护约定

- 原生层只实现"安全变更原语"；TTL/重试/provider/映射全部放 `AfterglowQueueCore`。
- 任何新增队列变更 API 必须先写不变量测试，并更新本文档与 capability 版本。
- 主进程与原生版本偏移由 capability + `nativeRuntime` 身份校验兜底；旧引擎自动走窗口模式。
