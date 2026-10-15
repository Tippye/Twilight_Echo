# QQ音乐客户端与 Twilight Echo 适配调查 - Evidence

状态：用户于 2026-10-14 批准方案 1，接入路线确认完成，实施进行中。本文保存证据和已批准路线；它不表示整体逆向或适配已经完成。实施计划为 `docs/aegis/plans/2026-10-14-qqmusic-windows-adaptation.md`。

## 当前验收状态（后文起始调查保留为历史证据）

| 能力 | 当前直接证据 | 结论与限制 |
| --- | --- | --- |
| QQ 官方扫码、服务端认证、冷启动登录 | qq-real-login-and-playback-smoke.json；qq-enabled-normal-close-cold-session.json | 真扫码成功；当前服务端检查为已登录；原 QQ 客户端账号状态未复制或改动 |
| Windows 请求与加解密 | 原 DLL 固定公开输入 oracle；signature/tea/ekey/media-stream 模块及独立审查 | Windows ct19/cv2271/signature 已接入；QMC mode1/2 与 Ekey 有独立对照，不能推广为所有 QQ 编码 |
| 歌曲、歌手、专辑、歌单搜索 | qq-real-search-catalog-shapes.json；实际 renderer 专辑搜索 | 真请求与 canonical 双 ID 已保留 |
| 个人资料库、完整歌单 | qq-library-real-sdk-mapping.json；qq-library-real-renderer-full-collection.json | 14 张歌单；喜欢目录完整 544 条，541 可进入播放队列，3 条特殊记录有明确不可播放状态 |
| 专辑曲目 | qq-album-real-pagination.json；qq-album-real-renderer-play.json | 《叶惠美》完整 11 首；正常界面点击《以父之名》真实播放 |
| 歌手热门歌曲、简介、专辑 | qq-windows-embedded-artist-findings.json；qq-artist-real-response-shapes.json | 官方配置所指内嵌网页契约；3 接口均经当前 Windows 请求通道接受。全专辑分页及新 handler UI 验收进行中；不是 C++ producer 证明 |
| MP3 128／320、FLAC | qq-real-login-and-playback-smoke.json；qq-rasen-renderer-320.json；qq-rasen-flac-playback.json | 真实音频与播放；seek、暂停恢复成功 |
| Hi-Res | qq-higher-quality-real-acquisition.json | 《破局者》FLAC 96 kHz／24 bit／双声道，真实播放 |
| 杜比 | qq-higher-quality-real-acquisition.json；qq-dolby-seek-pause.json | 《云裳羽衣曲》源 EAC3 48 kHz／6 声道，获取、解密、播放、seek 与暂停恢复成功；实际解码输出为双声道，未验证空间渲染 |
| 5.1 | qq-higher-quality-public-candidates.json；qq-private-format-counts.json | 160 条公开候选及 544 条当前曲库未取得带 DTS 标记样本；没有正向获取／播放证据 |
| 音质入口 | qq-task12-real-fallback-ui-v1.json；qq-task11-real-ui-v7.json；qq-task11-per-track-real-qualities.json | 按本轮用户要求，在同一歌曲记录内有限降级，每档最多一次，保留首选；目录明确缺失项禁用，未知项待验证。SameBlue首选杜比实际FLAC，随后有源歌曲仍播杜比。标准／FLAC往返及暂停进度证据保留；独立迷你窗口及零声音瞬态未验证 |
| 播放页实际参数 | qq-task11-real-ui-v7.json；qq-task11-independent-review-final.json | 修复标准档目录大小被当作所有品质大小，以及grant/raw源身份不一致导致实际解码信息丢弃。SameBlue标准3806594bytes／3.6MB，FLAC31629508bytes／30.2MB；均44.1kHz，FLAC16bit，MP3不显示解码float32为源位深。标准→FLAC→标准显示和实际流一致 |
| Same Blue音质列表 | qq-task11-per-track-real-qualities.json；qq-task12-real-fallback-ui-v1.json | Official髭男dism的两个普通版本scene0均标128／320／FLAC正大小、HiRes／Dolby／DTS0；零档跳过，在同一记录自动FLAC，保留杜比首选及稳定queue entry。业务22仅代表该请求拒绝，不猜VIP含义；周深有源歌曲仍EAC3／48k／源6输出2 |
| 同曲降级与终止 | qq-task12-core-regression-root.txt；qq-task12-source-regression-root.txt；qq-task12-independent-review-final.json | Root516Core及428source测试通过。原同名QQ记录A/B递归重匹配已由通用terminal码阻止；质量候选有限且lease固定。完整session指纹和typed本地RPC生命周期封闭会话替换与host30s超时两个独立反例。未标记的旧provider远端业务错误保留原恢复行为 |
| 日语歌曲失败反馈 | qq-rasen-unified-search-route.json | QQ 的《螺旋》128／320／FLAC 正向通过；复现了两个 NCM 记录空地址失败。未确认用户当时选中的记录，不能宣称历史问题已完全定位 |
| 队列与重启 | qq-named-queue-real-restore.json；qq-enabled-cold-resume-native-play.json | 命名队列 30 首恢复后真播放；开启恢复设置后正常退出、冷启动、37 秒续播成功；测试后恢复原默认关闭设置 |
| 首页与每日推荐 | qq-bound-home-discovery-real-sdk-v1.json；qq-bound-home-real-renderer-play.json；qq-normal-rc-real-sdk-smoke.json | 每日30首、最新发行20首、推荐歌单12张；12张详情完整且与摘要计数相同，公共搜索2张详情成功。身份绑定修复已闭合，主页与歌单实际播放通过 |
| 发现与分类 | qq-discovery-real-renderer-v1.json；qq-normal-rc-real-sdk-smoke.json | 8组81项普通分类，同名私藏已区分；广场和日语分类前后翻页及歌单播放成功，日语两页各30张、无重复、total977。广场总数未知；不声明nativeorder5的热门／最新含义，未启用AI分类 |
| 发布包 | qq-task12-normal-archive-audit.json；qq-task12-cold-normal-session.json；qq-task12-final-default-runtime.json | 0.4.0-rc.4已安装，宿主1.3.1-qq.4；233762bytes、32ZIP成员source-exact/CRC及Acorn30可达模块通过，SHA b32d016c…773322。冷启动已登录并保留本轮实际初始FLAC偏好；默认启动无调试／安装钩子。rc1／rc2／rc3材料保留为历史 |

