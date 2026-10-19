# QQ 音乐 Windows 适配研究归档

本目录保存已整理的研究结论和证据索引；当前 provider 镜像见 [integrations/qqmusic](../../integrations/qqmusic/README.md)。

## 阅读入口

- [Task15 严格排除本地臻品组件](task15/README.md)：当前 qq.15 / rc.12，Core e026、原生 79780、provider 7d261。全新原生构建、50 配置的 49 通过/1 条件跳过、13 项产物及 meta 已通过；正常 GUI 与功能会话重启已取得置信度 B 的限定证据，提交与推送状态以最终 Git 回读为准；并非严格冷媒体或全网络保证。qq.13 真实暂停切换超时、qq.14 EBUR 构建遗漏导致能力检查失败均保留，不用合成或结构成功替代。见[摘要](task15/final-release-summary.json)、[清单](task15-manifest.json)及[qq.15 发布说明](../release-notes/1.3.1-qq.15.md)。
- [Task14 取流、缓存、预加载与超时](task14/README.md)：qq.9 当时的限定验收、历史失败及来源映射。该版仍含后来被用户排除的 QQ 组件路径，不能作为 Task15 严格范围交付依据。见[第40份摘要](task14/qq-task14-final-release-summary.json)、[清单](task14-manifest.json)及[历史说明](../release-notes/1.3.1-qq.9.md)。
- [Task13 音质、收藏与本地音效](task13/README.md)：保留当时源码、协议和验收范围，不能替代新 DLL/新包验收；[清单](task13-manifest.json)固定历史字节。
- [证据与验证主索引](records/aegis/work/2026-10-14-qqmusic-adaptation/90-evidence.md)、[实施计划](records/aegis/plans/2026-10-14-qqmusic-windows-adaptation.md)及[早期归档清单](archive-manifest.json)。

## 证据边界

当前 Task15 保留普通账号授权、真实网络音质、媒体身份、实际参数、收藏和 Task14 控制/IO 合同，排除 QQ 本地臻品组件和另一会话的独立效果。本版选定实际操作记录了26/23/24项可用 FLAC 索引；不能推广至全部 QQ 源。正式 C++ 生成媒体的精确 PCM、provider 字节游标、固定产物和真实 GUI 是不同证据层；不得把任一层写成另一层通过，也没有新 P2P 加速结论。

Task13/14 共 83 份历史文件原字节不改。原路径、文件名和当时构建/账号环境只代表历史上下文，不能要求新运行继承旧会话或缓存。归档保留研究报告、精简 JSON、合法源码及许可证；不包含账号配置、Cookie/令牌、运行 profile、原 QQ DLL、音频/缓存、截图或构建产物。未归档原始收据仅通过安全摘要和 SHA 引用。
