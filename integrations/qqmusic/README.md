# QQ 音乐 Windows 插件源码

当前镜像对应 qq.15 候选：Core `e0268bfd6ab136d3684394e15391cc73a2fea670`，provider `7d261d81ef36713df135a2de8a29db7bb4f57df4` / `0.4.0-rc.12`，最低宿主仍为 qq.13。TEP 276654 bytes，34 成员、32 模块，SHA-256 `b2d0ac8858eac9afdd4bfbc7550b125d62d2d6da16205c1de8360ea848e4cd4b`。镜像为冻结 provider 的 78 份 Git LF 文本加 2 份继承普通诊断，共 80 项；诊断不进入普通 TEP/ASAR。来源、raw/LF 和 Git filter 见[清单](../../docs/qqmusic-research/task15-manifest.json)。保留作者、LICENSE 和 THIRD_PARTY_NOTICES。

用户排除的 QQ 本地臻品组件已从菜单、权限、绑定、Native 和当前分发树退役；真实网络 `master`、`galaxy`、杜比/5.1 等源按账号与曲目实际可用性保留。旧偏好一次事务迁移不能覆盖新选择。rc.12 的单一有限 ciphertext memo 复用原 quota/auth/TTL/Range/cipher 和未命中流式路径，不增加磁盘缓存、P2P、超时或第二套客户端。生产受控字节/游标和 CAPI 结果仅证明其各自范围，候选 through-proxy exact PCM 未测。

qq.15 全新原生构建恢复正确 EBUR 输入，50 项配置为 49 通过/1 条件跳过；13 项固定产物审计及 meta 通过。本版选定操作窗口观察到可用实际 FLAC 索引与 indexed seek，仍不推广至全部 QQ 源；正式生成媒体的精确 PCM 与真实 GUI 是不同证据层。**本版正常 GUI 与功能会话重启取得限定置信度 B。** 提交与推送状态以最终 Git 回读为准。 非零 playing/paused 切换保持同曲/暂停意图，缺源按真实菜单降级；不承诺所有网络或严格冷媒体表现。 qq.13 暂停非零 FLAC 超时及 qq.14 能力构建回归均保留，旧版本限定成功不替代本版验收。详见 [Task15](../../docs/qqmusic-research/task15/README.md)、[当前摘要](../../docs/qqmusic-research/task15/final-release-summary.json)和[qq.15 发布说明](../../docs/release-notes/1.3.1-qq.15.md)。

三个已跟踪旧组件包仅从当前 provider 树退役，历史 Git 对象保留；4 份既有未跟踪试验包不删除、不打包、不暂存。[Task14 历史归档](../../docs/qqmusic-research/task14/README.md)原字节保持。

在核心仓库目录执行插件源码测试：

```powershell
node --test integrations/qqmusic/plugins/qqmusic-provider/*.test.mjs integrations/qqmusic/plugins/qqmusic-provider/lib/windows/*.test.mjs
```

在核心仓库目录重新打包：

```powershell
node integrations/qqmusic/scripts/pack-plugin.cjs qqmusic-provider --twilight-root .
```

产物写入 `integrations/qqmusic/packages/`，通过客户端扩展中心安装。重新从 Git LF 镜像打包时须重新校验 ZIP 和模块闭包；文本的 LF 等价不保证原 provider raw ZIP 的哈希相同。打包工具会验证清单和 ZIP 边界。

更多使用说明见[插件 README](plugins/qqmusic-provider/README.md)和[研究归档](../../docs/qqmusic-research/README.md)。公开归档不携带账户、令牌、profile、媒体 URL/lease、原 QQ DLL/模型、音频、缓存或构建二进制。
