const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  CookieManager,
  detectPlatform,
  serializeNetscapeCookies,
} = require("../src/main/services/cookie-manager.cjs");

function createHarness(cookies) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clipport-auth-"));
  const metadata = {};
  const fakeSession = {
    cookies: { get: async () => cookies },
    on: () => {},
    setPermissionRequestHandler: () => {},
    setPermissionCheckHandler: () => {},
    getUserAgent: () => "ClipPort Test Agent",
    clearStorageData: async () => {},
    clearCache: async () => {},
  };
  const store = {
    getAuthMetadata: (id) => ({ ...(metadata[id] || {}) }),
    updateAuthMetadata: (id, patch) => { metadata[id] = { ...(metadata[id] || {}), ...patch }; return metadata[id]; },
    clearAuthMetadata: (id) => { delete metadata[id]; },
  };
  const manager = new CookieManager({
    sessionModule: { fromPartition: () => fakeSession },
    BrowserWindow: class {},
    store,
    userDataPath: directory,
  });
  return { directory, manager };
}

test("detects supported platform from canonical and short URLs", () => {
  assert.equal(detectPlatform("https://v.douyin.com/abc/").id, "douyin");
  assert.equal(detectPlatform("https://b23.tv/abc").id, "bilibili");
  assert.equal(detectPlatform("https://youtu.be/abc").id, "youtube");
  assert.equal(detectPlatform("https://xhslink.com/a/abc").id, "xiaohongshu");
  assert.equal(detectPlatform("https://example.com/video"), null);
});

test("serializes cookies in Netscape format without leaking line breaks", () => {
  const output = serializeNetscapeCookies([
    { domain: ".douyin.com", path: "/", secure: true, httpOnly: true, expirationDate: 2_000_000_000, name: "sessionid", value: "secret" },
    { domain: ".douyin.com", path: "/", secure: true, name: "bad\nname", value: "skip" },
  ]);
  assert.match(output, /^# Netscape HTTP Cookie File\r\n/);
  assert.match(output, /#HttpOnly_\.douyin\.com\tTRUE\t\/\tTRUE\t2000000000\tsessionid\tsecret/);
  assert.doesNotMatch(output, /skip/);
});

test("exports only matched platform cookies and tracks real-use validation", async () => {
  const cookies = [
    { domain: ".douyin.com", path: "/", secure: true, httpOnly: true, expirationDate: 2_000_000_000, name: "sessionid", value: "douyin-secret" },
    { domain: ".google.com", path: "/", secure: true, expirationDate: 2_000_000_000, name: "SAPISID", value: "google-secret" },
  ];
  const { directory, manager } = createHarness(cookies);
  try {
    const initial = await manager.getStatus("douyin");
    assert.equal(initial.status, "ready");

    const context = await manager.createAuthContext("https://v.douyin.com/abc/");
    const cookieFile = fs.readFileSync(context.cookieFile, "utf8");
    assert.match(cookieFile, /douyin-secret/);
    assert.doesNotMatch(cookieFile, /google-secret/);
    assert.equal(context.userAgent, "ClipPort Test Agent");
    context.cleanup();
    assert.equal(fs.existsSync(context.cookieFile), false);

    await manager.markAccepted("https://www.douyin.com/video/1");
    assert.equal((await manager.getStatus("douyin")).status, "valid");
    await manager.markRejected("https://www.douyin.com/video/1");
    assert.equal((await manager.getStatus("douyin")).status, "invalid");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
