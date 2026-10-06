const fs = require("node:fs");
const path = require("node:path");

const CHANGE_LABELS = { added: "新增", fixed: "修复", improved: "优化" };
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function compareVersions(first, second) {
  const left = first.split(".").map(Number);
  const right = second.split(".").map(Number);
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function validateRelease(entry, upcoming = false) {
  if (!entry || typeof entry.title !== "string" || !entry.title.trim() || !Array.isArray(entry.changes) || !entry.changes.length) {
    throw new Error("Version notes require a title and changes.");
  }
  if (!upcoming && (!VERSION_PATTERN.test(entry.version) || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date))) {
    throw new Error("Version notes require a semantic version and release date.");
  }
  for (const change of entry.changes) {
    if (!Object.hasOwn(CHANGE_LABELS, change.type) || typeof change.text !== "string" || !change.text.trim()) {
      throw new Error("Each change requires an added, fixed or improved type and text.");
    }
  }
}

function buildProductInfo(source, { version, date, previousReleases = [], isRelease = false }) {
  if (source.schemaVersion !== 1 || !Array.isArray(source.features) || !Array.isArray(source.releases) || !VERSION_PATTERN.test(version)) {
    throw new Error("Invalid product information or application version.");
  }
  validateRelease(source.upcoming, true);
  const releases = new Map();
  for (const entry of [...source.releases, ...previousReleases]) {
    validateRelease(entry);
    if (!isRelease || compareVersions(entry.version, version) < 0) releases.set(entry.version, entry);
  }
  const current = { ...source.upcoming, version: isRelease ? version : "development", date: isRelease ? date : null };
  if (isRelease) validateRelease(current);
  return {
    schemaVersion: 1,
    features: source.features,
    releases: [current, ...[...releases.values()].sort((first, second) => compareVersions(second.version, first.version))],
  };
}

function releaseMarkdown(entry) {
  return `# ClipPort ${entry.version}\n\n${entry.date} · ${entry.title}\n\n${entry.changes.map((change) => `- ${CHANGE_LABELS[change.type]}：${change.text}`).join("\n")}\n`;
}

async function previousReleaseHistory(repository, { fetchImpl = globalThis.fetch, token = "" } = {}) {
  const response = await fetchImpl(`https://api.github.com/repos/${repository}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`Cannot read previous release: HTTP ${response.status}`);
  const release = await response.json();
  const asset = release.assets?.find((item) => item.name === "release-notes.json");
  if (!asset) return [];
  const url = new URL(asset.browser_download_url);
  if (url.origin !== "https://github.com" || !url.pathname.startsWith(`/${repository}/releases/download/`)) {
    throw new Error("Unexpected release history asset URL.");
  }
  const download = await fetchImpl(url.href, { signal: AbortSignal.timeout(15_000) });
  if (!download.ok) throw new Error(`Cannot download previous release history: HTTP ${download.status}`);
  const text = await download.text();
  if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error("Release history asset is too large.");
  const snapshot = JSON.parse(text);
  if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.releases)) throw new Error("Invalid release history snapshot.");
  return snapshot.releases;
}

async function main() {
  const root = path.resolve(__dirname, "..");
  const source = JSON.parse(fs.readFileSync(path.join(root, "docs", "product-info.json"), "utf8"));
  const metadata = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const isRelease = process.env.CLIPPORT_RELEASE_BUILD === "1";
  const publish = metadata.build.publish[0];
  const previousReleases = isRelease ? await previousReleaseHistory(`${publish.owner}/${publish.repo}`, { token: process.env.GITHUB_TOKEN }) : [];
  const info = buildProductInfo(source, { version: metadata.version, date: new Date().toISOString().slice(0, 10), previousReleases, isRelease });
  const json = JSON.stringify(info, null, 2);
  const rendererFile = path.join(root, "src", "renderer", "product-info.js");
  fs.writeFileSync(rendererFile, `window.clipportProductInfo = ${json};\n`, "utf8");
  if (isRelease) {
    const output = path.join(root, "output");
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, "release-notes.json"), `${json}\n`, "utf8");
    fs.writeFileSync(path.join(output, "release-notes.md"), releaseMarkdown(info.releases[0]), "utf8");
  }
  console.log(`Prepared product guide and ${info.releases.length} version entries${isRelease ? ` for ${metadata.version}` : " (development)"}.`);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { buildProductInfo, compareVersions, previousReleaseHistory, releaseMarkdown };
