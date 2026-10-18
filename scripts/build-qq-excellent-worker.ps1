param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $taskRoot 'audio-engine/build/qq-excellent-x86' }
$taskOutput = [IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($taskOutput) | Out-Null
$taskVswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
if (-not (Test-Path -LiteralPath $taskVswhere)) { throw 'MSVC x86 build tools and vswhere are required' }
$taskInstallation = (& $taskVswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath).Trim()
if (-not $taskInstallation) { throw 'MSVC x86 build tools are required' }
$taskSetup = Join-Path $taskInstallation 'VC/Auxiliary/Build/vcvarsall.bat'
$taskSource = Join-Path $taskRoot 'audio-engine/pcm-worker/QqExcellentWorker.cpp'
$taskProtocol = Join-Path $taskRoot 'audio-engine/pcm-worker/PcmWorkerProtocol.h'
$taskBinary = Join-Path $taskOutput 'twilight-qq-excellent-worker.exe'
$taskObject = Join-Path $taskOutput 'QqExcellentWorker.obj'
$taskBatch = Join-Path $taskOutput 'compile-worker.cmd'
$taskLog = Join-Path $taskOutput 'build.log'
# Paths are passed as quoted batch arguments, never interpolated as commands.
$taskCommands = @'
@echo off
call "%~1" x86 >nul
if errorlevel 1 exit /b 1
cl /nologo /std:c++20 /utf-8 /O2 /EHsc /MT /W4 /WX /D_WIN32_WINNT=0x0A00 /Fe"%~2" /Fo"%~3" "%~4" /link /MACHINE:X86 /NXCOMPAT /DYNAMICBASE
exit /b %errorlevel%
'@
[IO.File]::WriteAllText($taskBatch, $taskCommands, [Text.Encoding]::ASCII)
& $taskBatch $taskSetup $taskBinary $taskObject $taskSource *> $taskLog
if ($LASTEXITCODE -ne 0) { Get-Content -LiteralPath $taskLog; throw 'QQ Excellent worker build failed' }
$taskReceipt = [ordered]@{
  architecture = 'x86'
  runtime = '/MT'
  sourceSha256 = (Get-FileHash -LiteralPath $taskSource -Algorithm SHA256).Hash.ToLowerInvariant()
  protocolSha256 = (Get-FileHash -LiteralPath $taskProtocol -Algorithm SHA256).Hash.ToLowerInvariant()
  binarySha256 = (Get-FileHash -LiteralPath $taskBinary -Algorithm SHA256).Hash.ToLowerInvariant()
  binary = $taskBinary
}
$taskReceipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskOutput 'build-receipt.json') -Encoding utf8
$taskReceipt | ConvertTo-Json -Compress
