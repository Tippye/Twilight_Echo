# Windows QQ音乐 22.71 → Twilight Echo 实施计划

Goal：实现用户批准的方案 1，保持完整的 Windows 登录、验证、音乐数据、播放、编解码及加解密适配目标。2026-10-14 用户明确批准独立 QQ provider + loopback 音频代理，仅有证据证明必要时引入 native 桥或核心接口。

Architecture：源协议、会话、音乐 DTO 和 QQ 专有内容变换归独立 QQ provider；Twilight 拥有标准媒体解码、播放队列和设备输出。以作者插件仓库的 QQ provider 为复用 owner，不把 Android profile 当作 Windows 实现，也不先制造第二套播放器。

Tech Stack：Node.js 24 ESM、Twilight MediaProvider API、Node HTTP Range proxy；Ghidra 12.1.4/JDK 21 静态分析；独立 x86 Python/ctypes 仅用于本机原 DLL 的受控算法 oracle。

Baseline/Authority Refs：

- 用户完整请求、2026-10-14 方案 1 批准与安装工具授权。
- `Twilight_Echo/docs/twilight-echo-plugin-spec.md`，当前插件 API v3 和可接受的 v1/v2 插件。
- `Twilight_Echo/packages/plugin-api/src/index.ts`，URL-only 播放入口、QR/profile/资料库能力。
- `Twilight_Echo/src/renderer/src/utils/playerSessionTrack.ts` 与 `queueSessionTrack.ts`，持久化白名单。
- `docs/aegis/work/2026-10-14-qqmusic-adaptation/90-evidence.md` 与其 REA/原始字节记录。
- 插件源基线 `52d76a6b6bbd40606119229a136a40ac84099076`；宿主基线 `60a899ecee5f4524d7489e28298b1470b47444d4`。

Compatibility Boundary：保持当前 provider ID/Track 来源和宿主 API；原 Android provider 仅为复用基线。Windows 构建不得将未证实的 Android 登录宣称为 Windows 能力。首次只加入已证实的 Windows 数据变换模块，不改变既有插件的运行 profile 或打包宣传。

TDD Route：Mode=off，Decision=skipped，Strict authority=not applicable。Test posture 为 post-change regression 和原 DLL 输入输出对照；不实施 strict RED/GREEN。

Verification：独立原 DLL oracle 向量、位置/整数边界、分段与整段数据对应、现有 QQ provider 定向离线回归；完整验收还必须有真实登录、请求数据、媒体格式与播放 evidence，单元测试不关闭整体目标。

## 当前准备程度与代码必要性

Requirement Ready Check：用户范围和接口路线已确认；恢复出的 EncryptData/DecryptData 包装层及 XOR 实现足以实施数据变换模块。Windows auth/profile、完整请求序列化和媒体容器用途仍 needs-source，相关生产实现以证据门槛阻止猜测，并在本计划内继续定向调查。

Change Necessity：当前 QQ provider 没有 Windows 固定表变换，现成 Android/网页请求不能满足目标。最小改动是在既有 QQ provider 内加入独立、可验证的 Windows transform owner；此时不修改 2600+ 行入口，不添加未验证的认证 fallback，也不改变 Twilight 核心。

Existence/Owner Fit：复用现有 `plugins/qqmusic-provider`，把新的纯内容变换放入 `lib/windows/`。常量表从目标文件读得，原始摘要、Evidence ID 作为 provenance。这个模块只声明实际函数行为，不声明 QMC/MFLAC/MGG 容器支持。

Complexity：纯变换模块目标 <100 行；Vkey JSON 构造器 103 行，必要的递归复制集中在同一 owner，拒绝 accessor/非 JSON 值而不增加认证 fallback；各测试文件 <180 行；原 QQ monolith 不新增责任。研究脚本和证据留在工作记录，原 DLL/JDK/Ghidra 不进入插件包。若后续原生依赖或 PCM 接口需要核心改动，先给出具体证据与接口影响，再在已批准路线内修订计划。

Execution Route：inline implementation + independent parallel evidence gathering。协调者唯一持有 Git 提交/分支权限；不建 worktree。算法模块通过独立审查后才形成可验证提交。原始 DLL 与账号状态不得被修改。

## Task 1：实现并验证 Windows 固定表变换

Files：

