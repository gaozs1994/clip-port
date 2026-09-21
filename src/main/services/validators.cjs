const crypto = require("node:crypto");
const path = require("node:path");

const SENSITIVE_QUERY_KEYS = /^(?:access_token|auth|authorization|cookie|expires?|key|policy|signature|sig|token|x-amz-.+)$/i;
const ACTIVE_TASK_STATES = new Set(["preparing", "downloading", "processing", "verifying", "pausing", "canceling"]);
const TASK_STATES = new Set([
  "queued",
  "preparing",
  "downloading",
  "processing",
  "verifying",
  "paused",
  "pausing",
  "canceling",
  "canceled",
  "completed",
  "partial",
  "failed",
  "interrupted",
]);
const PRESETS = new Set(["recommended", "best", "mp4", "audio", "mp3", "subtitles"]);
const VOICEBOX_LANGUAGES = new Set(["zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it", "he", "ar", "da", "el", "fi", "hi", "ms", "nl", "no", "pl", "sv", "sw", "tr"]);
const URL_DELIMITER = /[\s<>"'`()\[\]{}【】（）《》，。！？；：、…]/u;
const TRAILING_URL_PUNCTUATION = /[.,!?;:，。！？；：、]+$/u;

class AppError extends Error {
  constructor(code, message, details = "") {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}

function assertHttpUrl(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 4096) {
    throw new AppError("INVALID_URL", "请输入有效的媒体链接");
  }

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new AppError("INVALID_URL", "链接格式不正确");
  }

  if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
    throw new AppError("INVALID_URL", "仅支持 HTTP 或 HTTPS 链接");
  }

  if (!parsed.hostname || parsed.username || parsed.password) {
    throw new AppError("INVALID_URL", "链接中不能包含账号或密码");
  }

  return parsed.toString();
}

function extractHttpUrl(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 20_000) {
    throw new AppError("INVALID_URL", "请粘贴分享文案或有效的媒体链接");
  }
  const prefixIndex = value.search(/https?:\/\//i);
  if (prefixIndex < 0) {
    throw new AppError("INVALID_URL", "未识别到以 http 或 https 开头的媒体链接");
  }
  const remainder = value.slice(prefixIndex);
  const delimiterIndex = remainder.search(URL_DELIMITER);
  const candidate = remainder
    .slice(0, delimiterIndex < 0 ? remainder.length : delimiterIndex)
    .replace(TRAILING_URL_PUNCTUATION, "");
  return assertHttpUrl(candidate);
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.test(key)) url.searchParams.set(key, "REDACTED");
    }
    url.hash = "";
    return url.toString();
  } catch {
    return "invalid-url";
  }
}

function canPersistCanonicalUrl(value) {
  try {
    const url = new URL(value);
    return ![...url.searchParams.keys()].some((key) => SENSITIVE_QUERY_KEYS.test(key));
  } catch {
    return false;
  }
}

function fingerprintUrl(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function assertTaskId(value) {
  if (typeof value !== "string" || !/^[a-f0-9-]{20,64}$/i.test(value)) {
    throw new AppError("INVALID_TASK", "任务标识无效");
  }
  return value;
}

function assertVoiceboxGenerationId(value) {
  if (typeof value !== "string" || !/^[a-f0-9-]{20,64}$/i.test(value)) {
    throw new AppError("INVALID_VOICEBOX_GENERATION", "语音生成标识无效");
  }
  return value;
}

function assertVoiceboxGeneration(input = {}) {
  const profileId = typeof input.profileId === "string" ? input.profileId.trim() : "";
  if (!/^[a-z0-9-]{1,100}$/i.test(profileId)) throw new AppError("INVALID_VOICE_PROFILE", "请选择有效的声音档案");
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text || text.length > 10_000) throw new AppError("INVALID_VOICE_TEXT", "语音文案需为 1 到 10000 个字符");
  const language = VOICEBOX_LANGUAGES.has(input.language) ? input.language : "zh";
  const instruct = typeof input.instruct === "string" ? input.instruct.trim().slice(0, 500) : "";
  return { profileId, text, language, instruct, personality: Boolean(input.personality) };
}

function assertOutputDirectory(value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.length > 1024) {
    throw new AppError("INVALID_DIRECTORY", "请选择有效的保存目录");
  }
  return path.normalize(value);
}

function sanitizeTaskOptions(input = {}) {
  const preset = PRESETS.has(input.preset) ? input.preset : "recommended";
  const allowedResolution = new Set(["best", "2160", "1440", "1080", "720", "480", "360"]);
  const allowedContainer = new Set(["auto", "mp4", "mkv", "webm"]);
  const allowedFps = new Set(["auto", "highest", "30", "60"]);
  const allowedAudioFormat = new Set(["original", "m4a", "opus", "mp3", "flac", "wav"]);
  const allowedAudioQuality = new Set(["128", "192", "256", "320"]);

  return {
    preset,
    resolution: allowedResolution.has(input.resolution) ? input.resolution : "1440",
    container: allowedContainer.has(input.container) ? input.container : "mp4",
    fps: allowedFps.has(input.fps) ? input.fps : "60",
    embedThumbnail: input.embedThumbnail !== false,
    writeMetadata: input.writeMetadata !== false,
    audioFormat: allowedAudioFormat.has(input.audioFormat) ? input.audioFormat : "original",
    audioQuality: allowedAudioQuality.has(input.audioQuality) ? input.audioQuality : "192",
    subtitleLanguages: Array.isArray(input.subtitleLanguages)
      ? input.subtitleLanguages.filter((value) => typeof value === "string" && /^[\w-]{1,24}$/.test(value)).slice(0, 12)
      : [],
    includeAutomaticSubtitles: Boolean(input.includeAutomaticSubtitles),
  };
}

function sanitizeSettingsPatch(input = {}) {
  const patch = {};
  if (Object.hasOwn(input, "downloadDirectory")) patch.downloadDirectory = assertOutputDirectory(input.downloadDirectory);
  if (Object.hasOwn(input, "concurrency")) {
    const concurrency = Number(input.concurrency);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 5) {
      throw new AppError("INVALID_SETTINGS", "同时下载任务必须在 1 到 5 之间");
    }
    patch.concurrency = concurrency;
  }
  if (Object.hasOwn(input, "theme")) {
    if (!new Set(["light", "dark", "system"]).has(input.theme)) {
      throw new AppError("INVALID_SETTINGS", "主题设置无效");
    }
    patch.theme = input.theme;
  }
  if (Object.hasOwn(input, "toolPaths")) {
    const toolPaths = {};
    for (const key of ["ytDlp", "ffmpeg", "ffprobe"]) {
      const value = input.toolPaths?.[key];
      if (value === "" || value === null) toolPaths[key] = "";
      else if (typeof value === "string" && path.isAbsolute(value) && value.length <= 1024) toolPaths[key] = path.normalize(value);
      else if (value !== undefined) throw new AppError("INVALID_SETTINGS", `${key} 路径无效`);
    }
    patch.toolPaths = toolPaths;
  }
  return patch;
}

function publicTask(task) {
  const { sourceUrlEncrypted, ...safeTask } = task;
  return safeTask;
}

module.exports = {
  ACTIVE_TASK_STATES,
  TASK_STATES,
  AppError,
  assertHttpUrl,
  assertOutputDirectory,
  assertTaskId,
  assertVoiceboxGeneration,
  assertVoiceboxGenerationId,
  canPersistCanonicalUrl,
  extractHttpUrl,
  fingerprintUrl,
  publicTask,
  redactUrl,
  sanitizeSettingsPatch,
  sanitizeTaskOptions,
};
