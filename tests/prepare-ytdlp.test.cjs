const assert = require("node:assert/strict");
const test = require("node:test");
const { checksumFor, releaseApiUrl, sha512 } = require("../scripts/prepare-ytdlp.cjs");

test("builds stable and pinned yt-dlp release API URLs", () => {
  assert.equal(releaseApiUrl(), "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest");
  assert.equal(releaseApiUrl("v2025.08.22"), "https://api.github.com/repos/yt-dlp/yt-dlp/releases/tags/2025.08.22");
});

test("extracts the matching SHA-512 checksum", () => {
  const expected = "a".repeat(128);
  const contents = Buffer.from(`${"b".repeat(128)}  yt-dlp_macos\n${expected} *yt-dlp.exe\n`);
  assert.equal(checksumFor(contents, "yt-dlp.exe"), expected);
  assert.equal(checksumFor(contents, "missing.exe"), "");
});

test("computes SHA-512 hashes", () => {
  assert.equal(sha512(Buffer.from("clipport")), cryptoHash("clipport"));
});

function cryptoHash(value) {
  return require("node:crypto").createHash("sha512").update(value).digest("hex");
}
