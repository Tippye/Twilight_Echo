# QQ 音乐 Windows 插件源码

此目录配套宿主1.3.1-qq.9，provider版本0.4.0-rc.8，来源8514b96b4af3c9f88ce93718bc06d8c18496f698，正常TEP SHA-256为a3e59a6d06f024ccbb9f4998b72cac529f4d74da4437bec741dd284f2e418016。80项镜像中78项为该provider提交源码/测试，2项为Task13 bd3基线继承的Core诊断源码，未包含在正常34成员TEP或ASAR；逐项来源及raw/LF摘要见[清单](../../docs/qqmusic-research/task14-manifest.json)。保留上游作者、LICENSE和THIRD_PARTY_NOTICES。

产品构建源码20f47dfbcb298070ff3bf4b619911783d14836eb、最终产物及限定真实GUI/功能冷启动验收见[第40项收据](../../docs/qqmusic-research/task14/qq-task14-final-release-summary.json)。历史39项与qq.6/qq.7/qq.8失败继续保留；公共分支不包含c99/1d35独立音效实现，既有Task13组件适配保留。限制及发布位置见[Task14入口](../../docs/qqmusic-research/task14/README.md)与[发布说明](../../docs/release-notes/1.3.1-qq.9.md)。

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
