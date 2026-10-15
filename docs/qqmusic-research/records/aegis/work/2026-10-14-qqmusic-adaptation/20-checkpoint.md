# QQ音乐客户端与 Twilight Echo 适配调查 - Checkpoint

- Task ID: 2026-10-14-qqmusic-adaptation
- Current todo: 恢复Windows认证、签名、HTTP与媒体格式并逐项适配
- Active slice: windows-contracts-and-runtime-evidence
- Blocked on: 真实扫码与播放行为需要用户操作；独立静态/算法验证继续执行
- Next step: 完成Sign/Mask原DLL oracle；核实请求与媒体读取边界

## Checkpoint Update

- Current todo: 完成Common/Protocol定向函数证据并提交设计确认
- Active slice: native-evidence-and-design-review
- Completed todos:
- 克隆并检查Twilight宿主接口与持久化边界
- 识别Windows22.71目标并完成PE资源/符号调查
- 核查现成QQ provider的Android边界和29项离线测试
- 安装校验便携Ghidra/JDK并分析两个登录函数
- Evidence refs:
- 90-evidence.md
- qq-login-factory.json
- qq-login-constructor.json
- Blocked on: 生产实现尚需接入设计确认与完整协议证据
- Next step: 完成Common/Protocol证据，复核报告并请求路线确认

## DriftCheckDraft

- Scope status: 保留完整Windows QQ适配目标；目前仅静态调查与设计提案，整体未完成
- Compatibility status: 拟复用现有provider/loopback入口；无生产API变更
- Retirement status: 无逻辑删除；未复制Android协议当作Windows实现
- New risk signals:
- Track白名单持久化、native singleton事件依赖、格式用途和请求参数未恢复
- Advisory decision: pause-for-user

## Checkpoint Update

- Current todo: 等待用户确认接入路线；后续恢复Windows请求/状态机并实施全部适配
- Active slice: awaiting-design-confirmation
- Completed todos:
- Twilight接口和Track持久化边界调查
- 工具安装校验和Windows目标身份验证
- 登录工厂、构造和空Release导出函数证据
- 固定表XOR包装层与核心实现及原始常量表证据
- CgiGetEVkey有界trace和无procedure失败记录
- 独立设计审查与现成QQ provider29项离线测试
- Evidence refs:
- 90-evidence.md
- native-analysis-index.json
- qq-protocol-evkey-summary.json
- Blocked on: 接入路线确认；Windows状态机和请求参数、目标样本/运行时验证仍缺失
- Next step: 收到路线确认后落实设计/实施计划并继续定向逆向

## Checkpoint Update

- Current todo: 验证数据变换oracle、审查Windows请求构造并继续auth/transport恢复
- Active slice: transform-oracle-and-native-contracts
- Completed todos:
- 用户批准方案1；实施计划落盘
- 独立插件owner克隆固定基线，未修改宿主核心
- 实现已观察Windows数据变换模块和Vkey四分支构造
- Windows请求构造6项定向验证、既有QQ29项回归通过
- Evidence refs:
- docs/aegis/plans/2026-10-14-qqmusic-windows-adaptation.md
- qq-protocol-next-summary.json
- Blocked on: Windows外层认证/传输和真实登录播放证据尚未恢复
- Next step: 原DLLoracle后独立审查；继续真实调度与初始化接口

## Checkpoint Update

- Current todo: 验证CommonFunction Sign/Mask算法，定位HTTP owner与实际媒体格式
- Active slice: windows-signature-and-live-request-shapes
- Completed todos:
- 用户批准方案1，原DLL oracle的26组向量对照通过
- 独立审查修复Vkey JSON漂移，37项新测试与29项原回归通过
- 本地提交f6b4a72b46df59ce78fc8d3be8fa63e6b5f10ec1；插件仓库clean/detached HEAD，未建分支或worktree，宿主未改
- 确认Windows comm/queryvkey和musics.fcg的Sign/Mask分层
- Frida request-shape工具修复QJS缺少URL的漏采问题；synthetic self-test验证脱敏与prototype安全
- Evidence refs:
- qq-common-oracle-vectors.json
- qq-protocol-next-transport-summary.json
- qq-protocol-next-wire-summary.json
- qq-sign-next-static-vectors.json
- qq-runtime-selftest.jsonl
- Blocked on: 实际账号输入、请求接受、媒体格式/播放闭环仍未完成；不是设计批准或decompiler缺失
- Next step: 原签名DLL假输入oracle、纯签名模块、用户操作后的请求shape核验

## Checkpoint Update

- Current todo: 恢复QR获取/轮询、Login响应/验证、mode2 media cipher并组装Windows source
- Active slice: live-windows-contracts-and-auth-media-leaves
- Completed todos:
- 三个本地slice提交：f6b4a72(transform/Vkey)、d36f20a(Sign/Mask)、8ba197c(QR/code/restore三请求与精确signed64)
- 新login cString NUL差异P2修复后独立6/6复核；协调者96项定向/既有测试全pass，插件repo clean/detached HEAD
- Electron43.5.0实际Node24.19/V8 runtime probe确认JSON.rawJSON与9007199254740993精确JSON number
- 宿主源码构建pass；作者Windows1.3.0安装包sha核验、只解包运行，无安装器执行；官方frontend PID65396，本地CDP9283已检查
- 用户选择QQ扫码、实际搜索播放并再换曲；06:30~06:40结构采集中实际有queryvkey/GetEVkey、Desktop搜索、PlayLyricInfo等输入；未持久化账号/令牌值
- Common媒体mode1使用物理full64偏移；mode2 mflac/mgg/mmp4路径、musicex尾部、ord3/8/9及key/stream intake来源已定位
- Evidence refs:
- qq-runtime-user-actions-v2-shapes.jsonl
- qq-login-qr-next-findings.json
- qq-login-context-next-findings.json
- qq-common-media-format-findings.json
- qq-commonfunction-media-factory-findings.json
- twilight-json-runtime-probe-final.log
- Blocked on: QR image/code生产与轮询仍未知；服务响应/refresh/挑战待恢复；modernEkey/cipher缺完整变换；真实Twilight播放/安装未闭环
- Next step: auth response parser100cafcf、CommonFunction a695/98a0/9a60；Windows comm/transport的可复现组装和目标样本验证
- Parallel recovery: upstream_qq_reuse两次model capacity失败，Root复用5d150完整输出并完成同slice第3份5c5d3；两个是HTTP header callback/空返回，不能称真实发送owner

## Checkpoint Update

- Current todo: 将QQ官方扫码、Windows client/state、Desktop search与modern media接入可运行插件，完成真实登录/播放
- Active slice: windows-client-and-media-integration
- Completed todos:
- 用户已换曲操作的request结构成功保存，未持久化账号/令牌值；不用再次请求同样操作
- plugin新增commit9ce5fe0(comm/metadata/signed wire)和9abdc73(lossless响应/完整登录state提取)，分别独立审查通过
- Root Frida只读版本getter代码：Common RVA3f0d4返回2271，3f0e6返回22，3f0ea返回71；无目标getter调用，qq-version-getter-probe.json
- OnLogin ac1b7的globals55f8/fc源payload+70；cafcf同时将musicid写+20和+70，所以签名metadata accountIdentity在成功QQ会话中为musicid
- core正式QQ扫码bridge提交9ce6b816（8文件），root44项相关验证pass；全plugin505项0fail/1skip、font9/9、build/ESLint通过
- 官方window源码证明用户QQ路径OAuth→xlogin→ptqrshow/ptqrlogin，captcha/SMS须官方网页；TME QR源码明确要求QQ音乐扫描，不能替代用户QQ选择
- 真实hidden匿名Electron43.5 QQ bridge生成111x111 PNG（1931bytes），立即窗口/session清理，未保存二维码/key/qrsig/code、未登录或触碰原QQ profile
- media原DLL internal-key oracle v1 16cases/32Read与v2 zero7cases/14Read全部pass，canaries/SDKrelease均通过，生成expected不调用port
- Root新增media-stream.mjs（25test，含zero转换U64 1<<63）与TEA inverse（22test），加既有signature24合计71目标test pass，待fresh独立review后提交
- Electron实际JSON.parse source context与JSON.rawJSON保真probe均pass
- 取回作者v1.3.0 tage4e0c10确认到原基线60a899之间native代码与bindings无变更；官方nativeaddon在实际Electron加载+required API/capability读取pass
- 把官方release的18个native资源作为ignored本地development assetsstage到Twilight_Echo/resources/audio-engine，各hash一致；不是本任务native重编译或可复现binary证明
- Evidence refs:
- qq-http-backend-findings.json
- qq-login-refresh-findings.json / qq-login-response-review.json
- qq-qr-resources-findings.json / qq-qr-resources-host-bridge-verification.json / qq-qr-resources-host-anonymous-smoke-attempt2.json
- qq-commonfunction-media-stream-oracle-matrix-vectors.json / qq-commonfunction-media-stream-oracle-v2-matrix-vectors.json
- twilight-json-response-runtime-probe.log / twilight-release-native-probe.log / twilight-native-stage-provenance.json
- Blocked on: 尚未组装/安装Windows plugin或真实登录/播放；Ekey Base64+keyderive的有效decode oracle待恢复；track detail/quality filename/persistence/proxy完整闭环待做
- Next step: Root实现providerindex/loopback并独立reviewclient；qq_http_backend独占client.mjs/login refresh builders/tests；qq_packaged_resources继续Ekey forward oracle与media review；qq_qr_resources独占search-call/datascope，其首REA内部40c7失败已保留，实builder6d558..6d763待canonical entry（不要重复initializer）
- Git status note: appmain9ce6b816 clean；pluginhead9abdc73，Roottea/media模块与fixture未提交；clientworker允许写明确ownerfiles、不Git；manifest/index/runtimeFiles尚未接入
- Runtime note: 原QQMusic PID47120仍现有session；RootstockTwilight PID65396/CDP9283仍运行；版本60s采集已结束；nativeCLI searchinitializer96970已exit1（NoProcedure atinterior40c7），输出469bytes保留，无activeRootcapture

