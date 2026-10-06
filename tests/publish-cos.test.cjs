const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const yaml = require("js-yaml");
const { buildReleasePlan, publishRelease } = require("../scripts/publish-cos.cjs");
const { COS_RELEASE, COS_UPDATE_URL } = require("../src/main/services/update-config.cjs");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clipport-cos-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const dist = path.join(directory, "dist");
  const output = path.join(directory, "output");
  fs.mkdirSync(dist);
  fs.mkdirSync(output);
  const version = "0.1.23";
  const name = `ClipPort.Setup.${version}.exe`;
  const binary = Buffer.from("test installer");
  const sha512 = createHash("sha512").update(binary).digest("base64");
  const manifest = { version, files: [{ url: name, sha512, size: binary.length }], path: name, sha512 };
  fs.writeFileSync(path.join(dist, name), binary);
  fs.writeFileSync(path.join(dist, `${name}.blockmap`), "blockmap data");
  fs.writeFileSync(path.join(dist, "latest.yml"), yaml.dump(manifest));
  fs.writeFileSync(path.join(output, "release-notes.json"), JSON.stringify({ schemaVersion: 1, releases: [{ version }] }));
  return { dist, output, version, name, manifest };
}

function publicDownloads(plan, calls = []) {
  return async (url, options) => {
    calls.push({ url, options });
    const file = plan.files.find((item) => new URL(item.name, COS_UPDATE_URL).href === url);
    assert.ok(file, "only access files inside the configured public release folder");
    assert.equal(options.redirect, "error");
    if (options.method === "HEAD") {
      assert.equal(options.headers, undefined, "public validation must not send upload credentials");
      return new Response(null, { headers: { "content-length": String(file.size), "x-cos-meta-sha512": file.sha512 } });
    }
    if (options.headers?.Range) {
      assert.equal(options.headers.Range, "bytes=0-0");
      return new Response(Buffer.from([0]), { status: 206, headers: { "content-range": `bytes 0-0/${file.size}` } });
    }
    assert.equal(file.name, "latest.yml");
    return new Response(plan.manifestText);
  };
}

test("validates the installer hash and includes only current release files", async (t) => {
  const options = fixture(t);
  fs.writeFileSync(path.join(options.dist, "ClipPort.Setup.0.1.22.exe"), "stale installer");
  const plan = await buildReleasePlan(options);
  assert.deepEqual(plan.files.map((file) => file.name), [options.name, `${options.name}.blockmap`, "release-notes.json", "latest.yml"]);
  assert.equal(plan.files[0].sha512, options.manifest.sha512);
});

test("rejects installer tampering and mismatched release metadata before uploading", async (t) => {
  const options = fixture(t);
  fs.appendFileSync(path.join(options.dist, options.name), "tampered");
  await assert.rejects(buildReleasePlan(options), /size or SHA-512/);
  await assert.rejects(buildReleasePlan({ ...options, version: "0.1.24" }), /manifest does not match/);
  options.manifest.files[0].url = "https://example.com/installer.exe";
  fs.writeFileSync(path.join(options.dist, "latest.yml"), yaml.dump(options.manifest));
  await assert.rejects(buildReleasePlan(options), /manifest does not match/);
});

test("requires nonempty blockmaps and release history matching the version", async (t) => {
  const options = fixture(t);
  fs.writeFileSync(path.join(options.dist, `${options.name}.blockmap`), "");
  await assert.rejects(buildReleasePlan(options), /Missing or empty/);
  fs.writeFileSync(path.join(options.output, "release-notes.json"), JSON.stringify({ schemaVersion: 1, releases: [{ version: "0.1.22" }] }));
  await assert.rejects(buildReleasePlan(options), /history does not match/);
});

