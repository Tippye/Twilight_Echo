# QQ 音乐 Windows 适配与逆向资料

本目录于 2026-10-15 将原工作区仓库外的研究结论归档到 Twilight Echo。宿主的 QQ 适配修改保留在 Git 历史中，插件源码与测试收录在 [integrations/qqmusic](../../integrations/qqmusic/README.md)。

## 阅读入口

- [Task14取流、缓存、预加载与超时](task14/README.md)：qq.9限定验收完成，40项归档分开历史失败与最终source/package/GUI/功能冷启；[第40项收据](task14/qq-task14-final-release-summary.json)与[清单](task14-manifest.json)固定来源，构建源码20f47dfbcb298070ff3bf4b619911783d14836eb，provider rc.8/8514。详见[发布说明](../release-notes/1.3.1-qq.9.md)，不声称严格冷音频、立即恢复或P2P加速。
- [Task13 高音质、收藏与本地音效](task13/README.md)：2026-10-18 的实际播放、原生处理与发布验收；[独立清单](task13-manifest.json) 固定本轮源码镜像和证据摘要。
- [能力、证据与限制](records/aegis/work/2026-10-14-qqmusic-adaptation/90-evidence.md)：登录、请求签名、数据映射、媒体变换、实际播放与音质验证。
- [实施计划](records/aegis/plans/2026-10-14-qqmusic-windows-adaptation.md)。
- `records/aegis/work/2026-10-14-qqmusic-adaptation/*findings*.json`：原生函数地址、目标 DLL 哈希、调用关系、结论及证据边界。
- `qq-task12-*.json`：最后一轮同曲音质降级、正常包审计、冷启动及独立审查记录。
- [归档清单](archive-manifest.json)：原始相对路径、归档路径、SHA-256、插件来源提交及宿主归档前提交。

## 验证范围

历史记录包含官方扫码登录、搜索与资料库、歌手与专辑、首页和分类、MP3/FLAC/Hi-Res 与杜比样本的验证。杜比样本源为六声道，实际输出为双声道；没有 DTS 5.1 正向样本，空间渲染和增强逐字歌词等能力仍未验收。各记录的时间、限制和未完成状态保留，不代表重新执行了历史账号或音频验证。

原始报告保留当时工作区的路径和文件名。报告引用的快照、运行日志、截图或采集结果不一定包含在本次归档中；不能将引用视为原始证据已随仓库发布。结论构建脚本依赖本机工具和未归档原始材料，作为调查方法记录保存。插件测试使用随源码提供的固定向量，可独立执行。

## 收录边界

收录研究报告、结论 JSON、结论构建脚本、选定最终验证摘要及完整 QQ 插件源码/测试。保留原始作者和 Apache-2.0/第三方许可声明。

未收录账号配置、登录会话、Cookie/令牌、运行 profile、原生私有快照、原 QQ DLL、解密音频、音频样本、工具安装目录和构建产物。原工作区中的资料没有删除。
