# Task14：第二阶段 transport 静态调查

本次只读检查安装目录中的 `tp2p.dll`、`TVKDownloadProxy.dll` 和桥接方 `QMNetwork.dll`，没有启动或挂接 QQ，没有读取用户缓存、账号或音频，没有重新运行大范围 Ghidra 分析。REA 独立 stdio 实例实际打开并校验两件目标后关闭；未触碰 Root 的 REA 会话或服务器配置。新导入导出、字符串及小范围机器码由 PE/Capstone 离线核对。地址为 PE 首选 VA，实际 hook 应使用模块 RVA。

| Artifact | SHA-256 | 大小 / 导出 |
|---|---|---|
| tp2p.dll | `3c1817c00f08ba3b85cd21e22bafdea3b2e862330ec1ba0a9380672cc1f971d8` | 4,141,336 B / 40 |
| TVKDownloadProxy.dll | `1979b868e265b0d39de9c2c5996d673dbe071e84c5215ed9b699e5ef145bc4d8` | 5,262,616 B / 22 |
| QMNetwork.dll | `ce160adb08e0bbf76d667f9528d89d03d33bbbce0e09bd7059fe81ba5f4702c4` | 本轮同时核对桥接与 delay import |

**Type 2 静态桥指向 tp2p.dll。** 既存 REA `ev_ed5cbf061118b6da313c1b95d7b89148e4534e9c3ea5c0b19b2c83aea1d5b1ce` 已显示 `FUN_10031b21` 对 type 2 调用 IsSupportTP2P 门控。新核对的构造函数在 `QMNetwork+0x31b98` 检查 type 2，然后构造 `+0x3a47e` 对象，其主 vtable `+0x2277e0` 首槽为 `+0x3a66e`。该槽函数中的 `+0x3a6dd` 调用 delay-IAT `+0x25c7b4`，PE delay-import 项明确为 `tp2p.dll!_GetTP2PInterface@0`。普通 import 列表没有这项，单看普通表会漏掉它。Windows delay loader 在实际执行此路径时才解析目标；静态证据不保证本次播放成功走到该点。

tp2p 的 `_GetTP2PInterface@0`（RVA `0xbb60`）懒创建全局接口，对象构造函数为 `+0xd1b0`、主 vtable 为 `+0x32dbdc`。公开导出包括 `TP2P_getLocalVodUrl`、`TP2P_getLocalDownloadUrl`、`TP2P_preloadPlay`、`TP2P_getResInfo`、`TP2P_getResInfoExtra`、`TP2P_getCachePath`、`TP2P_updateResParam` 和外部缓存装载/合并接口。导出名表明有本地代理、资源统计和预加载边界，**尚未恢复稳定参数布局、资源 ID、所有权和返回结果 ABI**，本轮未调用这些接口。

**另一写入路径有独立 HTTP/CDN、并发和缓存候选，不能直接命名为 peer 流量。** tp2p 包含分开的 `cdnBytes`（VA `0x1032eaa8`）、`pcdnBytes`（`0x1032eab4`）、`cacheBytes`（`0x1032eac0`），以及 `fs/pcdn_concurrent_switch`（`0x1035b46c`）、带 Range/requestOffset 的 concurrent prepare 日志（`0x1035b5f8`）和 `_requestCDN@Concurrent` 类型信息。它还包含 `fs/pcdn_host`、`fs/pcdn_xcdn_vhosts`、xcdn 响应 rhost 和 originhost→replacehost 重定向日志（`0x10355550`）。这些是可用的后续归因锚点，证明二进制具备多来源/并发 CDN 与 host 替换的实现线索；没有实际配置值、当前选中 host 或各来源字节计数，无法证明这些能力在本次歌曲生效，也不能从名字 PCDN 推断实际 peer 来源。

**TVK 是另一套可配置下载代理，但本轮没有证明 type 2 经由它。** `GetTPDownloadProxyFactory`（RVA `0x15e70`）返回带 vtable `+0x445ac4` 的静态工厂对象。普通/延迟 import 都没有建立 tp2p↔TVK 的直接依赖；本轮筛选字符串也未在 QMNetwork 中找到 TVK 工厂名。这是有界负证据，仍不能排除其他宿主模块用运行时拼接名字加载它。它与 tp2p **都含 `tp_dp_file`**，因此共享文件名不能唯一识别实际写入者。

TVK 的明确参数词汇包括 `dl_param_preload_duration`（`0x104613d0`）、`preload_size`（`0x10461424`）、`file_size`、`file_duration`、`cache_copy_first`、`need_cache`、`dns_cache_first`、`prepare_priority`、`prepare_running_timeout`、`http_limit_speed_kb`、`http_proxy_host/port`、`pcdn_urls`、`multi_network` 和 QUIC 模式。日志区分“按 byte size 限制 prepare 下载”和“按 preload time 限制 prepare 下载”，以及 HTTP Range、切换 URL/403/404 终止等路径。**这些字符串没有证明 QQ 当前传入的参数、默认值、并发数、重试次数或选 host 的具体算法**；不能把枚举词汇直接复制成适配器的有效配置。

Root 提供的 88,129,955 B 新文件与 legacy HTTP/worker 计数缺口是当前运行态事实，但本次没有对这次采集重新归因。最小后续证据是由 Root 在既有授权采集中：确认实际加载模块及 type 2 桥是否执行；针对同一公开资源绑定，观察既有资源统计返回中的 CDN/PCDN/cache 数量字段；关联目标写入句柄和对应模块调用栈。应只输出数量、字段类型和模块/RVA，不输出资源令牌、完整 URL 或请求头值。本次未实施这些运行操作。

完整身份、导入导出和匹配字符串在 `qq-task14-static2-inventory.json`；小范围反汇编在 `qq-task14-static2-bridge.json`、`qq-task14-static2-delay-bridge.json`、`qq-task14-static2-constructors.json`；REA 实际打开/关闭回执为 `qq-task14-static2-rea-open-*.json` 和 `qq-task14-static2-rea-close-*.json`。新观察不冒充 REA decompile Evidence；仅上面引用的旧 Ghidra 结果具有该 Evidence ID。
