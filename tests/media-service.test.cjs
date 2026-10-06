const test = require("node:test");
const assert = require("node:assert/strict");
const { MediaService } = require("../src/main/services/media-service.cjs");

test("uses the Douyin share resolver only after yt-dlp reports a cookie challenge", async () => {
  const calls = [];
  const resolver = {
    async resolve(url, options) {
      calls.push({ url, options });
      return {
        id: "7685293965771410698",
        title: "测试视频",
        uploader: "测试作者",
        duration: 30,
        uploadDate: "20260916",
        webpageUrl: "https://www.iesdouyin.com/share/video/7685293965771410698",
        thumbnailUrl: "",
        width: 1920,
        height: 1080,
        fps: 30,
        availableHeights: [1080, 720],
      };
    },
  };
  const service = new MediaService({
    toolchain: { requireReady: async () => ({ ytDlpPath: "yt-dlp", ffmpegPath: "ffmpeg" }) },
    cookieManager: { createAuthContext: async () => null },
    douyinResolver: resolver,
    spawnProcess: () => ({
      child: {},
      completion: Promise.resolve({
        code: 1,
        stdout: "",
        stderr: "ERROR: [Douyin] Fresh cookies (not necessarily logged in) are needed",
      }),
    }),
  });

  const input = "复制打开抖音 https://v.douyin.com/UhZQZXPTRJs/ 直接观看";
  const media = await service.parse(input);

  assert.deepEqual(calls, [{ url: "https://v.douyin.com/UhZQZXPTRJs/", options: { resolution: "best" } }]);
  assert.equal(media.id, "7685293965771410698");
  assert.equal(media.extractor, "Douyin");
  assert.equal(media.downloadStrategy, "douyin-share");
  assert.equal(media.resolvedUrl, "https://v.douyin.com/UhZQZXPTRJs/");
});

test("parses a Xiaohongshu image note without invalidating its platform login", async () => {
  let accepted = 0;
  let rejected = 0;
  let cleaned = 0;
  const service = new MediaService({
    toolchain: { requireReady: async () => ({ ytDlpPath: "yt-dlp" }) },
    fetchThumbnail: async (url, headers) => {
      assert.match(url, /^https:\/\/sns-webpic/);
      assert.equal(headers.Referer, "https://www.xiaohongshu.com/");
      return "data:image/png;base64,preview";
    },
    cookieManager: {
      createAuthContext: async () => ({ cleanup: () => { cleaned += 1; } }),
      markAccepted: async () => { accepted += 1; },
      markRejected: async () => { rejected += 1; },
    },
    spawnProcess: () => ({ child: {}, completion: Promise.resolve({ code: 0, stderr: "", stdout: JSON.stringify({
      id: "note", title: "Photo note", extractor_key: "XiaoHongShu", formats: [],
      thumbnails: [{ url: "http://sns-webpic-qc.xhscdn.com/spectrum/one!nd_dft_webp" }],
    }) }) }),
  });
  const result = await service.parse("https://xhslink.com/a/example");
  assert.equal(result.contentType, "images");
  assert.equal(result.imageCount, 1);
  assert.equal(result.thumbnailDataUrl, "data:image/png;base64,preview");
  assert.equal(accepted, 1);
  assert.equal(rejected, 0);
  assert.equal(cleaned, 1);
});

test("rejects empty Xiaohongshu metadata instead of creating an undownloadable task", async () => {
  const service = new MediaService({
    toolchain: { requireReady: async () => ({ ytDlpPath: "yt-dlp" }) },
    spawnProcess: () => ({ child: {}, completion: Promise.resolve({ code: 0, stderr: "", stdout: JSON.stringify({
      id: "note", extractor_key: "XiaoHongShu", formats: [], thumbnails: [],
    }) }) }),
  });
  await assert.rejects(service.parse("https://www.xiaohongshu.com/explore/note"), { code: "NO_VIDEO_FORMATS" });
});
