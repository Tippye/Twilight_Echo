# 2026-10-15 归档验证

- 宿主归档前提交：`6c21df77d6a9e5cea6088e314da3f4f3e7a5af09`。
- QQ 插件原始来源提交与逐文件 SHA-256：见 `archive-manifest.json`。
- 70 份研究记录及 75 个插件文件的复制哈希核对通过；研究 JSON 全部解析成功。
- 研究归档的常见凭据赋值、带凭据 URL、私钥头模式扫描未发现命中。该检查覆盖本次归档材料，不是对完整 Git 历史的安全审计。
- 插件测试：`node --test integrations/qqmusic/plugins/qqmusic-provider/*.test.mjs integrations/qqmusic/plugins/qqmusic-provider/lib/windows/*.test.mjs`，457 项通过、0 失败、0 跳过。
- 宿主测试：选取 `git diff --name-only 60a899e..HEAD` 中的 17 个 `.test.*` 文件，使用 `node --experimental-strip-types --test --test-reporter=dot --import ./scripts/register-renderer-aliases.mjs` 执行，退出码 0。
- 插件打包：`node integrations/qqmusic/scripts/pack-plugin.cjs qqmusic-provider --twilight-root .`，退出码 0。生成包仅用于验证，未纳入源码提交。
- 未重新运行扫码登录、远端 QQ 服务或真实设备音频测试；相关结果是归档的历史证据。
- 目标仓库 `main` 与本地存在分叉，本次使用 `qqmusic-windows-adaptation` 分支提交，保留远端 `main`。
