const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createLicenseCode, normalizeDeviceCode, PRODUCT_ID } = require("../src/main/services/license-manager.cjs");

const projectRoot = path.resolve(__dirname, "..");
const defaultPrivateKey = path.join(projectRoot, ".local-license", "license-private.pem");
const defaultPublicKey = path.join(projectRoot, "src", "main", "license-public-key.pem");

function argumentsMap(values) {
  const result = { command: values[0] || "" };
  for (let index = 1; index < values.length; index += 1) {
    const key = values[index];
    if (!key.startsWith("--")) continue;
    const next = values[index + 1];
    result[key.slice(2)] = next && !next.startsWith("--") ? values[++index] : true;
  }
  return result;
}

function resolveFile(value, fallback) {
  return path.resolve(value ? String(value) : fallback);
}

function generateKeys(options = {}) {
  const privateFile = resolveFile(options.private, defaultPrivateKey);
  const publicFile = resolveFile(options.public, defaultPublicKey);
  if (fs.existsSync(privateFile) || fs.existsSync(publicFile)) {
    throw new Error("密钥文件已存在。为避免破坏已有授权，请先确认并手动移走旧密钥。");
  }
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  fs.mkdirSync(path.dirname(privateFile), { recursive: true });
  fs.mkdirSync(path.dirname(publicFile), { recursive: true });
  fs.writeFileSync(privateFile, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  fs.writeFileSync(publicFile, publicKey.export({ type: "spki", format: "pem" }), "utf8");
  return { privateFile, publicFile };
}

function expiration(value) {
  if (!value || value === "never") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("--expires 必须使用 YYYY-MM-DD 或 never");
  const result = `${value}T23:59:59.999Z`;
  if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0, 10) !== value) throw new Error("--expires 日期无效");
  return result;
}

function issueLicense(options = {}, now = new Date()) {
  const deviceCode = normalizeDeviceCode(options.device);
  const privateFile = resolveFile(options.private, defaultPrivateKey);
  if (!fs.existsSync(privateFile)) throw new Error(`未找到签发私钥：${privateFile}`);
  const holder = String(options.holder || "").trim();
  if (holder.length > 100) throw new Error("--holder 不能超过 100 个字符");
  const payload = {
    v: 1,
    product: PRODUCT_ID,
    licenseId: crypto.randomUUID(),
    deviceCode,
    holder,
    issuedAt: now.toISOString(),
    expiresAt: expiration(options.expires),
  };
  const privateKey = fs.readFileSync(privateFile, "utf8");
  return { code: createLicenseCode(payload, privateKey), payload };
}

function usage() {
  return [
    "生成签发密钥：npm run license:keygen",
    "签发永久授权：npm run license:issue -- --device CPD1-... --holder 用户名",
    "签发限时授权：npm run license:issue -- --device CPD1-... --expires 2027-12-31 --holder 用户名",
  ].join("\n");
}

function main(values = process.argv.slice(2)) {
  const options = argumentsMap(values);
  if (options.command === "generate-key") {
    const files = generateKeys(options);
    console.log(`私钥已生成：${files.privateFile}`);
    console.log(`公钥已生成：${files.publicFile}`);
    console.log("请离线备份私钥；私钥丢失后无法继续签发与旧版本兼容的授权码。");
    return;
  }
  if (options.command === "issue") {
    const result = issueLicense(options);
    console.log(result.code);
    return;
  }
  console.log(usage());
  process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { argumentsMap, expiration, generateKeys, issueLicense };
