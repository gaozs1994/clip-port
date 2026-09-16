const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DouyinResolver,
  buildYtDlpInfo,
  extractVideoId,
  isDouyinUrl,
} = require("../src/main/services/douyin-resolver.cjs");

function response({ url, body = "", status = 200, contentType = "text/html", setCookies = [] }) {
  return {
    url,
    ok: status >= 200 && status < 300,
    status,
    body: { cancel: async () => {} },
    headers: {
      get(name) {
        if (name.toLowerCase() === "content-length") return String(Buffer.byteLength(body));
        if (name.toLowerCase() === "content-type") return contentType;
        return null;
      },
      getSetCookie: () => setCookies,
    },
    text: async () => body,
  };
}

test("recognizes supported Douyin URLs and canonical video ids", () => {
  assert.equal(isDouyinUrl("https://v.douyin.com/example/"), true);
  assert.equal(isDouyinUrl("https://www.iesdouyin.com/share/video/7685293965771410698"), true);
  assert.equal(isDouyinUrl("https://douyin.com.example.com/video/1"), false);
  assert.equal(extractVideoId("https://www.douyin.com/video/7685293965771410698?from=share"), "7685293965771410698");
});

test("resolves a short link through the current Douyin share-page flow", async () => {
  const id = "7685293965771410698";
  const html = [
    "<html><body>",
    "<div id='douyin_reflow_webId' webId=1234567890123456789 usercip=127.0.0.1></div>",
    "<div id=douyin_reflow_token xsstoken=abcdef0123456789abcdef0123456789></div>",
    "</body></html>",
  ].join("");
  const payload = JSON.stringify({
    status_code: 0,
    item_list: [{
      aweme_id: id,
      desc: "测试视频",
      create_time: 1_789_552_816,
      author: { nickname: "测试作者" },
      video: {
        duration: 270_838,
        width: 1920,
        height: 1080,
        play_addr: { url_list: ["https://aweme.snssdk.com/aweme/v1/playwm/?video_id=media&ratio=720p"] },
        cover: { url_list: ["https://example.com/cover.webp"] },
      },
    }],
  });
  const calls = [];
  const queue = [
    response({ url: `https://www.douyin.com/video/${id}`, status: 404 }),
    response({ url: `https://www.iesdouyin.com/share/video/${id}`, body: html, setCookies: ["ttwid=session-value; Path=/; HttpOnly"] }),
    response({ url: "https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/", body: payload, contentType: "application/json" }),
  ];
  const resolver = new DouyinResolver({
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return queue.shift();
    },
  });

  const result = await resolver.resolve("https://v.douyin.com/UhZQZXPTRJs/", { resolution: "1440" });

  assert.equal(calls.length, 3);
  assert.equal(new URL(calls[2].url).searchParams.get("item_ids"), id);
  assert.ok(new URL(calls[2].url).searchParams.get("reflow_id"));
  assert.equal(calls[2].options.headers.Cookie, "ttwid=session-value");
  assert.equal(result.title, "测试视频");
  assert.equal(result.uploader, "测试作者");
  assert.equal(result.duration, 270.838);
  assert.equal(result.height, 1080);
  assert.equal(new URL(result.downloadUrl).pathname, "/aweme/v1/play/");
  assert.equal(new URL(result.downloadUrl).searchParams.get("ratio"), "1080p");
  assert.deepEqual(result.availableHeights, [1080, 720, 480, 360]);

  const info = buildYtDlpInfo(result);
  assert.equal(info.id, id);
  assert.equal(info.formats[0].url, result.downloadUrl);
  assert.equal(info.formats[0].height, 1080);
  assert.equal(info.thumbnail, "https://example.com/cover.webp");
});

test("fails clearly when the share page no longer exposes its short-lived token", async () => {
  const id = "7685293965771410698";
  const resolver = new DouyinResolver({
    fetchImpl: async () => response({
      url: `https://www.iesdouyin.com/share/video/${id}`,
      body: "<div id='douyin_reflow_webId' webId=1234567890123456789 usercip=127.0.0.1></div>",
    }),
  });
  await assert.rejects(() => resolver.resolve(`https://www.iesdouyin.com/share/video/${id}`), { code: "DOUYIN_PAGE_CHANGED" });
});
