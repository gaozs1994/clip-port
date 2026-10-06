const path = require("node:path");
const { AppError } = require("./validators.cjs");
const { detectPlatform } = require("./cookie-manager.cjs");
const { selectXiaohongshuImages } = require("./xiaohongshu-images.cjs");

const PROGRESS_PREFIX = "CLIPPORT_PROGRESS|";
const OUTPUT_PREFIX = "CLIPPORT_OUTPUT:";
const POST_PREFIX = "CLIPPORT_POST:";
const IMAGE_PREFIX = "CLIPPORT_IMAGES:";

function optionalFfmpegArgs(ffmpegPath) {
  return ffmpegPath ? ["--ffmpeg-location", path.dirname(ffmpegPath)] : [];
}

function optionalAuthArgs({ cookieFile, userAgent } = {}) {
  const args = [];
  if (cookieFile) args.push("--cookies", cookieFile);
  if (userAgent) args.push("--user-agent", userAgent);
  return args;
}

function buildParseArgs({ url, ffmpegPath, cookieFile, userAgent }) {
  return [
    "--ignore-config",
    "--no-warnings",
    "--no-playlist",
    "--skip-download",
    "--dump-single-json",
    ...(detectPlatform(url)?.id === "xiaohongshu" ? ["--ignore-no-formats-error"] : []),
    ...optionalFfmpegArgs(ffmpegPath),
    ...optionalAuthArgs({ cookieFile, userAgent }),
    "--",
    url,
  ];
}

function formatSelector(options) {
  const height = options.resolution === "best" ? "" : `[height<=${options.resolution}]`;
  const fps = ["30", "60"].includes(options.fps) ? `[fps<=${options.fps}]` : "";
  const cap = `${height}${fps}`;
  return `bv*${cap}+ba/b${cap}`;
}

function buildDownloadArgs(task, { ffmpegPath, cookieFile, userAgent }) {
  const { options } = task;
  const outputTemplate = path.join(task.packageDirectory || task.outputRoot, "%(title).160B [%(id)s].%(ext)s");
  const args = [
    "--ignore-config",
    "--newline",
    "--continue",
    "--no-overwrites",
    "--windows-filenames",
    "--trim-filenames",
    "180",
    "--retries",
    "5",
    "--fragment-retries",
    "5",
    "--output",
    outputTemplate,
    "--progress-template",
    `${PROGRESS_PREFIX}%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress._percent_str)s`,
    "--progress-template",
    `postprocess:${POST_PREFIX}%(progress.status)s|%(progress.postprocessor)s`,
    "--print",
    `after_move:${OUTPUT_PREFIX}%(filepath)j`,
    ...optionalFfmpegArgs(ffmpegPath),
    ...optionalAuthArgs({ cookieFile, userAgent }),
  ];

  if (task.downloadStrategy === "xiaohongshu-images") {
    args.push(
      "--ignore-no-formats-error", "--skip-download", "--no-simulate", "--write-all-thumbnails",
      "--convert-thumbnails", "png",
      "--print", `after_video:${IMAGE_PREFIX}%(thumbnails)j`,
    );
    if (task.infoJsonPath) args.push("--load-info-json", task.infoJsonPath);
    else args.push("--", task.sourceUrl);
    return args;
  }

  args.push(
    "--format", formatSelector(options),
    "--merge-output-format", "mp4",
    "--keep-video",
    "--extract-audio", "--audio-format", "m4a",
    "--write-thumbnail",
    "--write-subs", "--write-auto-subs",
    "--sub-langs", options.subtitleLanguages.length ? options.subtitleLanguages.join(",") : "all",
    "--embed-metadata",
  );

  // Bilibili already supplies SRT captions; its XML danmaku cannot be converted by FFmpeg.
  const isBilibili = /^BiliBili/i.test(task.media?.extractor || "") || detectPlatform(task.sourceUrl)?.id === "bilibili";
  if (!isBilibili) args.push("--convert-subs", "srt");

  if (task.infoJsonPath) args.push("--load-info-json", task.infoJsonPath);
  else args.push("--", task.sourceUrl);
  return args;
}

function parseNumber(value) {
  if (!value || value === "NA" || value === "None") return null;
  const number = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : null;
}

function parseProgressLine(line) {
  if (line.startsWith(IMAGE_PREFIX)) {
    try {
      const thumbnails = JSON.parse(line.slice(IMAGE_PREFIX.length));
      return Array.isArray(thumbnails) ? { type: "images", value: thumbnails } : null;
    } catch {
      return null;
    }
  }
  if (line.startsWith(PROGRESS_PREFIX)) {
    const [status, downloaded, total, estimate, speed, eta, percentText] = line.slice(PROGRESS_PREFIX.length).split("|");
    const totalBytes = parseNumber(total) || parseNumber(estimate);
    const downloadedBytes = parseNumber(downloaded);
    const explicitPercent = parseNumber(percentText);
    const percent = explicitPercent ?? (totalBytes && downloadedBytes ? (downloadedBytes / totalBytes) * 100 : null);
    return {
      type: "progress",
      value: {
        status,
        downloadedBytes,
        totalBytes,
        speed: parseNumber(speed),
        eta: parseNumber(eta),
        percent: percent === null ? null : Math.max(0, Math.min(100, percent)),
      },
    };
  }
  if (line.startsWith(OUTPUT_PREFIX)) {
    const raw = line.slice(OUTPUT_PREFIX.length);
    try {
      return { type: "output", value: JSON.parse(raw) };
    } catch {
      return { type: "output", value: raw };
    }
  }
  if (line.startsWith(POST_PREFIX)) {
    const [status, postprocessor] = line.slice(POST_PREFIX.length).split("|");
    return { type: "postprocess", value: { status, postprocessor } };
  }
  return null;
}

