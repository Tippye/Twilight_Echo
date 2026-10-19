import './diagnostics/bootstrap.ts'
import { relaunchWithX11BackendIfNeeded } from './imeBackend'

// 必须在加载应用生命周期之前执行：Chromium 的 ozone 平台在 Electron
// 二进制启动阶段就已确定（早于任何 JS 代码），KWin 未配置输入法时
// 只能以真实参数 --ozone-platform=x11 重启自身，让 browser 进程走
// X11（XWayland）后端，fcitx5/ibus 才能输入中文。
// 开发/预览模式由 scripts/run-electron-vite.cjs 在启动时透传参数，
// 此处不会触发自重启。
relaunchWithX11BackendIfNeeded()

import { startApp } from './app/lifecycle'

startApp()
