# 网络音乐源真机验证清单（Manual Verification Checklist）

> 配套文档：[网络音乐源架构与接口](./network-music-sources.md)。
> 自动化回归入口为 `pnpm run test:network-sources`。系统命令类（SFTP/SMB/NFS）与 SOAP 类（DLNA）依赖真实环境，发布前必须按本清单人工验证。

## 0. 准备

- 开发环境：`pnpm install` 后 `pnpm run dev`。
- 至少准备：一个 WebDAV 服务器（Nextcloud / 坚果云 / 本地 `wsgidav`）、一个 FTP 服务器、一台带 SSH/SFTP 的主机（配好无口令私钥）、一个 SMB 共享（Windows 下用 `net use`；Linux 下 gvfs）、一个 DLNA 媒体服务器（MiniDLNA / Plex）。
- 测试文件：至少 2 首带标签（标题/艺术家/专辑 + 封面）的音频，一个空目录，一个含空格/中文文件名的目录；WebDAV 建议额外准备含 `#`、`&`、`+`、`%`、emoji 的文件名。

## 1. WebDAV

- [ ] 添加网络源（匿名或口令），连接测试成功
- [ ] 浏览根目录与子目录；含空格/中文文件名的目录正常显示
- [ ] 特殊文件名：`#`、`&`、`+`、`%`、`%ZZ`、`[ ]`、括号、单引号、emoji 均可列出并播放
- [ ] HTTPS：地址写 `https://` 或端口填 `443` 时使用 HTTPS；仅端口 443 也应为 HTTPS
- [ ] Digest：服务端仅提供 Digest 时提示「仅支持 Basic」，错误密码才提示检查凭据
- [ ] 重定向：集合缺少尾斜杠（服务端 301 补 `/`）时自动跟随，列表与自身过滤正确
- [ ] 单曲播放：匿名源直连 URL 播放；口令源走缓存下载后播放
- [ ] 加入队列、播放全部
- [ ] 入库此目录 → 媒体库出现全部音频
- [ ] 解析元数据 → 标题/艺术家/专辑/时长正确，封面写入 cover-cache（含 webp/gif/bmp 等非 jpg/png 封面）
- [ ] 断点续传：预置 `.part` 后再次播放，缓存文件与服务端逐字节一致
- [ ] 错误路径：错误密码 → auth；不存在目录 → notFound；服务器下线 → network（UI 不卡死）

## 2. FTP / FTPS

- [ ] FTP 匿名/口令连接、浏览、播放（下载缓存）、入库
- [ ] FTPS（显式 TLS）连接成功
- [ ] 中文/空格文件名正常
- [ ] 错误密码 → auth；断连中重试正常

## 3. SFTP / SCP（系统 OpenSSH）

前提：仅支持**私钥认证**；带口令私钥不支持（用无口令密钥或 ssh-agent）。

- [ ] 添加 SFTP 源（私钥路径 + 用户名），连接测试成功
- [ ] 浏览、播放（下载缓存）、入库
- [ ] SCP 协议（走 SFTP 传输）同样可浏览
- [ ] 错误私钥/用户名 → auth；`ls -l` 输出解析正常（检查远端 ls 是否为标准 Unix 格式）
- [ ] 密码认证被明确拒绝（提示仅支持密钥）

## 4. SMB（系统挂载）

Windows：`net use`；Linux：`gio mount`（仅匿名/已缓存凭据）。

- [ ] Windows：添加 SMB 源（共享名作为根路径），浏览/播放/入库；关闭会话后 `net use` 卸载干净
- [ ] Linux：先手动在文件管理器连接共享，再用应用浏览（匿名）；口令认证给出明确提示
- [ ] 权限不足 → auth；共享不存在 → notFound
- [ ] 卸载后再次浏览会重新挂载

## 5. DLNA（媒体服务器浏览）

- [ ] 添加 DLNA 源（地址填媒体服务器 IP/端口），浏览根目录
- [ ] 容器（专辑/艺术家目录）逐级展开；音频 item 播放走 res URL 直连
- [ ] 无 res 的条目不报错
- [ ] 设备描述抓取失败（错误端口）→ 明确报错

## 6. 跨协议通用

- [ ] 媒体库：跨 profile 列出、搜索过滤、播放/加队列/移除
- [ ] 书签：收藏/跳转/移除，重启后保留
- [ ] 缓存管理：播放后「网络源缓存」大小增长；清理后归零且媒体库条目仍在
- [ ] 断点续传：播放中取消/失败后再次播放，WebDAV/FTP 走 Range/REST 续传（观察 `.part` 文件与请求头）
- [ ] 凭据安全：检查 `userData/network-sources/profiles.json`——口令/私钥口令均为密文；`library.json` 无凭据
- [ ] 路径安全：在地址栏/书签里尝试 `../` 与含控制字符路径，应被拒绝
- [ ] 断网/超时：所有操作给出结构化错误（auth/notFound/network/timeout），UI 不卡死

## 7. 平台注意事项

- SFTP/SMB 依赖系统命令（`sftp`、`net use`、`gio`），Windows 10+ 自带 OpenSSH；Linux 需 gvfs。
- NFS：Linux 下 `mount -t nfs`（需 root），验证时用 sudo 启动应用或预挂载后以本地目录方式使用。
- DLNA 直连播放依赖服务器 res URL 可达性；需要认证的流暂不支持。
