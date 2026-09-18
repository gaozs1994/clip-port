const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const staticMediaTools = require("ffmpeg-ffprobe-static");
const { AppError } = require("./validators.cjs");

const execFileAsync = promisify(execFile);
const RELEASE_API = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";

function unpackedPath(value) {
  return value ? value.replace("app.asar", "app.asar.unpacked") : "";
}

function isExecutableFile(value) {
  if (!value || !path.isAbsolute(value)) return false;
  try {
    return fs.statSync(value).isFile();
  } catch {
    return false;
  }
}

async function findOnPath(command) {
  try {
    const locator = process.platform === "win32" ? "where.exe" : "which";
    const { stdout } = await execFileAsync(locator, [command], { windowsHide: true });
    return stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  } catch {
    return "";
  }
}

async function versionOf(binary, args = ["--version"]) {
  if (!isExecutableFile(binary)) return "";
  try {
    const { stdout, stderr } = await execFileAsync(binary, args, {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    return `${stdout}\n${stderr}`.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  } catch {
    return "";
  }
}

async function fetchBuffer(url, maxBytes = 220 * 1024 * 1024) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "ClipPort/0.1 (+https://github.com/yt-dlp/yt-dlp)" },
  });
  if (!response.ok) throw new AppError("TOOL_DOWNLOAD_FAILED", `工具下载失败：HTTP ${response.status}`);
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maxBytes) throw new AppError("TOOL_DOWNLOAD_FAILED", "工具文件超过安全大小限制");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) throw new AppError("TOOL_DOWNLOAD_FAILED", "工具文件超过安全大小限制");
  return buffer;
}

function ytDlpAssetName() {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === "win32") return arch === "arm64" ? "yt-dlp_arm64.exe" : "yt-dlp.exe";
  if (platform === "darwin") return "yt-dlp_macos";
  if (platform === "linux") return arch === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux";
  throw new AppError("UNSUPPORTED_PLATFORM", "当前平台暂不支持自动安装 yt-dlp");
}

class ToolchainManager {
  constructor({ store, userDataPath, onStatus, resourcesPath = process.resourcesPath, appRoot = path.resolve(__dirname, "..", "..", "..") }) {
    this.store = store;
    this.onStatus = onStatus;
    this.toolDirectory = path.join(userDataPath, "tools");
    this.bundledYtDlpPath = process.platform === "win32"
      ? path.join(resourcesPath, "tools", "yt-dlp.exe")
      : "";
    this.developmentYtDlpPath = process.platform === "win32"
      ? path.join(appRoot, "vendor", "yt-dlp", "win32-x64", "yt-dlp.exe")
      : "";
    this.cachedStatus = null;
    this.cacheTime = 0;
  }

  managedYtDlpPath() {
    return path.join(this.toolDirectory, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  }

  async #resolveYtDlp() {
    const configured = this.store.getSettings().toolPaths.ytDlp;
    if (isExecutableFile(configured)) return { path: configured, source: "自定义" };
    const managed = this.managedYtDlpPath();
    if (isExecutableFile(managed)) return { path: managed, source: "ClipPort 管理" };
    const bundled = [this.bundledYtDlpPath, this.developmentYtDlpPath].find(isExecutableFile) || "";
    if (bundled) return { path: bundled, source: "应用内置" };
    const fromPath = await findOnPath(process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
    return { path: fromPath, source: fromPath ? "系统 PATH" : "未安装" };
  }

  async #resolveMediaTool(name, bundledPath) {
    const configured = this.store.getSettings().toolPaths[name];
    if (isExecutableFile(configured)) return { path: configured, source: "自定义" };
    const bundled = unpackedPath(bundledPath);
    if (isExecutableFile(bundled)) return { path: bundled, source: "应用内置" };
    const command = process.platform === "win32" ? `${name}.exe` : name;
    const fromPath = await findOnPath(command);
    return { path: fromPath, source: fromPath ? "系统 PATH" : "未安装" };
  }

