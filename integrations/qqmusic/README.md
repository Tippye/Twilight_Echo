# QQ 音乐 Windows 插件源码

本目录维护 QQ 音乐插件源码、测试和打包工具，配套 Twilight Echo 1.3.1-qq.15；插件版本为 0.4.0-rc.12，最低宿主为 1.3.1-qq.13。

当前源码同步自 [Tippye/Twilight-Echo-plugins](https://github.com/Tippye/Twilight-Echo-plugins/tree/7d261d81ef36713df135a2de8a29db7bb4f57df4)，保留原作者、LICENSE 和 THIRD_PARTY_NOTICES。只保留正式插件和回归测试，临时调查入口已移出。

插件直接访问 QQ 官方服务，不要求安装或运行原版 QQ 音乐。使用手机 QQ 在官方窗口扫码登录，歌曲与音质仍受当前账号授权限制。本地臻品处理组件不包含在此实现中。

音质选择、自动降级、收藏同步、歌词及功能边界见[插件说明](plugins/qqmusic-provider/README.md)。普通解码、播放控制和实际音频参数由宿主音频引擎负责。

从宿主仓库根目录运行测试：

```powershell
node --test integrations/qqmusic/plugins/qqmusic-provider/*.test.mjs integrations/qqmusic/plugins/qqmusic-provider/lib/windows/*.test.mjs
```

重新打包：

```powershell
node integrations/qqmusic/scripts/pack-plugin.cjs qqmusic-provider --twilight-root .
```

产物位于 `integrations/qqmusic/packages/`，在兼容宿主的扩展中心导入。重新打包需核对清单和模块闭包；Git 文本换行归一化可能使 ZIP 与已有发行包的哈希不同。