## Checkpoint Update — Windows provider activation and media integration

- Current todo: 完成 media-source/播放接线和新开发包安装，再真实 QQ 扫码与播放；完整目标仍未完成。
- Active slice: native-song-detail-and-audio-proxy-wiring
- Completed todos:
  - plugin HEAD after session client: 8fe3a2a436c2cb90b84e3e43095981a45abbd5ad; Ekey/search/filename/lifecycle:943bf25c995e7b36ce2340938933feb07eeecb25; Root source/main/manifest still being wired, no PR/push.
  - QQ DLL Ekey six native V1/V2 vectors and pure module passed independent review; 14 new full64 original helper vectors and26 prior cases match, new19tests.
  - Actual Windows anonymous Desktop search and native UInt32 CgiGetTrackInfo succeed HTTP200/RPC0. scene0 has full DTO; scene1 incremental media/rights. Failed mid-only metadata hypothesis item400 closed, no Android fallback.
  - New Windows canonical ID is qq:<14char MID>:<UInt32SongId>; host Track.id/filePath survive session/queue clone unchanged, removing need for core metadata whitelist change or persistent map-only dependency.
  - windows-index/tracks search/auth source reviewed; stale QR authorization/clear-new-owner and oversized-page findings fixed and independently repro closed. Client cancelPending plus queued storage rollback preserves prior auth on already-started canceled writes.
  - Root71 fresh proxy/stream/full64/detail tests pass. Proxy total15s timeout P2 repaired: timeouts on resolving/headers/read waits, downstream backpressure allowed; 21 proxy tests.
  - Development package0.4.0-dev.1 SHA19045eea3bf618e3318d54068b1c3e12c99bfa864dddd3fd174737d1a38ebacc installed/enabled via actual manager in isolated source client; this is older code before race/canonical fixes and MUST NOT be final artifact.
  - Source client PID134120/CDP9284/launcher tools/twilight-qq-adaptation, private profile only. Bootstrap --qq-install-smoke test hook binds exact packageSHA and own plugin dialog callbacks once; production installer unchanged. Normal start has no hook/CDP.
  - Real utility-process plugin search returns2public tracks/total997; server-verified checkLogin false before scan. Actual QQ official QR was ready for600s, human input requested; now QR state expired65. No success code/session or playback yet. Original QQMusic47120 remains untouched/logged in.
  - Anonymous Vkey/EVkey RPCs accept all three calls but reject premium track with result22 and emptypurl; no sip/Ekey/audio fetched; don't label this playback success.
- Parallel work:
  - qq_http_backend: new media-source.mjs/tests Windows GetVkey/EVkey+HTTPS bounded preflight/container/header validation (no real private account tests).
  - qq_packaged_resources: precise Windows lyric builder/response, max2new native dossiers and1public lyricprobe, no full lyric text persisted.
  - qq_qr_resources: independent Rootcontainer and full64 port review (read-only; proxy already delivered/fixed).
- Evidence refs: qq-windows-entry-review-receipt.json; qq-windows-audio-proxy-review-P2.json; qq-common-file-transform-findings.json; qq-song-detail-findings.json; qq-windows-anonymous-song-dto-probe.json; qq-windows-anonymous-vkey-probe.json.
- Next step: wire playback resolver/proxy in windows-index and package deps; verify fresh artifact/deactivate/restart, reopen actual scan only when ready; await real human QR then native codecs/play/seek/queue restart evidence.
- Drift check: Windowsct19/cv2271 strings/Sign maintained; no Android protocol fallback, no original credential-store read, no paid-rights bypass. Dev capability currently search/cover/login; media goal explicitly open.

## Checkpoint Update — Real QQ login and native MP3/FLAC playback

- Human replied 已扫码; official QQ code exchange succeeded, server checkLogin=true, cold restart restore=true. Do not request another scan without evidence of expiration. Private profile encrypted envelope uses upstream aes-256-gcm-machine fallback, not a DPAPI claim; no auth values exported.
- Task source client PID167208/CDP9284; current installed dev.2 SHA f5e8d5fb33c23dbb586d70d96dcf037684b7a4fe87117ce1a1cd47f46b1190d5. Core frame disposal fix built/typechecked/budgets passed, remains two-file uncommitted.
- Real SDK GetVkey with relative purl and no sip passed explicit fixed official dl CDN compatibility base preflight; this is not asserted to be recovered native default. Native CDN dispatch owner is under independent static investigation.
- Native audio play accepted host-issued twilight-media grant without core playback changes: MP3 128000bps/44100Hz/2ch/269.7467s playing, seek(60) observed61.4s, pause observed paused, zero audio errors. Real GetEVkey lossless path native FLAC play succeeded/44100Hz/2ch/269.7467s, then stop. Metadata IPC does not accept grant; legitimate play route does, no bypass or new metadata patch.
- Root wired strict plaintext Windows GetPlayLyricInfo mode0 into provider/capability/runtimeFiles. Fresh33 relevant tests pass including missing-sip byte-validation regression and precise safe error codes. Enhanced QRC still rejected. New package/live lyrics pending.
- Independent9 lyric tests review complete/no findings. Bundled NCM missing cause investigation suggests launch cwd/resources path, not proven dependency prune. Need restore proper task launch cwd before final verification.
- Synthetic generated-tone actual native codec/loudness probe succeeded for plain MP3/FLAC and mode1/mode2 FLAC over actual loopback; source fixtures contain no QQ recordings. These tests do not replace real track evidence above.
- Remaining original scope: renderer queue/persistence/disable cleanup; playlist/user library/artist/discovery/recommendations; enhanced lyrics if required; actual rights/refresh lifecycle coverage; final package audit/install. Full goal not complete.
- Evidence: qq-real-login-and-playback-smoke.json, qq-audio-synthetic-native-probe.json, qq-windows-lyric-review.json.

## Checkpoint Update — Windows music-data acceptance and controlled probe entry

- Core frame fix committed621b4bb9; core clean. Real renderer QQ source select+Enter on public 晴天 row native play accepted, bartitle晴天/artist周杰伦/duration269.7467/queueIndex0. UI paused and saved named queue QQ Windows 验证. New actual plain lyrics SDK request returned LRC1388chars, no full lyrics persisted.
- NCM descriptor was disabled, not absent or dependency failure; enabled via SDK in task profile and ncm methods available. Original other profile unchanged.
- Three authenticated Desktop searches accepted wire1 singer/wire2 album/wire3 playlist (native enum labels separately proven). Safe schemas in qq-real-search-catalog-shapes.json; anonymous2001 corresponds native requires user verification logs. No extra anonymous probes.
- GetPlaylistByUin native builder verified current session.musicid request accepted. Safe field-only schema shows total/v_playlist4/v_delTid0/bFinish; no playlist IDs/titles or account tokens saved. Rootprobe source caches only RAM for next detail. Created/public canonical owner agreed qq:playlist:<hostUinU64>:<disstidInt64>[:<diridU64>] in playlist-data.mjs.
- Installed dev.4 is intentionally temporary diagnosis artifact (windows-probe-index.mjs), SHA7f9cd51da11550ccf351ed8e771039971ade33854e1be2e578ea1f22b97ed5fd; source manifest still productionwindows-index/dev.2. It has library:read because core requires declared library capability permission. Diagnostic entry must be removed from finalpackage/Git; current returned schema is not final library DTO. Dev3 lacked librarycap so fetchUserLibrary route unavailable despite handler support; fixed in dev4. These authorization failures are explained, not bypassed by core changes.
- Root helper install-package receipt follows exact temporarypackage checksum, original installer code unchanged. Task own app.relaunch graceful current PID changed from167208→180364 then subsequent, revalidate.
- Active agents: HTTP catalog DTO mapper (source/tests independent), packaged playlist-data mapper (source/tests independent; awaiting actualdetail), QR favorite builder 1005e2b7 one newdossier (outerkey music.musicasset.PlaylistFavRead, uin string, code source proven). Root ownsindex/manifest/temporaryprobe/Git/runtime.
- Next: detail schema first own directory/publicsearch playlist, favorite schema; strict real library/catalog wiring andfreshreviews; productionpackage replaces temporary probe. Queue restore/persistence verification stillopen; originalscope recommendation/other codecs/enhancedlyric states remainopen.