test("uploads versioned files first and publishes the no-cache manifest last", async (t) => {
  const plan = await buildReleasePlan(fixture(t));
  const uploads = [];
  const requests = [];
  await publishRelease(plan, {
    cos: { uploadFile: async (parameters) => uploads.push(parameters) },
    fetchImpl: publicDownloads(plan, requests),
    log: () => {},
  });
  assert.deepEqual(uploads.map((parameters) => parameters.Key), plan.files.map((file) => `${COS_RELEASE.prefix}${file.name}`));
  for (const [index, parameters] of uploads.entries()) {
    assert.equal(parameters.Bucket, COS_RELEASE.bucket);
    assert.equal(parameters.Region, COS_RELEASE.region);
    assert.equal(parameters.Headers["x-cos-meta-sha512"], plan.files[index].sha512);
    assert.equal(parameters.ACL, undefined, "use existing directory permissions, do not widen access");
  }
  assert.match(uploads[0].CacheControl, /immutable/);
  assert.equal(uploads[2].CacheControl, "no-store");
  assert.equal(uploads[3].CacheControl, "no-store");
  assert.equal(requests.filter((request) => request.options.headers?.Range).length, 1);
  assert.equal(requests.at(-1).url, `${COS_UPDATE_URL}latest.yml`);
});

test("does not publish latest.yml if release files are not publicly readable", async (t) => {
  const plan = await buildReleasePlan(fixture(t));
  const uploads = [];
  await assert.rejects(publishRelease(plan, {
    cos: { uploadFile: async ({ Key }) => uploads.push(Key) },
    fetchImpl: async () => new Response(null, { status: 403 }),
    log: () => {},
  }), /Public download unavailable.*HTTP 403/);
  assert.equal(uploads.length, 1);
  assert.equal(uploads.some((key) => key.endsWith("latest.yml")), false);
});

test("does not publish latest.yml if the installer cannot serve byte ranges", async (t) => {
  const plan = await buildReleasePlan(fixture(t));
  const uploads = [];
  const fetchValid = publicDownloads(plan);
  await assert.rejects(publishRelease(plan, {
    cos: { uploadFile: async ({ Key }) => uploads.push(Key) },
    fetchImpl: async (url, options) => options.headers?.Range ? new Response("whole file") : fetchValid(url, options),
    log: () => {},
  }), /does not support single-byte range/);
  assert.equal(uploads.length, 1);
});

test("rejects public checksum metadata mismatches", async (t) => {
  const plan = await buildReleasePlan(fixture(t));
  await assert.rejects(publishRelease(plan, {
    cos: { uploadFile: async () => {} },
    fetchImpl: async () => new Response(null, { headers: { "content-length": String(plan.files[0].size), "x-cos-meta-sha512": "incorrect" } }),
    log: () => {},
  }), /metadata mismatch/);
});

test("does not print SDK errors containing signed requests or upload credentials", async (t) => {
  const plan = await buildReleasePlan(fixture(t));
  await assert.rejects(publishRelease(plan, {
    cos: { uploadFile: async () => { throw { code: "AccessDenied", statusCode: 403, message: "private-upload-key" }; } },
    log: () => {},
  }), (error) => error.message.includes("AccessDenied") && !error.message.includes("private-upload-key"));
});

test("detects a stale or corrupted publicly served update manifest", async (t) => {
  const plan = await buildReleasePlan(fixture(t));
  const fetchValid = publicDownloads(plan);
  await assert.rejects(publishRelease(plan, {
    cos: { uploadFile: async () => {} },
    fetchImpl: async (url, options) => !options.method && !options.headers ? new Response("stale manifest") : fetchValid(url, options),
    log: () => {},
  }), /manifest does not match/);
});

test("publishes the GitHub backup before COS and scopes upload secrets to the publishing step", () => {
  const workflow = yaml.load(fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "release.yml"), "utf8"));
  const steps = workflow.jobs.release.steps;
  const githubIndex = steps.findIndex((step) => step.name === "Publish GitHub Release");
  const cosIndex = steps.findIndex((step) => step.run === "npm run publish:cos");
  assert.ok(githubIndex >= 0 && cosIndex > githubIndex);
  assert.equal(steps[cosIndex].env.COS_SECRET_ID, "${{ secrets.COS_SECRET_ID }}");
  assert.equal(steps[cosIndex].env.COS_SECRET_KEY, "${{ secrets.COS_SECRET_KEY }}");
  assert.equal(steps.find((step) => step.name === "Build Windows installer").env.COS_SECRET_KEY, undefined);
  assert.equal(require("../package.json").dependencies["cos-nodejs-sdk-v5"], undefined);
});
