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

test("classifies cookie challenges as an actionable authentication error", () => {
  const error = classifyError("ERROR: Fresh cookies are needed to access this content");
  assert.equal(error.code, "AUTH_REQUIRED");
  assert.match(error.message, /登录状态/);
});

test("download arguments map the MP3 preset centrally", () => {
  const args = buildDownloadArgs({
    outputRoot: path.resolve("downloads"),
    sourceUrl: "https://example.com/video",
    options: {
      preset: "mp3",
      resolution: "1440",
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
  assert.equal(args[args.indexOf("--audio-format") + 1], "mp3");
  assert.equal(args[args.indexOf("--audio-quality") + 1], "192K");
  assert.equal(args.at(-2), "--");
  assert.equal(args.at(-1), "https://example.com/video");
});

test("progress parser handles unknown totals without inventing a percentage", () => {
  const event = parseProgressLine("CLIPPORT_PROGRESS|downloading|2048|NA|NA|1024|8|NA");
  assert.equal(event.type, "progress");
  assert.equal(event.value.downloadedBytes, 2048);
  assert.equal(event.value.totalBytes, null);
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
