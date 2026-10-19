# QQ 音乐 Windows 插件源码

本目录维护 QQ 音乐插件源码、测试和打包工具，配套 Twilight Echo 1.3.1-qq.15；插件版本为 0.4.0-rc.12，最低宿主为 1.3.1-qq.13。

源码最初同步自 [Tippye/Twilight-Echo-plugins](https://github.com/Tippye/Twilight-Echo-plugins/tree/7d261d81ef36713df135a2de8a29db7bb4f57df4)，保留原作者、LICENSE 和 THIRD_PARTY_NOTICES。此分支中的 QQ 适配以本目录为维护入口，修改、测试和打包均在 Twilight_Echo 内完成，无需检出独立插件仓库。其他插件不受此安排影响。

插件直接访问 QQ 官方服务，不要求安装或运行原版 QQ 音乐。使用手机 QQ 在官方窗口扫码登录，歌曲与音质仍受当前账号授权限制。本地臻品处理组件不包含在此实现中。

音质选择、自动降级、收藏同步、歌词及功能边界见[插件说明](plugins/qqmusic-provider/README.md)。普通解码、播放控制和实际音频参数由宿主音频引擎负责。

从宿主仓库根目录运行测试：

```powershell
node --test integrations/qqmusic/plugins/qqmusic-provider/*.test.mjs integrations/qqmusic/plugins/qqmusic-provider/lib/windows/*.test.mjs
```

重新打包：

```powershell
pnpm run build:qqmusic-plugin
```

产物位于 `integrations/qqmusic/packages/`，在兼容宿主的扩展中心导入。重新打包需核对清单和模块闭包；Git 文本换行归一化可能使 ZIP 与已有发行包的哈希不同。

## 主程序与插件统一发布

完成 Windows 主程序构建后执行：

```powershell
pnpm run prepare:qqmusic-release
```

命令使用当前主仓库中的插件源码重新生成 `.tep`，并将对应主程序安装包、插件包、`release-manifest.json` 和 `SHA256SUMS.txt` 汇总到 `release/qqmusic-<主程序版本>/`。安装包默认读取 `dist/TwilightEcho-<主程序版本>-setup.exe`，也可通过 `--installer <路径>` 指定同名安装包。

手动创建一个 Twilight_Echo Release，将上述四个文件一起上传即可。用户安装主程序后，在扩展中心导入同一 Release 的 `.tep`；插件最低宿主版本仍由清单检查。此命令不上传文件或创建 Release，生成目录不提交到 Git。