- create `Twilight-Echo-plugins/plugins/qqmusic-provider/lib/windows/data-transform.mjs`
- create `Twilight-Echo-plugins/plugins/qqmusic-provider/lib/windows/data-transform.test.mjs`
- create `Twilight-Echo-plugins/plugins/qqmusic-provider/lib/windows/data-transform-vectors.json`，只接收原 DLL oracle 固定公开输入的结果。
- oracle 与安装证据位于 `docs/aegis/work/2026-10-14-qqmusic-adaptation/qq-common-oracle*`。

Contract：`transformWindowsData(buffer, firstParameter)` 对 Uint8Array/Buffer 原位变换并返回同一对象；firstParameter 是有符号 int32，buffer.length 不超过 INT32_MAX。它保留 native unsigned64 加法/求余语义，特别是负首参和 x==32767 的不求余路径。首参的业务用途尚未确认，API 不将其命名为密钥或文件偏移。

Steps：

1. 从 `qq-common-xor-table.json` 的 hex 固定表核验 256 字节与 SHA-256。实施常量 provenance 和纯函数；输入错误在变换前拒绝，不留下部分写入。
2. 原 DLL oracle 在固定输入上调用已确认 cdecl 导出，记录 original hash、firstParameter、输入/输出 hex、返回长度；oracle 不导入本模块。
3. 将原始 oracle 向量作为 fixture，逐字节比较模块输出；检查首参 0、1、32767、32768、-1、INT32_MIN 和分段边界。分段 firstParameter 必须与原始业务值的连续位置语义一致；跨 signed int32 上界不擅自绕回。
4. 运行精确命令：

```powershell
node --test plugins/qqmusic-provider/lib/windows/data-transform.test.mjs
node --test plugins/qqmusic-provider/index.test.mjs
```

5. 独立 reviewer 校验原函数数据流、unsigned64 边界、fixture 独立性及 no-QMC 过度声明。只有 oracle 对照、模块测试和原有回归全部通过才可提交此任务；缺少 oracle 时保留 needs-verification。

## Task 2：恢复 Windows 登录、刷新与验证契约

当前只实施静态研究，不为未知行为写认证代码。使用已确认 CLoginHost vtable 0x10028d9c 和六个 observer 事件，选择有实际代码指针的虚方法/handler。

Files：`qq-login-next-*` 输出归工作证据目录；完成后 auth 生产 owner 为同一 QQ provider 的 `lib/windows/auth.mjs`，仅在请求 profile/状态边界有证据时创建。

已恢复QQ code、token restore及真实扫码(type4)三个LoginServer/Login请求。最小实现新增 `lib/windows/login-request.mjs` 纯构造owner与 `json-integer.mjs` 精确signed64 JSON数值owner；不创建未证实的QR/刷新状态机。QR params严格只有musicid/token/qrCodeID，不能用code/appid/deviceName分支替代。Node24与当前Electron43运行线支持JSON.rawJSON；纯API在不支持的runtime明确拒绝，生产发布的host版本边界在打包任务中验证。

Steps：读取 vtable/函数指针 → 最多三条关联函数 dossier → 记录请求 module/method、设备/版本字段、成功/失效/刷新/挑战 payload → 与 QR/profile/login DTO 对应。下一轮扩张必须由新证据明确指出缺口。

可复现公共 CLI：

```powershell
$env:GHIDRA_INSTALL_DIR = 'E:\PycharmProjects\MusicAnyClient\tools\ghidra_12.1.4_PUBLIC'
$env:JAVA_HOME = 'E:\PycharmProjects\MusicAnyClient\tools\jdk-21.0.12.1+1'
$env:PATH = (Join-Path $env:JAVA_HOME 'bin') + [IO.Path]::PathSeparator + $env:PATH
node 'C:\Users\Payne\AppData\Local\npm-cache\_npx\af752b90495482d7\node_modules\rea-agents\scripts\rea.mjs' function 'E:\Program Files (x86)\QQMusic\QQMusic2271.18.09.14\QQMusic_Login.dll' '0x1001b560' --snapshot 'E:\PycharmProjects\MusicAnyClient\docs\aegis\work\2026-10-14-qqmusic-adaptation\qq-login-snapshot.json' --provider ghidra --format json --full-output
```

该示例是已完成 constructor 的可复现入口，执行者从其已保存结果选新 handler，不能重复它代替恢复新状态机。

Evidence Gate：原事件名称或本地凭据存在不算登录有效性；服务器状态、刷新和挑战交互必须有目标证据。若需人的扫码/验证码响应，准备具体界面与动作后再请求该输入，而不要求重复批准实现路线。

## Task 3：恢复 Windows Musicu/Vkey/Ekey 请求和音乐数据模型

