const test = require("node:test");
const assert = require("node:assert/strict");
const { isTrustedClipportOrigin, shouldGrantMediaPermission } = require("../src/main/services/media-permissions.cjs");

test("recognizes only the ClipPort application origin", () => {
  assert.equal(isTrustedClipportOrigin("clipport://app/index.html"), true);
  assert.equal(isTrustedClipportOrigin("https://app.example.com"), false);
  assert.equal(isTrustedClipportOrigin("not a URL"), false);
});

test("allows trusted display capture checks and requests", () => {
  assert.equal(shouldGrantMediaPermission({ permission: "display-capture", origin: "clipport://app/", trustedContents: true }), true);
  assert.equal(shouldGrantMediaPermission({ permission: "display-capture", origin: "clipport://app/", trustedContents: true, phase: "request" }), true);
  assert.equal(shouldGrantMediaPermission({ permission: "display-capture", origin: "clipport://app/", trustedContents: true, details: { isMainFrame: false } }), false);
  assert.equal(shouldGrantMediaPermission({ permission: "display-capture", origin: "https://example.com", trustedContents: true, phase: "request" }), false);
});

test("allows microphone audio but rejects camera and untrusted requests", () => {
  assert.equal(shouldGrantMediaPermission({ permission: "media", origin: "clipport://app/", trustedContents: true, details: { mediaType: "audio" } }), true);
  assert.equal(shouldGrantMediaPermission({ permission: "media", origin: "clipport://app/", trustedContents: true, details: { mediaTypes: ["audio"] }, phase: "request" }), true);
  assert.equal(shouldGrantMediaPermission({ permission: "media", origin: "clipport://app/", trustedContents: true, details: { mediaTypes: ["audio", "video"] }, phase: "request" }), false);
  assert.equal(shouldGrantMediaPermission({ permission: "media", origin: "https://example.com", trustedContents: true, details: { mediaType: "audio" } }), false);
  assert.equal(shouldGrantMediaPermission({ permission: "notifications", origin: "clipport://app/", trustedContents: true }), false);
});
