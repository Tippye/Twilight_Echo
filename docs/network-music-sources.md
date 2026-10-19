# 多协议网络音乐源架构与接口

网络音乐源用于浏览、入库和播放 NAS、远程服务器及家庭媒体服务器中的音乐。
当前共享类型以 [networkSources.ts](../src/shared/networkSources.ts) 为准，
IPC 接口以 [networkSourcesApi.ts](../src/preload/domains/networkSourcesApi.ts) 为准。

## 协议与职责

支持 WebDAV、FTP、FTPS、SFTP、SCP、SMB、NFS 与 DLNA。
系统命令和挂载类协议依赖目标平台的工具、权限及环境；
AFP 共享可通过系统挂载后作为本地目录使用。

- `src/main/network/profileStore.ts`：配置校验、凭据存储和渲染层摘要。
- `src/main/network/sourcesManager.ts`：协议适配、连接与浏览、播放解析和生命周期。
- `src/main/network/adapters/`：协议实现。
- `src/main/network/networkLibrary.ts`：虚拟媒体库。
- `src/main/network/networkMetadata.ts`、`networkCover.ts`：元数据与封面。
- `src/main/network/networkCache.ts`：网络媒体缓存。
- `src/main/network/networkIpc.ts`：主进程 IPC 边界。

## 配置与凭据

`NetworkSourceProfile` 保存稳定 ID、协议、名称、主机、端口、根路径、
连接/传输超时、并发选项和书签。WebDAV 的传输协议通过 `webdavScheme` 指定；
地址中显式写明的 `http(s)://` 优先，其次为 `webdavScheme`，再次按端口 443
推断 HTTPS，否则默认 HTTP。

创建/更新配置使用 `NetworkSourceProfileInput`，认证输入可为匿名、密码或私钥。
口令类数据仅作为主进程输入，落盘由安全存储加密；配置中的凭据使用引用。
渲染层读取 `NetworkSourceProfileSummary`，其中不含口令或凭据密文。

凭据持久化、参数校验和系统安全存储不可用时的行为以
`profileStore.ts` 及其回归测试为准。网络源参数通过受控 IPC 传入，
网络请求和系统命令在主进程执行。

## 浏览与媒体库

`NetworkEntry` 包含所属 profile、稳定条目 ID、远程路径、条目类型，
以及可选的文件大小、修改时间、标签和封面路径。
支持目录、文件、音频和播放列表条目。

当前 preload 提供配置增删改查、`listDirectory`、`testConnection`、
`scanDirectory`、`listLibrary`、`removeLibraryEntry` 和元数据读取等接口。
从虚拟媒体库移除条目与删除服务器文件是不同操作。

路径规范化、条目所属来源、文件名和下载目标的校验由主进程承担，
错误使用共享的 `NetworkSourceErrorCode` 表达。

## WebDAV 实现行为

`src/main/network/adapters/webdavAdapter.ts` 的当前行为，是对接真实服务端
（Nextcloud、坚果云、WsgiDAV、Apache mod_dav 等）时的权威说明。

### 地址与传输

- 传输协议优先级：地址中的 `http(s)://` > `webdavScheme` > 端口 443 视为 HTTPS > 默认 HTTP。
- 主机可内嵌端口（如 `nas.local:5001`）；`port` 字段仅在显式填写时覆盖主机端口。
- 裸 IPv6 字面量（如 `::1`）会自动补方括号；主机里误带的路径、查询串或片段不会进入请求 URL。

### 认证

- 支持匿名与用户名/口令（HTTP Basic）。选择口令认证即发送 Basic，包含空口令。
- 不支持 Digest；服务端仅提供 Digest 时会返回 `auth`，并提示「服务器要求 Digest 认证，当前仅支持 Basic」，
  避免把正确的凭据误报为密码错误。

### 路径与响应解析

- 请求路径逐段做百分号编码，`#`、`?`、`&`、`+`、空格、中文与 emoji 等不会被截断或改写。
- 解析 `DAV:href` 时兼容绝对 URI、XML 实体（`&amp;`）、百分号编码，以及含连字符/点的命名空间前缀。
- 穿越路径、控制字符、孤立代理项与非法编码的条目会被丢弃，不会中断整个目录列表。
- 列表按“请求集合的有效路径”过滤自身条目，重定向补尾斜杠后仍能正确过滤。

### 重定向

- 跟随 301/302/303/307/308，最多 5 跳；303 转为 GET。
- 仅当主机与端口不变、且未降级到 HTTP 时继续携带凭据；跨主机/端口或 https→http 时丢弃凭据，
  非 http(s) 目标直接拒绝。

### 超时与续传

- `connectTimeoutMs` 约束建立连接与等待响应头；收到响应后切换为 `transferTimeoutMs` 的**空闲**超时，
  只要持续有数据流动，大文件不会被总时长掐断。
- PROPFIND 显式发送 `Content-Length`；错误响应体会被消费，避免挂起 keep-alive 连接。
- 续传严格校验 `Content-Range`；服务端返回 200/416 或范围不匹配时视为不支持续传，缓存清空后从零重下。

### 封面

- 封面缓存按图片 MIME 选择扩展名（jpeg、png、webp、gif、bmp、avif、tiff），保存与回读共用同一映射，
  未知格式回退 jpg。封面文件名只接受无路径分隔符的短令牌，防止越出缓存目录。

### 已知限制

- 仅支持 Basic 认证，不支持 Digest。
- 未放宽 HTTPS 证书校验，自签名证书会被拒绝。
- 反向代理若改写 `DAV:href` 去掉路径前缀，需要把该前缀写进根路径，否则子条目路径无法对齐。
- 口令源的「播放全部」会先解析（下载）全部条目再开始播放，属预缓存设计。

## 播放与缓存

`resolvePlayback(profileId, entry)` 返回 `NetworkPlaybackPlan`：

- `direct-url`：使用协议适配器提供的可播放地址。
- `local-cache`：使用经过缓存处理的本地媒体文件路径。

渲染层将解析结果交给现有播放链路。网络源不建立独立播放内核。
缓存通过受管音乐缓存目录统计和清理；元数据与封面保留各自缓存职责。
凭据、连接失败和缓存失败不应改变其他来源的配置与媒体身份。

## 验证

```powershell
pnpm run test:network-sources
```

自动化回归覆盖 profile、路径、缓存、元数据、适配器与页面行为。
适配器回归包含编码/href/重定向/超时/续传/封面等分支，见
`src/main/network/adapters/webdavAdapter.test.ts`。
实机验证使用 [网络音乐源验证清单](./network-music-sources-verification.md)，
覆盖浏览/播放/入库、错误凭据、超时与断网、缓存清理和会话释放。
