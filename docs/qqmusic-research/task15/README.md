# Task15：严格排除本地臻品组件

当前候选为 `1.3.1-qq.15` / provider `0.4.0-rc.12`。源码、全新原生构建、限定测试、固定产物及正常 GUI/功能会话重启已有分层证据，**置信度 B**。提交与推送状态以最终 Git 回读为准；不承诺所有网络稳定、严格冷媒体缓存或 P2P 复用。

Core 产品提交为 `e0268bfd6ab136d3684394e15391cc73a2fea670`，原生源码保持 `79780db61f256875415e9cd588653b4ba8579d0e`；provider 为 `7d261d81ef36713df135a2de8a29db7bb4f57df4`。rc.12 TEP 为 276654 bytes，34 成员、32 个可达模块，SHA-256 `b2d0ac8858eac9afdd4bfbc7550b125d62d2d6da16205c1de8360ea848e4cd4b`；最低宿主仍为 qq.13。

## 保留的范围

用户排除的 QQ 本地臻品组件及另一会话的独立音效均不进入产品。Provider、Host、Native 和打包入口的 worker、专用权限、执行绑定、effect/queue 字段及组件资源已退役。真实网络音质 `128`、`320`、`flac`、`hires`、`dolby`、`surround`、`master`、`galaxy` 保留，是否可用仍由当前账号授权和实际取流决定。

旧 excellent 偏好只在既有 settings 事务中迁移一次至 128，不能覆盖后来保存的新选择；显式旧请求保持同一歌曲记录。普通媒体身份、bytes/expiry/session 撤销、收藏、实际 HiFi 参数、IPC seek await、同源 readback、Stop/EOF 资格、取消和异步预加载合同保留。

当前镜像为 provider 冻结树的 78 份文本加 2 份继承诊断，共 80 项；普通诊断不进入 TEP/ASAR。三个已跟踪的旧 rc.6/7/8 组件包仅从当前分发树退役，Git 历史保留；4 份既有未跟踪试验包不删除、不打包、不暂存。

## 本轮修复与证据边界

qq.13 在同曲 playing FLAC、playing Hi-Res 切换时分别成功，但暂停 82.1721875 秒切 FLAC 在 15004ms 后报 `network_io_timeout`，候选被拒绝。故障后目录/占位后缀曾造成 MP3/STANDARD 标签；新元数据投影要求远程实际参数来自匹配且有效的 native snapshot，缺失时显示未知。明确 inactive 会失效，暂停且 active 的实际参数保留；本地回退和已知 DSD/DST 正例保留。35 项生产测试及 29 项只读相邻回归属于源码证据，不是新 GUI 验收。

新的 HTTP raw FLAC 路径在同一 AVIO 中探测实际格式，在读 header 前按实际 FLAC 启用索引；有可用索引时复用现有精确帧裁剪，无表时恢复原回退。坏表首点指向后部帧会被拒绝。没有第二次 open/probe、超时扩张或近似定位。正式 C++ fixture 生成 FLAC，验证两输出采样率共 14 个精确 PCM 窗口、无表回退及坏表拒绝；普通 HTTP 8 项亦通过。本版选定操作窗口记录实际可用索引及 indexed seek：One Last Kiss 关联窗口为 26 项、素直未満为 23 项、Same Blue 为 24 项。歌曲关联来自 GUI 与时间，不是秘密 source 身份；不能推广到全部 QQ 源，也不是原始表头全审计。合成证据与真实观察仍分层。可选的 provider-through-proxy exact PCM 仍未测，与本次正式 C++ 精确 PCM 不同。

qq.14 的 13 项产物检查中 12 项通过，能力一致性因新构建目录遗漏 EBUR include/static library 而失败，未做 GUI。原安装包、ASAR、DLL 三份拒绝产物由协调者按原字节保留。qq.15 恢复旧正确构建的 EBUR 输入，能力文档不降级。首次路径分隔符断言是在 configure 成功后中止的预检查错误，改用 resolved path 后继续，configure 未重跑。