  async getStatus({ fresh = false } = {}) {
    if (!fresh && this.cachedStatus && Date.now() - this.cacheTime < 3000) return this.cachedStatus;
    const [ytDlp, ffmpeg, ffprobe] = await Promise.all([
      this.#resolveYtDlp(),
      this.#resolveMediaTool("ffmpeg", staticMediaTools.ffmpegPath),
      this.#resolveMediaTool("ffprobe", staticMediaTools.ffprobePath),
    ]);
    const [ytDlpVersion, ffmpegVersion, ffprobeVersion] = await Promise.all([
      versionOf(ytDlp.path),
      versionOf(ffmpeg.path, ["-version"]),
      versionOf(ffprobe.path, ["-version"]),
    ]);
    const status = {
      ready: Boolean(ytDlpVersion && ffmpegVersion && ffprobeVersion),
      tools: {
        ytDlp: { ...ytDlp, available: Boolean(ytDlpVersion), version: ytDlpVersion },
        ffmpeg: { ...ffmpeg, available: Boolean(ffmpegVersion), version: ffmpegVersion.replace(/^ffmpeg version\s+/i, "") },
        ffprobe: { ...ffprobe, available: Boolean(ffprobeVersion), version: ffprobeVersion.replace(/^ffprobe version\s+/i, "") },
      },
    };
    this.cachedStatus = status;
    this.cacheTime = Date.now();
    return status;
  }

  async requireReady() {
    const status = await this.getStatus({ fresh: true });
    if (!status.tools.ytDlp.available) throw new AppError("YTDLP_MISSING", "需要先安装或选择 yt-dlp");
    if (!status.tools.ffmpeg.available || !status.tools.ffprobe.available) {
      throw new AppError("FFMPEG_MISSING", "FFmpeg 或 ffprobe 不可用");
    }
    return {
      ytDlpPath: status.tools.ytDlp.path,
      ffmpegPath: status.tools.ffmpeg.path,
      ffprobePath: status.tools.ffprobe.path,
      versions: {
        ytDlp: status.tools.ytDlp.version,
        ffmpeg: status.tools.ffmpeg.version,
        ffprobe: status.tools.ffprobe.version,
      },
    };
  }

  async installYtDlp() {
    this.onStatus?.({ phase: "checking", message: "正在检查 yt-dlp 官方版本" });
    const response = await fetch(RELEASE_API, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "ClipPort/0.1",
      },
    });
    if (!response.ok) throw new AppError("TOOL_DOWNLOAD_FAILED", `无法读取官方版本：HTTP ${response.status}`);
    const release = await response.json();
    const assetName = ytDlpAssetName();
    const asset = release.assets?.find((item) => item.name === assetName);
    const checksums = release.assets?.find((item) => item.name === "SHA2-512SUMS");
    if (!asset || !checksums) throw new AppError("TOOL_DOWNLOAD_FAILED", "官方发布中缺少目标文件或校验清单");

    this.onStatus?.({ phase: "downloading", message: `正在下载 yt-dlp ${release.tag_name || ""}`.trim() });
    const [binary, checksumFile] = await Promise.all([
      fetchBuffer(asset.browser_download_url),
      fetchBuffer(checksums.browser_download_url, 4 * 1024 * 1024),
    ]);
    const expected = checksumFile
      .toString("utf8")
      .split(/\r?\n/)
      .map((line) => line.match(/^([0-9a-f]{128})\s+\*?(.+)$/i))
      .find((match) => match?.[2] === assetName)?.[1]?.toLowerCase();
    const actual = crypto.createHash("sha512").update(binary).digest("hex");
    if (!expected || expected !== actual) throw new AppError("TOOL_CHECKSUM_FAILED", "yt-dlp 校验失败，未启用下载文件");

    fs.mkdirSync(this.toolDirectory, { recursive: true });
    const destination = this.managedYtDlpPath();
    const temporary = `${destination}.download`;
    const previous = `${destination}.previous`;
    fs.writeFileSync(temporary, binary, { mode: 0o755 });
    if (fs.existsSync(previous)) fs.rmSync(previous, { force: true });
    if (fs.existsSync(destination)) fs.renameSync(destination, previous);
    fs.renameSync(temporary, destination);
    if (process.platform !== "win32") fs.chmodSync(destination, 0o755);

    this.store.updateSettings({ toolPaths: { ytDlp: destination } });
    this.cachedStatus = null;
    const status = await this.getStatus({ fresh: true });
    if (!status.tools.ytDlp.available) {
      if (fs.existsSync(previous)) {
        fs.rmSync(destination, { force: true });
        fs.renameSync(previous, destination);
      }
      throw new AppError("TOOL_SMOKE_TEST_FAILED", "yt-dlp 安装后自检失败，已恢复上一版本");
    }
    this.onStatus?.({ phase: "complete", message: `yt-dlp ${status.tools.ytDlp.version} 已可用` });
    return status;
  }

  invalidate() {
    this.cachedStatus = null;
  }
}

module.exports = { ToolchainManager, unpackedPath };
