const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ASSET_SHA256, VERSION, findServerBinary, sha256File } = require("../scripts/prepare-voicebox.cjs");

test("pins the verified Voicebox release asset", () => {
  assert.equal(VERSION, "0.5.0");
  assert.match(ASSET_SHA256, /^[0-9a-f]{64}$/);
});

test("finds a CPU server executable and validates its PE header", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clipport-voicebox-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const binaryPath = path.join(directory, "nested", "voicebox-server.exe");
  fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
  fs.writeFileSync(binaryPath, Buffer.from("MZ-test"));
  assert.equal(findServerBinary(directory), binaryPath);
  assert.equal(sha256File(binaryPath), "66909e464c2d98cb5beffa571886604ba0c859d9deeff4655d705c45d1438d39");
});