当前 Windows profile 的凭据保护为宿主 aes-256-gcm-machine 存储路径，不宣称 DPAPI。所有实际账号调查文件只保存类型、计数和布尔关系；公开歌手、专辑、歌曲标识可用于复现。

## 目标与起始状态

- 用户要求：逆向 QQ音乐客户端，把登录、验证、音乐数据、播放、编解码及加解密逻辑适配到 Twilight Echo。
- TaskStartSnapshot：2026-10-14，`E:\PycharmProjects\MusicAnyClient` 起始为空目录，无 Git 仓库、无用户修改。
- 用户追加授权：可以自行安装本任务需要的工具或软件。
- 原生目标：安装的 Windows QQ音乐 22.71，目录 `E:\Program Files (x86)\QQMusic\QQMusic2271.18.09.14`。
- Twilight Echo：本地 `Twilight_Echo/`，提交 `60a899ecee5f4524d7489e28298b1470b47444d4`，版本 1.3.0，Apache-2.0；克隆时工作树干净。
- 作者关联插件仓库：提交 `52d76a6b6bbd40606119229a136a40ac84099076`，QQ provider 0.3.2，Apache-2.0；只作为源码参考。

## 证据索引

REA 原始输出保存在 `rea-pe-evidence.json`；它是 PE 资源结构证据，不是函数反编译或运行时证据。

| 对象 | SHA-256 | REA Evidence ID |
| --- | --- | --- |
| QQMusic_Login.dll | 857c1a4cc9ea287c11ceb4bc49446f6d3fa05070bb3801e50fe3fc6591242c20 | ev_b8ce3de2a252a4f23cb89758cf88e20bc94d8278612846bee5034ec556e147c8 |
| QQMusic_Protocol.dll | ba66aa248b885227179f1676fbc54576a036f46b9d096fea33131c4f30fa6476 | ev_da84745c9f147d3cc83a6430430f144223e5c2050cd1d08fdf7b537005e0b8d7 |
| QQMediaPlayer.dll | 600b5111b0940df2aa19d9600d77076b3a0ae08c0760f2a63ccc6a1dec70281b | ev_f670527d76e6c89e259d4d2e69bff7d451a6254f2a8e20ca476719dc558bdf1c |
| QQMusicApi.dll | 10ed93d19ddd4934111a7d789790dfa6953450f6f3dbd51e2ccf80beb6b8f027 | ev_a599840e7db174814962effab6dedf08b177c44b6c8fa47924832a05dd823a4f |

以上四个模块的 machine 为 0x014c、格式 PE32。普通 Python/PowerShell 的 PE 导出与 ASCII 字符串提取另存 `native-symbol-candidates.json`，不能称为 REA Evidence。

## Windows 客户端的已知入口

以下都是静态观测；字符串出现不能证明请求曾执行，也不能证明完整参数或算法。

| 入口 | 精确位置 | 结论与边界 |
| --- | --- | --- |
| CreateLoginHost | QQMusic_Login.dll，RVA 0x1ba20，文件偏移 0x1ae20 | 初始仅为导出名；后续函数体证据见下，完整对象 ABI 仍未确认 |
| ReleaseLoginHost | QQMusic_Login.dll，RVA 0x1ba10 | 存在该名称导出；释放行为尚未分析，不能仅凭名称编写桥接 |
| music.vkey.GetVkey / UrlGetVkey | QQMusic_Protocol.dll，文件偏移 0x1328c4 / 0x1328d8 | 与公开 QQ provider 使用的服务名吻合；Windows comm、认证和参数仍待查 |
| music.vkey.GetEVkey / CgiGetEVkey | QQMusic_Protocol.dll，文件偏移 0x1288d8 / 0x132890 | 存在加密播放链路候选；不能从 E 字母推出解密算法 |
| music.vkey.GetEDownUrl | QQMusic_Protocol.dll，文件偏移 0x13289c | 存在加密下载 URL 服务候选 |
| music.musichallSong.PlayLyricInfo | QQMusic_Protocol.dll，文件偏移 0x128788 | 存在歌词服务名候选 |
| ?DecryptData@qqmusic@@YAHHPADH@Z | QQMusicCommon.dll，RVA 0x321b5，文件偏移 0x315b5 | 导出符号存在；数据用途、算法、密钥来源与调用者尚未证实 |
| DecryptCacheFile / EncryptCacheFile | QQMusicCommon.dll，详见 symbol JSON | 缓存变换入口候选；与 QMC/MFLAC/MGG 的关系尚未知 |

