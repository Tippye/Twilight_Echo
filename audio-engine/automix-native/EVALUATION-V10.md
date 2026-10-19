# AutoMix 分轨包 2.3：低于 2 GB 的 ZIP

本轮将 Windows CPU/CUDA 分轨包从 3,089,016,378 字节压缩到 **1,980,473,490 字节**，减少 **35.89%**。交付文件低于严格的十进制 2,000,000,000 字节限制，仍为正常 ZIP。

## 实现

- 45 个大文件使用 ZIP LZMA（方法 14），4,893 个小文件使用 Deflate（方法 8）。安装器同时兼容 Store、Deflate 和 LZMA。
- 删除 `nvrtc64_120_0.alt.dll`（86,794,240 字节）。保留主 NVRTC、builtins、JIT linker、cuDNN、cuSOLVER/Mg 和所有原有 GPU 架构。
- PyTorch 2.8 的 Windows 加载器引用 `nvrtc64_120_0.dll`。对剩余 133 个 PE 文件的导入表检查未发现备用 DLL 的引用。
- Python 3.11.9、Torch 2.8.0+cu128、Demucs 4.0.1、模型权重和全部保留的运行时文件均未改变。106 份法律声明保持原字节。
- 安装器使用固定 SHA-256 的 7-Zip 26.04 独立解码器。解码器随播放器提供；安装时通过 stdin/stdout 流式处理 LZMA，不从分轨 ZIP 执行解压程序。
- 保留路径检查、展开大小限制、CRC/SHA 校验、安装进度、取消、回滚和正式安装路径探测；限制 LZMA 字典不超过 128 MiB。

## 验证

- 交付 ZIP：独立 7-Zip 完整性检查、独立解压、4,937 项 inventory SHA-256 检查通过；实际文件共 4,938 个。
- 两首本地歌曲片段：CPU 双声道、CUDA 双声道、CPU 单声道共六组输出与 2.2 逐采样相同，最大误差和 RMS 误差均为 0。
- 缓存复用、真实 CUDA 显存不足回 CPU、超时、模型缺失和模型损坏检查通过。GPU 实测为 RTX 5070 Laptop GPU。
- 播放器 `automix.10` 完整 ZIP 安装及重启恢复通过，CPU/GPU 识别正常。最终播放器的额外重启检查通过。
- 57 项 AutoMix 测试、Node/Web 类型检查、相关 ESLint、10 项发布打包策略测试通过。新增覆盖混合 ZIP、Unicode 文件名、LZMA 损坏/截断、字典限制、取消及缺失解码器。
- 正式打包脚本从 2.2 独立重建得到 **1,979,736,102 字节** ZIP；逐文件内容与交付包一致。7-Zip 对 268 个小文件选择 Store，因此压缩字节数略有差异。
- 播放器依赖闭包、固定解码器 SHA、Windows x64/strip/品牌资源、原生二进制和模型检查通过。原生音频运行时与 `.9` 保持相同字节。

## 重建

在 Windows 项目根目录执行：

```powershell
node scripts/prepare-automix-stem-zip-decoder.cjs
python scripts/package-automix-stem-zip.py --source "D:\StemSource\automix-enhancement" --stage "D:\StemBuild\2.3" --output "D:\Release\Twilight-AutoMix-Enhancement-2.3-Windows-x64.zip"
```

源目录应为带有完整 `package-files.json` 的已验证 2.2 包，暂存目录和输出文件必须不存在。脚本不会修改源目录；只有大小、ZIP 完整性及全部文件校验通过后才发布最终文件和 SHA-256 清单。Windows 打包 hook 自动准备随播放器提供的解码器。

## 兼容与范围

通过播放器安装这个 ZIP 需要 `automix.10` 或包含 `zip-lzma-v1` 支持的后续版本；`.9` 的 ZIP 安装器仅支持 Store/Deflate。外部解压可使用支持 ZIP LZMA 的 7-Zip。

安装后实际占用约 **4.66 GB**，压缩不会同比降低分轨时的 RAM/VRAM。目标盘建议至少留 6 GB 空闲；旧包仍会保留用于回滚。

本轮修改打包与安装兼容，不改变混音规划器、模型精度或过渡判定，也未重新评测 Natural/DJ 的过渡比例。原有总体发布验收状态保持不变。
