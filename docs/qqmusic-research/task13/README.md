# Task13：高音质、收藏与本地臻品音效

本轮固定 Windows QQ 音乐22.71，交付宿主 `1.3.1-qq.5` 与独立插件 `0.4.0-rc.6`。源码来源、镜像逐文件摘要和本目录证据见 [Task13 清单](../task13-manifest.json)，最终来源与产物摘要见 [发布收据](qq-task13-final-release.json)。源码仅在本地提交，未推送上游。

## 实际行为

- 高码率代理在既有授权、解密及背压下使用四路512 KiB滚动 Range、全局八槽；首个206验证后才并发，200保持单流。相同 lease 的串行→并行→串行对照见 [Range 实测](qq-task13-real-range-comparison-auto.json)，边界复核见 [独立报告](qq-task13-range-independent-review.json)。没有证据确认 QQ P2P；也没有引入持久下载缓存。
- 宿主为 decoder 已确认有限时长的高采样率 HTTP PCM 复用现有两秒 ring，最多等待三秒预缓冲。未知/live 源即使目录 duration 为正也保留快速路径。最终《One Last Kiss》Hi-Res 实测60.78秒推进60.47秒、无反复加载，见 [持续播放](qq-task13-real-performance-sustained-v3.json)。这是当前网络/设备的一分钟结果，不能保证所有歌曲或长期极端负载。
- 播放条提供九档首选。母带、臻品全景声依据每曲真实候选和 OtherMID；缺源时同记录有限降级，不反复换曲。臻品音质明确为普通媒体加本地效果，需当前账号有效能力、本机固定摘要 QQ 组件与受支持格式。[UI 验证](qq-task13-real-ui-v4.json) 包括《素直未満》Hi-Res 缺源后稳定 FLAC、心形点亮，以及暂停切换臻品全景声保留进度；[母带样本](qq-task13-real-master-v3.json) 为192 kHz/24-bit。
- [最终臻品验证](qq-task13-real-excellent-v4.json) 通过实际音质按钮启用效果，连续播放约20秒，暂停后跳到60秒再恢复。HiFi 分别展示48 kHz/24-bit普通源、50.5 MB及本地效果标记。[进程关系验证](qq-task13-real-excellent-worker-process-v2.json) 来自此前相同 helper 的正常 rc.6 客户端；最终打包 helper 另有23项 [合成验证](qq-task13-packaged-worker-test.json)。
- [收藏写入验证](qq-task13-real-favorites.json) 仅把原先未喜欢的公开候选添加后移除，恢复原状态；没有移除已有喜欢歌曲。元数据由播放条、HiFi、可视化共享当前来源绑定和实际 decoder 参数，Float32处理格式不充当编码位深。

## 原生契约和生命周期

通用 source-native F32 transform 位于 FFmpeg 解码线程，在 final SWR/device 前运行；可选 x86 worker 以受限匿名管道调用用户本机 QQ 组件。原 QQ DLL/模型不随包分发。处理失败不会变成正常 EOF 自动换曲；seek 销毁重建处理器。原生 NULL/0 是查询已排队输出，不是时长精确的尾部终结器；没有补造尾部或承诺效果后的帧数等于源时长。契约见 [audio-engine-api](../../audio-engine-api.md)。

worker 参数仅由 main 的可信 provider grant 产生，公共 queue DTO、插件事件和即将播放列表剔除内部参数。注销、插件退出、替换或授权 alias 淘汰会同步撤销队列、preload和在途提交；旧 RPC/ACK 不能重新获得授权。边界复核在其捕获 pins 下无未解决P0–P2，见 [报告](qq-task13-final-boundary-review.json)。

逻辑停止不能证明回调已静止，decoder/DSP 退休继续要求实际 backend stop 或 epoch ACK。[数值反例及候选结果](qq-task13-native-retirement-probe.json) 保留当时源码 pins；最终修复和 decoder-duration 分类由独立只读复核确认，当前 pins 在发布收据中。最终 [CTest](qq-task13-native-regression-final-v2.txt) 为11通过、1个需要外部驱动 fixture 的 ASIO cross-DLL测试跳过；包括完整 runtime、通用 transform、decoder、queue、性能门禁及 ASIO 单元。

## 产物与复验

- 已安装的 `qqmusic-client-adapter` skill 补充性能诊断、本地音效、收藏、生命周期与本轮实现索引；[方法验证收据](qq-task13-skill-sync-validation.json)记录七个文件摘要、引用检查及独立只读场景的前后差异。场景验证不充当真实播放证据。
- [正常插件成员审计](qq-task13-normal-archive-audit.json)：263822 bytes、34个源码精确成员，无诊断入口。
- [发布构建](qq-task13-windows-release-build-v3.txt)：安装包174920079 bytes，269个依赖闭包、原生位数/导入/去调试信息与能力声明通过。独立 helper 精确允许 x86，其他原生运行文件仍要求 x64；FFmpeg LGPL和静态 ebur128许可已附。
- [主进程与打包测试](qq-task13-final-main-package-tests.txt)245项；[插件工作区](qq-task13-provider-tests-final.txt)636通过、1跳过；[镜像 QQ 测试](qq-task13-mirrored-provider-tests.txt)510项；[最终构建](qq-task13-core-build-v6.txt)包含 Node/Web 检查及 renderer资源预算。
- [冷启动](qq-task13-cold-normal-session.json)确认登录有效、rc.6已启用、九档和首选FLAC；[最终默认启动](qq-task13-final-default-runtime.json)关闭 Inspect、安装测试 hook 和启动 observer，无调试端口监听。仅使用独立任务 profile。

## 保留的失败与限制

初次持续播放脚本因测试者误关任务客户端失败，保留在 `qq-task13-real-performance-sustained.json`；v2和v3为后续完整观察。Excellent v3 在并行打包和原生压力测试期间发生 Play 超时，原因未确认；冷启动后的v4完整流程通过，未承诺极端系统负载下的延迟。首次宽选 CTest 包含未构建 fixture 而失败；补建后最终12项结果在v2中。首次打包分别因未配置SMTC工具链、可选worker遗漏去调试信息而失败，修复既有打包 owner 后v3通过。早期失败文件保留，不能作为成功证据。

真实 DTS/5.1 正向音源、Atmos 空间输出、增强逐字歌词仍未验证。杜比历史成功样本为源六声道、输出双声道，不能推广为空间渲染。没有收录账号、凭据、私有歌单内容、真实 lease/密钥、原生私有快照、QQ组件、工具或音频；报告提到的外部材料不代表已经归档。