当前进度：纯 Vkey 四分支构造及 Windows 固定表变换已独立审查并提交 `f6b4a72b46df59ce78fc8d3be8fa63e6b5f10ec1`。37项新增定向测试和29项既有回归通过；生产入口、manifest与打包未接入新 profile。外层已证实 `ct="19"`、`patch="118"`、版本值为字符串以及 `queryvkey` 请求键。非空 Vkey 请求进入 `musics.fcg` 的 Sign/Mask链，不能以 unsigned请求代替实际Windows传输。签名 owner 将放在 `lib/windows/signature.mjs`；依据 CommonFunction 原实现恢复 HMAC-SHA1 与16轮TEA framing，并必须先通过假输入原DLL oracle。

Files：工作证据目录 `qq-protocol-next-*`；已证实后的生产 owner 为 `lib/windows/protocol.mjs` 与 `lib/windows/tracks.mjs`。

Steps：

1. 对 CgiGetEVkey 全局对象 0x101a5648 做 xrefs，而非再 trace 静态字符串。
2. 从真实 procedure 引用恢复最多两个请求构造函数，记录 comm、认证、参数、序列化、响应及错误码。
3. 对 GetVkey/GetEDownUrl、歌曲详情/歌单/歌词用同样的证据驱动方法建立字段映射。分页不是返回固定 100 首；Track canonical id 必须能通过持久索引或详情重建 mediaMid/songmid。
4. 在得出字段证据后写精确序列化与归一化测试，以目标样本为 fixture；未知字段不从 Android 版本移植。

Evidence Gate：endpoint/service 名相同不等于 profile/请求相同；所有请求与 crypto 代码需明确来源证据。Windows 请求未恢复时，不把现有 Android source 包装成 Windows 版本。

## Task 4：把实际媒体变换接入 Range 音频代理

Files：复用既有 provider proxy owner，将 Windows 媒体变换独立在 `lib/windows/media-source.mjs`；最终入口仅做 profile 与协议 wiring。宿主 `getPlaybackUrl` 继续返回 string/null。

Steps：从媒体 Read/Write 和缓存 caller 恢复 firstParameter、内容起点/长度及容器头尾 → 取得真实可验证媒体样本 → 应用数据变换/标准编解码 → 代理按明文 Content-Length/Content-Range 回答。

Evidence Gate：只有算法没有文件格式仍不能接入所有音频。音频加密、参数/缓存保护、编码/转码须分别映射；有真实编码/加密业务时需输入输出或往返验证。刷新改变音质/源版本时不能拼接不同内容。支持无 Range 上游、随机偏移、末段和解密块边界。

## Task 5：闭环登录、播放与安装验收

Steps：定向测试全部 provider 方法 → 在当前宿主安装 Windows 构建 → 真实 QR/会话/挑战/失效验证 → 授权曲目音质与 seek/暂停恢复/过期/账号切换 → 重启和命名队列恢复 → 插件崩溃/停用清理及 token 失效 → 安装包与原 DLL 不分发核查。

Only Claim What Verified：用户完整目标由 90-evidence.md 验收表关闭。离线 mock 或一个 crypto 模块不关闭该表。若外部输入缺失，记录具体缺口和可复现步骤，继续其它独立工作。

## Execution Readiness View

- Intent Lock：保留完整 Windows22.71 目标；已授权实现方案1与工具安装。
- Scope Fence：只修改独立 QQ provider 的任务文件；当前不改宿主核心，不读取/导出账号秘密。
- Baseline Lock：两个源码固定提交与原 DLL 摘要；static、oracle、live evidence 分开。
- Approved Behavior：独立源适配和 loopback proxy；不能静默替换成 Android native。
- Owner/Contract：provider owns protocol/session/content，host owns playback/standard decoder。
- Compatibility：现有 API v3 与 v1 plugin acceptance；Track 持久化白名单；loopback生命周期。
- Retirement：旧 Android profile 保留为基线，Windows release 激活前需要逐项替换证明；不新增自动 fallback 伪装兼容。
- Task Batches：先 transform/oracle；auth/protocol 静态研究可并行；实际 media/activation 依赖其证据门槛。
- Test Obligations：原 DLL oracle、单模块边界、原 provider 回归、重启/Range/账号生命周期和真实播放。
- Review Gates：每个实现 slice 独立审查，严重问题修复并复核；协调者唯一 Git owner。
- Drift/Rewind：同一个名字不等于行为，错误 profile/字段假设立即返回证据恢复，不加猜测 fallback。
- Evidence Before Completion：完整原始 outputs、测试、目标行为、源码变更和可安装结果；只能逐能力标记状态。
- Advisory Boundary：此计划是执行指导，不自动授予完成或验收结论。