## Steering and data compatibility checkpoint

- User explicitly added: reproduce/fix Japanese 螺旋 - 9Lana; separately test Dolby and otherqualities acquisition. Their followup says no UI qualityswitch found: currentQQentry defaults128/no publicqualityUI. Root explained and will add standardpluginsettingsform qualityselector, then realuserworkflow bugverification. Keep both additions in fullgoal.
- Root search exacttrack qq:00301Olx260o9G:706251329/title螺旋 - RASEN/9Lana accepted. Native128 playback succeeded190.421s/44100Hz2ch/position1.2, sourceapiaccepted. This is not yet a fix of reported UI failure; no falseclosure. qq-japanese-rasen-playback-probe.json. Plain publicscene0 both晴天/Japanese sizes show mp3/ogg/flac available, size_dolby/hires0 (not allquality proof).
- Currentinstalled dev.7 diagnosisentry SHA271bfb1d43f19ca7c8145277965c8c741224f0a7bea16db8d0d209a1aa976b85. Tempwindows-probe-index.mjs neverfinaldistribution/Git; packhelper qq-pack-probe.mjs restores productionmanifest and verifies absolute staging before packscript recursive cleanup.
- User/favorite actualrequeststatus/codeaccepted; created4/finishedtrue and favorite11/hasmore0/hidefalse. Favoritev_delTids intersectsv_list; never just displayall orfilterwithoutnativeconsumer evidence. Allprivate IDs/titles/keys removed from savedshapes.
- Firstownnative detail201 returnscode0/subcode0/full544tracks; id+dirid+totalcorrect, ownerfields are0 placeholders. allCreatedOwnersMatchSession=true; responsehost0 not rawQQ namespace. NativeGetQQUinEx/L201compiledassertion found byQRagent, actualserverdir201 boolean true. Rootapproved minimal explicitcompat-only201 host0 when decodercaller has verifiedsessionmatchingcanonicalownhost, id/dir/code allmatch. Public/otherdir/otherhost stillstrict. Agentpatched20own+8builder+4track=32pass, v3findings; actual544DTO mapping not runyet.
- Defaultplaybacksessionnotpersisted afterapp.relaunch forcedquit; namedqueue DIDpersist30entries:firstpublicdualID,position18.29. Savednamedqueue restoration/play stillmusttest. Do notpretend colddefaultsessionpass.
- Root pending qualityUIneedsUIexistingformcommand/API, notnewcorequalityinterface. Standard forms existinupstreamQQ/NCM. Need serialize pluginsettings mutations toavoid RMW clobber acrossquality/auth writes ifused.
- Agents: HTTP catalog completed37relatedpass, readonlydatareview+tombstoneconsumer up to1newdossier; packageddata20tests/201compatidle(waitfavproof); QRlikedconsumer Ghidra75853stillpending then nativeDolby/hires mapping max2dossiers.

## Checkpoint Update — Quality UI and native higher-quality mapping

- User: “此外还需要测试如杜比音质等能否正常获取数据”. Must test Dolby/HiRes/5.1 actualacquisition/decrypt/codec separately fromavailability/rights; do not silentlydowngrade. Japanese issue remainsUIrepro open: native128 succeeds; current qualityform commandselected320 + defaultgetPlaybackUrl respectedpreference, Japanese native320 succeeded190.421s/mp3float320000/position0.88; restoredpref128 andlogintrue. They reportednoUIqualityswitch, nownewsettingsPanelavailableinSDK butGUIpathverificationpending.
- Root created quality.mjs singleowner mappings backedQRNativeGetSongLevel ev_504c10f5...: UIquality3→filename6(5.1 D0MA mflac),UI6→filename10(HiRes RSM1 mflac),UI7→filename12(Dolby D0M1 mmp4). No confusedenumdomains; Mainlabelconsumerproof. Higherquality source+settings6options nowwired, fresh31tests(passnewmode2MP4syntheticheader). ActualDolby/HiRes/5.1 NOT testedyet; peerHTTPreviewactive, QR2ndqualityparserdossierGhidra5762pending.
- Rootwindows/settings.mjs serialWeakMapowner allSDKget/set/delete; initialget-awaitwriteshadP2becauselegacysecretmigrationreadmayRMWwrite. Fixedget=>queue, addedmeaningfulmigrationrace regression. Independentreview23→24tests passed+v2reprocorrectqualityretained. SourceUI type/provider+ui:inject permissionrequiredbycoreexistingnormalizeUiContribution; nonewcorequalityinterface. windows-index3catalogmethodsnowwired(privateSourcecapsearch).
- Currentinstalledtemporarydev9 SHA0d7c28e8f94aa56bdd278b02a739c60826649ad69e9f19072d0a5ee416ba443a. Quality source3optionsinstalledbeforelatestnewhigherqualityowner, mustfreshpackbeforeDolbytest. Sourceproductionmanifeststilldev2/mainwindows-index notfinal; temporarywindows-probe-index anddev3..9 artifacts MUST NOT enter finalcommit/distribution.
- Real544 detail mapper nowfails exactly3records: invalidTracks3/invalidMedia3, all4sizefieldsvalid, other541 singlemapperpass. qqlibrary mappingprobe-v2 istypes/countsonly. Rootnextsafeprobe willgive3invalid identity type/length/zero/presence no IDs/titles. Peerpackagedplan recommendstypedunsupportedsidecar/count/notice, nofakeTrackIDs: SDKnoavailabilityfield/sessionwhitelistdropsnewfields. No silentfilter orclaimdeleted/rights. NativeDatafullresponse544complete; mappingnotfullyclosed.
- Favorites realtombstoneintersectionrecord status0/opType5/dirShow0/dirType0; otherexamplesstatus100/400,opType5,dirShow1. HTTPplainnativecallbackonlyreads v_list; rowhelperreadsopType/tablemaps5→3, no status/dirShow/dirType orv_delTidsread; finalgenericobserverfilterstillunknown. InvalidGhidra callbackqueryNoProcedure1005e53d preserved, notrepeated. Do notguessdeletionfilter.
- Root should refactor temporary probe to invisible UI diagnosticcommand insteadof overridingstandardprovider library/catalog methods: currently diagnosisstub affectsnormaluserinterface (fetchLibraryemptySchema/searchcatalogpublicqueryguard). OriginalSource3catalog/qualityUIcanremainfunctionalwhiledata researchcontinues. Temp wrapper ownsclient/current-sessiononlysanitizedmetadata; use sharedsettingsserializer. Thenproductiondatawiringonceinvalid3/favsemanticsresolved, finalartifactmustremoveprobe.

### Real higher-quality and renderer evidence (2026-10-14, continuation)
- dev11 quality contribution discriminator worked; production source registration stayed intact. Three private playlist invalid records: positive UInt32 IDs/type21 with empty MID/mediaMid. Bounded native scene0 TrackInfo(types21) returned tracks=[]; no values persisted. See qq-private-playlist-unresolved-shapes.json.
- dev12 public search+TrackInfo exact-ID/MID/type matched candidates. Hi-Res 张杰/破局者 resolved+played: FLAC96kHz24-bit stereo, duration282.9129s, bitrate3115801, native position0.853s. Dolby 周深/云裳羽衣曲 resolved+played: EAC3,48kHz,6sourcechannels,448000bps,duration296.6717s,position0.98s; decoded/output2channels, spatial-output validation still open. Receipts qq-higher-quality-public-candidates.json/qq-higher-quality-real-acquisition.json.
- Actual rendered Settings→System/About→Plugin settings→QQ quality panel opened six options. Saved320 through actual form, applied normal QQ-only search row RASEN Enter: nativeMP3float320000bps190.4213s position27.89; receipt qq-rasen-renderer-320.json. Normal QQ-only RASEN original/acoustic/anime all played128; reported failure remains unreproduced, not fixed-claim. RASEN FLAC decoded44100Hz16bit andseek60→60.769, receipt qq-rasen-flac-playback.json. Preference restored128.
- dev13 installed bounded type21 probe. dev14 installed temporary format-candidate probe SHA83fb08de89050370b452ac26af840e744743521fe21c9df5a14cf19827550e02; never ship diagnosis entry/helper/packages. Root restarted own task client only; app.relaunch still not default playback-session restore verification.

- Fresh top-level QQ regression 283/283 after higher-quality wiring, includes baseline Android mocks (not Windows live evidence). Independent settings/media/index quality review 36/36 and six-quality fake-only mapping; no findings. Dolby seek120→120.4/paused120.88/resumed121.42 native proof qq-dolby-seek-pause.json. 5.1 candidate scan:160 public results+544 own rows size_dts positive0; negative Japanese server22 is not a positive acquisition test or universal unsupported claim.

