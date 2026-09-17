const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { expiration, generateKeys, issueLicense } = require("../scripts/license-issuer.cjs");
const { decodeLicenseCode } = require("../src/main/services/license-manager.cjs");

const DEVICE_CODE = "CPD1-0123-4567-89AB-CDEF-0123-4567-89AB-CDEF";

test("generates an offline key pair and signs a verifiable device license", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clipport-issuer-"));
  const privateFile = path.join(directory, "private.pem");
  const publicFile = path.join(directory, "public.pem");
  try {
    generateKeys({ private: privateFile, public: publicFile });
    const result = issueLicense({ device: DEVICE_CODE, holder: "测试用户", expires: "2027-12-31", private: privateFile }, new Date("2026-09-17T00:00:00.000Z"));
    const decoded = decodeLicenseCode(result.code);
    assert.equal(decoded.payload.deviceCode, DEVICE_CODE);
    assert.equal(decoded.payload.expiresAt, "2027-12-31T23:59:59.999Z");
    assert.equal(crypto.verify(null, decoded.payloadBytes, fs.readFileSync(publicFile), decoded.signature), true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects impossible expiration dates", () => {
  assert.throws(() => expiration("2027-02-29"), /日期无效/);
});
