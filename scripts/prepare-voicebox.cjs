const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const VERSION = "0.5.0";
const ASSET_NAME = `Voicebox_${VERSION}_x64_en-US.msi`;
const ASSET_URL = `https://github.com/jamiepine/voicebox/releases/download/v${VERSION}/${ASSET_NAME}`;
const ASSET_SHA256 = "6242007dcee2c7127b687873c0d97d02958d6d5b3bb304dca70439ecf595cdd0";
const MAX_INSTALLER_BYTES = 700 * 1024 * 1024;
const root = path.resolve(__dirname, "..");
const vendorRoot = path.join(root, "vendor", "voicebox");
const cacheDirectory = path.join(vendorRoot, "cache");
const outputDirectory = path.join(vendorRoot, "win32-x64");
const installerPath = path.join(cacheDirectory, ASSET_NAME);
const outputPath = path.join(outputDirectory, "voicebox-server.exe");
const metadataPath = path.join(outputDirectory, "metadata.json");

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function readMetadata() {
  try {
    return JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  } catch {
    return null;
  }
}

function validPreparedBinary(metadata = readMetadata()) {
  if (metadata?.version !== VERSION || !/^[0-9a-f]{64}$/i.test(metadata?.sha256 || "") || !fs.existsSync(outputPath)) return false;
  return sha256File(outputPath) === metadata.sha256.toLowerCase();
}

async function downloadInstaller(fetchImpl = globalThis.fetch) {
  if (fs.existsSync(installerPath) && sha256File(installerPath) === ASSET_SHA256) return installerPath;
  fs.mkdirSync(cacheDirectory, { recursive: true });
  const temporaryPath = `${installerPath}.download`;
  fs.rmSync(temporaryPath, { force: true });
  const response = await fetchImpl(ASSET_URL, {
    redirect: "follow",
    headers: { "user-agent": "ClipPort-build" },
  });
  if (!response.ok || !response.body) throw new Error(`Voicebox 下载失败：HTTP ${response.status}`);
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_INSTALLER_BYTES) throw new Error("Voicebox 安装资产超过大小限制");

  let downloaded = 0;
  let lastPercent = -1;
  const hash = crypto.createHash("sha256");
  const verifier = new Transform({
    transform(chunk, _encoding, callback) {
      downloaded += chunk.length;
      if (downloaded > MAX_INSTALLER_BYTES) {
        callback(new Error("Voicebox 安装资产超过大小限制"));
        return;
      }
      hash.update(chunk);
      if (contentLength) {
        const percent = Math.floor((downloaded / contentLength) * 100);
        if (percent >= lastPercent + 10) {
          lastPercent = percent;
          console.log(`Downloading Voicebox runtime: ${percent}%`);
        }
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(response.body), verifier, fs.createWriteStream(temporaryPath, { flags: "wx" }));
    if (hash.digest("hex") !== ASSET_SHA256) throw new Error("Voicebox 官方安装资产 SHA-256 校验失败，已拒绝打包");
    fs.rmSync(installerPath, { force: true });
    fs.renameSync(temporaryPath, installerPath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
  return installerPath;
}

function collectFiles(directory) {
  const files = [];
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else files.push(target);
    }
  }
  return files;
}

function findServerBinary(directory) {
  const candidates = collectFiles(directory)
    .filter((filePath) => /^voicebox-server(?:-cpu)?(?:-[^.]+)?\.exe$/i.test(path.basename(filePath)))
    .filter((filePath) => !/cuda/i.test(path.basename(filePath)))
    .sort((left, right) => {
      const leftExact = path.basename(left).toLowerCase() === "voicebox-server.exe" ? 1 : 0;
      const rightExact = path.basename(right).toLowerCase() === "voicebox-server.exe" ? 1 : 0;
      return rightExact - leftExact || fs.statSync(right).size - fs.statSync(left).size;
    });
  if (!candidates[0]) throw new Error("Voicebox 安装资产中未找到 CPU 服务程序");
  const header = Buffer.alloc(2);
  const descriptor = fs.openSync(candidates[0], "r");
  try { fs.readSync(descriptor, header, 0, 2, 0); } finally { fs.closeSync(descriptor); }
  if (header.toString("ascii") !== "MZ") throw new Error("Voicebox 服务程序不是有效的 Windows 可执行文件");
  return candidates[0];
}

async function prepare() {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error(`Voicebox 内置运行时仅支持 Windows x64，实际环境为 ${process.platform}-${process.arch}`);
  }
  const requestedVersion = String(process.env.CLIPPORT_VOICEBOX_VERSION || VERSION).replace(/^v/i, "");
  if (requestedVersion !== VERSION) throw new Error(`当前仅允许打包已校验的 Voicebox ${VERSION}`);
  if (validPreparedBinary()) {
    console.log(`Using cached Voicebox ${VERSION}: ${outputPath}`);
    return;
  }

  const sourcePath = await downloadInstaller();
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clipport-voicebox-extract-"));
  try {
    const result = spawnSync("msiexec.exe", ["/a", sourcePath, "/qn", `TARGETDIR=${temporaryRoot}`], {
      windowsHide: true,
      stdio: "pipe",
      encoding: "utf8",
    });
    if (result.status !== 0) throw new Error(`Voicebox MSI 解包失败（退出码 ${result.status ?? "未知"}）：${String(result.stderr || "").trim()}`);
    const serverPath = findServerBinary(temporaryRoot);
    fs.mkdirSync(outputDirectory, { recursive: true });
    const temporaryOutput = `${outputPath}.copy`;
    fs.copyFileSync(serverPath, temporaryOutput);
    fs.rmSync(outputPath, { force: true });
    fs.renameSync(temporaryOutput, outputPath);
    const metadata = { version: VERSION, sha256: sha256File(outputPath), source: ASSET_URL, installerSha256: ASSET_SHA256 };
    fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  } finally {
    if (temporaryRoot.startsWith(path.join(os.tmpdir(), "clipport-voicebox-extract-"))) fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
  console.log(`Prepared Voicebox ${VERSION}: ${outputPath}`);
}

if (require.main === module) {
  prepare().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  ASSET_NAME,
  ASSET_SHA256,
  ASSET_URL,
  VERSION,
  findServerBinary,
  sha256File,
  validPreparedBinary,
};