各模块静态 image base 为 0x10000000；运行时 ASLR 地址尚未观察。DLL 不能直接载入 64 位 Electron 进程；若最终确实需要调用原生代码，需独立 x86 进程及已恢复的 ABI。这只是平台推论，不是当前选定实现。

### 已取得的登录函数体证据

`qq-login-factory.json`：REA Evidence `ev_494fbb0dea1d708d7846870f05dca3c1b43419e18a368e6aea0e7e0b3af55f3d`，Ghidra 12.1.4，shipped-artifact / observed。

- 精确函数：CreateLoginHost，0x1001ba20，96 字节函数体。
- 反编译观测：检查 TLS/static guard；首次路径调用 `FUN_1001b560(&DAT_10031788)`，注册 atexit，然后返回 `&DAT_10031788`。
- 推论：静态登录对象的惰性初始化，比“每次创建新实例”更符合本函数体。不能据此将其当成可自由多实例、多线程调用的普通工厂。
- 未知：构造函数的完整依赖、vtable 方法契约、登录及验证状态机、对象的跨线程可用性和运行时行为；正在按具体 callee 补充。
- 这是反编译伪代码和分析数据库观测，不是恢复的原始源码，也未执行 QQ 客户端。

`qq-login-constructor.json`：REA Evidence `ev_f17a64755155c44b69a2d979bca6636b2c248781dbcc77cd975bc394cd8a90c9`，精确 callee `FUN_1001b560` / 0x1001b560，1193 字节函数体。

- 静态观测：调用 ILoginHost 构造、设置 CLoginHost vftable（0x10028d9c），初始化若干成员，并经 `QQMusicCommon.dll::qqmusic::AddObserver` 注册六个事件。
- 六个事件名：OnLogin、OnLoginOut、OnRefreshMusicKey、Notify_Authorize、Notify_OnRefreshToen（保留目标拼写）、Notify_LoginBuffer。
- 推论：登录对象依赖 QQ 客户端共享事件系统，单独加载导出后直接调用不足以证明完整可用；后续应从 observer callbacks、vtable 和原调用者恢复状态与依赖。
- 未知：事件实际触发条件、payload、刷新请求实现、用户验证流程及跨模块初始化顺序。参数类型中存在 Ghidra FID conflict 和分析类型推断，不能把推测 C++ 类型当成稳定 SDK。

`qq-login-release.json`：REA Evidence `ev_e0cfe791b22672d45108f117e99dab0c3071a64816063b3024e26049771a555e`。ReleaseLoginHost / 0x1001ba10 的 5 字节函数体只有 PUSH/MOV/POP/RET，伪代码为空返回。因此该导出在本次目标中没有释放对象的行为，不能按导出名称为桥接设计实例销毁。

### 协议字符串的定向追踪

`qq-protocol-evkey-trace.json`：REA Evidence `ev_a8c95f3ecf9dc754733b2997a78bf7fc423aa845fa7b3e41185958d9d71e8735`，目标 QQMusic_Protocol.dll 固定摘要与上表相同。

- CgiGetEVkey 的静态地址为 0x10133490。
- 六处引用指令地址为 0x10003d31、0x10003d36、0x10003d3f、0x10004780、0x10004785、0x1000478e。
- Ghidra trace 将这六处标记为 not_in_procedure，当前没有已确认的所属函数；不能从字符串引用推导请求参数、Windows client profile 或解密密钥结构。
- 下一步应进行有界指令与函数边界恢复，并对有证据的请求路径进行状态/数据流对照；不重复相同 trace 来填补缺失的函数边界。

本轮仅进一步尝试候选入口 0x10003d30，REA 返回 `invalid_request: No procedure exists`（完整记录 `qq-protocol-evkey-initializer-function.json`），随后停止扩张。普通静态字节补充保存在 `qq-protocol-evkey-static-byte-supplement.json`：39 字节序列中的 CRT strlen IAT 已辨认，另有两个调用候选和全局对象地址。这段像全局字符串初始化与清理登记，仍属推断；不能称为已恢复的请求构造函数。结果汇总为 `qq-protocol-evkey-summary.json`，Windows endpoint、参数、序列化与实际业务 caller 仍未证实。

### 已取得的数据变换函数证据

目标 `QQMusicCommon.dll` 的 SHA-256：`4267e1c27f7251a31460613a97f5787fd7d9d0be3664e5e615251aba2780471f`。此身份来自原始 DLL 哈希和各函数 REA subject，独立于前述四个 PE resource 记录。

