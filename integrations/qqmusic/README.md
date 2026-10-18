# QQ 音乐 Windows 插件源码

此目录是独立插件仓库 `Twilight-Echo-plugins` 中 QQ 音乐插件的源码快照，版本为 `0.4.0-rc.6`，配套宿主为 `1.3.1-qq.5`，来源提交为 `2de4bf293ec3abb907a2089c79602427be855f47`。本轮来源与逐文件哈希见 [Task13 归档清单](../../docs/qqmusic-research/task13-manifest.json)；原 [归档清单](../../docs/qqmusic-research/archive-manifest.json) 保留 Task12 历史，不代表本轮文件。保留上游代码、作者、LICENSE 和 THIRD_PARTY_NOTICES，不改变插件的原始来源声明。

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
