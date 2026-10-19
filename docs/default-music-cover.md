# 默认音乐封面

资源：`src/renderer/src/assets/images/default-track-cover.webp`，768×768，4,258 字节。使用内置 imagegen 生成，转换为 WebP 后随应用打包；没有运行时生成或额外下载。

生成提示词：

> Create one extremely simple square default music cover for a refined desktop music player. Full bleed uniform matte muted slate-blue gray background (#323e4b approximately), only ONE large centered simple musical eighth-note symbol in soft light blue gray (#91a3b6 approximately), thick rounded smooth silhouette, clear and recognizable as a tiny thumbnail. Flat minimalist graphic treatment with only a very subtle soft tonal lift. Two colors, lots of empty space. No records, no rings, no waves, no ribbons, no scenery, no textures, no small details, no grain, no glass, no decorative highlights, no dramatic shadow, no gradients, no text, no logo, no border, no baked-in rounded corners. Quiet understated accessible fallback artwork. Composition should feel calm and almost as simple as a monochrome app glyph, not an album illustration.

`CoverImg` 默认使用此资源，并保留显式 fallback 和 placeholder 插槽。普通歌曲列表、聚合歌曲列表、在线歌曲列表、主页、播放栏、队列、歌曲详情及迷你播放器使用统一默认图。专用主题自己的封面插槽仍保留。真实封面优先；没有封面、授权失败或无法解码时回退。过期图片句柄每个歌曲身份最多恢复一次，避免破损链接反复请求；旧歌曲的异步结果不会替换新歌曲。

主页把歌名、歌手和专辑归为同一个信息组，并为包含控制和进度的完整构图预留两行歌名的高度，避免短歌名与歌手分离。播放按钮置于进度条上方并保持居中，切歌、开始播放与暂停时主卡片高度稳定。封面保持静态且缩小，窄窗口进一步减小封面。最近添加按内容区域宽度分为 6／3／2 列，包含紧凑密度；最近添加、聆听足迹和专辑先于播放链路展示。

默认图片使用与真实封面相同的根图片元素，继承调用方的尺寸和裁切规则，避免占位插槽丢失父级作用域样式后按原始 768px 尺寸显示。Electron 回归检查真实图片加载和缩略图几何。
