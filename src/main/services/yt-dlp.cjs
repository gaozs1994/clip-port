const path = require("node:path");
const { AppError } = require("./validators.cjs");

const PROGRESS_PREFIX = "CLIPPORT_PROGRESS|";
const OUTPUT_PREFIX = "CLIPPORT_OUTPUT:";
const POST_PREFIX = "CLIPPORT_POST:";

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

  switch (options.preset) {
    case "best":
      return "bv*+ba/b";
    case "mp4":
      return `bv*${cap}[vcodec^=avc1]+ba[acodec^=mp4a]/b${cap}[ext=mp4]/bv*${cap}+ba/b`;
    case "audio":
    case "mp3":
      return "ba/b";
    default:
      return `bv*${cap}+ba/b${cap}`;
  }
}

function buildDownloadArgs(task, { ffmpegPath, cookieFile, userAgent }) {
  const { options } = task;
  const outputTemplate = path.join(task.outputRoot, "%(title).160B [%(id)s].%(ext)s");
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

  if (options.preset === "subtitles") {
    args.push("--skip-download", "--write-subs");
    if (options.includeAutomaticSubtitles) args.push("--write-auto-subs");
    if (options.subtitleLanguages.length) args.push("--sub-langs", options.subtitleLanguages.join(","));
    args.push("--convert-subs", "srt");
  } else {
    args.push("--format", formatSelector(options));
    if (options.container !== "auto" && !["audio", "mp3"].includes(options.preset)) {
      args.push("--merge-output-format", options.container);
    }
    if (options.preset === "mp3" || (options.preset === "audio" && options.audioFormat !== "original")) {
      args.push("--extract-audio", "--audio-format", options.preset === "mp3" ? "mp3" : options.audioFormat);
      if (["mp3", "m4a", "opus"].includes(options.preset === "mp3" ? "mp3" : options.audioFormat)) {
        args.push("--audio-quality", `${options.audioQuality}K`);
      }
    }
    if (options.embedThumbnail) args.push("--embed-thumbnail");
    if (options.writeMetadata) args.push("--embed-metadata");
  }

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
  const text = stderr.toLowerCase();
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
  if (/requested format.*not available|no video formats/.test(text)) {
    return new AppError("FORMAT_UNAVAILABLE", "所选下载方案不可用", stderr);
  }
  if (/disk full|no space left/.test(text)) {
    return new AppError("DISK_FULL", "磁盘空间不足", stderr);
  }
  if (/ffmpeg.*not found|ffprobe.*not found/.test(text)) {
    return new AppError("FFMPEG_MISSING", "FFmpeg 工具不可用", stderr);
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
