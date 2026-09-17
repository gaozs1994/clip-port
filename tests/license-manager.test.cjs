const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { LicenseManager, createLicenseCode } = require("../src/main/services/license-manager.cjs");

const DEVICE_CODE = "CPD1-0123-4567-89AB-CDEF-0123-4567-89AB-CDEF";
const OTHER_DEVICE = "CPD1-FFFF-FFFF-FFFF-FFFF-FFFF-FFFF-FFFF-FFFF";

function harness({ deviceCode = DEVICE_CODE, now = new Date("2026-09-17T00:00:00.000Z"), enforce = true } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clipport-license-"));
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`protected:${value}`, "utf8"),
    decryptString: (value) => value.toString("utf8").replace(/^protected:/, ""),
  };
  const create = () => new LicenseManager({
    deviceIdentity: { getCode: async () => deviceCode },
    safeStorage,
    userDataPath: directory,
    publicKey,
    enforce,
    now: () => now,
  });
  const issue = ({ target = deviceCode, expiresAt = null } = {}) => createLicenseCode({
    v: 1,
    product: "clipport",
    licenseId: crypto.randomUUID(),
    deviceCode: target,
    holder: "测试用户",
    issuedAt: "2026-09-16T00:00:00.000Z",
    expiresAt,
  }, privateKey);
  return { directory, create, issue };
}

test("activates a signed license for this device and restores it after restart", async () => {
  const context = harness();
  try {
    const first = context.create();
    await first.initialize();
    assert.equal(first.getStatus().status, "unlicensed");
    const activated = first.activate(context.issue());
    assert.equal(activated.status, "active");
    assert.equal(activated.hasLicense, true);
    assert.equal(activated.holder, "测试用户");
    assert.doesNotMatch(fs.readFileSync(path.join(context.directory, "license.dat"), "utf8"), /^CPL1\./);

    const restarted = context.create();
    await restarted.initialize();
    assert.equal(restarted.getStatus().status, "active");
    assert.equal(restarted.requireActive(), true);
  } finally {
    fs.rmSync(context.directory, { recursive: true, force: true });
  }
});

test("rejects licenses signed for another device", async () => {
  const context = harness();
  try {
    const manager = context.create();
    await manager.initialize();
    assert.throws(() => manager.activate(context.issue({ target: OTHER_DEVICE })), { code: "LICENSE_DEVICE_MISMATCH" });
  } finally {
    fs.rmSync(context.directory, { recursive: true, force: true });
  }
});

test("rejects tampered and expired licenses", async () => {
  const context = harness();
  try {
    const manager = context.create();
    await manager.initialize();
    const valid = context.issue();
    const replacement = valid.endsWith("A") ? "B" : "A";
    assert.throws(() => manager.activate(`${valid.slice(0, -1)}${replacement}`), { code: "LICENSE_INVALID" });
    const signatureParts = valid.split(".");
    const signature = Buffer.from(signatureParts[2], "base64url");
    signature[0] ^= 1;
    assert.throws(() => manager.activate(`${signatureParts[0]}.${signatureParts[1]}.${signature.toString("base64url")}`), { code: "LICENSE_INVALID" });
    assert.throws(() => manager.activate(context.issue({ expiresAt: "2026-09-16T23:59:59.999Z" })), { code: "LICENSE_EXPIRED" });
  } finally {
    fs.rmSync(context.directory, { recursive: true, force: true });
  }
});

test("refreshes an active license into expired state when status is requested", async () => {
  const now = new Date("2026-09-17T00:00:00.000Z");
  const context = harness({ now });
  try {
    const manager = context.create();
    await manager.initialize();
    manager.activate(context.issue({ expiresAt: "2026-09-18T00:00:00.000Z" }));
    assert.equal(manager.getStatus().status, "active");
    now.setTime(Date.parse("2026-09-18T00:00:00.001Z"));
    assert.equal(manager.getStatus().status, "expired");
  } finally {
    fs.rmSync(context.directory, { recursive: true, force: true });
  }
});

test("development mode remains active without storing a license", async () => {
  const context = harness({ enforce: false });
  try {
    const manager = context.create();
    await manager.initialize();
    assert.equal(manager.getStatus().status, "development");
    assert.equal(manager.requireActive(), true);
  } finally {
    fs.rmSync(context.directory, { recursive: true, force: true });
  }
});
