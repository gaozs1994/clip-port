const path = require("node:path");
const { execFileSync } = require("node:child_process");

const REGISTRY_KEY = "HKCU\\Software\\ClipPort";
const REGISTRY_VALUE = "LicenseCode";

function parseRegistryLicense(output) {
  const match = String(output || "").match(/^\s*LicenseCode\s+REG_SZ\s+(CPL1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\s*$/im);
  return match?.[1] || "";
}

class WindowsLicenseStore {
  constructor({ runCommand = execFileSync, platform = process.platform, systemRoot = process.env.SystemRoot || "C:\\Windows" } = {}) {
    this.runCommand = runCommand;
    this.enabled = platform === "win32";
    this.registryTool = path.join(systemRoot, "System32", "reg.exe");
  }

  command(args) {
    return this.runCommand(this.registryTool, args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 64 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  }

  read() {
    if (!this.enabled) return "";
    try {
      return parseRegistryLicense(this.command(["QUERY", REGISTRY_KEY, "/v", REGISTRY_VALUE]));
    } catch {
      return "";
    }
  }

  write(code) {
    if (!this.enabled) return false;
    this.command(["ADD", REGISTRY_KEY, "/v", REGISTRY_VALUE, "/t", "REG_SZ", "/d", String(code), "/f"]);
    return true;
  }

  clear() {
    if (!this.enabled) return;
    try {
      this.command(["DELETE", REGISTRY_KEY, "/v", REGISTRY_VALUE, "/f"]);
    } catch {
      // The value is already absent.
    }
  }
}

module.exports = { REGISTRY_KEY, REGISTRY_VALUE, WindowsLicenseStore, parseRegistryLicense };
