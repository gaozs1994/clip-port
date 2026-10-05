const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { collectPackageFiles, createZipArchive, nextArchivePath, safeArchiveName } = require("../src/main/services/archive.cjs");

test("collects package files while ignoring interrupted download fragments", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clipport-package-files-"));
  try {
    fs.writeFileSync(path.join(directory, "video.mp4"), "video");
    fs.writeFileSync(path.join(directory, "cover.jpg"), "cover");
    fs.writeFileSync(path.join(directory, "partial.mp4.part"), "partial");
    assert.deepEqual(collectPackageFiles(directory).map((value) => path.basename(value)), ["cover.jpg", "video.mp4"]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("creates a zip archive containing video, audio, cover and subtitles", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clipport-package-"));
  const archivePath = path.join(directory, "media.zip");
  const sourceDirectory = path.join(directory, ".staging");
  try {
    fs.mkdirSync(sourceDirectory);
    for (const [name, value] of [["video.mp4", "video"], ["audio.m4a", "audio"], ["cover.jpg", "cover"], ["en.srt", "subtitle"]]) {
      fs.writeFileSync(path.join(sourceDirectory, name), value);
    }
    const result = await createZipArchive({ sourceDirectory, archivePath });
    assert.equal(result.archivePath, archivePath);
    assert.ok(result.bytes > 0);
    const listing = require("node:child_process").execFileSync("tar", ["-tf", archivePath], { encoding: "utf8" });
    assert.deepEqual(listing.trim().split(/\r?\n/).sort(), ["audio.m4a", "cover.jpg", "en.srt", "video.mp4"]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("sanitizes archive names for Windows paths", () => {
  assert.equal(safeArchiveName('A:/B?C*D<>:\"|'), "A--B-C-D-----");
  assert.equal(safeArchiveName("..."), "ClipPort-media");
});

test("chooses a new archive path without overwriting an existing package", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clipport-archive-name-"));
  try {
    fs.writeFileSync(path.join(directory, "clip.zip"), "existing");
    assert.equal(path.basename(nextArchivePath(directory, "clip")), "clip (2).zip");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("refuses to overwrite an existing archive when its path is already taken", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clipport-archive-collision-"));
  const sourceDirectory = path.join(directory, "source");
  const archivePath = path.join(directory, "existing.zip");
  try {
    fs.mkdirSync(sourceDirectory);
    fs.writeFileSync(path.join(sourceDirectory, "video.mp4"), "video");
    fs.writeFileSync(archivePath, "original package");
    await assert.rejects(createZipArchive({ sourceDirectory, archivePath }), { code: "EEXIST" });
    assert.equal(fs.readFileSync(archivePath, "utf8"), "original package");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
