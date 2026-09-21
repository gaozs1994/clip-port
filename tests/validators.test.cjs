const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertHttpUrl,
  assertVoiceboxGeneration,
  assertVoiceboxGenerationId,
  canPersistCanonicalUrl,
  extractHttpUrl,
  redactUrl,
  sanitizeSettingsPatch,
  sanitizeTaskOptions,
} = require("../src/main/services/validators.cjs");

test("accepts only HTTP(S) URLs without embedded credentials", () => {
  assert.equal(assertHttpUrl("https://example.com/watch?v=1"), "https://example.com/watch?v=1");
  assert.throws(() => assertHttpUrl("file:///tmp/video"), { code: "INVALID_URL" });
  assert.throws(() => assertHttpUrl("https://user:secret@example.com/video"), { code: "INVALID_URL" });
});

test("extracts the first HTTP link from a copied share message", () => {
  const shareText = "5.64 复制打开抖音，看看【城市金融报的作品】追觅6至8月离职裁员近万人!业务全面收缩 # 热点... [https://v.douyin.com/-gQDYnKuZ4g/](https://v.douyin.com/-gQDYnKuZ4g/) D\\@H.Vy srr:/ :9pm 05/24";
  assert.equal(extractHttpUrl(shareText), "https://v.douyin.com/-gQDYnKuZ4g/");
  assert.equal(extractHttpUrl("打开 https://example.com/watch?v=1，查看视频"), "https://example.com/watch?v=1");
  assert.throws(() => extractHttpUrl("没有可识别的链接 javascript:alert(1)"), { code: "INVALID_URL" });
});

test("redacts sensitive query parameters and blocks canonical persistence", () => {
  const value = "https://example.com/watch?v=abc&token=secret&signature=signed#section";
  const redacted = redactUrl(value);
  assert.match(redacted, /token=REDACTED/);
  assert.match(redacted, /signature=REDACTED/);
  assert.doesNotMatch(redacted, /secret|signed|#section/);
  assert.equal(canPersistCanonicalUrl(value), false);
  assert.equal(canPersistCanonicalUrl("https://example.com/watch?v=abc"), true);
});

test("normalizes task options to a bounded public contract", () => {
  assert.deepEqual(sanitizeTaskOptions({ preset: "mp3", audioQuality: "320", subtitleLanguages: ["zh-Hans", "../bad"] }), {
    preset: "mp3",
    resolution: "1440",
    container: "mp4",
    fps: "60",
    embedThumbnail: true,
    writeMetadata: true,
    audioFormat: "original",
    audioQuality: "320",
    subtitleLanguages: ["zh-Hans"],
    includeAutomaticSubtitles: false,
  });
});

test("rejects concurrency outside the supported range", () => {
  assert.throws(() => sanitizeSettingsPatch({ concurrency: 0 }), { code: "INVALID_SETTINGS" });
  assert.equal(sanitizeSettingsPatch({ concurrency: 3 }).concurrency, 3);
});

test("bounds Voicebox generation input without requiring a consent flag", () => {
  assert.deepEqual(assertVoiceboxGeneration({
    profileId: "a1111111-1111-4111-8111-111111111111",
    text: "  你好，ClipPort。  ",
    language: "zh",
    instruct: "温和、清晰",
    personality: true,
  }), {
    profileId: "a1111111-1111-4111-8111-111111111111",
    text: "你好，ClipPort。",
    language: "zh",
    instruct: "温和、清晰",
    personality: true,
  });
  assert.equal(assertVoiceboxGeneration({ profileId: "valid-profile", text: "hello" }).text, "hello");
  assert.throws(() => assertVoiceboxGeneration({ profileId: "../profile", text: "hello" }), { code: "INVALID_VOICE_PROFILE" });
  assert.equal(assertVoiceboxGenerationId("a1111111-1111-4111-8111-111111111111"), "a1111111-1111-4111-8111-111111111111");
});
