const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outputDirectory = path.join(root, "vendor", "yt-dlp", "win32-x64");
const outputPath = path.join(outputDirectory, "yt-dlp.exe");
const metadataPath = path.join(outputDirectory, "metadata.json");
const assetName = "yt-dlp.exe";
const maxBinaryBytes = 80 * 1024 * 1024;
const maxChecksumBytes = 4 * 1024 * 1024;

function releaseApiUrl(version = "") {
  const normalized = String(version).trim().replace(/^v/i, "");
  return normalized
    ? `https://api.github.com/repos/yt-dlp/yt-dlp/releases/tags/${encodeURIComponent(normalized)}`
    : "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
}

function requestHeaders() {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "ClipPort-build",
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

async function fetchBuffer(url, maxBytes, headers = {}) {
  const response = await fetch(url, { redirect: "follow", headers });
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status} (${url})`);
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maxBytes) throw new Error(`下载内容超过 ${maxBytes} 字节限制`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) throw new Error(`下载内容超过 ${maxBytes} 字节限制`);
  return buffer;
}

function checksumFor(contents, filename) {
  return contents
    .toString("utf8")
    .split(/\r?\n/)
    .map((line) => line.match(/^([0-9a-f]{128})\s+\*?(.+)$/i))
    .find((match) => match?.[2] === filename)?.[1]?.toLowerCase() || "";
}

function sha512(buffer) {
  return crypto.createHash("sha512").update(buffer).digest("hex");
}

function readCachedMetadata() {
  try {
    return JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  } catch {
    return null;
  }
}

function validCachedBinary(metadata) {
  if (!metadata || !fs.existsSync(outputPath) || !/^[0-9a-f]{128}$/i.test(metadata.sha512 || "")) return false;
  return sha512(fs.readFileSync(outputPath)) === metadata.sha512.toLowerCase();
}

async function main() {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error(`当前打包配置仅支持 Windows x64，实际环境为 ${process.platform}-${process.arch}`);
  }

  const requestedVersion = process.env.CLIPPORT_YTDLP_VERSION || "";
  const cached = readCachedMetadata();
  if (requestedVersion && cached?.version === requestedVersion.replace(/^v/i, "") && validCachedBinary(cached)) {
    console.log(`Using cached yt-dlp ${cached.version}: ${outputPath}`);
    return;
  }

  let release;
  try {
    const response = await fetch(releaseApiUrl(requestedVersion), { headers: requestHeaders() });
    if (!response.ok) throw new Error(`GitHub API 返回 HTTP ${response.status}`);
    release = await response.json();
  } catch (error) {
    if (!requestedVersion && validCachedBinary(cached)) {
      console.warn(`Unable to check the latest yt-dlp release; using verified cache ${cached.version}: ${error.message}`);
      return;
    }
    throw error;
  }

  const binaryAsset = release.assets?.find((asset) => asset.name === assetName);
  const checksumAsset = release.assets?.find((asset) => asset.name === "SHA2-512SUMS");
  if (!binaryAsset || !checksumAsset) throw new Error("yt-dlp 官方发布缺少 Windows x64 文件或 SHA2-512SUMS");

  const version = String(release.tag_name || "").replace(/^v/i, "");
  if (cached?.version === version && validCachedBinary(cached)) {
    console.log(`Using cached yt-dlp ${version}: ${outputPath}`);
    return;
  }

  console.log(`Downloading yt-dlp ${version || "stable"}...`);
  const [binary, checksums] = await Promise.all([
    fetchBuffer(binaryAsset.browser_download_url, maxBinaryBytes),
    fetchBuffer(checksumAsset.browser_download_url, maxChecksumBytes),
  ]);
  const expected = checksumFor(checksums, assetName);
  const actual = sha512(binary);
  if (!expected || actual !== expected) throw new Error("yt-dlp SHA-512 校验失败，已拒绝打包");

  fs.mkdirSync(outputDirectory, { recursive: true });
  const temporaryPath = `${outputPath}.download`;
  fs.writeFileSync(temporaryPath, binary);
  fs.rmSync(outputPath, { force: true });
  fs.renameSync(temporaryPath, outputPath);
  fs.writeFileSync(metadataPath, `${JSON.stringify({ version, sha512: actual, source: binaryAsset.browser_download_url }, null, 2)}\n`);
  console.log(`Prepared yt-dlp ${version}: ${outputPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { checksumFor, releaseApiUrl, sha512, validCachedBinary };