### Library, album and generic unsupported-row continuation
- RASEN unified all-source search reproduced two NCM records with no playback URL; NCM loggedInfalse and IDs public3404245089/3426681957. Own task client NCM was restored to original disabled, now onlyQQ. Fresh all-source QQ RASEN native128 playing18.37s, actionQQlogin; qq-rasen-unified-search-route.json. Human historical row still unproved.
- Library entry capabilities+library:read and handlers nowimplemented but actual mapper firstfailed on onefavorite: emptyuin/status0/opType5/dirShow0/dirType0/intersectsdeletedtrue. Created4 strictmappedpositive. No unknownowner→0 fallback. Agent implemented explicit adaptervisibleOnly show1 rule (not nativefilteredbehavior), Rootentry optsintoit; nativeCatMgr finalquery106544b0 timedout330000ms, no retry. Receipt qq-library-mapper-failure-shapes.json /qq-playlist-data-v4-findings.json /qq-favorite-manager-final-visibility-findings.json. Fresh actual library afternewpack stillrequired.
- 3 own type21 emptyMID records nowstrictmap genuine qq:native:21:UInt32 +playbackStatus unsupported; mediaarray samepositionsnull, unsupportedCount3. Othermalformedrows stillreject. Coregenericoptional typed field, visualdisabled+bulk/queue/finalplaybackguard+persistedstatus changesinprogress; independentreview identifiednamedrestore currentTrack derivingunfilteredqueue P2, QRfixpending. Rootalso mappedartistmetadataID qq:artist:MID:UInt32+albumId qq:album:MID:UInt32; matchingalbum/artist parser tests15pass. Coremetadata whitelist albumId/artists gap explicitlyauthorizedforminimalfix, no perQQcorestate.
- Albumnative producer29c0f/full589bytes verified, actual publicalbum8220 11rows+newdata.totalNum/curBegin. Nativeorder0 currentresponse reversed; two-pagebegin0/2 num2 hadcurBegin0/2,total11,nooverlap. qq-album-real-response.json/qq-album-real-pagination.json. PurefetchWindowsAlbumTracks strictbinding/stabletotal/rawoffset/max100pages10000rows nowwired inentry; SDKactual/UI next. ArtistTopSongs producer remainsunproved; nativeSingerRadio cannotfake TopSongs.
- dev15 first installactivation5000mstimedout androlledback14; exactsamepackage freshapprelaunchretrypositive1.99s, no codechange/no reasonproved/no timeoutincrease. Startuppeerreview no actionable findings. dev16/17 startspositive. Currentdev17 SHAadb1bd6f7fa0916c6f0decef1b3418c65a23c3265440e0a8262dae71ab4cc28c installed; temporaryprobe/helper MUSTNOTship. Receipt/tools install binding keeps exactpackage.
- SavedQQ Windows验证 namedqueue30 restoredrecords, nativewasstopped at2secs beforecontrolledrelaunch, so actual restore-and-playstillopen. qq-named-queue-real-restore.json retains observationwiththislimit. App.relaunchbypassesnormaldefaultsession saving; properexit teststillneeded.

### Internal playlist paging retirement decision
Anti-Entropy Declaration:
- Deletion Class: code-retirement (unpublished task provider optional SDK method)
- Old Path/Object: Windows entry fetchPlaylistTracksPage registration/function and direct fake cursor assertions
- New Canonical Owner: existing native full-snapshot playlistDetail + fetchPlaylistTracks; existing host progressive virtual list
- Expected Preserved Behavior: complete544 records/sourceorder/unsupported3/wholecollection read/host scroll/search/sort/bulkplay
- Expected Retired Behavior: task-added localcursor causing20-loaded-only view and repeated complete native endpoint requests
- External Boundary Touched: no; only current task-owned debug packages/client, observable consumer, no push/PR/distribution
- Source-of-Truth Data Risk: none; no account/playlist/song/profile/queue data deletion
- User Confirmation Required: no; reversible internal code within approved adaptation scope
Retirement Decision: delete-first; native producer returns entire directory without paging inputs; full544 live SDK verified, existing fullcollection UI is the fitting owner. No original QQ or persistent user objects edited.

- Core reviewed22hash files committed locally e2a8a967 (main), afterfresh72/types/build/budget/peer68 closedrestoreP2. Coreclean. Plugincombined top+nativepure 348/348 fresh beforeinternalpagingretirement; afterretiremententry9/9. Source RootcacheIncomplete+libraryepochP2 closedpeeractualrepros; albumspoofP2privateclass602967... closedpeer32. Receipts qq-windows-library-album-integration-review-v1.json / qq-album-canonical-independent-review-v1.json. Runtimeartistcapture600seconds ended8emitted/noartist humanactionresponse; nohook active, no retries. QR nowreadspublicexactWindows configuredwebassetsforartistpath insteadNativeRadioguess.
- RealSDK dev18 completedlibrary14/owned4/liked544+unsupported3/allids; album8220 eleven canonicaltracks+albumId. UI dev19library14cards accepted, but newlocalpager only20loaded and repeatedfullsnapshot endpoint; internaldelete-first adoptedstandardfullfetch, dynamicUI actualfull544stillrequiredafterdev20. dev20temporarySHA332e73bffaa8c7765db7aaaafee041395887abb435442ecd26723184046c2b93, notfinalrelease.

### Actual full-list, album, queue and artist continuation
- dev20 UI full544 count/virtualHeight34816, wholecollection last-row search accepted, all3 special rows disabled/reason/rowactivation unchanged. PlayAll excludes3 -> actual541 queue badge/nativeplaying20.23. Independent paging retirement44plugin+3host tests/no findings; receipt qq-windows-playlist-page-retirement-independent-review-v1.json SHAe75f923c... . No private IDs/titles saved, see qq-library-real-renderer-full-collection.json.
- Named QQ Windows 验证 actual restore-and-play now closed:30 restored/skip0/nativeplaying18.44/MP3float44.1k. Normalwindowclose firstreturned data:null because startupresume defaultoff (verified ownAPI), not a QQ persistence bug. EnabledtrackAndPosition -> normalclose paused37.32/newprocess data.queue30,pos37.56/canonicalcurrent=true; actualcoldplaycontrolnative37.714/queue0 thenpaused and restored originaloff. Old namedqueue predates albumId/artists fields: don't claim those newfields coldverified from this oldsession. qq-enabled-normal-close-cold-session.json /qq-enabled-cold-resume-native-play.json /qq-core-cold-resume-settings-review.json.
- Public album search actual叶惠美/周杰伦 opened11rows/fullcount11, clickednormalrow以父之名/nativeplaying0.218/MP3float342.000s thenpaused. qq-album-real-renderer-play.json.
- Human requestednewcapture and replied已打开. Rootfresh600sec Frida ownPID265452→Original47120 attached13:31:37UTC selftesttrue, stoppednaturally emitted10; nooriginalprofile/loginsmodified. Recapture-v2 hasDesktopSearch/SmartBox but noartist; embeddedofficialroute isXHR+JSsigner, nativehookcoverage insufficient, don't conflate noevent with noRPC. qq-runtime-artist-recapture-v2-analysis.json.
- QRfound Resource JSON2009 configured https://y.qq.com/wk_v17/#/singer_detail/song andalbum. Currentofficialasset consumer source proves Top10 GetSingerSongList order1最热, detailGetSingerDetail, albumsGetAlbumList. Publicassets/sourcepins in qq-windows-embedded-artist-findings.json (updatedSHAaebe757...). This is configuredembedded-web, not recoveredC++producer.
- dev21SHAaff75b3eb8a73737bdc03860734626b24d31d26dfe60627208e4da5b8a4193b4 actualprobe currentnativeclientct19/cv2271 acceptedall3public周杰伦RPCs:Top10mapped10 first晴天/搁浅, strictIntro249chars, albums20 rows albumID:number/Mid/string/total:number. No rawdescription/keys/cookies persisted. qq-artist-real-response-shapes.json. Native-client transmission is explicitcompatible transport verified byactualresponse, notthewebsource ct20defaults.
- Agentartist-call sourcecaf16ebb... frozen19test/paired37pass, actualDTO dualIDs/defaultorder0boundedall-pages, sharedmapWindowsAlbum date/identity owner; covernull becauseunobservedalbumPic (no guessedURL). Rootwired3handlers+current-sessionepochcheck+2entryintegrationregressions, fresh30artist+entrypass. Pending independentv2, dev22 actualtwo-page/albumscomplete/SDK/GUI.
- Core releaseidentity necessary P2: old1.3.0 lacksQQbridge/unsupportedmetadata despite sameversion. Rootsetpackage+tasklauncher1.3.1-qq.1, engine>=1.3.1-qq.1;23hostmanifesttests passed andcorepackagecommitted08e7e797. Coreclean. NewprocessactualappVersion1.3.1-qq.1. Finalprovider freshversion/README/normalmainpackage andreceipt stillpending; allprobeentry/helper/devpackages neverfinaldistribution.
- dev22 temporarySHA7a2b9e819fd2eaf150d447321f93ad57a08041abcab65e0f130e40d02a4f602d packready/rootclosedownclient, nextrestartwithreviewedinstallhook theninstall. Current installed21; originalofficialclient65396/QQ47120 retained.

