<h1 align="center">Twilight Echo</h1>

<p align="center">
  <img src="./assets/logo.png" width="480" alt="Twilight Echo 渐变色标志" />
</p>

<p align="center">
  <strong>收藏你喜欢的音乐，找到下一首心动。</strong><br />
  一款整合本地曲库、在线发现与网络音乐源的开源桌面播放器。<br />
  从沉浸歌词、主题定制，到 HiFi 调音与 AutoMix，让音乐按你的习惯播放。
</p>

<p align="center">
  <a href="https://github.com/Px-asen/Twilight_Echo/releases/latest"><img alt="最新正式版" src="https://img.shields.io/github/v/release/Px-asen/Twilight_Echo?display_name=tag&style=flat-square&color=8b5cf6" /></a>
  <img alt="支持 Windows 10 和 11" src="https://img.shields.io/badge/Windows-10%20%2F%2011-2563eb?style=flat-square" />
  <a href="./LICENSE"><img alt="Apache 2.0 开源许可证" src="https://img.shields.io/badge/license-Apache--2.0-64748b?style=flat-square" /></a>
</p>

<p align="center">
  <a href="https://github.com/Px-asen/Twilight_Echo/releases/latest"><strong>下载 Windows 版</strong></a>
  · <a href="#快速开始">快速开始</a>
  · <a href="#功能一览">功能一览</a>
  · <a href="#界面预览">界面预览</a>
  · <a href="./docs/release-notes/1.3.1.md">1.3.1 更新说明</a>
  · <a href="#常见问题">常见问题</a>
  · <a href="https://github.com/Px-asen/Twilight_Echo/issues">问题反馈</a>
</p>

![Twilight Echo 音乐主页：唱片式正在播放、每日推荐与音乐入口](./assets/screenshots/home-dashboard.png)

<p align="center"><sub>从硬盘里的珍藏，到每日推荐里的新发现，让音乐陪你度过每一个日常。</sub></p>

## 1.3.1 更新亮点

- **余晖模式（Afterglow）**：卸载界面渲染器释放内存，原生引擎继续播放；托盘、媒体键、系统媒体控制和局域网遥控仍可用，恢复界面不中断播放。
- **全窗口插件体验与灵动岛**：插件 API v4 / bridge v2 让插件在宿主窗口内提供完整工作区；灵动岛支持歌词、播放控制和 DIY 配置。
- **快捷键、页面历史与网络源**：快捷键可配置并显示占用状态，鼠标侧键可前进／后退；WebDAV 等网络源与在线歌单分组分页继续完善。
- **原生音频、性能与修复**：改进 ASIO 协商和 Native DSD 边界，加入跨进程诊断；歌曲列表虚拟化与图片内存治理降低占用，并修复播放页配色、窗口外框和详情页布局。

完整的新增功能、修复与使用说明见 **[v1.3.1 发布说明](./docs/release-notes/1.3.1.md)**。

## 下载与安装