qq.15 从已提交 e026 构建，未提交原生清单为空，331 份原生源码保持不变；全新构建 141.906 秒，新 stage 为 fresh3 产品、精确保留的普通6依赖及新能力2文件。CTest 配置 50 项：49 通过、1 条件 ASIO 跳过、0 失败，148.562 秒；恢复 EBUR 后新增启用 `twilight_loudness_realtime_unit`。不能沿用 qq.14 的 49 配置计数。

生产构建绑定 1987 Core / 86 provider 输入，630 renderer 预算项、642 新输出；日志包含既有 lockfile 依赖维护及 install-app-deps，不能称没有依赖安装。固定产物 13 项及独立 meta 审查通过：174 payload、34 CRC/32 AST、80 镜像、614 packaged out、241 依赖、44 当前源码 pins/4 superseded。原生三产品与新构建绑定，六产品的 canonical strip 从固定输入重现；不是复用旧整套 stage。

本版实际检查已完成限定范围：playing 72.007 秒切 Hi-Res 的 main 请求/结果为 4540ms；暂停目标 native83.5933/UI83.6 秒，FLAC 5743ms、Hi-Res 7056ms，二者保持暂停且参数匹配。初始 FLAC 48k24/50.5MB；Hi-Res 96k24/84MB。素直未満 Hi-Res 不可用时为 FLAC48k24/49.4MB，观察到111秒且未见加载循环，暂停 seek45 后恢复到58.7秒；Same Blue 显示 Hi-Res/杜比/5.1 不可用并保持同曲 FLAC44.1k16/30.2MB。正常重启无需扫码、偏好与收藏保持，实际96k24从22.2推进37.2秒。重启需同 profile 二次启动显示隐藏窗口，这是功能会话重启，不是严格冷媒体实验。历史 qq.10/11/12/13 的失败及其限定成功保留，qq.9 不满足本轮严格排除范围。

## 证据入口

- [退役与验证摘要](retirement-and-verification.json)
- [当前候选摘要](final-release-summary.json)
- [Skill 方法验证索引](skill-validation.json)：知情而非盲测，Root 最新7文件/18本地引用及官方 quick_validate 通过；4轮历史知情检查与3项当前知情前向检查分开，不称盲测或独立原生正确性。
- [归档与镜像清单](../task15-manifest.json)
- [qq.15 发布说明](../../release-notes/1.3.1-qq.15.md)与[当前镜像源码](../../../integrations/qqmusic/README.md)
- [Task13](../task13/README.md)、[Task14](../task14/README.md)：83 份历史归档原字节保持。

这里只收录公开数值和精简结论。原始账号、令牌、profile、媒体 URL/lease、QQ DLL/模型、音频、缓存、截图或构建二进制不进入本归档；收据名称和哈希不表示原始材料已归档。

## 本版真实观察与限制

One Last Kiss 从 native72.007秒切 Hi-Res 成功，main 请求/结果4540ms；暂停83.5933秒切 FLAC5743ms、再 Hi-Res7056ms，同曲、暂停意图及实际48k24/96k24参数均保留。UI 的83.6与native83.5933分开记录，未精确重放历史82.1721875点。后退 seek 的真实 marker 是14.8秒（非精确14.8442），随后观察19.2秒；素直未満暂停 seek45后恢复到58.7秒。自然252.027秒结束后普通下一首 AmaLee 被观察到；没有记录 EOF bool，也未新增单曲 EOF seek/rebuild GUI 用例。

首会话99条main记录、8次Play：7成功、1被后续操作取代。18条warning包括数值 marker，其中2条有未分类错误详情；另保留2次proxy resolve/UNKNOWN，不归因、不写“零错误”。重启main16条、1次Play3452ms；proxy无白名单事件但有3条未知文本，不能称没有问题。计数器和进度为采样观察，非连续听感、商业媒体精确PCM或全网络验证。历史失败保留；不新增P2P复用、原客户端进程缺席或严格媒体冷缓存的声明。