## Accepted-route evidence update (2026-10-14 continuation)

The initial no-core statement above records Task1's limited necessity. Later verified host evidence required the official QQ authorization bridge, QR lifetime/race fixes, and generic unsupported-track/queue metadata safeguards; these are within the human-approved方案1 condition. Core commits9ce6b816/621b4bb9/e2a8a967/08e7e797 implement that boundary and identify host1.3.1-qq.1. No original QQ binaries or original account store enter the provider package.

Actual own-session auth/search/library/album/artist/lyrics/native playback/cold restoration/provider-disable evidence now exists. Home Daily/latest SDK and GUI are positive, while public recommended playlist identities require explicit actual-native-detail binding. Discovery actual request/page compatibility is positive; taxonomy, mapping and UI remain active work. Higher quality proofs include HiRes96kHz/24bit/stereo and DolbyEAC3 6sourcechannels; current actual playback output is2channels. RealDTS5.1 acquisition remains open. See20-checkpoint and90-evidence for precise latest artifacts; these are required acceptance gaps, not permission gates or grounds to mark the overall request complete.

## Task 9: Resolve public playlist identities and implement verified discovery

Necessity: actual own-session recommended/search/category DTO creator identifiers do not match NativeDetail host identifiers; category DTO even supplies creator.uin as empty. Existing strict decoder is correct and is retained. Native lookups with the already verified current musicid as both request login_uin and host_uin, without directory id, independently return exact requested dissid, actual host0 matching creator.musicid0, and complete track collections. This is an explicit adapter lookup choice established by real replies, not a recovered creator namespace or a directory201 fallback.

- HTTP owns new pure `lib/windows/playlist-binding.mjs` and corresponding regression suite; loginUin is injected, no second session/cache/device owner. Resolve one provided positive signed64 dissid through existing NativeDetail RPC, bind returned host and creator.musicid losslessly to each other and the requested id, then decode via the retained strict directory/detail decoder and require completeness. Return only canonical reference and normalized detail. Errors are reconstructed from private owned codes; raw upstream content cannot escape. HTTP updates Home source/test to bind its12 supplied candidates before returning summaries.
- Root owns entry integration: its verified read owner passes session identity to Home and public catalog binding, and retains post-await epoch/account/abort checks. Source creator identity remains display metadata. Root owns manifest/normal packaging and actual SDK/UI verification. No original account store access.
- Resources proposes Discovery source/test contract before mutation, then owns only discovery-call module/tests. Configured modules441/435/436 and actual native ct19 response receipts authorize the leaf: exact FullCategory GetAllTag{qq:''}; source0 ordinary category branch; fixed30-row absolute page/use_page1 proven through three nonoverlapping total504 pages; feed From0/30/60 Size30 and actualHasMore, with total0 explicitly unknown per existing host UI. No FromLimit-total equivalence, hot/new mapping for nativeorder5, or unverified AI requests. Name-only SDK category IDs require explicit disambiguation of same names with different IDs, without a first-match guess.
- QR independently reviews fixed binder/Home/Discovery on exact sources and source assets; no new asset budget beyond requested unique48. Regression fakes are not actual auth/playback evidence. Final acceptance requires public playlist normal opens/play and Discovery category/feed next/previous actual renderer behavior, fresh normal archive closure/integrity/install/default launch. Root alone mutates Git.

## Task 10: Direct player quality selection (2026-10-15 user follow-up)

TaskStartSnapshot: Core main c77ae2ff and provider codex/qqmusic-windows-adaptation efcd69b7 were clean before this slice. Installed normal provider 0.4.0-rc.1 / host1.3.1-qq.1, own saved preference FLAC; original QQ and other Twilight processes remain outside this slice. User requested an app quality-switch button after finding the settings entry hard to discover. This executes the existing accepted source/host boundary; no new service, account store or external publishing commitment.

Necessity/owner: PlayerBar has no direct quality selector; QQ already owns six options and their serialized setting. Add optional generic provider getPlaybackQuality/setPlaybackQuality methods returning {quality, options:[{value,label}]}. Keep option definitions and persistence in the provider. The host owns the button and reuses its current load, native queue, playback clock and decoder. Providers without both optional methods keep their existing behavior.

