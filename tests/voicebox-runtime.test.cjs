const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { VoiceboxRuntimeManager, normalizeLoopbackOrigin } = require("../src/main/services/voicebox-runtime.cjs");

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "clipport-runtime-test-"));
}

test("accepts loopback origins and rejects remote Voicebox services", () => {
  assert.equal(normalizeLoopbackOrigin("http://127.0.0.1:17493/path"), "http://127.0.0.1:17493");
  assert.throws(() => normalizeLoopbackOrigin("https://example.com"), /loopback/);
});

test("reports a missing bundled runtime without spawning a process", async (t) => {
  const directory = temporaryDirectory();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let spawned = false;
  const runtime = new VoiceboxRuntimeManager({
    userDataPath: directory,
    isPackaged: true,
    binaryPath: path.join(directory, "missing.exe"),
    spawnImpl: () => { spawned = true; },
  });
  const status = await runtime.start();
  assert.equal(status.state, "missing");
  assert.equal(spawned, false);
});

test("degrades to a failed status when the Voicebox data directory is not writable", async (t) => {
  const directory = temporaryDirectory();
  const userDataFile = path.join(directory, "not-a-directory");
  const binaryPath = path.join(directory, "voicebox-server.exe");
  fs.writeFileSync(userDataFile, "file");
  fs.writeFileSync(binaryPath, "test executable placeholder");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const runtime = new VoiceboxRuntimeManager({ userDataPath: userDataFile, isPackaged: true, binaryPath });
  const status = await runtime.start();
  assert.equal(status.state, "failed");
  assert.match(status.message, /数据目录/);
});

test("starts the bundled runtime with private data and model directories", async (t) => {
  const directory = temporaryDirectory();
  const binaryPath = path.join(directory, "voicebox-server.exe");
  fs.writeFileSync(binaryPath, "test executable placeholder");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const child = new EventEmitter();
  child.exitCode = null;
  child.killed = false;
  child.unref = () => {};
  child.kill = () => { child.killed = true; };
  let spawnArguments = null;
  const requests = [];
  const runtime = new VoiceboxRuntimeManager({
    userDataPath: directory,
    isPackaged: true,
    binaryPath,
    findPort: async () => 17521,
    spawnImpl: (...args) => { spawnArguments = args; return child; },
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      if (url.endsWith("/shutdown")) {
        queueMicrotask(() => { child.exitCode = 0; child.emit("exit", 0, null); });
        return new Response("", { status: 200 });
      }
      return url.endsWith("/health")
        ? new Response(JSON.stringify({ status: "healthy" }), { status: 200 })
        : new Response("", { status: 200 });
    },
    pollIntervalMs: 1,
  });
  const starting = await runtime.start();
  assert.equal(starting.state, "starting");
  await runtime.readyPromise;
  assert.equal(runtime.getStatus().state, "ready");
  assert.equal(runtime.getStatus().origin, "http://127.0.0.1:17521");
  assert.equal(spawnArguments[0], binaryPath);
  assert.deepEqual(spawnArguments[1].slice(0, 4), ["--host", "127.0.0.1", "--port", "17521"]);
  assert.match(spawnArguments[2].env.VOICEBOX_MODELS_DIR, /voicebox[\\/]models$/);
  await runtime.shutdown();
  assert.equal(child.killed, false);
  assert.equal(requests.some((request) => request.url.endsWith("/shutdown")), true);
});
