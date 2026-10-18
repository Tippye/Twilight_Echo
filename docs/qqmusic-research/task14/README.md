# Task14：取流、缓存、预加载与超时

本归档保留本轮调查及历史开发候选证据。**目标宿主为 `1.3.1-qq.8`，当前39项记录不是新公共分支的产物/实播验收，最终一槽留给新包、GUI、冷启动和发布冻结，尚不可交付**。qq.7 已实际观察FLAC96kHz/24-bit，但保进度切音质仍失败；后续 renderer时钟、代理握手及native seek预算三项修复已有历史源码/合成审查。qq.7 当时配套 provider `0.4.0-rc.7`，来源提交 `5eb33115090fd5cb4bb6035eab3e7d99ae3afa05`，插件 SHA-256 为 `b34358153e38a0b72e6510f187147d96aabd907f3b68af070734f408152e68b2`。旧 `qq.6` 安装包153,196,613 bytes，SHA-256 为 `81605cdd7ee0915f29cfcdfefa52e665a96fffbfc7dccdca89c704ef4fdc9088`；旧产物审计继续保留其历史角色。

当前公共分支 `codex/qqmusic-streaming-fixes` 从既有Task13基线选择本任务修改，文档冻结前产品代码基准为 `e689af4489c5ecde0f004f36377575514872d12f`；保留原有QQ组件适配，不含另一会话的独立音效实现。当前provider为 `0.4.0-rc.8`、来源 `8514b96b4af3c9f88ce93718bc06d8c18496f698`，TEP SHA-256为 `a3e59a6d06f024ccbb9f4998b72cac529f4d74da4437bec741dd284f2e418016`，80项镜像已按实际raw/LF文本更新清单；最终canonical构建提交和安装包由最后收据绑定。

以下仅为历史开发出处：已审计旧候选源码为 `3bacff6e275c2333e1931373f48088e47e1fc8c3`；Task14 slice `28c23565ee7345cdb7dbd4e3a090f80a9f51fd42` 曾与开发树基线 `c99cb5bdf34ba93c8b79e3709881b84c56b05849` 集成为 `ac573ac083b244d6d253ab1ae93c2b9f38fad33c`。这些SHA只保留证据的实际来源，不表示当前公共分支包含该开发树的独立实现。十二项slice pins、集成pins和控制层审查pins不改写为新分支结果。完整来源及归档摘要见[Task14清单](../task14-manifest.json)。

历史 `qq.7` 产品源码为 `05186af4bb6a8bbe464d4d77cc7eccc187e1f1d0`，其原生EOF/Service Pause修复见[两项修复合并证据](qq-task14-eof-and-pause-repair-summary.json)。之后开发候选的10项文件pins、qq.7失败、独立审查及native9项CTest见[三项修复汇总](qq-task14-qq8-pre-release-repairs-summary.json)，其中完整源码、DLL与构建结果仍属于切公共分支前的开发候选。当前行为合同见[音频引擎API](../../audio-engine-api.md)。

## 历史开发候选的已有证据

