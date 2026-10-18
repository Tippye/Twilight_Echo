# QQ 音乐 Windows 插件源码

此目录是独立插件仓库 `Twilight-Echo-plugins` 中 QQ 音乐插件的源码快照，版本为 `0.4.0-rc.8`，来源提交 `8514b96b4af3c9f88ce93718bc06d8c18496f698`，目标宿主为 `1.3.1-qq.8`。正常 TEP 的 SHA-256 为 `a3e59a6d06f024ccbb9f4998b72cac529f4d74da4437bec741dd284f2e418016`；80项源码/测试镜像的原始字节和 LF 文本摘要见 [Task14 清单](../../docs/qqmusic-research/task14-manifest.json)。保留上游代码、作者、LICENSE 和 THIRD_PARTY_NOTICES，不改变原始来源声明。

当前公共分支为 `codex/qqmusic-streaming-fixes`，文档冻结前的产品代码基准为 `e689af4489c5ecde0f004f36377575514872d12f`。它从既有Task13基线选择本任务修改，保留原有QQ组件适配，未引入另一会话的独立音效实现。Task14的39项历史开发候选证据保留其原提交、产物及失败来源，不能作为这个公共分支的新包验收；最终产物审计、真实GUI/单首EOF、正常冷启动和发布冻结仍待完成，尚不可交付。具体边界见 [Task14入口](../../docs/qqmusic-research/task14/README.md)。[Task13清单](../../docs/qqmusic-research/task13-manifest.json)和原 [归档清单](../../docs/qqmusic-research/archive-manifest.json)继续保存历史。

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