Behavior: a compact labeled quality selector is directly visible in the right player controls in all three main-window bar modes when the current provider supports selection. Its label is the preferred source quality, not a claim of actual decoded/output format. Selection re-resolves the same song with explicit quality/force, then resumes at the latest progress with the current playing/paused intent. Resolve before stopping the old stream; rejection leaves existing playback intact and reports failure. A later track/load, queue-entry change, provider invalidation or newer selection wins over an old result. A selected quality does not trigger silent source or song substitution. Casting is not reconfigured by a local quality selection. The settings form remains another view of the same provider preference, taking effect on next resolution.

Verification: optional-method compatibility and bridge routing; serialized source setting and lifecycle; held-resolution next/duplicate-entry/provider invalidation/newer-selection controls; same-song progress and pause preservation; actual visible six choices and 128/320/FLAC switching on the public RASEN sample; fresh normal rc.2 package/closure/install/cold preference restoration and default launch. Verify HiRes/Dolby through the button where the existing public samples support them; preserve FLAC at closeout. DTS actual sample remains unverified. Root owns UI/store/version/package/Git; HTTP owns QQ setting/method wiring, QR owns generic contract/bridge, Resources reads playback lifecycle and independently reviews the final integration.

TDD Route remains off/post-change. ArchitectureReviewRequired: yes, optional SDK contract plus owned playback re-entry. No strict TDD or extra design approval is required by the accepted implementation authorization; the optional product preference question may steer immediate versus next-song application.

## Task 11: Actual playback metadata and per-track quality availability (2026-10-15 bug report)

TaskStartSnapshot: Core main150cf6aaae6e61a24d074e3780964530ce6f6321 and provider codex/qqmusic-windows-adaptation fbfeb8061b331f909b740ef9e5b4fc75378b0bce clean. User reports standard/FLAC both FILE SIZE3.3MB, missing sample rate and generic source-verification errors for Dolby/5.1; supplied public sample “Same Blue - Official胡子男” (exact QQ identity still to resolve). User explicitly selected immediate same-song switching with preserved progress. Existing independent provider/loopback route and minimal evidence-driven host changes remain authorized.

Diagnosis: independent compound. QQ Track.size is always catalog size_128mp3; formatter always displays it. Native raw loopback source differs from renderer twilight-media grant, so formatter's exact identity check rejects live codec/rate/depth/bitrate. A public synthetic fixture reproduces FLAC96k/24bit becoming MP3/3.3MB/blank rates without changing transport. Separately, global six quality choices ignore per-song native size_hires/dolby/dts flags already proved in original producer; all resolver phases collapse into one error. Positive metadata flags establish candidates, not current account authorization. Unknown fields cannot be coerced to unavailable. Actual Same Blue server facts remain to collect.

Change Necessity / Decision: code-change at existing provider media/quality owner and host authorization/playback identity seam. No configuration or UI text alone can provide the lost identities or actual media lengths. Reuse existing provider playback envelope and main ProviderPlaybackIdentityRegistry; do not add HEAD downloads, expose raw grants, weaken stale checks, or infer missing rights.

- Source owner: preserve native field presence and expose a new optional getTrackPlaybackQualities(track,context) result {trackId,options:[{value,label,availability:'candidate'|'unavailable'|'unknown',reason?,metadataSize?}]}. Keep global get/set preference. Query exact-ID/MID scene0 TrackInfo, distinguish explicit0/positive/unknown, and reject explicit missing quality in getPlaybackUrl too. Return safe stage-specific user errors without raw upstream data or invented VIP-code meanings. Proxy returns verified plaintext bytes; normal playback returns existing host-supported {streamUrl,providerSource:{bytes,...}} envelope. No new auth/store owner.
- Host metadata owner: retain authorization-before/raw-after source identity and verified bytes snapshot with the submitted main queue. Only matching current queue/index/raw source projects optional rendererSource/sourceBytes to PlaybackInfo. Native internal source unchanged; renderer formatting consumes bound current actual metadata and shows unknown remote size if absent, not catalog128 size. Reuse live technical-metadata channel. Preserve local/string-provider behavior and stale/late-result rejection.
- Generic quality bridge owner: optional SDK registration/method allowlist/routing and renderer bridge; old providers unchanged. Formally declare existing backward-compatible playback envelope union at plugin boundary, renderer remains string. Current-track quality UI disables explicit unavailable choices and labels unknown; controller rechecks before persistence/reload. Explicit failed selection retains current stream and quality metadata, no silent rematch/downgrade.
- Root: actual public sample queries/normal UI/native verification, docs/version/normal package/install/Git. Agents own disjoint source/metadata/quality-bridge files and no Git. Fresh relevant tests/types/build, independent review on frozen files, source/ZIP identity and cold/default launch close the slice. Preserve original QQ, other Twilight and existing account state; no new login or capture request unless proved necessary.

