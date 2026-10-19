# 灵动岛（Dynamic Island）

灵动岛是宿主拥有的置顶 overlay 窗口，由插件通过 `twilight.overlay` 控制。宿主负责窗口生命周期、几何计算、原生圆角裁剪、播放状态/歌词下发与 DIY 配置校验；插件只提供配置和设置表单。

## 契约

- 入口：`twilight.overlay.show()` / `hide()` / `configure(input)`，需要 `ui:inject` 权限。
- 同一时间只有一个插件可以占用灵动岛；`configure` 返回宿主实际生效的完整配置，插件应持久化该返回值。
- 所有数值字段由 `normalizeDynamicIslandConfig()` 钳制并回退默认值，越界或非法值不会进入渲染。
- 歌词走独立的 `miniPlayer:publishLyrics` → `dynamicIsland:lyrics` 通道，共享的 mini player 快照保持无歌词，避免进度推送重复序列化歌词数组。

几何与窗口形状由 `resolveDynamicIslandLayout()` / `resolveDynamicIslandWindowBounds()` 在共享层计算，原生窗口与渲染器 CSS 使用同一组数字。

## 行为

- `display: 'main-window'`：跟随主窗口所在显示器，主窗口跨屏拖动或显示器热插拔时重新定位。
- `display: 'primary'`：固定在主显示器。
- `visibility`：`always` / `when-track` / `when-playing`；展开中的灵动岛不会被隐藏。
- 折叠态通过原生 `setShape` + CSS `clip-path` 雕刻胶囊，窗口本身始终保持展开尺寸，避免透明窗口在动画末帧抖动。
- 展开/折叠、拖动进度或音量时，本地乐观状态优先于播放推送，避免滑块回弹；隐藏面板不可聚焦（`inert`）。

## 三轮审计记录（2026-10-14）

合并 `feat/host-overlay-api`（`63f62e17`）到当前分支时唯一冲突为
`SettingsPage.quickSetup.behavior.test.ts`，保留当前分支较新的 AutoMix 可用性回退断言。

### 第一轮：宿主窗口生命周期

- 增加 `targetDisplay()` 与 `lastDisplayId`，监听主窗口 `move`、`display-added`、`display-removed`，仅在目标显示器变化时重排。

### 第二轮：渲染与体验

- 进度/音量拖动期间忽略远端 `currentTime` / `volume`，消除滑块回弹。
- hover 模式下点击胶囊只展开，不再折叠后被 `pointermove` 立即改回，消除闪烁。
- 展开卡第二行优先显示翻译/音译，回退 `artist/title`。
- `cover=false` 且折叠内容为封面时回退显示文案。
- 折叠面板、关闭的音量菜单、展开的摘要使用 `inert`，并在切换时迁移键盘焦点；补摘要焦点环。
- 无歌曲/加载中禁用播放按钮。

### 第三轮：集成、契约与安全

- 歌词发布引用比对去重，避免进度重算重复下发。
- 复核 `ui:inject` 权限、`assertDynamicIslandSender` 双重鉴权、`normalizeMiniPlayerCommand` 命令白名单、可视化通道复用受信来源，以及 IPC 公共契约基线。

验证：`pnpm typecheck`、`pnpm build:plugin-api`、`pnpm test:dynamic-island`（47）、`pnpm test:plugins`、`pnpm test:quality-policy`（30）全部通过。
