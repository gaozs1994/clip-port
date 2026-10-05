const fs = require("node:fs");
const path = require("node:path");
const archiver = require("archiver");

const TEMP_FILE_PATTERN = /(?:\.part|\.ytdl|\.tmp)$/i;

function collectPackageFiles(directory) {
  const files = [];
  if (!directory || !fs.existsSync(directory)) return files;

  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && !TEMP_FILE_PATTERN.test(entry.name)) files.push(absolute);
    }
  };
  visit(directory);
  return files.sort((a, b) => a.localeCompare(b));
}

function safeArchiveName(value, fallback = "ClipPort-media") {
  const normalized = String(value || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 120);
  return normalized || fallback;
}

function nextArchivePath(directory, stem, extension = ".zip") {
  const base = path.join(directory, `${stem}${extension}`);
  if (!fs.existsSync(base)) return base;
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = path.join(directory, `${stem} (${index})${extension}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error("无法生成唯一的 ZIP 文件名");
}

function createZipArchive({ sourceDirectory, archivePath }) {
  return new Promise((resolve, reject) => {
    const files = collectPackageFiles(sourceDirectory);
    if (!files.length) {
      const error = new Error("未找到可打包的媒体文件");
      error.code = "PACKAGE_EMPTY";
      reject(error);
      return;
    }

    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    const output = fs.createWriteStream(archivePath, { flags: "wx" });
    const archive = archiver("zip", { zlib: { level: 9 } });
    let settled = false;
    let created = false;
    output.once("open", () => { created = true; });
    const fail = (error) => {
      if (settled) return;
      settled = true;
      output.once("close", () => {
        if (created) {
          try {
            fs.unlinkSync(archivePath);
          } catch {
            // Keep the original failure when an incomplete archive cannot be removed.
          }
        }
        reject(error);
      });
      archive.abort();
      output.destroy();
    };

    output.on("close", () => {
      if (settled) return;
      settled = true;
      resolve({ archivePath, files, bytes: archive.pointer() });
    });
    output.on("error", fail);
    archive.on("error", fail);
    archive.pipe(output);
    for (const file of files) archive.file(file, { name: path.relative(sourceDirectory, file) });
    archive.finalize().catch(fail);
  });
}

module.exports = { collectPackageFiles, createZipArchive, nextArchivePath, safeArchiveName };
