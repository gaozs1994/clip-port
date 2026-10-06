const { spawnWithLines, terminateProcessTree } = require("./process-utils.cjs");
const { AppError, extractHttpUrl } = require("./validators.cjs");
const { buildParseArgs, classifyError, normalizeInfo } = require("./yt-dlp.cjs");
const { isDouyinUrl, normalizeDouyinInfo } = require("./douyin-resolver.cjs");
const { selectXiaohongshuImages } = require("./xiaohongshu-images.cjs");

async function thumbnailDataUrl(value, headers = {}) {
  if (!value) return "";
  let url;
  try {
    url = new URL(value);
  } catch {
    return "";
  }
  if (url.protocol !== "https:") return "";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { headers, signal: controller.signal, redirect: "follow" });
    if (!response.ok) return "";
    const type = response.headers.get("content-type") || "";
    if (!/^image\/(?:avif|gif|jpeg|png|webp)$/i.test(type)) return "";
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > 5 * 1024 * 1024) return "";
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 5 * 1024 * 1024) return "";
    return `data:${type};base64,${buffer.toString("base64")}`;
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

class MediaService {
  constructor({ toolchain, cookieManager, douyinResolver, spawnProcess = spawnWithLines, fetchThumbnail = thumbnailDataUrl }) {
    this.toolchain = toolchain;
    this.cookieManager = cookieManager;
    this.douyinResolver = douyinResolver;
    this.spawnProcess = spawnProcess;
    this.fetchThumbnail = fetchThumbnail;
    this.active = null;
  }

  async parse(rawUrl) {
    const url = extractHttpUrl(rawUrl);
    if (this.active) throw new AppError("PARSE_BUSY", "已有链接正在解析");
    const tools = await this.toolchain.requireReady();
    const authContext = await this.cookieManager?.createAuthContext(url);
    let processHandle = null;
    try {
      processHandle = this.spawnProcess(tools.ytDlpPath, buildParseArgs({ url, ffmpegPath: tools.ffmpegPath, ...(authContext || {}) }));
      this.active = processHandle;
      const result = await processHandle.completion;
      if (result.code !== 0) {
        const failure = classifyError(result.stderr);
        if (failure.code === "COOKIE_CHALLENGE" && this.douyinResolver && isDouyinUrl(url)) {
          const fallback = await this.douyinResolver.resolve(url, { resolution: "best" });
          const thumbnail = await this.fetchThumbnail(fallback.thumbnailUrl);
          return { ...normalizeDouyinInfo(fallback, thumbnail), resolvedUrl: url };
        }
        if (failure.code === "AUTH_REQUIRED" && authContext) await this.cookieManager?.markRejected(url);
        throw failure;
      }
      let info;
      try {
        info = JSON.parse(result.stdout.trim());
      } catch {
        throw new AppError("PARSE_PROTOCOL_ERROR", "解析器返回了无法识别的数据", result.stdout.slice(-2000));
      }
      if (Array.isArray(info.entries)) {
        throw new AppError("PLAYLIST_UNSUPPORTED", "首版暂不支持播放列表，请粘贴单个视频链接");
      }
      if (info.is_live || ["is_live", "is_upcoming"].includes(info.live_status)) {
        throw new AppError("LIVE_UNSUPPORTED", "首版暂不支持实时直播下载");
      }
      const media = normalizeInfo(info);
      if (/^XiaoHongShu$/i.test(media.extractor) && !(info.formats?.length) && media.contentType !== "images") {
        throw new AppError("NO_VIDEO_FORMATS", "未找到小红书视频或图片，请粘贴完整分享链接（保留链接参数）后重试，或确认笔记仍可访问");
      }
      const imageNote = media.contentType === "images";
      const thumbnail = await this.fetchThumbnail(
        imageNote ? selectXiaohongshuImages(info.thumbnails)[0]?.url : info.thumbnail,
        imageNote ? { Referer: "https://www.xiaohongshu.com/" } : {},
      );
      if (authContext) await this.cookieManager?.markAccepted(url);
      return { ...media, thumbnailDataUrl: thumbnail, resolvedUrl: url };
    } finally {
      authContext?.cleanup();
      this.active = null;
    }
  }

  async cancel() {
    if (!this.active) return false;
    await terminateProcessTree(this.active.child);
    this.active = null;
    return true;
  }
}

module.exports = { MediaService, thumbnailDataUrl };
