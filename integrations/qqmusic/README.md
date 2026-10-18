# QQ 音乐 Windows 插件源码

此目录是独立插件仓库 `Twilight-Echo-plugins` 中 QQ 音乐插件的源码快照，版本为 `0.4.0-rc.7`，目标配套宿主为 `1.3.1-qq.7`，来源提交仍为 `5eb33115090fd5cb4bb6035eab3e7d99ae3afa05`。旧 qq.6 候选源码 `3bacff6e275c2333e1931373f48088e47e1fc8c3` 的插件镜像与产物已有独立字节审计，但随后真实 GUI 的 EOF定位失败。原生 EOF 与服务 Pause 分层修复已有独立审查，qq.7 新版本实测、正常冷启动、新产物及发布冻结仍待补齐，尚不可交付。本轮来源与逐文件哈希见 [Task14 归档清单](../../docs/qqmusic-research/task14-manifest.json)，调查及待验状态见 [Task14 入口](../../docs/qqmusic-research/task14/README.md)；[Task13 清单](../../docs/qqmusic-research/task13-manifest.json)与原 [归档清单](../../docs/qqmusic-research/archive-manifest.json) 保留历史，不代表本轮镜像文件。保留上游代码、作者、LICENSE 和 THIRD_PARTY_NOTICES，不改变插件的原始来源声明。

从宿主仓库根目录执行测试：

```powershell
node --test integrations/qqmusic/plugins/qqmusic-provider/*.test.mjs integrations/qqmusic/plugins/qqmusic-provider/lib/windows/*.test.mjs
```

从宿主仓库根目录打包：

```powershell
node integrations/qqmusic/scripts/pack-plugin.cjs qqmusic-provider --twilight-root .
```

输出位于 `integrations/qqmusic/packages/`，可在兼容宿主的扩展中心安装生成的 `.tep`。构建时使用宿主已有的插件清单校验和 ZIP 工具。

详细使用方法和能力限制见 [插件说明](plugins/qqmusic-provider/README.md)，调查资料见 [QQ 音乐研究归档](../../docs/qqmusic-research/README.md)。快照中的原始文档可能仍引用原工作区路径，请以研究归档的路径清单定位已收录材料。