| 范围 | 结论及入口 |
| --- | --- |
| 原版缓冲与 transport | [缓冲策略摘要](qq-task14-native-buffer-policy-summary.json)保留目标摘要、REA ID 和20秒/30MiB策略；[第二阶段报告](qq-task14-static2-findings.md)及[收据](qq-task14-static2-receipt.json)确认 delay-import 到 `tp2p!_GetTP2PInterface@0` 的静态桥、CDN/PCDN/cache 计数与并发 CDN 线索。TVK 是否参与、实际来源字节归属及可独立复用 ABI 仍未知；不能把缓存文件名或 PCDN 名称当作实际 peer 流量证明。 |
| 原版冷缓存 | [严格已知媒体缓存冷测](qq-task14-qq-strict-cold.json)、[UI](qq-task14-qq-strict-cold-ui.json)和[恢复日志](qq-task14-full-media-cache-state.json)：整个已知 `downloadproxyNew`（包括共享块目录）隔离，QMDL 原本不存在，旧进程退出后新进程验证同一公开记录。新文件从零增长并完整取得88,129,955 bytes；原媒体缓存已恢复，账号/设置等未迁移。该边界强于早期只隔离选定歌曲目录的实验；不证明 CDN 远端缓存为空或所有未知实现均不存在。 |
| 未来块重试 | [收据](qq-task14-proxy-recovery-receipt-v2.json)：仅未发布 ciphertext 可以有限重试；保留同源身份、同 Range 和原预算剩余时间。已发布字节不重放，授权/身份/完整性/取消错误不借用网络恢复；Retry-After 严格解析。 |
| 有界预读 | [实现](qq-task14-read-ahead-receipt.json)、[独立复核](qq-task14-read-ahead-independent-review.json)及独立反例：网络任务每响应4、全局8，与32×512KiB owned compressed credits 分开。实际源字节配合 fresh TrackInfo duration hint 估算20秒并限制2–8MiB；首块立即流式输出。16MiB为该 owner 的压缩块界限，不是 RSS 或全系统网络上限。 |
| paced HTTP 阴性结果 | [同输入8秒延迟实验](qq-task14-paced-http-comparison.json)和[解释](qq-task14-paced-http-analysis.json)：两版均完整消费32MiB、没有模拟缺流。额外 socket/Node 缓冲掩盖延迟，不能用这个结果宣称减少了卡顿。 |
| paced HTTP 压力结果 | [事先选择依据](qq-task14-paced-http-progress-slow-design.json)、[完整数值](qq-task14-paced-http-progress-slow.json)和[解释](qq-task14-paced-http-progress-slow-analysis.json)：唯一追加的固定第32块每64KiB进展3秒场景，旧版一次约435ms模拟缺流，候选版为0。两版 hash 相同、各64次请求、并发峰值4；这证明受控字节消费场景的领先改善，不能替代真实 FLAC 输出。 |
| 普通 native 网络故障 | [旧版故障](qq-task14-ffmpeg-fault-baseline-v2.json)、[最终故障矩阵](qq-task14-ffmpeg-fault-final.json)、[A 审查](qq-task14-native-a-independent-review.json)和[持续进展](qq-task14-native-a-progress-independent.json)：startup/read-idle/seek/cancel 分层；健康持续进展可超过15秒；网络错误与自然 EOF 区分。取消后无 seek 重启不保证 sample-exact。 |
| 异步下一曲及模式变化 | [B 审查](qq-task14-native-b-independent-review.json)、[性能补审](qq-task14-native-performance-independent-review.json)和[模式/集成补审](qq-task14-native-integration-independent-review.json)：当前曲输出/ACK 不再等待下一曲网络准备，队列/路由/模式变更按既有 owner 取消或重发；accepted 不等于 ready。旧11-pin审查不覆盖后来发现并修复的 AutoMix mode eligibility 问题。 |
| 服务边界与集成 | [服务反例](qq-task14-service-timeout-probe.json)、[独立恢复复核](qq-task14-independent-recovery-review.json)、[最终集成门禁](qq-task14-integrated-native-final-receipt.json)：caller 超时与 native 实际完成分开。集成后9项 CTest及新 worker 合成 HSR/seek/EOF 验证通过；不等于实际候选客户端或安装包验收。 |
| 暂停定位与恢复屏障 | [最终控制层独立审查](qq-task14-paused-seek-fix-independent-review.json)：实际 Seek ACK和 fresh native readback 后才确认位置，依赖的 resume 等待同源事务；失败清展示 latch并保留拒绝屏障，显式新 transport 可恢复；确认的后退位置在普通 merge 后权威提交。18项管理器用例及2项额外并发反例通过，不相加为全套测试，也不代表新版48/96k真实 UI 已通过。 |
| 旧候选源码与安装包 | [qq.6 历史产物独立审计](qq-task14-final-artifact-independent-audit.json)：安装包175文件逐字节映射，TEP34成员 raw/Git blob/Core镜像及32模块闭包，614个 built out文件、241包依赖、7个 native从固定原始输入重放 canonical strip，PE架构/import closure、fresh capabilities、license和私有诊断排除均通过；并入 Root packaged worker23项摘要，未重复执行。旧候选 Core `test:audio-manager`506项无失败/skip，production typecheck/build及630文件预算核对通过；它随后 GUI 失败，不是新 qq.7 的验证。未执行安装程序或证明 NSIS envelope 语义。 |
| EOF 与 Pause 分层修复 | [合并安全证据](qq-task14-eof-and-pause-repair-summary.json)：原生产 DLL 用合成静音复现自然 EOF Stopped46、Seek45假成功仍46；修复在慢 Seek 内实际准备为 paused，手动 Stopped Seek 返回 NOT_INITIALIZED。独立7项真实 CAPI 反例和5项 native pins通过。ServiceBinding按一次 admission 决策分配 caller期限及在途归属，仅fresh native Stopped或Paused/shared非released且无慢前驱保持fast；Playing、unknown、exclusive、released及慢前驱使用既有slow tier。新9项反例、Core515项与独立Service57项通过，node typecheck/格式通过；各计数按范围分别记录，不代表 qq.7 真实播放或新包已验。 |
| qq.7 实测失败与后续三修 | [合并安全证据](qq-task14-qq8-pre-release-repairs-summary.json)：实际96k24已见，保留32.7103秒切流约5.385秒超时；main两次普通seek真实成功，renderer旧样本拒绝后退另有复现/107项独审。代理同lease满32credits时新头等待，large partial GET改为先flush身份已验的逻辑206，音频验证与quota不变；53项及3个独立public API反例通过，真实32占用未知。生成FLAC在750ms请求延迟且非零起点复现旧5秒seek总上限；新5秒byte-idle/15秒绝对及startup含首次定位共享15秒，10HTTP/6CAPI/3定点CTest与新9项集成通过。各层结果不能混加或视为新包实播验收。 |
| 真实百秒同曲对照 | [混合基线](qq-task14-real-streaming-baseline.json)为 Task14 web/service + Task13 native-v5/rc.6，[候选](qq-task14-real-streaming-candidate.json)为集成 native + rc.7，不是两个完整历史版本。均为《One Last Kiss》同一记录、FLAC 96kHz/24-bit、88,129,955 bytes。baseline100.005秒推进99.973秒，candidate100.036秒推进99.860秒；两者100次采样均无 loading，未复现基线卡顿。首播计时6.836→7.127秒，没有首播或持续播放速度提升证据。 |
| 原版进程独立性 | [进程核对](qq-task14-standalone-process-check.json)固定候选同次测试前后原版 QQ 音乐进程数均为0、普通任务 profile、无安装 hook。该记录不等于最终无调试默认启动验收；本地臻品音效的可选本机组件依赖也不在此 Hi-Res 样本中消除。 |