**[前往 Releases 下载最新版 →](https://github.com/Px-asen/Twilight_Echo/releases/latest)**

1. 在发布页的 **Assets（资源）** 中，下载以 `-setup.exe` 结尾的 Windows 安装程序。
2. 运行安装程序，按向导选择安装位置并完成安装。
3. 打开 Twilight Echo，跟随首次使用向导设置听歌习惯、音乐文件夹和播放器外观。

> [!NOTE]
> Windows 10/11 是当前主要且验证最完整的平台。macOS 与 Linux 后端已有实现，但尚未达到正式发布验证标准。

<details>
<summary>安装时提示“未知发布者”？</summary>

当前安装包由个人开发者发布，尚无商业代码签名证书，因此 Windows SmartScreen 可能显示“未知发布者”。请从本项目的 GitHub Releases 下载，并在发布页提供 `.sha256` 文件时核对安装包的校验值。

在安装包所在文件夹打开 PowerShell，运行下面的命令，将引号内的名称替换为实际文件名，然后与发布页的 SHA-256 比对：

```powershell
Get-FileHash -LiteralPath '.\你下载的安装包文件名.exe' -Algorithm SHA256
```

</details>

## 快速开始

**听本地收藏** — 在首次使用向导中添加音乐文件夹，或打开「设置 → 媒体库与存储 → 本地媒体库 → 添加文件夹」。扫描完成后，按歌曲、专辑、艺术家、文件夹或流派浏览；设置页的「快速配置」也能直接进入添加音乐和选择输出设备。

**发现在线音乐** — 无需先建立本地曲库。打开「流媒体音乐 → 推荐主页」，按音源能力浏览公开歌单或排行榜；登录后使用每日推荐、私人漫游与个人收藏。更多音源可在「扩展中心」查找，或从[第三方插件仓库](https://github.com/Px-asen/Twilight-Echo-plugins)获取 `.tep` 扩展包。

**快速找到内容** — 在侧栏「搜索」选择本地音乐、全部来源或已启用音源，查找歌曲、专辑、歌单和艺术家；可用搜索类型取决于音源。按 **Ctrl + K** 打开命令面板，查找歌曲、已加载歌单和常用操作；输入 `>` 可只查找操作与设置。

**调成喜欢的样子** — 在「设置 → 外观」调整深浅主题、字体、播放栏，以及「背景与界面材质」；打开「主题工作室」预览布局和播放器样式。迷你播放器、桌面歌词和主窗口可分别调整。需要制作可分享的主题包时，再使用主题插件工坊（Beta）。

**选择声音与衔接方式** — 在「设置 → 播放与音效」选择输出设备，可用左右声道测试音检查输出。日常听歌可保持默认配置；想尝试自动混音，在「歌曲衔接 → Twilight AutoMix」选择自然或 DJ 模式后再播放队列。基础 AutoMix 无需额外分轨包，分轨增强的安装方式见下方常见问题。

扫描、下载或更新进行时，可从标题栏「任务与通知」查看进度和处理结果。设置搜索也能直接定位选项，无需逐个展开分类。

## 功能一览

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🎵 把收藏整理好</h3>
      <p>多文件夹监听、专辑与艺术家浏览、元数据补全、批量标签编辑、重复检测和 CUE 整轨分曲。通过曲库整理收件箱处理待整理内容，关联歌曲与专辑的不同版本和来源。</p>
    </td>
    <td width="50%" valign="top">
      <h3>🔎 总有新的声音</h3>
      <p>统一搜索本地与在线歌曲、专辑、艺术家和歌单；浏览网易云推荐、排行榜、个人音乐库与云盘。下载完成后可直接播放、打开目录或复制加入本地曲库。</p>
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h3>✨ 让歌词跟着音乐走</h3>
      <p>逐行、逐词同步，翻译与音译分层显示，支持 TTML、本地歌词导入、编辑和时间偏移。沉浸式播放页随封面变换色彩，桌面歌词独立显示，频谱与波形呈现声音动态。</p>
    </td>
    <td valign="top">
      <h3>🎧 按你的喜好调音</h3>
      <p>原生音频引擎、WASAPI 共享与独占输出、设备档案、OPRA/AutoEQ 耳机校正与 DSP 效果链。参数均衡器支持最多 32 个频段、A/B 快照、多选联动、复制粘贴和撤销重做。</p>
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h3>🎚️ 让歌曲自然接上</h3>
      <p>无缝播放、交叉淡化与 Twilight AutoMix 可分别配置。AutoMix 提供自然和 DJ 模式试用，分析适合的交接位置；安装可选分轨包后，可用人声与贝斯分轨辅助过渡。</p>
    </td>
    <td valign="top">
      <h3>🌙 留住播放进度</h3>
      <p>保存命名队列、恢复歌曲与进度、查看实际播放顺序，并使用播放书签、变速不变调、A-B 循环和睡眠定时。迷你播放器、托盘、全局快捷键和局域网遥控适配不同听歌场景；余晖模式（Afterglow）可卸载界面释放内存，由原生引擎继续播放，托盘或快捷键随时恢复。</p>
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h3>🎨 做成你喜欢的样子</h3>
      <p>深浅主题、封面取色、自定义图片，以及透明、毛玻璃和液态玻璃材质。按页面设置背景并全窗口预览，调整字体、播放栏和侧栏顺序；主题插件工坊（Beta）可编辑与导出主题。</p>
    </td>
    <td valign="top">
      <h3>🧩 接入更多音乐来源</h3>
      <p>通过 WebDAV、FTP、SFTP、SMB 等网络源浏览 NAS 或远程音乐，协议可用性取决于系统与服务端。支持网络电台、RSS 播客，以及通过扩展中心安装音源、主题和工具插件。</p>
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h3>📊 回看自己的音乐足迹</h3>
      <p>统计仪表盘展示近 7／30／90 天收听趋势、前一周期对比、活动日历，以及常听歌曲与艺术家排行。可按时长或次数查看歌曲排行，按日期范围清理记录。</p>
    </td>
    <td valign="top">
      <h3>💾 管理任务与个人数据</h3>
      <p>任务与通知中心汇总扫描、补全、响度分析、下载与更新，支持勿扰。个人数据备份涵盖十类记录，恢复前预览冲突并映射音乐目录；软件更新支持进度显示、续传和完整性校验。</p>
    </td>
  </tr>
</table>

## 界面预览

### 找歌、逛歌单，也照顾好本地收藏

<table>
  <tr>
    <td width="50%"><a href="./assets/screenshots/streaming-home.png"><img src="./assets/screenshots/streaming-home.png" alt="在线音乐主页：每日推荐与私人漫游" /></a></td>
    <td width="50%"><a href="./assets/screenshots/local-library-light.png"><img src="./assets/screenshots/local-library-light.png" alt="本地音乐库：歌曲列表与专辑封面" /></a></td>
  </tr>
  <tr>
    <td align="center">每日推荐 · 从熟悉的喜好发现新歌</td>
    <td align="center">本地曲库 · 随时翻阅自己的收藏</td>
  </tr>
</table>

### 留一点屏幕空间给音乐

封面、歌词与色彩一起构成正在播放页面；支持深浅主题，也可以把歌词留在桌面上。

![沉浸式播放页：封面取色、同步歌词与双语显示](./assets/screenshots/immersive-lyrics.png)

<details>
<summary>查看更多界面：主题工作室、在线歌单、调音工具与扩展中心</summary>

<table>
  <tr>
    <td width="50%"><a href="./assets/screenshots/theme-studio.png"><img src="./assets/screenshots/theme-studio.png" alt="主题工作室：选择界面风格并实时预览" /></a></td>
    <td width="50%"><a href="./assets/screenshots/streaming-playlist.png"><img src="./assets/screenshots/streaming-playlist.png" alt="每日推荐歌单：歌曲列表与播放控制" /></a></td>
  </tr>
  <tr>
    <td align="center">切换主题，实时预览界面风格</td>
    <td align="center">浏览每日推荐，播放喜欢的歌曲</td>
  </tr>
  <tr>
    <td><a href="./assets/screenshots/dsp-processor.png"><img src="./assets/screenshots/dsp-processor.png" alt="DSP 处理器与音频信号链" /></a></td>
    <td><a href="./assets/screenshots/parametric-equalizer.png"><img src="./assets/screenshots/parametric-equalizer.png" alt="Twilight EQ 参数均衡器：频段曲线、实时频谱与调节旋钮" /></a></td>
  </tr>
  <tr>
    <td align="center">组合 DSP 效果，查看处理状态</td>
    <td align="center">调节频段，直观看到均衡曲线</td>
  </tr>
  <tr>
    <td><a href="./assets/screenshots/audio-visualizer.png"><img src="./assets/screenshots/audio-visualizer.png" alt="音频频谱、波形与响度可视化" /></a></td>
    <td><a href="./assets/screenshots/extension-center.png"><img src="./assets/screenshots/extension-center.png" alt="扩展中心：浏览和管理可选插件" /></a></td>
  </tr>
  <tr>
    <td align="center">看见声音的频谱与动态</td>
    <td align="center">按需添加音源、主题和工具</td>
  </tr>
</table>

</details>

<sub>以上界面截图截取自 v1.3.0 演示视频，实际外观随版本和主题设置变化。截图中的酷狗、Bilibili、QQ 音乐等为可选第三方扩展示例，可用性以当前扩展为准。</sub>

## 支持的音频格式

| 类型            | 格式                                                   |
| --------------- | ------------------------------------------------------ |
| 常见音频        | MP3、AAC、OGG、Opus、WMA                               |
| 无损与 PCM 音频 | FLAC、WAV / WAVE、AIFF / AIF、ALAC、APE、WavPack（WV） |
| 其他容器        | M4A、MP4、WebM                                         |
| DSD 与整轨收藏  | DSF、DFF、SACD ISO；支持 CUE 整轨分曲                  |

实际解码与输出能力取决于发布包、音频驱动和设备。`.mqa` 文件按 FLAC 兼容容器扫描与解码，不提供 MQA unfold、认证或授权能力。

## 常见问题

<details>
<summary>只听本地音乐，需要登录或联网吗？</summary>

播放已有本地音乐无需登录音乐平台账号。在线推荐、网络音源、在线歌词获取、电台和播客等功能需要网络；部分在线内容还需要对应平台的登录或订阅权限。

</details>

<details>
<summary>在哪里打开统计、电台、播客和 NAS 网络源？</summary>

这些页面默认不固定在侧栏。打开「全部页面」，或通过侧栏「编辑页面」显示「统计仪表盘」「电台 / 播客」「网络源」，也可以用 Ctrl + K 查找入口。侧栏支持调整页面顺序和隐藏不常用项。

</details>

<details>
<summary>连接 NAS / WebDAV 网络源失败，怎么排查？</summary>

先确认地址与根路径：地址可写 `https://nas.local`，也可写 `nas.local` 并单独填写端口。使用 HTTPS 时可写明 `https://`，或把端口填为 `443`。用户名/口令走标准 Basic 认证；如果服务器强制要求 Digest 认证，会提示「仅支持 Basic」，此时需要在服务器端启用 Basic 或使用其他挂载方式。

匿名源可直接串流播放；需要认证的来源会先下载到「网络源缓存」再播放，可在网络源页面查看缓存大小并清理。连接超时、认证失败、路径不存在等都会给出结构化提示。若服务器使用自签名证书，HTTPS 连接会被拒绝，请改用受信任证书，或在可信内网中改用 HTTP。

</details>

<details>
<summary>添加文件夹后，歌曲没有出现怎么办？</summary>

先确认文件夹中有受支持的音频文件，并等待扫描完成。在「设置 → 媒体库与存储」检查目录、自动扫描和扫描状态，必要时展开「扫描与诊断」执行完整重扫。标题栏「任务与通知」也能查看扫描进度。

下载目录在曲库之外时，可在下载完成项点击「加入曲库（复制）」；应用会保留原文件，并把副本加入已配置的音乐目录。也可以直接把下载目录添加到媒体库。

</details>

<details>
<summary>没有声音，或者其他应用突然不能出声？</summary>

先检查播放器音量、静音状态和 Windows 音量混合器，再到「设置 → 播放与音效」确认输出设备；暂停播放后可用左右声道测试音检查输出。如果启用了 WASAPI 独占模式，设备可能被播放器独占；日常多应用同时播放时，使用共享模式更方便。

</details>

<details>
<summary>为什么有些在线歌曲或扩展暂时不可用？</summary>

内置网易云音乐与第三方音源均依赖对应平台服务，可用内容受账号权限、所在地区和平台策略影响。扩展由各自作者维护，可先检查登录状态并更新扩展；仍有问题时，向对应扩展作者反馈。使用账号和内容时，请遵守对应服务条款。

</details>

<details>
<summary>AutoMix 怎么开启？分轨包需要另外下载吗？</summary>

在「设置 → 播放与音效 → 歌曲衔接 → Twilight AutoMix」选择自然或 DJ 模式，再开始播放队列。AutoMix 默认关闭，当前已开放试用；自然模式侧重保留歌曲内容，DJ 模式允许更长重叠、对拍和更明显的片头／片尾调整。不适合混音或过渡准备失败时会回退常规播放。

基础 AutoMix 不需要安装分轨包。需要人声、贝斯分轨辅助时，在 [Releases](https://github.com/Px-asen/Twilight_Echo/releases) 找到当前版本对应的 Assets（附件），下载分轨运行包，再在上述设置中点击「安装分轨包…」选择 ZIP 文件。按运行包能力选择自动、GPU 或 CPU；分轨会额外占用内存或显存，详见[发布说明](./docs/release-notes/1.3.0.md)。

</details>

<details>
<summary>换电脑后，怎么带走歌单、队列和收听记录？</summary>

打开「设置 → 系统与关于 → 备份与恢复」，导出个人数据；在新电脑上选择备份并预览，勾选恢复类别、选择冲突处理方式，并把原音乐目录映射到新位置。确认后，在下次启动时执行恢复。

个人数据备份包含曲库索引、歌单收藏、队列、当前播放、歌词修改、播放书签、电台、播客、收听统计和版本关系。**音频文件需要另行复制，账号登录、插件和封面缓存不随备份迁移。** 设置与主题配置使用同一区域的「设置备份」单独导出、导入。

</details>

<details>
<summary>如何更新播放器？</summary>

打开「设置 → 系统与关于」检查更新，可选择稳定或测试频道，并查看更新说明、下载进度与安装状态。Windows 使用完整安装包升级，下载支持中断恢复，并在安装前校验文件大小和 SHA-256；任务与通知中心也能查看更新进度。后台检查只提示新版本，下载和安装由你决定。

也可以从 [Releases](https://github.com/Px-asen/Twilight_Echo/releases) 手动下载安装包；当前版本的变化见 [v1.3.1 发布说明](./docs/release-notes/1.3.1.md)。

</details>

<details>
<summary>HiFi 进阶：独占输出、DSD、ASIO 和 DSP 有哪些限制？</summary>

- **共享与独占**：WASAPI Shared（共享）经过 Windows 系统混音；Exclusive（独占）可在设备允许时进行格式直通。日常播放无需开启独占。
- **DSD**：Native DSD、DoP 与 SACD ISO 的实际播放模式取决于设备、驱动和发布包。WASAPI 与 CoreAudio 没有平台级 native DSD 通道，会使用 DoP 或 PCM 回退；Linux 仅在兼容的 ALSA `hw:` 设备上尝试 native DSD。DSD / 直通播放会绕过部分 DSP，这是预期行为。
- **ASIO 与 VST3**：Windows x64 的 ASIO 兼容层仍属实验性，真实设备支持尚未验证；VST3 的实际运行与设备兼容性同样尚未完成验证。请结合发布包能力清单与应用中的输出诊断判断。
- **重采样与转换**：PCM SRC 支持 SWR；SoXR 随构建可选，当前仍属未验证能力。实验性 PCM→DSD64/128/256 由 CPU 执行，不代表完整高品质 SDM；当前不提供 CUDA SDM。
- **原样输出与混音**：EQ、DSP 和 AutoMix 可能改变输出样本。需要 bit-perfect 时，应关闭会改变信号的处理，并以播放时的 HiFi 状态和原因说明为准；AutoMix 分轨可使用 GPU，不代表核心音频链路提供 CUDA 加速。

更详细的能力状态见[发布能力说明](./docs/release-capability-status.md)，实际发布包以随附的 `audio-capabilities.json` 与 `release-capability-status.json` 为准。

</details>

<details>
<summary>macOS 和 Linux 可以用吗？</summary>

CoreAudio 与 ALSA 后端已存在，但目前没有经过与 Windows 同等级别的发布和真实设备验证。现阶段建议普通用户使用 Windows 版本；macOS / Linux 构建供开发、测试和贡献使用。

</details>

## 反馈与交流

遇到问题或有新想法，欢迎[提交 Issue](https://github.com/Px-asen/Twilight_Echo/issues/new/choose)，选择对应表单：

- **Bug 反馈**：提供应用版本、系统版本、问题表现、复现步骤和预期结果。无法稳定复现时，说明发生前的操作与大致频率即可。
- **功能建议**：描述使用场景、当前困难和希望改善的体验。
- **使用问题**：说明想完成什么操作、在哪一步遇到困难，以及已经尝试的方法。

提交前先查看[常见问题](#常见问题)，并[搜索已有 Issue](https://github.com/Px-asen/Twilight_Echo/issues)，包括已关闭的问题；已有相同问题时，直接补充到原 Issue。每条 Issue 只讨论一个问题，标题描述具体现象，例如「[Bug] 切换 WASAPI 独占模式后播放无声」。

截图和日志按需提供。音频问题建议补充输出设备、驱动、输出模式及歌曲格式，也可在「设置 → 系统与关于 → 导出音频诊断」保存诊断文件，并附上导出的 Markdown 报告。AutoMix 问题可补充模式、分轨运行包和计算设备；插件问题请提供插件名称、版本和来源。如果仅涉及第三方插件，可优先向对应插件作者反馈。

Issue 内容和附件会公开显示，上传前请检查并删除密码、Cookie、Token、账号信息及私人文件路径，无需上传整首音乐或完整媒体库。

**官方 QQ 群：1093775290** — 交流使用体验、参与预览版内测，获取Apple Music 音源。

## 支持与赞助

##### **如果 Twilight Echo 成了你常用的播放器，欢迎给项目点一个 Star、分享给朋友，或通过[爱发电](https://afdian.com/a/pxasen)支持后续开发。捐赠者将记录在软件内的贡献者名单中，感谢每一份支持。**

#### **每一位想参与TwilightEcho开发的开发者可以通过：QQ3248974986 来加我的联系方式进入内部开发者群聊，让我们一起将TwilightEcho做的更好**！

## 扩展与开发

想制作扩展、贡献代码或从源码运行，可以从这里开始：

[开发者文档](./docs/DEVELOPER_README.md) · [插件开发指南](./docs/PLUGIN_README.md) · [插件规范](./docs/twilight-echo-plugin-spec.md) · [第三方插件仓库](https://github.com/Px-asen/Twilight-Echo-plugins) · [全部文档](./docs/README.md)

第三方开发者可在自己的公开仓库发布 `.tep`，通过 GitHub Topic 和 Release 自动进入插件市场；无需把源码提交到目录仓库。发布步骤见[插件开发指南](./docs/PLUGIN_README.md#14-发布到插件市场)。

开发环境使用项目锁定的 `pnpm@11.7.0`；依赖安装、原生音频工具链和运行步骤见开发者文档，Windows 发布流程见[发布检查](./docs/windows-release-gate.md)。

## 开源许可

Twilight Echo 采用 [Apache License 2.0](./LICENSE) 开源。第三方依赖、字体、图标、插件和内容素材遵循各自的许可证或服务条款；相关商标归其权利人所有，Twilight Echo 与这些服务不存在官方隶属或背书关系。

如有版权或侵权问题，请联系 Pxasen@outlook.com，以便核实并处理。