### Native response variants and Homepage continuation
- dev22 realartist closurecomplete: actualpagesbegin0/2num2/order0 total43/stable/nooverlap;3SDKhandlersTop10/intro249/all43canonicalunique,actualGUIshows43albumcards+IntroDOM+TopSong晴天native0.1,43card→叶惠美11rows/noerror. qq-artist-albums-real-pagination.json /qq-artist-real-sdk-mapping.json /qq-artist-real-renderer.json. Peer v2 37module+2entry tests/13collection+6handlerowner counterexamples nofindings; receiptSHA1ebf2413700d69ff19cc36644489746c3becdbdb4d19c120411b44fd2f6c1641. Corepackagecommit08e7e797 appversion1.3.1-qq.1/Coreclean.
- Realdisablecleanup: actual oldhost grant scheme twilight-media rejectedafterplugins.disable, nativeplayfalse; reenable currentcheckLogintrue. No grant decode/rawleaseexport. qq-real-provider-disable-cleanup.json. Nativeproxy.socket close tests remainseparate; no fake404 liveclaim.
- READMEplugin rewrittenaccurateWindowsflags/realhigherquality/unsupported/queue/requiredhost; tools launcherREADMEcreatednormalnoCDP/noinstallhook. Neitherfinalversion norfinalpackage done. Normalpackage3P2 version/legacydocs/host sourceidentity; coreengine >=1.3.1-qq.1 resolved, READMEupdatedawaitreview, devdiagnosticreceipt stillmustreplace.
- Home primarysource configuredwk_v20 musicroom: module620 get_new_hot_recommend cmd0/page0/daily_page0/size12; get_new_song_info type5. CurrentNative client ct19accepted2RPCs, BUT exactnative responsevariant official has data.grids12/modules[]0 whileembeddedsourceexpectsmodules0.grids. Native latestsonglist43/strict43 publicfixtures permitted; Rootapproved first20 songs preview label最新发行歌曲, notnewCoreAlbumsection/notDaily. HomeUI requires ui.streamingSections Track[] methods toenableproviderHome; no getHomeSections/fetchHomeSection SDK. HomepagefetchRecommendPlaylists acceptedexistingmethod, DiscoveryneedsactualdifferentpagingAPI.
- Agenthome-call currentlyownedHTTP source pureLatest+2knownbuilders+unwiredcandidate mapper, peer26tests+9checks passed/nofindings(SHA94a6...). Latestvalidatesall≤1000 returnedrows then20preview; no rootindex/manifestwire yet. Officialcandidatependingkind/host namespace, creatoruin usedprofile insource544 nothost; no inventedowner0 or expand201specialcompat.
- Dailyprimarysource609 hasGetRecommendFeed initial direction0/page1/v_cache[]/v_uniq[]/s_num0; embeddedsource strictnumeric301+firstniche+title每日30首. Source544 genericplaylistplay -> aidissInfo.uniform_get_Dissinfo exactdisstid/userinfo1/tag1/guid (enHost optionalprop elsewhere). Source16replay/12pins proof; do notcopylossyparseInt/errorcatchhang. Root dev24false301record retained.
- ActualNativeCt19variant newproof: feedretcode0, 8shelves firstshelfkind201(firstniche4) unique exactDailytitle=true, other204/203 false/no301. This201 is feedkind, notliked-directory201. Rootdev26 explicitnative-observed selector201+exacttitle, aidiss rawInt64disstid/guid currenttaskDevice actualcode0/sub0,IDmatchtrue,raw30/total30/strictmap30,HiRes1/Dolby1/DTS0. qq-daily-real-known-selector-checks.json /qq-daily-native-variant-real-detail.json. Thisis observedadapterresponsepolicy, NOT nativeC++enum recovery/guessed301fallback. HTTP authorisedDailyLeafstrictunique201+firstniche+knownlabel/retcode0/cardlosslessID+detailcode,total,IDbinding/getDevice/signal andguards, peerpending.
- RootNativeHotRecommend firstgrid strictCgiDetail usingactualgrid.creator.uin+id accepted/code0+sub0/full30 strictdecode. Actualcreatoruin0 AND responsehost0 AND creatormusicid0 equalrequest, no fabricatedzero. All12actualtype10014/sourceType3|2|5/nojmpurl parse, no song/isVip inobservedshape. Rootgenericsectiontitle推荐歌单 (notallcurated/public). Firstgrid isNOT exactDailyTitle, headername/title matchesnoneallowlistedlabels. Other11host namespacesnotyetactualvalidated. qq-home-official-playlist-native-detail.json /qq-home-native-variant-label-and-detail.json /qq-home-real-kind-flags.json.
- Currentownclient PID287860, CDP9284, installeddev26SHA3a077221a5be66cd2a3a495973f17b3ec2f51c5843c2fe19d5c69edaac1d6e25. Logintrue;quality128; resume restored originaloff; OnlyQQsource. OriginalQQ47120 andotherclient65396 untouched. Freshartistcollector600sec stopped/detached10events noartist; noactiveRootFrida. Temporaryprobefiles/dev1..26 excludedfinal/Git.
- Agents: HTTP implementinghome-call Daily/genericRecommendLists afteractuals; Rootownsindex/manifest/SDK/UI/Git. QRupdateDailypositiveproof then onlyalready-savedmusicroomroute discoveryproducersearch(no newassetsunlessexplicitRootdecision). packaged peerhomepure/dailysource done, canreviewfrozenhome/index/finalREADME/rc+closure. Finalnormalpack/commit stillrequired. Allordinarysource andtests except lastCoreversion remainuncommitted; noPR/push.

## Continuation: Home SDK and public playlist identity (2026-10-14)

- Own source client currently PID305804, inspected CDP9284, installed task-only dev30 SHA7e88e8f77d6bdbdab9eaaef42bc194876b1bff7d6342caf0304b6ce5574f9bd6. Original QQ47120 and other Twilight65396 untouched. No active Frida collector; user artist-page action has been handled through configured embedded assets and actual own-session calls, not repeated capture windows.
- Home leaf9a239d2...752b3 and entryb93a2d...4b36e: Daily30/latest20/recommended12 actual normal SDK successful; all50 songs have canonical QQ refs/album/artist refs. Daily hasmore===0 and dirinfo.songnum===total30 verified. Home GUI shows30/20/12, no notice; normal daily preview click reaches decoder mp3float/playing/position30.11 then actual pause. Records qq-home-real-sdk-mapping.json/qq-home-real-renderer-play.json. Initial isPlaying property probe was corrected to actual state and receipt rewritten, no unsupported native-flag claim.
- Real recommended playlist defect: all12 NativeDetail code0/sub0 and exacttid binding, but11 creator.uin values differ from actual responsehost0. Actual responsehost also equals responsecreator.musicid for all12. Strict existing decoder correctly rejects those11 candidate-host refs; strict refs using actually returned host0 accept all12 complete lists (counts30/511/145/49/154/233/42/40/63/39/46/39). qq-home-all-recommended-native-bindings.json. Do not widen liked-directory201 policy or infer creator.uin native namespace. HTTP preparing an explicit native public-detail binding design before mutation.
- Two Home privacy P2 and shared withVerifiedDataRead async return gap fixed/independently closed. Home peer immutablev2 SHA951f1489...181b54;39leaf/catalog/tracks+4scopedentry+21ownerfake controls passed. Actual SDK/live does not replace cancellation/error regression evidence.
- Three further leaf privacy P2 patterns confirmed with10 public fake counterexamples and3Abort controls, nofetch; album/artist/media fixed c1662b...cee5/317dcc...afee/54efd6...ec27;57suite tests passed; QR exact10/3+4focused closure passed. Old baseline JSON was rerun changing only generatedAt; retain actual rerun revision and document old pin superseded, never guess/forge old timestamp.
- Discovery5 exact purebuilders and peer5pass; Root actual native ct19 acceptedSquare Feed60/Tabs8/Category60/Basic. Pagination trials Feed From0/30/60 Size30: all30, no adjacent overlap, FromLimit400 is NOT total, observed HasMore true/false/true kept as actualflags. Ordinary Category page0/1/2 size30: each30,total504 stable,no adjacent overlap,retcode0. Records qq-discovery-real-response-shapes.json/qq-discovery-real-pagination.json. Category SDK needs exact name binding and grouping; square tabs vary acrosscalls, basic.group_name blank. QR newly authorized only exact known category chunk48/module436 for full taxonomy. No Discovery mapper/registration yet.
- SDK/UI already supports total0 as unknown count through hasMore/offset previous/next; do not invent server total400 or claim need nullablecore based on earlier misread. supportsSort:false prevents false nativeorder5 hot/new labels; new remains unsupported pending evidence.
- Root corrected public artist counts using actually observed songNum/albumNum fields;12catalogtests pass; ArtistSummary optional musicSize/albumSize added to SDK declaration matching existing renderer fields. Type/build checks pending after core change.
- dev29 all12 diagnostic exceeded existing5000ms ui-command; dev30 splits3-item batches, all actual requests completed without changing timeout. Temporary probes and all devpackages remain excluded from normal shipping/sourcecommit. Final fresh normal version/archive/integrity/install/default no-CDP launch still outstanding.

