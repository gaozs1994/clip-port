const crypto = require("node:crypto");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { AppError } = require("./validators.cjs");

const execFileAsync = promisify(execFile);

function cleanIdentifier(value) {
  return String(value || "")
    .trim()
    .replace(/[{}]/g, "")
    .toLowerCase();
}

function parseMachineGuid(output) {
  const match = String(output || "").match(/MachineGuid\s+REG_\w+\s+([^\r\n]+)/i);
  const value = cleanIdentifier(match?.[1]);
  return /^[a-f0-9-]{16,64}$/.test(value) ? value : "";
}

function parseHardwareId(output) {
  const match = String(output || "").match(/ComputerHardwareId\s+REG_\w+\s+([^\r\n]+)/i);
  const value = cleanIdentifier(match?.[1]);
  const compact = value.replaceAll("-", "");
  if (!/^[a-f0-9]{32}$/.test(compact) || /^0+$/.test(compact) || /^f+$/.test(compact)) return "";
  return value;
}

function parseSmbiosUuid(output) {
  const candidates = String(output || "").match(/[a-f0-9]{8}-[a-f0-9-]{27,}/gi) || [];
  const value = cleanIdentifier(candidates[0]);
  const compact = value.replaceAll("-", "");
  if (!/^[a-f0-9]{32}$/.test(compact) || /^0+$/.test(compact) || /^f+$/.test(compact)) return "";
  return value;
}

function createDeviceCode({ machineGuid = "", hardwareId = "", smbiosUuid = "" }) {
  const parts = [];
  if (machineGuid) parts.push(`machine-guid:${cleanIdentifier(machineGuid)}`);
  const hardwareValue = hardwareId || smbiosUuid;
  if (hardwareValue) parts.push(`hardware-id:${cleanIdentifier(hardwareValue)}`);
  if (!parts.length) throw new AppError("DEVICE_ID_UNAVAILABLE", "无法读取此设备的系统标识");
  const digest = crypto.createHash("sha256").update(`clipport-device-v1\n${parts.join("\n")}`, "utf8").digest("hex").slice(0, 32).toUpperCase();
  return `CPD1-${digest.match(/.{4}/g).join("-")}`;
}

async function runSystemCommand(file, args) {
  const result = await execFileAsync(file, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 8000,
    maxBuffer: 256 * 1024,
  });
  return result.stdout;
}

class DeviceIdentity {
  constructor({ runCommand = runSystemCommand, platform = process.platform, systemRoot = process.env.SystemRoot || "C:\\Windows" } = {}) {
    this.runCommand = runCommand;
    this.platform = platform;
    this.systemRoot = systemRoot;
    this.cachedCode = "";
  }

  async getCode() {
    if (this.cachedCode) return this.cachedCode;
    if (this.platform !== "win32") {
      throw new AppError("DEVICE_ID_UNAVAILABLE", "设备授权当前仅支持 Windows");
    }

    const registryTool = path.join(this.systemRoot, "System32", "reg.exe");
    const registry = this.runCommand(registryTool, [
      "QUERY",
      "HKLM\\SOFTWARE\\Microsoft\\Cryptography",
      "/v",
      "MachineGuid",
    ]).catch(() => "");
    const hardware = this.runCommand(registryTool, [
      "QUERY",
      "HKLM\\SYSTEM\\CurrentControlSet\\Control\\SystemInformation",
      "/v",
      "ComputerHardwareId",
    ]).catch(() => "");
    const [registryOutput, hardwareOutput] = await Promise.all([registry, hardware]);
    const machineGuid = parseMachineGuid(registryOutput);
    let hardwareId = parseHardwareId(hardwareOutput);
    if (!hardwareId) {
      const smbiosOutput = await this.runCommand(path.join(this.systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "(Get-CimInstance -ClassName Win32_ComputerSystemProduct).UUID",
      ]).catch(() => "");
      hardwareId = parseSmbiosUuid(smbiosOutput);
    }
    if (!machineGuid || !hardwareId) {
      throw new AppError("DEVICE_ID_UNAVAILABLE", "无法完整读取此设备的 Windows 标识，请重启后重试");
    }
    this.cachedCode = createDeviceCode({ machineGuid, hardwareId });
    return this.cachedCode;
  }
}

module.exports = {
  DeviceIdentity,
  createDeviceCode,
  parseHardwareId,
  parseMachineGuid,
  parseSmbiosUuid,
};
