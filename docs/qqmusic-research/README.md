# QQ 音乐 Windows 适配资料

当前实现、使用方法与测试命令见 [QQ 音乐插件源码](../../integrations/qqmusic/README.md)和[插件说明](../../integrations/qqmusic/plugins/qqmusic-provider/README.md)。宿主通用播放接口见[音频引擎 API](../audio-engine-api.md)。

## 维护范围

- 插件负责官方登录请求、会话、曲库数据、歌曲身份、音质候选和授权媒体取流。
- 本地音频代理负责内容解密、Range、有限并行预读和租约内缓存；宿主负责标准解码、输出与播放状态。
- 首选音质与实际音频参数分开显示；缺源在同一歌曲内有限降级，不替换歌曲记录。
- 本实现不分发原 QQ DLL 或模型，不调用原客户端 P2P；本地臻品处理组件已移除。

## 研究记录

早期协议与实现资料保留在[证据索引](records/aegis/work/2026-10-14-qqmusic-adaptation/90-evidence.md)、[实施计划](records/aegis/plans/2026-10-14-qqmusic-windows-adaptation.md)和[归档清单](archive-manifest.json)中。原始运行环境和历史结论不代表当前版本重新完成了全部验证。

后续开发阶段的重复日志、测试输出、逐文件验证清单和临时调查入口不再随当前源码维护，可从 Git 历史追溯。发布说明与安装包由维护者单独创建 Release。

实际音质受曲目及账号授权限制。杜比媒体解码不等于空间扬声器输出；真实 DTS/5.1 正向样本与增强逐字歌词仍需单独验证。源码仓库不携带账号、令牌、运行 profile、真实媒体地址、原 QQ DLL 或音频缓存。