## Delivered normal candidate (2026-10-15)

- Normal package0.4.0-rc.1 is built, installed and running. SHA2561d0b1828f572cef2630a1627d2fd98ad15dc84069804e3362d5d7b6858572c11,223437bytes; exact32ZIP members =mainwindows-index +29runtime +manifest +THIRD_PARTY_NOTICES. Root byte/closure audit and independent Acorn archive audit both pass, no diagnostic/probe/test/profile/originalQQDLL/vendor entries. install-package.json is bound to this normal filename/SHA. Normal independentreceipt d09109c8...a08da.
- Root production commit efcd69b7dde1ca5b7681030f4306a52c2a8480ef on codex/qqmusic-windows-adaptation; Core mainc77ae2ff (ArtistSummary counts) after earlier bridge/queue1.3.1-qq.1 commits. Both repo working trees clean. Only33exacttaskdevarchives and2taskprobe entries are locally excluded via .git/info/exclude, retained at original paths for evidence, not shipped/committed. No source push/PR/merge requested or performed.
- Public playlist sourcecreator→nativehost issue fixed through verified-current-login public lookup and exact response-id/host/creator binding, original strict decoder/liked201 policy unchanged. Actual all12 Home details complete; publicsearch2 details complete. Root normal rcSDK loggedIntrue, Daily30, recommendations12, artist1011songs/43albums, partial日语 windowoffset31/limit2 count2/total977 succeeded. qq-normal-rc-real-sdk-smoke.json.
- Discovery actualSDK8groups81tags (AIexcluded), distinctsame-name labels, feed0/30 and日语0/30 each30/nooverlap. GUIfeed1/2 unknown total and日语1/2 of33 pages; ordinarycategorycard→fullvirtualizedplaylist→FLACplay0.1/pause. Homecardindex1 originalbadnamespace→fullplaylist→FLACplay0.14/pause. qq-bound-home-discovery-real-sdk-v1.json /qq-discovery-real-renderer-v1.json /qq-bound-home-real-renderer-play.json. Initial skeleton-ready snapshot and UIroute-change lookup failures were corrected before claiming these proofs.
- User's current saved quality is FLAC, preserved (prior128checkpoint is historical). Normal rc原版螺旋 - RASEN /9Lana (qq:00301Olx260o9G:706251329) resolved protected twilight-media grant→official audioEngine.play, actualFLAC/duration190.4213/playing0.1 and pause. qq-normal-rc-rasen-native-play.json. Direct getMetadata(grant) correctly rejects that scheme because it accepts raw authorized source; no grant decoding or policy weakening. This normal direct-SDK playback proof is distinct from prior128/320/FLAC renderer proofs and does not identify user's original historical row.
- Cold normal rc app with -Inspect only/no installhook PID329152 restores verified login/Daily30/currentFLAC: qq-normal-rc-cold-session.json. Then normal close and default start-client.ps1 yields CURRENT PID332048, actualargv contains neither debug nor installhook, port9284 has no listener; installed publicmanifest exactsourcehash8cfd4915...815b/mainwindows-index/versionrc1. qq-normal-default-client-runtime.json. OriginalQQ47120 andotherclient65396 stillalive/untouched; no active Frida. No account/token/lease URL values stored in acceptance records.
- ScopedQQ+Windows-lib+scripts fresh434pass; first2files could not find defaulthostdirnameTwilight_Echo-main. Re-ran only those2 failed scripts using their documented TWILIGHT_ECHO_ROOT override to actual../Twilight_Echo:22/22pass, retainedboth firstfailure andfollowup receipts. No unrelated source edits to mask setup. CoreNode/Web/SDK typechecks pass; prior Corebuild/nativequeue72/peer68 controls remain valid since later change was typings-only.
- Independent final binder/Home/Discovery/entryreview d04a912d...f102d:67focused tests,196paginationwindows,48heldowner rejections+10success,30leafprivacy/ID/Abort controls; HasMore getter P2 snapshot fixed. Earlier3leafprivateerror10counterexamples/3Abort+57suite closed. Home/binder contractv4 and Discoveryv2 immutable, baseline timestamp rerun recorded honestly.
- Expanded public higher-quality metadata6actualcollections1087rawrecords (not unique) haspositiveHiRes/Dolby, no size_dts positives; qq-expanded-public-higher-quality-metadata.json. Existing actualHiRes96k/24bit andDolbyEAC3 48k/6sourcechannel proofs remain; currentdecoder output2channels, no spatial/hardwareclaim. DTS5.1 actualpositive sample stillnotobtained. Other scope limits: AIclassification/no verifiedhot-newsort, enhancedwordlyrics, albumlistcoverURLabsent. This is the shipped usable rc milestone, not a claim that everyQQproprietaryfeature orcodec has been verified.

## Delivered direct quality selection (2026-10-15 follow-up)

- Task10 executes the requested app button: generic optional provider get/set quality DTO, source-only six options/serialized preference, main-window PlayerBar right select in standard/mini/compact. Existing settings form shares the same preference; no new host preference or QQ enum. Same-song explicit quality/force resolution precedes transport replacement, latest progress/playing intent is captured, stale load/source/entry/provider owners are rejected, selected quality cannot rematch another source. User did not answer the optional timing preference; the stated recommended immediate-same-song behavior was used.
- Root/Source/Bridge independent review closed three P2: UI command omitted cancel context; loading pause incorrectly started HTMLAudio and late intent could expire; old same-ID UI source/owner result could overwrite a new source; renderer fallback owner checks now extend through URL, deferred seek and play. Registry generation also invalidates actual pluginId replacement without invalidating routine health refresh. Receipts v2 pins26 files; v3 adds2 service-client files; current source pins match both receipts exactly.
- Actual consecutive UI exposed a fourth P2: a request-local fast SetLoopRange timeout was converted by FF/coalesced catch into global failure, rejecting slow LoadQueue. Private WeakSet now distinguishes actual local timer errors; timeout/kill budgets and genuine fatal policy are retained.43/43 tests plus6 independent imported-client counterexamples pass. This establishes JS error propagation, not a native C++ network-lock cause; source-only stop/read hypothesis remains unproved. restartService returned true during investigation, but its existing nonfatal path can be a no-op; the reply is not evidence of child restart.
- Actual final Core build/rc2: RASEN normal row, UI seek40,128 at41.205 (128000bit/s),320 at41.8664 (320000bit/s),FLAC paused at42.4864; all three main-bar modes visible. Public破局者 through the select gives FLAC96000/24bit. Public云裳羽衣曲 through the select gives EAC348000/source6/output2. Metadata may update after preference/transport acknowledgement; assertions wait actual format/rate/channel facts. Higher proof v1 completes Dolby and FLAC return; its immediate final select snapshot was blank during refresh, resolved by final-visible-state (flac/paused/logintrue). No raw source/lease/account/token values saved.
- RASEN unavailable surround selection preserves exact prior source (boolean equality), paused0.47 and FLAC; no lower-quality/source substitution. Restored source preference to FLAC, final-visible-state confirms actual selectorflac/nativepaused0.81. Cold normal rc2 session verifies enabled/versionrc2/logintrue/flac/six options. Native paused option confirms pause before return/publication; N-API initialPaused is not exposed, so zero audible transient is not proven. Detached mini-player quality selector remains outside this follow-up.
- QA failures retained with their scope: v1 direct-native seek bypassed the renderer position intent and did not retain before/after; v2 first128 positive then next action found selector not ready; v3 initial row failed during collateral timeout, later rerun passed7 after restartService call, without proving actual process restart. Its first small failure record was overwritten by the rerun; first-failure-observed.json explicitly transcribes the displayed tool facts, while the post-run success copy was renamed accurately. v4 sampled old48k metadata before HiRes completion; v5 waits actual96k/24bit and confirms base/HiRes, then artist-appended QQ search misses cloud exact row; v6 encountered an already-open palette toggle. Separate higher harness handles existing palette and song-title-only query and confirms Dolby. These harness/search limits were not hidden with production edits.
- Fresh final regression:354 Core tests across player/controller/bridge/routing/audio manager/IPC/service client,51 QQ settings/entry/media tests; Node/Web/SDK typechecks, final build, renderer budgets628files/fonts8907800 pass. New normal archiveSHA365d96770fd2565c25d31f37cfedf9c3ed3e96f641d198fb4e3da75cb424da2f,32 source-exact ZIP members/CRC/Acorn import closure pass. OriginalQQ/otherclient not modified; normal launcher has no inspection/install switches. Git/default runtime receipts and workspace structural check finish this slice; original DTS/spatial gaps stay explicit.

