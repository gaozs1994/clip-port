const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { COS_RELEASE, COS_UPDATE_URL } = require("../src/main/services/update-config.cjs");

async function hashFile(file) {
  const hash = createHash("sha512");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("base64");
}

async function buildReleasePlan({ dist, output, version }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid release version.");
  const manifestText = fs.readFileSync(path.join(dist, "latest.yml"), "utf8");
  const manifest = yaml.load(manifestText, { schema: yaml.JSON_SCHEMA });
  const installerName = `ClipPort.Setup.${version}.exe`;
  const entry = manifest?.files?.[0];
  if (manifest?.version !== version || manifest.files?.length !== 1 || entry?.url !== installerName || manifest.path !== installerName) {
    throw new Error("Update manifest does not match the current Windows release.");
  }
  const history = JSON.parse(fs.readFileSync(path.join(output, "release-notes.json"), "utf8"));
  if (history.schemaVersion !== 1 || history.releases?.[0]?.version !== version) {
    throw new Error("Release history does not match the current version.");
  }
  const files = [];
  for (const [directory, name] of [
    [dist, installerName],
    [dist, `${installerName}.blockmap`],
    [output, "release-notes.json"],
    [dist, "latest.yml"],
  ]) {
    const filePath = path.join(directory, name);
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || !stat.size) throw new Error(`Missing or empty release file: ${name}`);
    files.push({ name, path: filePath, size: stat.size, sha512: await hashFile(filePath) });
  }
  if (entry.size !== files[0].size || entry.sha512 !== files[0].sha512 || manifest.sha512 !== files[0].sha512) {
    throw new Error("Installer size or SHA-512 does not match latest.yml.");
  }
  return { files, manifestText };
}

async function verifyPublicFile(file, fetchImpl) {
  const url = new URL(file.name, COS_UPDATE_URL).href;
  const response = await fetchImpl(url, { method: "HEAD", redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Public download unavailable for ${file.name}: HTTP ${response.status}`);
  if (Number(response.headers.get("content-length")) !== file.size || response.headers.get("x-cos-meta-sha512") !== file.sha512) {
    throw new Error(`Public file size or checksum metadata mismatch: ${file.name}`);
  }
  if (file.name.endsWith(".exe")) {
    const range = await fetchImpl(url, {
      headers: { Range: "bytes=0-0" }, redirect: "error", signal: AbortSignal.timeout(30_000),
    });
    if (range.status !== 206 || range.headers.get("content-range") !== `bytes 0-0/${file.size}`) {
      await range.body?.cancel();
      throw new Error("COS installer download does not support single-byte range requests.");
    }
    if ((await range.arrayBuffer()).byteLength !== 1) throw new Error("Invalid range response from COS.");
  }
}

async function publishRelease(plan, { cos, fetchImpl = globalThis.fetch, log = console.log }) {
  // Publish the manifest last so clients can only discover complete, publicly readable releases.
  for (const file of plan.files) {
    log(`Uploading ${file.name} (${file.size} bytes) to COS`);
    try {
      await cos.uploadFile({
        Bucket: COS_RELEASE.bucket,
        Region: COS_RELEASE.region,
        Key: `${COS_RELEASE.prefix}${file.name}`,
        FilePath: file.path,
        SliceSize: 8 * 1024 * 1024,
        CacheControl: file.name.endsWith(".exe") || file.name.endsWith(".blockmap")
          ? "public, max-age=31536000, immutable" : "no-store",
        ContentType: file.name.endsWith(".yml") ? "text/yaml; charset=utf-8"
          : file.name.endsWith(".json") ? "application/json; charset=utf-8" : "application/octet-stream",
        Headers: { "x-cos-meta-sha512": file.sha512 },
      });
    } catch (error) {
      // SDK errors can carry signed requests; log only the service code and HTTP status.
      throw new Error(`Cannot upload ${file.name}: ${error.code || "COS_UPLOAD_FAILED"} (HTTP ${error.statusCode || "unknown"})`);
    }
    await verifyPublicFile(file, fetchImpl);
    if (file.name === "latest.yml") {
      const response = await fetchImpl(new URL(file.name, COS_UPDATE_URL).href, { redirect: "error", signal: AbortSignal.timeout(30_000) });
      if (!response.ok || await response.text() !== plan.manifestText) {
        throw new Error("Public update manifest does not match the published release.");
      }
    }
  }
  log(`COS update source ready: ${COS_UPDATE_URL}latest.yml`);
}

async function main() {
  const SecretId = process.env.COS_SECRET_ID;
  const SecretKey = process.env.COS_SECRET_KEY;
  if (!SecretId?.trim() || !SecretKey?.trim()) {
    throw new Error("Configure COS_SECRET_ID and COS_SECRET_KEY in GitHub Actions secrets.");
  }
  const root = path.resolve(__dirname, "..");
  const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const plan = await buildReleasePlan({ dist: path.join(root, "dist"), output: path.join(root, "output"), version });
  const COS = require("cos-nodejs-sdk-v5");
  const cos = new COS({ SecretId, SecretKey, Protocol: "https:", Timeout: 120_000, UploadCheckContentMd5: true });
  await publishRelease(plan, { cos });
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { buildReleasePlan, hashFile, publishRelease };
