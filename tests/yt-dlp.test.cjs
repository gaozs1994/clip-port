const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  buildDownloadArgs,
  buildParseArgs,
  classifyError,
  normalizeInfo,
  parseProgressLine,
} = require("../src/main/services/yt-dlp.cjs");

test("parse arguments isolate the URL after an option terminator", () => {
  const args = buildParseArgs({ url: "https://example.com/watch?v=a&b=c", ffmpegPath: "C:\\tools\\ffmpeg.exe", cookieFile: "C:\\temp\\cookies.txt", userAgent: "ClipPort Test" });
  assert.equal(args.at(-2), "--");
  assert.equal(args.at(-1), "https://example.com/watch?v=a&b=c");
  assert.ok(args.includes("--ignore-config"));
  assert.ok(args.includes("--dump-single-json"));
  assert.equal(args[args.indexOf("--cookies") + 1], "C:\\temp\\cookies.txt");
  assert.equal(args[args.indexOf("--user-agent") + 1], "ClipPort Test");
});

test("allows Xiaohongshu image metadata without hiding missing formats on other platforms", () => {
  for (const url of ["https://www.xiaohongshu.com/explore/example", "https://xhslink.com/a/example"]) {
    assert.ok(buildParseArgs({ url }).includes("--ignore-no-formats-error"));
  }
  assert.equal(buildParseArgs({ url: "https://www.bilibili.com/video/example" }).includes("--ignore-no-formats-error"), false);
});

test("distinguishes absent video content from an unavailable resolution", () => {
  const empty = classifyError("ERROR: [XiaoHongShu] example: No video formats found!");
  assert.equal(empty.code, "NO_VIDEO_FORMATS");
  assert.doesNotMatch(empty.message, /分辨率/);
  assert.equal(classifyError("ERROR: Requested format is not available").code, "FORMAT_UNAVAILABLE");
});

test("downloads image notes without video, audio or subtitle processing", () => {
  const args = buildDownloadArgs({
    sourceUrl: "https://www.xiaohongshu.com/explore/example",
    outputRoot: path.resolve("downloads"),
    downloadStrategy: "xiaohongshu-images",
    options: { resolution: "1080", subtitleLanguages: [] },
  }, {});
  for (const flag of ["--skip-download", "--ignore-no-formats-error", "--write-all-thumbnails", "--no-simulate"]) {
    assert.ok(args.includes(flag), flag);
  }
  for (const flag of ["--format", "--extract-audio", "--write-subs", "--convert-subs"]) {
    assert.equal(args.includes(flag), false, flag);
  }
  assert.equal(args[args.indexOf("--convert-thumbnails") + 1], "png");
  assert.ok(args.includes("after_video:CLIPPORT_TEXT:%(.{title,description})j"));
});

test("recognizes image notes and counts distinct images instead of preview variants", () => {
  const info = {
    id: "note", title: "Photo note", extractor_key: "XiaoHongShu", formats: [],
    thumbnails: [
      { url: "https://sns-webpic-qc.xhscdn.com/spectrum/one!nd_prv_webp", width: 1080, height: 1440 },
      { url: "https://sns-webpic-bd.xhscdn.com/spectrum/one!nd_dft_webp", width: 1080, height: 1440 },
      { url: "https://sns-webpic-qc.xhscdn.com/spectrum/two!nd_dft_webp", width: 1080, height: 1440 },
    ],
  };
  const images = normalizeInfo(info);
  assert.equal(images.contentType, "images");
  assert.equal(images.imageCount, 2);
  assert.equal(images.downloadStrategy, "xiaohongshu-images");
  assert.deepEqual(images.availableHeights, []);
  assert.equal(Object.hasOwn(images, "thumbnails"), false);
  const video = normalizeInfo({ ...info, formats: [{ url: "https://example.com/video", height: 1080, vcodec: "avc1", ext: "mp4" }] });
  assert.equal(video.contentType, "video");
  assert.notEqual(video.downloadStrategy, "xiaohongshu-images");
});

test("reads image completion data without treating it as a video output", () => {
  const event = parseProgressLine('CLIPPORT_IMAGES:[{"filepath":"image.png"}]');
  assert.equal(event.type, "images");
  assert.deepEqual(event.value, [{ filepath: "image.png" }]);
  assert.equal(parseProgressLine("CLIPPORT_IMAGES:not-json"), null);
});

test("reads complete multiline text metadata as JSON without interpreting it as progress", () => {
  const value = { title: "标题", description: '第一段\n\n第二段 "引号"\n#话题' };
  assert.deepEqual(parseProgressLine(`CLIPPORT_TEXT:${JSON.stringify(value)}`), { type: "text", value });
  for (const payload of ["not-json", "null", "[]", '"text"']) {
    assert.equal(parseProgressLine(`CLIPPORT_TEXT:${payload}`), null);
  }
});

test("classifies platform cookie challenges without invalidating login", () => {
  const error = classifyError("ERROR: [Douyin] Fresh cookies (not necessarily logged in) are needed");
  assert.equal(error.code, "COOKIE_CHALLENGE");
  assert.match(error.message, /不代表登录已失效/);
});

test("classifies explicit sign-in requirements as authentication errors", () => {
  const error = classifyError("ERROR: Sign in to confirm your identity");
  assert.equal(error.code, "AUTH_REQUIRED");
  assert.match(error.message, /登录状态/);
});