Goal Closure: Task10 button/current-song selection done; original complete-proprietary-feature scope retains stated DTS/spatial limitations. Baseline alignment: accepted source preference/protocol owner and host playback owner retained; optional backward-compatible API documented in existing spec/plan. ADR signal: no owner/persistence migration or new service boundary; existing spec update is sufficient for this bounded extension. Confidence B: direct UI/native/codec plus independent/fake regression evidence, bounded paused-transient/native-delay limits. Retirement: existing source form retained as another view, old Android source retained inactive with notices; no new compatibility fallback. No external publish/push/PR requested.

- Git closeout: Core main150cf6aa,27 task-owned files; provider codex/qqmusic-windows-adaptation fbfeb80,6 task-owned files including immutable rc2 archive. Both task/repository working trees clean; existing provider branch retained for the adaptation. No new worktree/branch, no push/PR. Normal default own clientPID354272 now runs host1.3.1-qq.2/providerrc2, installed manifest source-exact, no debug/install switches or9284listener; originalQQ47120 andotherTwilight65396 alive. qq-quality-final-default-runtime.json is the exact current runtime receipt. Cold inspection immediately before default launch verified logintrue/FLAC/six options; no repeated human scan needed.

## Reusable skill delivered (2026-10-15)

- User requested extracting the third-party QQ integration method after delivery. Installed `qqmusic-client-adapter` at the default personal discovery root `C:/Users/Payne/.codex/skills/qqmusic-client-adapter/`; six UTF-8 files cover the entrypoint, protocol/login, data/media, quality/verification, Twilight example and UI metadata. Invocation: `$qqmusic-client-adapter`.
- Baseline before writing and fresh independent application test completed; source review found three path/index issues, all corrected and reread. Bundled quick_validate passes,35 local reference/source/evidence checks and current archive SHA pass. Exact file pins and bounded results are in `qqmusic-skill-authoring-validation.json`.
- This is method extraction only: no new client runtime, account, protocol implementation or source-repository change. Future target versions require their own evidence. No new Git repository, branch, external publication or push; the two source repositories retain their delivered commits. Confidence B covers the skill and tested application scenarios, not future codec or spatial-output support.

## Task11 active: metadata and per-song quality repair (2026-10-15)

- User reports unchanged3.3MB/missing sample rate and opaque Dolby/5.1 errors; supplied Same Blue/Official髭男dism. Start Core150cf6aa/providerfbfeb80 clean. Plan Task11 records approved repair scope. Source agent qq_track_quality_availability owns9 provider files, metadata agent qq_playback_metadata_bug owns10 host files, bridge agent qq_quality_availability_bridge owns12 bridge/UI files; Root owns versions/docs/package/Git/runtime.
- Confirmed compound defects: Track.size alwayssize_128mp3; formatter also rejects raw native loopback vs renderer grant identity; allsixquality options global and phases collapsed. Repair uses main queue-bound rendererSource/sourceBytes and existing provider envelope/identity registry, actual native metadata, optional getTrackPlaybackQualities three-state exact TrackInfo, explicit0 disabled/preblocked, and safe phase errors. No implicit downgrade. Source/bridge/metadata independent reviews closed; oneP2 HTTP403 incorrectly reclassified login was repaired via existing parseAppError at quality UI, phase preserved.
- User's actual initial saved preference is **dolby**, not historical FLAC; restore it after tests. SameBlue ordinary IDs qq:004bdORp28clBs:518676414 (albumSameBlue) and qq:000hhqGv2nKMeU:621064333 (ArenaTour) both actual scene0 report128/320/FLAC positive andhires/dolby/dts0. Oldrc2 advanced attemptsreturned22. Normalrc3 direct handler record qq-task11-per-track-real-qualities.json. Public云裳羽衣曲 qq:000wXRGx2u2NJ8:214188340 hasactualDolby candidate16624313 andprotectedsource acquisition succeeds.
- Normalrc3 immutable archive exists and installed; SHA da11e4dafb1f1b48c302852561e9daee3bdcffb5c8f056dde72f2e6f1bc0b1a2,229047bytes,32source-exact/CRC/no diagnostics/DLL,Acorn30closure. Core/launcher1.3.1-qq.3; bootstraprc.[123] andchecksumreceipt updated. Current taskclientPID632584 hasInspect+receiptboundinstall; originalQQ/otherTwilight untouched. Installhook must be absent at final default launch.
- Root fresh417source regression,395Core regressionv2,SDKtypechecks0,Corebuildv2(type/node/web plusbudgets628/fonts8907800) pass. Firstbuildfailedonlyin newlyadded incompleteTrack testfixture; completefixture repaired without casts. Original firstfailure log retained. Both source repos stilluncommitted; no branch/worktree/push/PR.
- Actual UI v1 proves MP3 128000/44100/source2 +display3.6MB, but harness wrongly expected main playerbar while visualizer intentionally hides it. v2/v3 toggle surfaces correctly: current-track threeadvanced options disabled; standard3806594bytes andFLAC31629508bytes/44100/16bit confirmed. Both then fail newly strict pausedprogress assertions: v2 capturedqloading/pause30.21→31.326; v3 waitedqready+3stable150ms andstill30.2→30.54. Allfailedharness/JSON retained, no full-passclaim. ActualFLAC page andfinalstandardpage stillneedcomplete normalharness after final fix.
- Remaining repair: metadata agent adds only playbackController.ts+manager tests for nativepaused-start precision. Independent publicfake RED proves sync/service actualbinding30.54 vs requested30.2 becausePlay→Pause has no Seek归位. Add guarded realSeek+freshinfo afterconfirmedPause, keepowner/CUE/error semantics; bridgeagent reviews newtwofilepins. No renderer compensation/no zeroaudibletransientclaim. Root then buildsnewcore(v3), normalcloses632584/relaunchInspect(noinstallneeded), rerunsSameBlueUI(v4strict0.15) andpositiveDolbyUI, restoresoriginalpreferredDolby, cold/defaultlaunch andcommits bothrepositories. Existingrc3providerpackage isunchanged bythishost-only followup.

## Task11 delivered repair evidence (2026-10-15)

- Final implementation retains the accepted provider/media/host owners. Main snapshots authorize public source identity and safe plaintext bytes per actual queue; renderer reads actual format/rate/depth/bitrate, shows unknown remote size without old128catalogfallback. Three-state native format metadata is kept separate from current-session authorization; explicit0 options disable and reject beforeVkey, unknown may stilltry. Source-stage errors and phase-specific403/401/22/KEY messages are preserved without IPCwrapper or guessedVIPmeaning.
- Independent review closed3realP2: presenter403numeric heuristics, nativepaused-start drift, and unrelated plugin changed abort. The last was independently RED/GREEN in isolated realVue/Electron fixture; it is not claimed to explain livev4 (recordedbus0). Paused core now guardedSeek+freshnativeinfo returns requested realposition (one native timeline frame tolerance), with service/sync, CUE, source/index/revision, failure andlateACKcoverage. It does not prove no audible startup transient.
- Live harness history retained: v1 expected a normalbar insidevisualizer, butvisualizer intentionally hidesit. v2/v3 compare mainpretransitionposition against renderer-owned latestposition and also expose the genuine Play→Pause drift class proved separately inbindingfakes. v4 completesFLACpage butback128neverreachesgetPlaybackUrl (methodcount2/failed0), whileoldDSPreadywarning isnotproofcrash. v5 addsvisible/interactable/same-nodechecks butstillcompares differentposition samplers. Finalv6/v7 use stablevisible slider(step0.1) as the actualuser progress baseline and compareafterNativewithin0.15; nativebindingtests separately enforce exactrequestedposition. No earlierfailure overwritten orlabelledpass.
- On final Corebuildv4, actual normal SameBlue albumSameBlue row qq:004bdORp28clBs:518676414 completes7phases: MP3128000/44100/3.6MB→FLAC1063907/44100/16bit/30.2MB→MP33.6MB, paused+visibleslider preserved, unsupportedHiRes/Dolby/5.1 disabled, directAPI rejects explicitmissing whilecurrentstream remains. qq-task11-real-ui-v7.json is the complete proof (v6 earlier same7passes). PositiveDolbyUI qq-task11-dolby-ui-v1.json completes3phases: enabledcandidate, actualEAC348k/source6/output2, visible448kbps/15.9MB. This is source playback, not Atmos spatialoutput; no realDTS5.1positive sample.
- Root fresh final414Coretests and417sourceWindows tests allpass; Node/Web viafinalbuildv4, SDKbothconfigs0; rendererbudgets628/fonts8907800.31 finalsource/test pins exactlymatchindependentreview receipt qq-task11-independent-review-final.json. ARootmanualhashtranscriptiontypo(host.ts extrachar) was corrected againstoriginalreviewerhash; sourceunchanged. Sourcearchive229047bytes32members source-exact/CRC/no-probes/DLL andAcorn30closure; immutableSHA da11e4dafb1f1b48c302852561e9daee3bdcffb5c8f056dde72f2e6f1bc0b1a2.
- Cold normal session643952 (Inspectonly/noinstallhook) confirmsrc3enabled/logintrue/originalpreferredDolby/sixglobalchoices/currentSameBluemissingadvancedflags. Then normalclose/defaultlauncher yields CURRENT taskPID622912, hostqq.3; noInspect/noinstallhook/no9284listener. OriginalQQ47120/otherTwilight65396 aliveuntouched. qq-task11-cold-normal-session.json andqq-task11-final-default-runtime.json boundtheseobservations; no credential/profile/rawlease values exported.