Acceptance: Same Blue exact QQ row has a measured per-song quality table; offered/disabled choices match that table. Supported128/FLAC switches show actual different byte lengths and codec/bitrate/rate/depth as applicable, preserve progress/final pause. Explicit missing Dolby/5.1 never produces the old opaque IPC error; unknown/server rejection remains distinguished from unsupported metadata and decoder validation. Existing Dolby positive sample, stale owner controls and old-provider compatibility pass. True DTS/5.1 and spatial output remain unverified absent actual successful samples. TDD remains off/post-change; architecture review required for optional contract and queue identity projection.

## Task 12: Same-song automatic quality downgrade (2026-10-15 user correction)

TaskStartSnapshot: Core main64dbfd37031f294fe21abe22bc960e0edfedc505 and provider codex/qqmusic-windows-adaptation512a15ee81dd17e100306c979241b66a0c7e9d1d clean; host1.3.1-qq.3/provider0.4.0-rc.3. User explicitly requires an unavailable preferred quality to downgrade on the same song instead of repeatedly switching songs. This supersedes Task10/11 and the extracted skill's no-quality-downgrade rule; no new approval is needed. Existing account, profile, source and playback owners remain.

Diagnosis: the provider resolves only one preferred quality. Normal load failure unconditionally enters host source recovery; rematch admits another QQ ID with the same title/artist, replaces queue and persistent references, and recursively loads it without a visited budget. A read-only execution using the actual fallback/rematch functions and public fixtures reproduces B/A/B/A with four searches/reference replacements. The prior explicit quality reload already disables source recovery. The original fallback policy lacked a terminal provider signal, so metadata validation alone could not stop this chain.

Change Necessity / Decision: code-change at the existing Windows provider initial media resolution owner plus generic host terminal-error boundary. Non-code settings cannot retain a high preference while playing a lower available format. Use finite per-request chains: dolby or surround -> hires -> flac ->320 ->128; hires ->flac ->320 ->128; flac ->320 ->128;320 ->128;128 only. Never cross between spatial formats or change song identity. Skip explicit zero, try unknown, each candidate once. Preserve preferred setting; expose actual quality only in the existing playback envelope. Each successful lease stays pinned to one resolver/format during refresh and Range requests.

Only privately attributed missing quality, empty Vkey address or observed business refusal22 may continue; cancellation, login/session/device changes, HTTP/network, unknown codes, invalid identity/key/header/container stop. A generic existing TE-ERR code `provider.playbackUnavailable` carries the terminal result across IPC; the host checks it before any cross-song/source recovery. It carries safe phase detail, not raw URLs/account values. Old providers retain recovery behavior. The quality controller delegates resolution and downgrade to the provider, without copying QQ ordering or maintaining another preference. UI can continue to mark explicit missing options unavailable while a saved higher preference automatically resolves the current song lower.

Verification: provider chain/order/unknown/zero/no-upgrade/session/abort/lease cleanup and authenticated-media error provenance; host real fallback/rematch execution proving terminal no-search/no-replacement and legacy recovery compatibility; current-song selection progress/pause; fresh types/build/relevant regressions; frozen rc4 archive source/closure, normal plugin installation, SameBlue normal play with saved Dolby resolving FLAC, actual metadata and stable ID, positive Dolby, cold preference and default startup. Independent final review is required. No push/PR or unrelated cleanup. TDD remains off/post-change; architecture review covers the new optional terminal error contract.

Independent review refinement: a public fixture proves same-account token replacement could cross candidates because the reused library owner compares only musicid. Playback now reuses the existing full session fingerprint and stops on any session change, without changing library semantics. A separate real-coordinator timing counterexample proves the30s host RPC deadline can preempt5 bounded media attempts, abort the utility, suppress its late terminal result, then emit a generic timeout that reenters rematch. The minimal additional boundary is typed local RPC lifecycle failure at the coordinator owner and getPlaybackUrl-specific terminal encoding in the existing manager; remote provider business errors keep legacy recovery. Increasing timeout or adding a second provider watchdog alone is insufficient. Host agent may edit coordinator/manager and their existing tests plus safe error/spec text; no new service/capability/preference owner.