| 输出 | Evidence ID | 函数体与观测 |
| --- | --- | --- |
| qq-common-decrypt-analysis.json | ev_f675bb24ebb242a25062cb9702824e1d53d7820a2053fe7f364f17900de9411a | qqmusic::DecryptData / 0x100321b5，9 字节，跳转到 EncryptData |
| qq-common-encrypt-analysis.json | ev_9bfd8c44b0a53354364f947d2e9d7c546d7b611567f29fc0c8da8c2a39df9c41 | qqmusic::EncryptData / 0x1003219f，22 字节，将首个 int 参数 CDQ 符号扩展并传向 0x10008d51 |
| qq-common-implementation-analysis.json | ev_92a30edf23e08e3b569a882fdc6464ac9b424762ddc453438fb7460c23443f34 | FUN_10008d51，82 字节，原位逐字节固定表 XOR，唯一 callee 为 __aullrem |

静态数据流：首参数扩展为 64 位输入值；对每个 i，将该值与 i 相加。当高 DWORD 非零或低 DWORD 大于 0x7fff 时，按 unsigned64 对 0x7fff 求余。表索引为 `(处理后的值 * 处理后的值 + 0x1b) & 0xff`，mask 来自 0x100bae80 起的字节表，对 buffer[i] 做 XOR。EAX 返回长度。首参数是否为文件偏移、种子或其他业务值仍需调用者证明。

范围限定：这三个精确函数及其汇编支持固定表位置相关 XOR 的结论；不证明全部 QQ 内容加密使用同一算法，也不证明它就是 QMC/MFLAC/MGG 解密。该 helper 的 Ghidra 参数类型包含推断误差，正式 ABI 应以包装层与汇编压栈为依据。后续仍需目标文件、调用者、密钥/位置语义和独立输入输出对照；目前没有执行目标 DLL。

`qq-common-xor-table.json` 保存实际引用的 256 字节常量表，VA 0x100bae80、原文件偏移 0xba080，表 SHA-256 为 `771a9b8588ec7cb87d033184d71b0025addea173f51bfb957d004a443f513ebf`。该文件是原始 PE 读取输出，非单独 REA Evidence。实现 dossier 的静态 caller 元数据包含 EncAndDesMediaFile::Read（0x1001384f）、Write（0x10013966）、DecryptCacheFile（0x10030254）、EncryptCacheFile（0x1003032a）及 EncryptData（0x1003219f）。这些名称与边提供媒体/缓存使用面的候选证据，但尚未反编译这些调用者来确认参数语义与格式。

### 工具安装与复现

用户已授权安装工具。便携安装限定 `tools/`，没有修改全局 PATH/Java 配置：

