const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { AppError } = require("./validators.cjs");

const PRODUCT_ID = "clipport";
const TOKEN_PREFIX = "CPL1";

function normalizeDeviceCode(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!/^CPD1-(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/.test(normalized)) {
    throw new AppError("INVALID_DEVICE_CODE", "设备码格式不正确");
  }
  return normalized;
}

function decodeLicenseCode(value) {
  const code = String(value || "").replace(/\s+/g, "");
  if (code.length < 100 || code.length > 8192) throw new AppError("LICENSE_INVALID", "授权码格式不正确");
  const parts = code.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]+$/.test(parts[2])) {
    throw new AppError("LICENSE_INVALID", "授权码格式不正确");
  }
  const payloadBytes = Buffer.from(parts[1], "base64url");
  const signature = Buffer.from(parts[2], "base64url");
  if (payloadBytes.toString("base64url") !== parts[1] || signature.toString("base64url") !== parts[2] || signature.length !== 64) {
    throw new AppError("LICENSE_INVALID", "授权码格式不正确");
  }
  let payload;
  try {
    payload = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    throw new AppError("LICENSE_INVALID", "授权码内容无法识别");
  }
  return {
    code,
    payload,
    payloadBytes,
    signature,
  };
}

function validatePayload(payload) {
  if (!payload || payload.v !== 1 || payload.product !== PRODUCT_ID) throw new AppError("LICENSE_INVALID", "授权码不适用于 ClipPort");
  normalizeDeviceCode(payload.deviceCode);
  if (typeof payload.licenseId !== "string" || !/^[a-f0-9-]{20,64}$/i.test(payload.licenseId)) throw new AppError("LICENSE_INVALID", "授权编号无效");
  if (!Number.isFinite(Date.parse(payload.issuedAt))) throw new AppError("LICENSE_INVALID", "授权签发时间无效");
  if (payload.expiresAt !== null && payload.expiresAt !== "" && !Number.isFinite(Date.parse(payload.expiresAt))) {
    throw new AppError("LICENSE_INVALID", "授权有效期无效");
  }
  if (payload.holder !== undefined && (typeof payload.holder !== "string" || payload.holder.length > 100)) {
    throw new AppError("LICENSE_INVALID", "授权用户信息无效");
  }
  return payload;
}

function createLicenseCode(payload, privateKey) {
  validatePayload(payload);
  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
  const signature = crypto.sign(null, payloadBytes, privateKey);
  return `${TOKEN_PREFIX}.${payloadBytes.toString("base64url")}.${signature.toString("base64url")}`;
}

class LicenseManager {
  constructor({ deviceIdentity, safeStorage, userDataPath, publicKey, enforce = true, now = () => new Date(), onStatus = () => {} }) {
    this.deviceIdentity = deviceIdentity;
    this.safeStorage = safeStorage;
    this.file = path.join(userDataPath, "license.dat");
    this.publicKey = publicKey;
    this.enforce = enforce;
    this.now = now;
    this.onStatus = onStatus;
    this.deviceCode = "";
    this.licenseCode = "";
    this.state = null;
  }

  async initialize() {
    try {
      this.deviceCode = await this.deviceIdentity.getCode();
    } catch (error) {
      this.state = this.enforce
        ? this.baseState("unavailable", error?.message || "无法读取设备码")
        : this.baseState("development", "开发环境不强制设备授权");
      return this.getStatus();
    }
    this.licenseCode = this.readStoredCode();
    this.refresh();
    return this.getStatus();
  }

  readStoredCode() {
    if (!fs.existsSync(this.file) || !this.safeStorage?.isEncryptionAvailable()) return "";
    try {
      return this.safeStorage.decryptString(fs.readFileSync(this.file));
    } catch {
      return "";
    }
  }

  baseState(status, message, extra = {}) {
    return {
      status,
      active: status === "active" || status === "development",
      hasLicense: Boolean(this.licenseCode),
      deviceCode: this.deviceCode,
      licenseId: "",
      holder: "",
      issuedAt: "",
      expiresAt: "",
      message,
      ...extra,
    };
  }

  evaluate(code) {
    if (!this.deviceCode) return this.baseState("unavailable", "无法读取设备码，请重启后重试");
    if (!code) {
      return this.enforce
        ? this.baseState("unlicensed", "尚未绑定授权码")
        : this.baseState("development", "开发环境不强制设备授权");
    }

    try {
      const decoded = decodeLicenseCode(code);
      const payload = validatePayload(decoded.payload);
      if (!crypto.verify(null, decoded.payloadBytes, this.publicKey, decoded.signature)) {
        return this.baseState("invalid", "授权码签名无效，请重新获取");
      }
      if (normalizeDeviceCode(payload.deviceCode) !== this.deviceCode) {
        return this.baseState("device_mismatch", "授权码与当前设备不匹配");
      }
      const details = {
        licenseId: payload.licenseId,
        holder: payload.holder || "",
        issuedAt: payload.issuedAt,
        expiresAt: payload.expiresAt || "",
      };
      if (payload.expiresAt && this.now().getTime() > Date.parse(payload.expiresAt)) {
        return this.baseState("expired", "设备授权已过期，请重新获取授权码", details);
      }
      return this.baseState("active", payload.expiresAt ? "设备已授权" : "设备已永久授权", details);
    } catch (error) {
      return this.baseState("invalid", error?.message || "授权码无法验证");
    }
  }

  refresh() {
    this.state = this.evaluate(this.licenseCode);
    return this.state;
  }

  getStatus() {
    return { ...this.refresh() };
  }

  isActive() {
    return this.refresh().active;
  }

  requireActive() {
    const status = this.refresh();
    if (status.active) return true;
    const messages = {
      expired: "设备授权已过期，请在设置中更新授权码",
      device_mismatch: "授权码不属于当前设备，请在设置中重新绑定",
      invalid: "设备授权无效，请在设置中重新输入授权码",
      unavailable: "无法读取设备码，请重启应用后重试",
      unlicensed: "此设备尚未授权，请先在设置中绑定授权码",
    };
    throw new AppError("LICENSE_REQUIRED", messages[status.status] || "此设备尚未授权");
  }

  activate(value) {
    if (!this.deviceCode) throw new AppError("DEVICE_ID_UNAVAILABLE", "无法读取设备码，请重启应用后重试");
    const decoded = decodeLicenseCode(value);
    const candidate = this.evaluate(decoded.code);
    if (candidate.status !== "active") {
      const code = candidate.status === "device_mismatch" ? "LICENSE_DEVICE_MISMATCH" : candidate.status === "expired" ? "LICENSE_EXPIRED" : "LICENSE_INVALID";
      throw new AppError(code, candidate.message);
    }
    if (!this.safeStorage?.isEncryptionAvailable()) {
      throw new AppError("LICENSE_STORAGE_UNAVAILABLE", "Windows 安全存储当前不可用，无法保存授权码");
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, this.safeStorage.encryptString(decoded.code), { mode: 0o600 });
    this.licenseCode = decoded.code;
    this.refresh();
    this.onStatus(this.getStatus());
    return this.getStatus();
  }

  clear() {
    fs.rmSync(this.file, { force: true });
    this.licenseCode = "";
    this.refresh();
    this.onStatus(this.getStatus());
    return this.getStatus();
  }
}

module.exports = {
  LicenseManager,
  PRODUCT_ID,
  createLicenseCode,
  decodeLicenseCode,
  normalizeDeviceCode,
};
