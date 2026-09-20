# ClipPort

ClipPort 是一款基于 Electron、yt-dlp、FFmpeg/ffprobe 和 Voicebox 的本地视频与语音工具。链接解析、下载、合并、媒体校验与语音生成均在本机执行。

## 当前功能

- 单视频链接解析与媒体信息预览
- 推荐视频、原始最佳、兼容 MP4、原始音频、MP3、仅字幕六种预设
- 下载队列、并发控制、实时速度/进度/ETA
- 暂停、继续、取消、失败重试与异常退出恢复
- 完成历史、打开文件和打开所在目录
- 浅色、深色及跟随系统主题
- 启动后定时检查应用更新，发现新版自动下载安装包，由用户确认后重启安装
- 安装包内置经过官方 SHA-512 校验的 yt-dlp，并支持后续手动更新
- 内置 FFmpeg/ffprobe，自定义工具路径可覆盖
- 抖音、哔哩哔哩、YouTube、小红书隔离登录会话与 Cookie 状态校验
- 内置 Voicebox CPU 服务：10 款语音模型目录与按需下载、预设/克隆声音档案、23 种语言、生成进度、试听、取消与 WAV 保存
- 独立终端式诊断日志页、级别/模块筛选、分批加载、自动脱敏与本地导出
- Windows 设备码与 Ed25519 离线授权

首版暂不支持播放列表逐项选择和直播下载。
平台登录页运行在独立、无 Node 权限的受限窗口中。ClipPort 不读取账号密码；Cookie 保存在对应平台的本机会话中，仅在匹配平台的 yt-dlp 进程运行期间导出为临时文件并随即删除。部分平台可能限制 Electron 登录，实际可用性以平台页面和当前 yt-dlp 版本为准。

## 本地运行

```powershell
npm install
npm start
```

Windows 安装包已内置 yt-dlp、FFmpeg、ffprobe 和 Voicebox CPU 服务，安装后无需另行安装运行依赖。设置页仍可手动更新 yt-dlp；应用只从 yt-dlp 官方 GitHub Release 获取文件，并在启用前校验官方 SHA-512 清单。

### Voicebox 集成

语音功能使用安装包内置的 [Voicebox](https://github.com/jamiepine/voicebox) v0.5.0 CPU 服务。ClipPort 启动时在随机本机回环端口拉起服务，并在退出时关闭；渲染页面无法直接访问该端口。首次使用某个引擎前，在“语音 > 语音模型库”查看模型语言、预计体积和下载状态，按需下载对应模型即可，无需安装独立 Voicebox 应用。

运行数据、模型、声音档案与生成记录保存在 ClipPort 用户数据目录下的 `voicebox` 子目录，不随应用升级或重新安装覆盖。模型来自对应提供者的 Hugging Face 仓库，体积和许可各不相同；安装包只内置运行时，不预装语音模型，也不会把文案、声音或生成音频发送到远程服务。

ClipPort 仅允许连接本机回环地址，并对声音档案、文本长度、语言和任务 ID 做边界校验。请只使用本人声音，或已取得明确授权的声音；不得用于冒充、欺诈或其他侵犯他人权益的用途。

## 验证与打包

```powershell
npm run check
npm test
npm run smoke
npm run build
```

`npm run build` 会生成可直接运行的 `dist/win-unpacked/ClipPort.exe`。`npm run dist` 用于生成 Windows NSIS 安装包。

打包前会执行 `npm run prepare:ytdlp`，下载当前官方 stable Windows x64 版本、核对 `SHA2-512SUMS`，再将通过校验的 `yt-dlp.exe` 写入安装包。可设置 `CLIPPORT_YTDLP_VERSION`（例如 `2025.08.22`）固定构建版本；未设置时使用最新 stable 版本。

构建还会执行 `npm run prepare:voicebox`，下载固定的官方 Voicebox v0.5.0 Windows MSI、校验预置 SHA-256，并从中提取 CPU 服务程序。提取后的二进制会再次计算哈希并写入本地元数据；GitHub Actions 使用版本化缓存，避免每次发布重复下载约 543 MB 的官方资产。Voicebox 的 MIT 许可证会随安装包写入 `resources/licenses`。

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

签发工具只读取本地私钥，不连接网络。授权码包含目标设备码并由 Ed25519 签名，客户端仅内置公钥用于验证。激活后，授权会同时保存在应用数据目录和当前 Windows 用户注册表中；应用更新导致其中一份丢失或损坏时会自动恢复，无需重新绑定。

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