## 仍需补齐

真实 GUI v1 从 EOF252秒暂停状态 seek45秒，约6591ms后恢复时提示 `native seek position was not confirmed`；这不是亚秒立即恢复实验，当次实际采样率未证。原始失败记录 `qq-task14-final-sky-ui-v1.json` 保留于研究工作区，未将含推荐列表的整棵 UI 树收入安全归档；后续最终 GUI 汇总必须保留该失败及摘要来源。

qq.7 在实际96k24播放后仍发生保进度切音质失败，其结构审计通过也未关闭真实门禁。后续三修的历史开发门禁通过，当前公共分支仍需独立绑定新的full build/native gates/source/package、真实保进度切音质、单首queue自然EOF后seek/恢复、普通暂停定位、正常无调试冷启动及发布验收。现39/40项，最后一槽留给新公共分支的最终合并收据。百秒稳定对照与Task13历史成功不能替代这些结果。

## 归档范围与摘要

本目录只收录选定报告和安全 JSON，不包含音频、缓存文件内容、账号/令牌、真实媒体 URL、profile、原 QQ DLL/模型或构建二进制。部分报告引用的原始 trace/log/fixture 未收录，应按清单中的 source 原始摘要理解其来源，不能假定全部原始材料随仓库分发。

`source_sha256` / `sources.raw_sha256` 是原始输入字节；`sha256` 是安全归档后的工作文件字节；`git_lf_sha256` 为 LF 文本摘要，`git_blob_sha1` 为对应内容对象。历史条目已做只读 Git filter 核对，本次新汇总及更新的README由canonical LF字节计算对象摘要，最终仓库filter复核待来源冻结。绝对本地路径缩减为 basename，并记录 JSON 指针。二进制插件仅收中央目录/CRC 元数据，原 ZIP 摘要按二进制原样计算，未进行换行归一化。
