@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if errorlevel 1 exit /b 1
title Twilight Echo - Debug

set "ELECTRON_RUN_AS_NODE="
set "PATH=%CD%\node_modules\.bin;%PATH%"
set "TWILIGHT_DEBUG_ROOT=%CD%"

where node.exe >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 Node.js，请安装后重新运行。
    goto failed
)
if not exist "node_modules\.bin\electron-vite.cmd" (
    echo [错误] 缺少项目依赖，请先运行 pnpm install --frozen-lockfile。
    goto failed
)
if not exist "resources\audio-engine\twilight_audio_node.node" (
    echo [错误] 缺少原生音频模块，请先构建并暂存音频引擎。
    goto failed
)

powershell.exe -NoLogo -NoProfile -Command "$exe = Join-Path $env:TWILIGHT_DEBUG_ROOT 'node_modules\electron\dist\electron.exe'; $running = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.Name -eq 'electron.exe' -and $_.ExecutablePath -eq $exe -and $_.CommandLine -notmatch ' --type=' }); if ($running.Count -gt 0) { exit 10 }"
if errorlevel 10 (
    echo [提示] 本地版本已经运行。请先从托盘彻底退出，再运行此脚本。
    goto failed
)
if errorlevel 1 (
    echo [错误] 无法检查现有进程，请确认后重新运行。
    goto failed
)

echo 正在启动 Twilight Echo 调试版本，日志会显示在此窗口。
echo 源码修改会自动更新。停止调试请按 Ctrl+C。
echo.
node.exe scripts\run-electron-vite.cjs dev %*
set "TWILIGHT_DEBUG_EXIT_CODE=%ERRORLEVEL%"
echo.
echo 调试进程已退出，退出码：%TWILIGHT_DEBUG_EXIT_CODE%
pause
exit /b %TWILIGHT_DEBUG_EXIT_CODE%

:failed
pause
exit /b 1
