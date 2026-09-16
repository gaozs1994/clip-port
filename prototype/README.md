# ClipPort 交互原型

此目录是基于产品 PRD 和 `ui-ux-pro-max` 生成设计系统实现的高保真交互原型。它使用原生 HTML/CSS/JavaScript，可直接作为 Electron Renderer 的交互验证材料，不包含 yt-dlp 或 FFmpeg 的真实调用。

## 打开方式

直接打开 [index.html](./index.html) 即可，无需安装依赖或启动开发服务器。

## 已覆盖交互

- 下载、任务、历史、设置四个主视图；
- URL 校验、模拟解析与解析结果状态；
- 下载预设、视频/音频/字幕选项切换；
- 创建下载、暂停/继续、移除任务；
- 历史搜索；
- 深浅主题；
- 1440px、1024px、768px 和 375px 响应式布局。

## 外部资源

- ClipPort 品牌图标为项目内置 SVG，位于 [`assets/clipport-icon.svg`](./assets/clipport-icon.svg)；
- 图标通过 Lucide UMD CDN 加载；
- 示例媒体缩略图来自 Unsplash；
- 字体使用 Plus Jakarta Sans，加载失败时回退至系统 UI 字体。