- Ghidra 12.1.4 PUBLIC：`tools/ghidra_12.1.4_PUBLIC`；官方 ZIP SHA-256 `ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db`。
- Temurin JDK 21.0.12.1+1 x64：`tools/jdk-21.0.12.1+1`；ZIP SHA-256 `f9d6e191ab098c0d416e7d588a24420a8621cd2f4720dab2459b8b7b2d2d8b4e`。
- 两份 archive 均完成摘要核验与路径边界检查后解压；JDK java/javac 版本实测，Ghidra 已通过上述两个 REA 函数分析实际使用。
- [NSA 官方 Ghidra 发布](https://github.com/NationalSecurityAgency/ghidra/releases/tag/Ghidra_12.1.4_build)，[官方 JDK 资产](https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jdk_x64_windows_hotspot_21.0.12.1_1.zip)。
- 当前 REA MCP 服务进程保留原环境；native 分析通过已安装 rea-agents 6.4.0 的公共 CLI，使用只作用于启动进程的 GHIDRA_INSTALL_DIR/JAVA_HOME。CLI 每次关闭拥有的临时分析数据库，快照与完整输出留在本任务目录，目标 DLL 字节不变。
- 使用 `rea function <目标> <函数地址> --provider ghidra --snapshot <对应snapshot.json> --format json --full-output`；公共 launcher 路径由 `qq-*-*.json` 的执行记录与本文工作上下文保留。Ghidra 快照可继续后续定向分析，不能用不匹配 SHA/profile 的快照替代目标。

### 打包资源搜索边界

- `html/qplay.html` 第 45–65 行存在按钮 onclick 到 `window.external.ClientInterfaceForWeb(disconnectXML, 0)` 的调用。XML 为 `command-lable-xwl78-qq-music`、cmd value=1074、subcmd=TurnOffQPlayR。SHA-256：`e677ae0378d567ee7578fca6f8430efd5ccff97e3f44399f69e959c6666a3dbd`。仅证明 QPlay 断开操作的桥接调用源码。
- `qmbrowser/qb.pak` 的 144 个 v4 风格资源记录全部偏移在范围内；SHA-256：`3f632d0ac077602a465b3c8b3da676966680f895921d6dcb205c7cee570f0711`。有限搜索未获得 QQ 登录、Vkey、验签或歌曲模型证据。浏览器的 openLoginPage 常量属于 captive portal，不能视为 QQ 登录。
- `html/qmbrowser/QQMusicAddin/resae` 的直接文本资源没有独立 QQ 业务 JS；未因此推断原生模块或远程网页不存在这些逻辑。

## Twilight Echo 可复用的接口

权威源码：`Twilight_Echo/packages/plugin-api/src/index.ts` 与 `Twilight_Echo/docs/twilight-echo-plugin-spec.md`，运行实现优先于过时文档描述。

当前 `TWILIGHT_PLUGIN_API_VERSION` 为 3；现成 QQ manifest 声明 1。API 主版本、插件声明版本及向后兼容范围必须分别记录，不能把当前宿主误称为仅 API v1。

独立审查确认 `main/plugins/manifest.ts` 第 195–208 行接受整数 1..3，`manager.ts` 第 1253 行按插件声明版本激活；现成 QQ 插件的版本范围兼容本次宿主。`Track` 的任意额外字段不会自动被持久化：`playerSessionTrack.ts` 第 16–52 行及 `queueSessionTrack.ts` 第 45–73 行按白名单保存。保留 songmid/mediaMid 是适配需求，尚非现有保证。需要以 canonical `qq:<id>` 和 provider 持久索引/详情重解析恢复，并验收应用重启与命名队列恢复；只有无法可靠重解析时才提出 DTO 核心扩展。

| 能力 | 现有接口 / 来源 | 适配结论 |
| --- | --- | --- |
| 曲库与音乐数据 | plugin-api 第 395 行起：searchSongs、searchAlbums、searchPlaylists、fetchPlaylistTracksPage、getLyrics | 复用 MediaProvider 与现有 Track DTO，保留 QQ songmid/mediaMid/id 等源标识 |
| 登录与资料库 | plugin-api 第 458 行起：checkLogin、getProfile、logout、openOfficialLogin、getQrLogin、checkQrLogin、fetchUserLibrary | 可承载 QQ 状态机；不能把本地凭据存在当作服务器会话有效 |
| 播放 | plugin-api 第 400 行：getPlaybackUrl 返回 string 或 null | 没有 headers/PCM/decoder callback 契约；鉴权和解密可由插件音频代理承担 |
| 本地音频代理 | plugin spec 第 113 行；manager.ts 第 1815 行附近 | 返回 loopback HTTP(S) URL 可使插件宿主保持运行，已有生命周期支持 |
| 常用编解码 | audio-engine/decoder/FFmpegDecoder.cpp 第 599 行附近 | 标准 MP3/AAC/FLAC/WAV 等复用现有解码器；QQ 专有格式要另行证实与适配 |
| 凭据保存 | settingsStore.ts 第 101 行；secureStorage.ts 第 21 行 | 敏感键通过宿主保护；持久化与登录状态须遵循已有 owner |
| 原生 / 浏览器桥 | plugin host 为 utilityProcess；插件不能 import Electron；仅有 qishuiAuth 专用接口 | QQ 内嵌验证若确有必要，需要窄宿主接口；不能复制一个通用任意执行桥 |
| 文件播放授权 | security/localPaths.ts 第 209–223 行 | 插件私有缓存文件默认不获音频授权；采用 loopback 或明确扩展受控授权 |

主项目规范第 74–87 行明确第三方插件应独立维护。接入 QQ 的生产逻辑应由 provider 拥有；播放器核心仅承担通用媒体解码与播放。DSP 扩展不等于源解码入口。

## 现成 QQ provider 的真实范围

一手来源：[作者插件仓库](https://github.com/Px-asen/Twilight-Echo-plugins/tree/52d76a6b6bbd40606119229a136a40ac84099076/plugins/qqmusic-provider)。以下结论来自固定提交的静态源码，不表示本机帐号已测试。

- `index.mjs` 第 28–33、431–464 行：ct=11、cv=14090008、Android channel ID、Android 设备参数和 User-Agent。它的 native QR 是 Android 协议，不能作为 Windows 22.71 协议复现的证据。
- 公开搜索走网页型接口；登录和部分音乐数据使用 musicu + MQTT。
- 第 1766 行起：必须登录，UrlGetVkey 后返回 loopback 代理；代理支持 Range，并在部分 CDN 错误时重新解析 URL。
- 音质限于 F000 FLAC、M800 MP3、M500 MP3；ape/hires 请求会降级，不能宣称支持 APE 或 Hi-Res。
- 无 QMC/MFLAC/MGG 内容解密；QIMEI RSA/AES/MD5 参数保护不等于音乐内容解密。
- checkLogin 仅检查本地 auth/device/profile；业务接口遇到过期状态清会话要求重扫，未发现 musickey 刷新流程。
- 可复用：DTO 归一化、provider 注册、QR UI 状态映射、Range 代理结构和测试方式。Windows 客户端协议、刷新和专有内容处理必须由实证补齐。

## 接入方案（方案 1 已获用户批准）

三个方案的取舍：

1. **复现已证实的 Windows 协议，适配独立 QQ provider（推荐）**：登录/验证/会话、数据与 Vkey/Ekey 由 provider 拥有；需要专有内容变换时先恢复算法和测试向量，再向 Twilight 返回标准音频 URL。保留原目标，便于逐项验证，逆向成本较高。
2. **调用原客户端 DLL 的 x86 桥接进程**：可能复用原生逻辑，但依赖 COM/vtable/初始化和目标版本；只有 ABI 与行为验证充分后才能选，当前不能承诺它更快。
3. **直接采用现成 Android QQ provider**：可以较快获得一部分 QQ 功能，但不能满足“适配 Windows QQ音乐客户端逻辑”的完整目标；不应静默作为完成结果。

推荐边界：复用 Twilight 现有 MediaProvider、设置与播放器；优先通过独立插件的 loopback Range 音频代理封装鉴权、过期 URL 恢复和经验证的内容解密。仅在证据显示必须使用 native ABI、PCM 回调或内嵌验证时，再提出具体核心接口变化。

First-principles / Architecture Integrity Lens：

- 必须满足：Windows 客户端逻辑的证据到适配代码有可追踪对应，目标帐号权限和实际音质被正确表达。
- 现有 owner：provider 持有源协议；Twilight 播放器持有通用编解码与设备播放。避免同时在 renderer/main/provider 重复保存凭据、重试与解密状态。
- 新接口的创建证明：只有已有 string URL 契约无法表达经确认行为时才改核心；已支持的 loopback 不是新宿主接口。
- 反例：登录凭据已过期、Ekey 有效但返回加密内容、跳转播放需 Range、代理退出、验证码挑战、QQ 升级后 ABI 改变。以上不能被一次搜索成功或一次解密导出调用覆盖。
- 当前决定：先补 native 函数证据；x86 桥和核心 API 扩展均未获创建证明，不作为默认实现。

独立审查补充的验收边界：

- 分别盘点请求参数保护、会话/缓存保护、音频内容加解密、编码/转码；有实际编码或加密业务路径时，需官方输入输出对照或往返测试。标准解码复用不表示编码也已覆盖。
- Range 按解密后的明文字节定义。测试首段、随机偏移、尾段、块边界、容器头尾、明文 Content-Length/Content-Range、上游忽略 Range 和播放中 URL 失效。刷新源版本或实际音质变化时，不得拼接两份不同内容。
- 登出/切换帐号后使旧代理令牌和帐号缓存失效；真实处理无权限、会员/地域限制及音质降级状态；覆盖挑战取消/恢复和插件崩溃后重解析。
- 代理只绑定回环，使用不可猜测的会话令牌；日志与响应不泄漏 Cookie/Ekey。

## 实现阶段的验收要求

| 用户要求 | 必须有的验收证据 | 当前状态 |
| --- | --- | --- |
| 登录 | QR 等待/扫码/成功/失效/取消状态与实际帐号登录结果；明确来源协议版本 | Windows 流程未还原 |
| 验证与会话 | 服务器检查、刷新、失效重新登录及遇挑战时的真实处理 | 未还原；现成 provider 不足 |
| 音乐数据 | 搜索、专辑、歌单分页、资料库、歌词的真实数据与 DTO 一致性；重启和命名队列恢复后源标识仍可重新解析 | 宿主接口已确认；Windows 请求待还原 |
| 播放 | 已授权曲目的实际播放、音质、seek/Range、暂停恢复、取消与过期 URL | 未测试 |
| 编解码 / 内容加解密 | 文件头与算法/密钥来源、可复现测试向量、解密后媒体校验、目标格式实播 | 尚未取得充分证据 |
| 打包运行 | 安装后的插件可用、生命周期和异常清理；必要核心改动通过定向回归 | 未实施 |

调查/宿主接口阅读完成不代表整个适配完成。后续应按以上表逐项标为已验证、部分或未解决；缺失能力必须显示真实状态。

## EvidenceBundleDraft

- Artifact key: native-pe-resources
- Type: static-analysis
- Source: rea-pe-evidence.json
- Summary: 四个 Windows QQ 22.71 DLL 的 PE32 资源结构、SHA256和完整REA记录；无函数或运行时行为证据
- Verifier: REA inspect_pe_resources and JSON parse

## EvidenceBundleDraft

- Artifact key: native-symbol-candidates
- Type: static-analysis
- Source: native-symbol-candidates.json
- Summary: 七个DLL导出符号、RVA与字符串候选，普通shell输出，非函数还原
- Verifier: Python PE parser

## EvidenceBundleDraft

- Artifact key: qq-provider-offline-baseline
- Type: test
- Source: Twilight-Echo-plugins 52d76a6b6bbd40606119229a136a40ac84099076/plugins/qqmusic-provider/index.test.mjs
- Summary: 29/29离线mock测试通过；不证明Windows协议或实际账号播放
- Verifier: node --test plugins/qqmusic-provider/index.test.mjs; delegated execution

## EvidenceBundleDraft

- Artifact key: native-login-functions
- Type: static-analysis
- Source: qq-login-factory.json;qq-login-constructor.json
- Summary: CreateLoginHost静态guard与共享对象、CLoginHost构造及六个AddObserver事件，函数体证据；无运行时登录
- Verifier: REA CLI Ghidra12.1.4; exit0

## EvidenceBundleDraft

- Artifact key: native-login-release
- Type: static-analysis
- Source: qq-login-release.json
- Summary: ReleaseLoginHost在固定版本仅5字节空返回，不承担实例释放；名字不等于行为
- Verifier: REA CLI Ghidra12.1.4 exit0; complete normalized function inspected

## EvidenceBundleDraft

- Artifact key: native-protocol-trace
- Type: static-analysis
- Source: qq-protocol-evkey-trace.json
- Summary: CgiGetEVkey六处引用均未归入procedure，未恢复Windows请求参数
- Verifier: REA CLI Ghidra trace exit0; normalized result inspected

## EvidenceBundleDraft

- Artifact key: native-common-transform
- Type: static-analysis
- Source: qq-common-decrypt-analysis.json;qq-common-encrypt-analysis.json;qq-common-implementation-analysis.json
- Summary: DecryptData到EncryptData包装层及82字节固定表位置相关XOR实现，未证实格式用途或运行时向量
- Verifier: REA Ghidra12.1.4; three ok=true dossiers; normalized functions inspected

## 批准后的实施与新增证据

用户已明确批准方案1，继续完整 Windows22.71 适配；无需再次批准原路线。生产入口尚未切换为 Windows，不将原 Android provider 的测试计为 Windows验收。

- 固定表变换：原 DLL x86 oracle 的26组公开输入、104次导出调用通过返回长度、往返、canary与原DLL摘要检查。`qq-common-oracle-vectors.json`为原输出；模块fixture没有计算期望值。首参的媒体用途已由后续Read定位为position-derived，但Read mode1传完整64位、cache函数先DWORD相减再CDQ，现有int32模块不能自动覆盖全部媒体路径。
- Windows Vkey：`qq-protocol-next-summary.json`证实四个服务分支与param字段；`qq-protocol-next-transport-summary.json`证实ct/patch字符串、cv表达式和queryvkey外层。请求序列化、认证及传输是独立owner。
- 首个实现提交：插件仓库 `f6b4a72b46df59ce78fc8d3be8fa63e6b5f10ec1`，只含五个任务文件。协调者fresh验证37项新测试、29项既有回归和staged diff检查通过；Vkey JSON漂移P2经修复与独立复核关闭。该提交时仓库clean/detached HEAD；无分支/worktree/push/PR。
- 真实wire：`qq-protocol-next-wire-summary.json`证明非空Vkey走CommonFunction Sign/Mask链与musics.fcg；不能以unsigned musicu推测Windows兼容。QMNetwork CHttpHost实际HTTPworker仍在恢复。
- Sign/Mask原算法：CommonFunction hash `a28ebdd9eda2d3dfbfc540578681bc71425136858e29bc07a22ead142510187d`；key09f40、slot0、TEA core及framing已获得静态body证据。16轮大端TEA与HMAC-SHA1不是凭cipher名称选择。
- Sign/Mask原DLL oracle：`qq-sign-native-oracle.py`及`qq-sign-native-oracle-v2.ps1`在单独x86子进程用20组公开假输入调用实际factory/slot0/cleanup；同一IAT的CRT srand/rand采样并reset。输出保留包含一个末NUL的长度/hex，20组输入及canary不变、固定种子结果可重复、原文件摘要不变。`qq-sign-oracle-v2-vectors.json` SHA256 `65599dfc861d0d5626fc3f224685a96c218cee99db47d2277c1dab2306bfcbaf`。
- 独立公式核对：`qq-sign-oracle-verify.py`不加载DLL、不导入JS，对上述20组原输出验证HMAC、真实随机前缀、TEA16解密、padding/salt/metadata/7zero，全部通过。副作用边界仍明确：DLL初始化与detach执行、native文件/registry/network/UI/子进程无trace或OS containment；重定向profile不是安全隔离。
- 签名移植：signature.mjs/tea.mjs已实现，24项定向测试含20组native逐字节Sign/Mask匹配；默认crypto随机源、注入流逐项范围验证。尚待独立代码review与协调者提交；未接生产请求。
- 运行时结构观察：Frida17.23.3只attach hash固定版本路径的PID47120，限定时窗，stop解除hooks并detach。QJS无URL导致漏采的问题由self-test定位后修复；合成credential/prototype测试通过。`qq-runtime-account-owner-shapes.jsonl`仅读自然getter输出的代码虚表指针，确认IQQMPAccount slots位于Protocol RVAabeed/aae4b/acb65，没有读取账号字段。此前无request事件的时窗不证明没有网络或协议不存在。
- 宿主准备：全局pnpm9不能读取新workspace overrides，改用仓库指定pnpm11.7.0后frozen安装成功；原lockfile和宿主Git工作树不变。构建与原生音频运行仍待验证。

以上纯算法slice的直接证据不能关闭登录、服务器验证、音乐数据、实播或打包验收；完整目标状态仍为needs-verification。

## 后续结构观测与第三提交

- 用户QQ扫码路径已选择，实际换曲时的采集`qq-runtime-user-actions-v2-shapes.jsonl`有已脱敏的Windows signature-input记录。comm字符串ct19/cv2271/patch118得到runtime交叉验证；queryvkey使用GetEVkey/CgiGetEVkey，四组song字段确为array。Desktop搜索方法DoSearchForQQMusicDesktop与PlayLyricInfo/GetPlayLyricInfo明确出现。此证据是发送前输入，不是网络成功/response/播放内容证明。
- type4 static producer为LoginServer/Login、仅musicid/token/qrCodeID三字段；code及token restore是独立legacy请求，不自动fallback。用户本次没有进行新扫码，因此不能称其实际账号走type4已观察。signed64是实际decoratedJsonCtor _J，appid构造默认100497308是已确认owner值，后续运行覆盖仍未知。
- Login DTO与精确数值owner提交`8ba197c8b8e969b5b6b5462c56f2596d35ca49bd`；source14+69lines/test63lines，6项新增+90项已有定向/回归全部通过。NUL truncation P2仅在3个C-string字段拒绝，empty保持，std::string字段未误套处理；fresh peer复核闭合。
- `twilight-json-runtime-probe-final.log`直接验证Electron43.5.0/Node24.19.0支持精确JSON.rawJSON；这只验证运行时数值功能。源码构建不能证明原生音频播放；发布binary摘要核对和界面启动也不能关闭QQ插件能力。
- 原作者安装包`19c3a8864180506f3088baf8cbed9969f9adea057783ee0be9cf0df56e77a7f0`只提取task-local image，frontend运行PID65396/loopback9283。原始安装器未执行。REA targets/page observations分别ev_18308a27af3d912a9deb0eab76ed820bae1d9e35f7e02aa6fcd4475ec90b1cf0、ev_7322d91510c7ca66c2577bb40fe5c7d390c5479f30e6e598a93c44163d37b4a1；界面DOM结构有policy filtering，不执行Electron API，不声称native decoder已验证。
- Native资料还原持续推进，单个错误或缺procedure保留失败记录。空vtable slot不能作发送worker；响应callback写globals早于code检查不能作登录有效；media parser返回true/key接入返回true不能作解密成功。新边界详见分层findings，不与live/account成功混合。

## Windows integration update 2026-10-14

- QQ OAuth/真实官方QR与captcha/SMS source、受限main-process bridge、anonymousPNG smoke：qq-qr-resources-findings.json、qq-qr-resources-host-bridge-verification.json、qq-qr-resources-host-anonymous-smoke-attempt2.json。原用户账号未参与该匿名smoke。
- 原CommonFunction media内核：qq-commonfunction-media-transform-findings.json、qq-commonfunction-media-cipher-* dossiers，original raw internal-key oracle v1 sha512271c128c498909af6aedc866d3a394838b783a8e65ecd3c38d3b52dd63525；zero v2 sha550c5da813fc76eec5e95eac21c32bc880d36b66a02668b60ebf638f07cb2e43。不是实际Ekey/container/playback证据。
- Windows comm/wire independent review：qq-http-backend-comm-wire-review.json；login response review：qq-login-response-review.json。public getter instruction probe给出full2271/main22/sub71，不执行getter。
- metadata UID source链：cafcf写musicid到payload+70，ac1b7写该字段到55f8/fc，737a8以%I64u格式化该global；正UID QQ会话可用session.musicid。
- 当前nativeHTTP actualJSON Content-Type是否覆盖仍unknown；worker构造default enum1且WinwebSDK默认form-urlencoded。agentclient将采用此已证默认作兼容实现选择，不声称证明全部wire相同。
- 官方native资源stage证据：twilight-native-stage-provenance.json。release sourcecode/bindings diff0+actual NAPI load/APIs支持兼容推断；未声称本任务编译native或播放成功。

### Real QQ auth and native media accepted

2026-10-14 human QQ scan -> server verified session + cold restoration, then real 晴天 MP3 and GetEVkey FLAC native engine play; MP3 seek/pause observed, stop both. Sanitized metrics and precise limits in `qq-real-login-and-playback-smoke.json`. Host grant is twilight-media; existing audio play route resolves it. Missing Vkey sip handled by explicitly identified official dl CDN compatibility base followed by real byte validation, not asserted native default. Full music-data/library and queue goals remain open.

### Real Hi-Res, Dolby and Japanese-song investigation

- qq-quality-findings.json closes native requested filename levels6/10/12 and format flags, with distinct raw song.type. Independent quality review found no actionable issues; synthetic/fake tests remain separately labelled.
- qq-higher-quality-real-acquisition.json: real Hi-Res 张杰/破局者 FLAC96kHz24bit stereo+native playback; real Dolby 周深/云裳羽衣曲 EAC3 448kbps48kHz6sourcechannels+native playback. Decoder/output was2channels; no spatial hardware-output claim. qq-dolby-seek-pause.json adds actualseek120,pause,resume.
- 5.1 mapping and synthetic content path verified; positive actual5.1 source acquisition still open. All160 scannedpublic metadata rows and544 private rows reported no positive size_dts. This does not prove global absence or unsupported permission.
- Actual rendered quality settings save320 and normal QQ-only RASEN row playedMP3 320kbps. QQ-only original/acoustic/anime128 variants played; primaryFLAC played44100Hz16bit andseek60. User-reported historical GUI failure is unreproduced, remains open.
- User-library actualDTO counts/owners proved, but3 type21 emptyMID/mediaMID records fail strictmapper and native TrackInfo(types21)returns[]; library/playlist production registration remains open pending truthful special-record contract. Favourite-list deleted/hidden consumer investigation ongoing.