test("does not invalidate login when a subtitle warning precedes a conversion error", () => {
  const error = classifyError([
    "WARNING: [BiliBili] Subtitles are only available when logged in. Use --cookies for the authentication.",
    "CLIPPORT_POST:started|SubtitlesConvertor",
    "ERROR: Preprocessing: Error opening input files: Invalid data found when processing input",
  ].join("\n"));
  assert.equal(error.code, "SUBTITLE_PROCESSING_FAILED");
});

test("keeps genuine authentication errors when unrelated warnings are present", () => {
  const error = classifyError("WARNING: Subtitle download failed\nERROR: [BiliBili] Login required");
  assert.equal(error.code, "AUTH_REQUIRED");
});

test("download arguments request a complete media package", () => {
  const args = buildDownloadArgs({
    outputRoot: path.resolve("downloads"),
    packageDirectory: path.resolve("downloads", ".clipport-task"),
    sourceUrl: "https://example.com/video",
    options: {
      preset: "package",
      resolution: "1440",
      container: "mp4",
      fps: "60",
      embedThumbnail: true,
      writeMetadata: true,
      audioFormat: "original",
      audioQuality: "192",
      subtitleLanguages: ["zh-Hans", "en"],
      includeAutomaticSubtitles: false,
    },
  }, { ffmpegPath: path.resolve("ffmpeg.exe") });
  assert.equal(args[args.indexOf("--audio-format") + 1], "m4a");
  assert.equal(args[args.indexOf("--format") + 1], "bv*[height<=1440][fps<=60]+ba/b[height<=1440][fps<=60]");
  assert.equal(args[args.indexOf("--sub-langs") + 1], "zh-Hans,en");
  assert.ok(args.includes("--write-thumbnail"));
  assert.ok(args.includes("--write-subs"));
  assert.ok(args.includes("--write-auto-subs"));
  assert.ok(args.includes("--keep-video"));
  assert.ok(args.includes("after_video:CLIPPORT_TEXT:%(.{title,description})j"));
  assert.equal(args[args.indexOf("--convert-subs") + 1], "srt");
  assert.equal(args.at(-2), "--");
  assert.equal(args.at(-1), "https://example.com/video");
});

test("preserves Bilibili SRT subtitles and XML danmaku without passing them to FFmpeg", () => {
  for (const [sourceUrl, extractor] of [
    ["https://www.bilibili.com/video/BV128H86SEHn/", "BiliBili"],
    ["https://b23.tv/example", ""],
    ["https://example.com/redirect", "BiliBiliBangumi"],
  ]) {
    const args = buildDownloadArgs({
      sourceUrl,
      outputRoot: path.resolve("downloads"),
      media: { extractor },
      options: { resolution: "360", fps: "60", subtitleLanguages: ["ai-zh", "danmaku"] },
    }, { ffmpegPath: path.resolve("ffmpeg.exe") });
    assert.equal(args.includes("--convert-subs"), false);
    assert.equal(args[args.indexOf("--sub-langs") + 1], "ai-zh,danmaku");
    assert.ok(args.includes("--write-subs"));
    assert.ok(args.includes("--write-thumbnail"));
    assert.ok(args.includes("--extract-audio"));
  }
});

test("download arguments can consume a trusted temporary info document", () => {
  const infoJsonPath = path.resolve("douyin.info.json");
  const args = buildDownloadArgs({
    outputRoot: path.resolve("downloads"),
    sourceUrl: "https://v.douyin.com/example/",
    infoJsonPath,
    options: {
      preset: "package",
      resolution: "1080",
      container: "mp4",
      fps: "60",
      embedThumbnail: true,
      writeMetadata: true,
      audioFormat: "original",
      audioQuality: "192",
      subtitleLanguages: [],
      includeAutomaticSubtitles: false,
    },
  }, { ffmpegPath: path.resolve("ffmpeg.exe") });
  assert.equal(args[args.indexOf("--load-info-json") + 1], infoJsonPath);
  assert.equal(args.includes("https://v.douyin.com/example/"), false);
});

test("progress parser handles unknown totals without inventing a percentage", () => {
  const event = parseProgressLine("CLIPPORT_PROGRESS|downloading|2048|NA|NA|1024|8|NA");
  assert.equal(event.type, "progress");
  assert.equal(event.value.downloadedBytes, 2048);
  assert.equal(event.value.totalBytes, null);
  assert.equal(event.value.speed, 1024);
  assert.equal(event.value.percent, null);
  assert.equal(event.value.eta, 8);
});

test("normalizes raw metadata without exposing raw formats", () => {
  const result = normalizeInfo({
    id: "abc",
    title: "Example",
    uploader: "Studio",
    duration: 120,
    formats: [
      { height: 720, fps: 30, ext: "mp4", vcodec: "avc1.4d", acodec: "none", filesize: 1000 },
      { height: 2160, fps: 60, ext: "webm", vcodec: "vp9", acodec: "opus", filesize_approx: 5000 },
    ],
    subtitles: { zh: [] },
    automatic_captions: { en: [] },
  });
  assert.equal(result.best.height, 2160);
  assert.equal(result.best.estimatedBytes, 5000);
  assert.deepEqual(result.subtitleLanguages, ["en", "zh"]);
  assert.equal(Object.hasOwn(result, "formats"), false);
});
