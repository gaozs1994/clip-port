# ClipPort

ClipPort 是一款基于 Electron、yt-dlp 和 FFmpeg/ffprobe 的本地视频解析与下载工具。链接解析、下载、合并与媒体校验均在本机执行。

## 当前功能

- 单视频链接解析与媒体信息预览
- 推荐视频、原始最佳、兼容 MP4、原始音频、MP3、仅字幕六种预设
- 下载队列、并发控制、实时速度/进度/ETA
- 暂停、继续、取消、失败重试与异常退出恢复
- 完成历史、打开文件和打开所在目录
- 浅色、深色及跟随系统主题
- 安装包内置经过官方 SHA-512 校验的 yt-dlp，并支持后续手动更新
- 内置 FFmpeg/ffprobe，自定义工具路径可覆盖
- 抖音、哔哩哔哩、YouTube、小红书隔离登录会话与 Cookie 状态校验
- Windows 设备码与 Ed25519 离线授权

首版暂不支持播放列表逐项选择和直播下载。
平台登录页运行在独立、无 Node 权限的受限窗口中。ClipPort 不读取账号密码；Cookie 保存在对应平台的本机会话中，仅在匹配平台的 yt-dlp 进程运行期间导出为临时文件并随即删除。部分平台可能限制 Electron 登录，实际可用性以平台页面和当前 yt-dlp 版本为准。

## 本地运行

```powershell
npm install
npm start
```

Windows 安装包已内置 yt-dlp、FFmpeg 和 ffprobe，安装后无需另行下载依赖即可开始解析。设置页仍可手动更新 yt-dlp；应用只从 yt-dlp 官方 GitHub Release 获取文件，并在启用前校验官方 SHA-512 清单。

## 验证与打包

```powershell
npm run check
npm test
npm run smoke
npm run build
```

`npm run build` 会生成可直接运行的 `dist/win-unpacked/ClipPort.exe`。`npm run dist` 用于生成 Windows NSIS 安装包。

打包前会执行 `npm run prepare:ytdlp`，下载当前官方 stable Windows x64 版本、核对 `SHA2-512SUMS`，再将通过校验的 `yt-dlp.exe` 写入安装包。可设置 `CLIPPORT_YTDLP_VERSION`（例如 `2025.08.22`）固定构建版本；未设置时使用最新 stable 版本。

## 设备授权签发

项目已生成签发公钥 `src/main/license-public-key.pem`。对应私钥位于 Git 忽略的 `.local-license/license-private.pem`，请离线备份并限制访问；私钥丢失后，无法继续签发与现有安装包兼容的授权码。

用户在“设置 > 设备授权”复制设备码后，使用以下命令签发永久授权：

```powershell
npm run license:issue -- --device CPD1-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX --holder 用户名
```

签发限时授权时增加到期日期：

```powershell
npm run license:issue -- --device CPD1-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX --holder 用户名 --expires 2027-12-31
```

签发工具只读取本地私钥，不连接网络。授权码包含目标设备码并由 Ed25519 签名，客户端仅内置公钥用于验证。

## 自动发布

每次向 `main` 分支推送提交时，[Windows Release 工作流](.github/workflows/release.yml) 会自动完成代码检查、测试和 NSIS 打包，并在 GitHub Releases 中创建唯一的 `build-<运行序号>` 版本，将 Windows 安装包作为附件发布。也可以在 GitHub Actions 页面手动触发该工作流。

## 目录

- `src/main`：Electron 主进程、工具链和任务引擎
- `src/preload`：最小权限 IPC 桥
- `src/renderer`：ClipPort 桌面界面
- `tests`：参数边界、持久化和解析协议测试
- `docs`：产品调研与需求文档
- `prototype`：早期静态交互原型

请仅下载你有权保存的内容，并遵守内容平台条款与当地法律。