Task11 closure: done for reportedmetadata/availability/errors and immediatequalityswitchbehavior. ConfidenceB: realUI/native/source, independent publicfakes andfrozenartifactevidence; nativezeroaudibletransient/spatial/DTSremainbounded. Minimality: reuseexistingmainregistry/envelope/queue; oneoptionalproviderquery, nosecondpreferenceowner/newproxy/nativeDLL. Retirement: oldcatalogsizefallbackretiredforremoteplayback; oldglobalget/set retainedforpreferenceandoldprovidercompatibility. Existingplan/spec alignwithapprovedroute; nonewauthority orpublishingpermission. Gitcloseout andworkspacebundle/checkfollow.

- Final Git closeout: Core `main` commit `64dbfd37031f294fe21abe22bc960e0edfedc505` (24 task-owned files), provider `codex/qqmusic-windows-adaptation` commit `512a15ee81dd17e100306c979241b66a0c7e9d1d` (12 task-owned files including immutable rc3 archive). Fresh status readback confirms both working trees clean. Existing branches/checkouts retained; no new branch/worktree, push or PR. Default own client PID622912 runs host1.3.1-qq.3/provider0.4.0-rc.3 without inspection/install hooks, with the user's original Dolby preference restored; runtime evidence remains `qq-task11-final-default-runtime.json`.
- Installed reusable skill synchronized with reviewed Task11 corrections: `SKILL.md`, `references/quality-and-verification.md`, and `references/twilight-example.md`. Existing authoring baseline/application test remains historical; this bounded correction passed bundled quick_validate and57 reference/evidence/commit/archive checks. Exact six-file pins and scope are recorded in `qq-task11-skill-sync-validation.json`; no implementation/package/runtime change resulted.

## Task12 active: automatic quality downgrade on the same song (2026-10-15)

- Start: clean Core64dbfd37/provider512a15e, hostqq.3/providerrc3. User explicitly supersedes previous no-downgrade behavior. Same-song finite fallback keeps preferred quality, song/queue identity, current progress/pause and actual stream metadata. Root read-set: existing Task11 plan/checkpoint, installed QQ skill quality reference, provider quality/media/entry owners, host load/recovery/controller and existing IPC error encoding.
- Root cause and owner: normal preferred-quality failure enters host rematch and recursively substitutes a same-title different QQ ID without a budget. Read-only real-function VM reproduces B/A/B/A,4 searches and4 persistent replacements. Provider owns quality ordering and initial lease choice; host owns whether an error permits cross-song/source recovery. No QQ title/source heuristics, no new proxy or preference owner. Existing TE-ERR terminal code will bridge those owners.
- Change Necessity: settings-only cannot implement downgrade with retained preference; Decision code-change, finite provider candidate loop plus generic terminal recovery guard and removal of redundant controller rejection. Old providers retain recovery; active lease never changes format on refresh. Root owns versions/docs/package/runtime/Git; source and host agents own disjoint implementation/tests. Baseline diagnostic notes9 old nativePlaybackAdvance VM fixture ReferenceErrors (missing prior dependencies), separate from10 quality controller tests passing; preserve scope and repair only affected fixtures if used.
- Provider finite chain implemented in6 existing source/test files. Independent review caught same-musicid token replacement crossing candidates; reused canonical full sessionFingerprint stops it, including opened-lease cleanup. Two public fake RED/GREEN proofs retained. Frozen session repair pins in `qq-task12-source-session-repair.json`; independent and Root full428/428 source tests pass. Root immutable rc4 package SHA `b32d016c56abc328444421b7eba7a58a26ca76435bf19f099e10360cee773322`,233762bytes,32 exact/CRC members,30 Acorn reachable modules/no undeclared imports or original DLL/probes. Source files must not change without a new artifact version; current archive audit `qq-task12-normal-archive-audit.json`.
- Host first slice151/151 and types pass, but independent scaled actual coordinator counterexample shows30s host RPC can preempt5 media attempts and suppress provider terminal after abort; generic timeout then rematches. `qq-task12-independent-review-timeout-counterexample.json` preserves the proof. Host agent now owns a minimal typed local lifecycle boundary in existing rpcCoordinator/manager, getPlaybackUrl-specific terminal encoding, catalog/spec/tests. Remote ordinary business errors retain compatibility. Do not claim full completion until fresh frozen review/build/UI/cold/default launch. Root prepared normal UI harness `qq-task12-real-fallback-ui-v1.mjs` (not run yet); no app mutation so far.

## Task12 delivered (2026-10-15)

- Same-song fallback now belongs to the Windows provider's initial media resolution. Finite chains skip explicit zeros, verify unknowns, and try each permitted format once; spatial choices fall through ordinary HiRes/FLAC/320/128, never another spatial preference. Success fixes one resolver/lease identity through refresh and Range. Preferred quality is never overwritten by the actual quality; existing envelope carries actualQuality/verified bytes. Host controller delegates quality selection instead of catalog hard rejection. Explicit unavailable menu items remain disabled as song metadata.
- Existing main RPC coordinator now distinguishes local lifecycle failures from remote provider business errors. Manager wraps only getPlaybackUrl local timeout/cancel/host-stop/wake/circuit/overload/dispatch into `provider.playbackUnavailable` with fixed safe reason. Renderer stops before any source matching or persistent reference replacement; old remote business errors preserve compatibility. Timing, circuit, queue and idempotency policies are unchanged. Independent source/session and host/timeout counterexamples now pass; final21 source/test/manifest pins match review plus archive. `qq-task12-independent-review-final.json` closes both P2 findings.
- Fresh Root516Core +428source tests all pass; final Node/Web checks/build/budgets628files/fonts8907800 pass. Agent first9 old fixture ReferenceErrors, one cross-realm Error fixture, and strip-only parameter-property failure remain recorded with corrected scopes. Host whole-module32 test log actually includes isolated temporary-profile Windows Electron (STARTUP_PROOF); an attempted negative-name filter did not exclude it. Earlier receipt wording saying excluded is inaccurate; independent final review explicitly records the actual execution. No existing user profile was used by those isolated tests.
- Installed immutable rc4 archive, then restarted Inspect-only without install hook for actual normal UI. `qq-task12-real-fallback-ui-v1.json` passes4phases: saved test preferenceDolby, ordinary SameBlue exactID qq:004bdORp28clBs:518676414 automaticallyFLAC31629508bytes/44100/16bit;20 playing samples retain same ID/entry; paused/seek page30.2MB/44.1kHz/16-bit; next public云裳羽衣曲 exactID qq:000wXRGx2u2NJ8:214188340 playsEAC3/48k/source6/output2 with testDolby preference still retained. Actual initial preference observed THIS TASK was FLAC, unlike Task11 historicalDolby; restoredFLAC. Do not overwrite this with the old history. No raw media/account values exported.
- Normal close exited actual task649472. Cold inspection655300 confirms enabledrc4/logintrue/FLAC/sixglobalchoices (`qq-task12-cold-normal-session.json`); then normal close/default launcher yields CURRENT PID645960, noInspect/noinstallhook/no9284listener, originalQQ47120 andotherTwilight65396 alive. `qq-task12-final-default-runtime.json` records default launch. Source/actual six-channel Dolby is not spatial output; no true DTS5.1 positive sample or zero-audible-transient claim.
- Local Git closeout after fresh checks and Root21-pin verification: Core `main` commit `6c21df77d6a9e5cea6088e314da3f4f3e7a5af09`,13 task files; provider `codex/qqmusic-windows-adaptation` commit `6469eaeabe37fdfeb9472ed5377d69594a6c1bef`,9 task files including rc4. Both working trees clean. Existing branches/checkouts retained; no new branch/worktree, no push/PR. No source change after frozen build/review/package.

Task12 closure: done for user-directed same-song downgrade and reported rematch loop. ConfidenceB: real normal UI/codec, original-counterexample rechecks, source/host public fakes and frozen artifact evidence; bounded spatial/DTS/startup-transient limits remain. Change Necessity at existing provider+RPC+renderer recovery owners is evidenced; no extra source search, preference owner, timer/watchdog or service was added. Old controller catalog rejection is retired under explicit new user direction; generic recovery remains only for legacy remote business errors. Plan/spec reflect this correction. Skill final metadata and workspace structural closeout follow.

- Skill final closeout: installed `qqmusic-client-adapter` now records current finite same-song fallback and typed local RPC lifecycle method, final commits/artifact, real UI and cold/default proof. Bundled quick_validate and120 reference/evidence/current-commit/source-pin/archive/UI checks all pass; six current skill hashes and no pending items are in `qq-task12-skill-sync-validation.json`. Provisional receipt preserved separately. No implementation/package/runtime mutation after verification. Workspace bundle/check is the final structural check; it does not substitute for the direct playback and regression evidence above.