function classifyError(stderr = "") {
  const lines = stderr.split(/\r?\n/);
  const errors = lines.filter((line) => /^\s*ERROR\b/i.test(line));
  const text = (errors.length ? errors : lines.filter((line) => !/^\s*(?:WARNING:|CLIPPORT_)/i.test(line))).join("\n").toLowerCase();
  if (/fresh cookies?\s+\(not necessarily logged in\)\s+(?:are|is) needed/.test(text)) {
    return new AppError(
      "COOKIE_CHALLENGE",
      "平台要求新的访问 Cookie，但这不代表登录已失效。请稍后重试或等待 yt-dlp 更新",
      stderr,
    );
  }
  if (/sign in|log in|login|cookies?|authentication/.test(text)) {
    return new AppError("AUTH_REQUIRED", "该内容需要登录状态。请在设置的“登录状态”中登录对应平台后重试", stderr);
  }
  if (/unsupported url|no suitable extractor/.test(text)) {
    return new AppError("UNSUPPORTED_URL", "暂不支持这个链接", stderr);
  }
  if (/no video formats/.test(text)) {
    return new AppError("NO_VIDEO_FORMATS", "未找到可下载的媒体，请使用完整分享链接重试，或确认内容仍可访问", stderr);
  }
  if (/requested format.*not available/.test(text)) {
    return new AppError("FORMAT_UNAVAILABLE", "该视频不支持所选分辨率", stderr);
  }
  if (/disk full|no space left/.test(text)) {
    return new AppError("DISK_FULL", "磁盘空间不足", stderr);
  }
  if (/ffmpeg.*not found|ffprobe.*not found/.test(text)) {
    return new AppError("FFMPEG_MISSING", "FFmpeg 工具不可用", stderr);
  }
  if (/CLIPPORT_POST:started\|SubtitlesConvertor/i.test(stderr) && /preprocessing:/.test(text)) {
    return new AppError("SUBTITLE_PROCESSING_FAILED", "字幕附件处理失败", stderr);
  }
  if (/timed out|temporary failure|network is unreachable|connection/.test(text)) {
    return new AppError("NETWORK_ERROR", "网络连接失败", stderr);
  }
  return new AppError("DOWNLOAD_FAILED", "任务执行失败", stderr);
}

function codecName(value) {
  if (!value || value === "none") return "未知";
  return value.split(".")[0];
}

function normalizeInfo(info, thumbnailDataUrl = "") {
  const formats = Array.isArray(info.formats) ? info.formats : [];
  const isXiaohongshu = /^XiaoHongShu$/i.test(info.extractor_key || info.extractor || "");
  const images = isXiaohongshu && !formats.length ? selectXiaohongshuImages(info.thumbnails) : [];
  const videoFormats = formats.filter((format) => format.vcodec && format.vcodec !== "none");
  const best = videoFormats
    .slice()
    .sort((a, b) => (b.height || 0) - (a.height || 0) || (b.fps || 0) - (a.fps || 0))[0] || {};
  const estimatedBytes = best.filesize || best.filesize_approx || info.filesize || info.filesize_approx || null;
  const subtitleLanguages = new Set([
    ...Object.keys(info.subtitles || {}),
    ...Object.keys(info.automatic_captions || {}),
  ]);

  return {
    id: String(info.id || ""),
    title: String(info.title || info.fulltitle || "未命名媒体"),
    uploader: String(info.uploader || info.channel || info.extractor_key || "未知来源"),
    extractor: String(info.extractor_key || info.extractor || "unknown"),
    duration: Number.isFinite(info.duration) ? info.duration : null,
    uploadDate: info.upload_date || "",
    webpageUrl: info.webpage_url || info.original_url || "",
    liveStatus: info.live_status || (info.is_live ? "is_live" : "not_live"),
    contentType: images.length ? "images" : "video",
    imageCount: images.length,
    ...(images.length ? { downloadStrategy: "xiaohongshu-images" } : {}),
    thumbnailDataUrl,
    best: {
      height: best.height || null,
      fps: best.fps || null,
      container: best.ext || info.ext || "未知",
      videoCodec: codecName(best.vcodec),
      audioCodec: codecName(best.acodec),
      estimatedBytes,
    },
    availableHeights: [...new Set(videoFormats.map((format) => format.height).filter(Boolean))].sort((a, b) => b - a),
    subtitleLanguages: [...subtitleLanguages].sort(),
    hasManualSubtitles: Object.keys(info.subtitles || {}).length > 0,
    hasAutomaticSubtitles: Object.keys(info.automatic_captions || {}).length > 0,
  };
}

module.exports = {
  OUTPUT_PREFIX,
  buildDownloadArgs,
  buildParseArgs,
  classifyError,
  normalizeInfo,
  parseProgressLine,
};
