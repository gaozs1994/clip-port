const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { AppStore } = require("../src/main/services/store.cjs");
const { TaskManager, mergeTaskProgress, outputSize } = require("../src/main/services/task-manager.cjs");

test("preserves known progress metrics and derives speed when an update omits them", () => {
  const previous = { percent: 10, downloadedBytes: 1_000, totalBytes: 10_000, speed: 500, eta: 18 };
  const merged = mergeTaskProgress(previous, { percent: null, downloadedBytes: 3_000, totalBytes: null, speed: null, eta: null }, 2_000);
  assert.equal(merged.downloadedBytes, 3_000);
  assert.equal(merged.totalBytes, 10_000);
  assert.equal(merged.speed, 1_000);
  assert.equal(merged.percent, 30);
  assert.equal(merged.eta, 18);
});

test("calculates final size from all output files", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clipport-output-size-"));
  try {
    const first = path.join(directory, "first.mp4");
    const second = path.join(directory, "second.srt");
    fs.writeFileSync(first, Buffer.alloc(1_024));
    fs.writeFileSync(second, Buffer.alloc(256));
    assert.equal(outputSize([first, second, path.join(directory, "missing")]), 1_280);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("reserves launching tasks so rapid scheduling cannot start a task twice", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clipport-schedule-"));
  const store = new AppStore({ userDataPath: directory, downloadsPath: directory });
  store.updateSettings({ concurrency: 2 });
  const toolchain = {
    calls: 0,
    requireReady() {
      this.calls += 1;
      return new Promise(() => {});
    },
  };
  const manager = new TaskManager({
    store,
    toolchain,
    safeStorage: { isEncryptionAvailable: () => false },
  });
  const media = { id: "sample", title: "Sample", uploader: "Tester", extractor: "test" };

  manager.create({ url: "https://example.com/one", outputRoot: directory, media });
  manager.create({ url: "https://example.com/two", outputRoot: directory, media });

  assert.equal(toolchain.calls, 2);
  assert.equal(manager.launching.size, 2);
  assert.ok(path.resolve(directory).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
  fs.rmSync(directory, { recursive: true, force: true });
});

test("does not start a queued task canceled during tool discovery", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clipport-cancel-"));
  const store = new AppStore({ userDataPath: directory, downloadsPath: directory });
  let releaseTools;
  const toolchain = {
    requireReady: () => new Promise((resolve) => { releaseTools = resolve; }),
  };
  const manager = new TaskManager({
    store,
    toolchain,
    safeStorage: { isEncryptionAvailable: () => false },
  });
  const task = manager.create({
    url: "https://example.com/canceled",
    outputRoot: directory,
    media: { id: "sample", title: "Sample", uploader: "Tester", extractor: "test" },
  });

  await manager.cancel(task.id);
  releaseTools({ ytDlpPath: "missing", ffmpegPath: "missing", ffprobePath: "missing" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(store.getTask(task.id).state, "canceled");
  assert.equal(manager.running.size, 0);
  assert.equal(manager.launching.size, 0);
  assert.ok(path.resolve(directory).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
  fs.rmSync(directory, { recursive: true, force: true });
});

test("keeps queued tasks idle while the device license is inactive", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clipport-license-gate-"));
  const store = new AppStore({ userDataPath: directory, downloadsPath: directory });
  const toolchain = { calls: 0, requireReady() { this.calls += 1; return Promise.resolve({}); } };
  const manager = new TaskManager({
    store,
    toolchain,
    safeStorage: { isEncryptionAvailable: () => false },
    canStartTask: () => false,
  });
  manager.create({
    url: "https://example.com/licensed",
    outputRoot: directory,
    media: { id: "sample", title: "Sample", uploader: "Tester", extractor: "test", best: { estimatedBytes: 12_345 } },
  });

  assert.equal(store.listTasks()[0].state, "queued");
  assert.equal(store.listTasks()[0].media.estimatedBytes, 12_345);
  assert.equal(toolchain.calls, 0);
  assert.equal(manager.launching.size, 0);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("download scheduling ignores queued voice tasks in the shared store", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clipport-shared-tasks-"));
  try {
    const store = new AppStore({ userDataPath: directory, downloadsPath: directory });
    store.upsertTask({
      id: "a1111111-1111-4111-8111-111111111111",
      kind: "voice",
      state: "queued",
      stage: "等待生成",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const toolchain = { calls: 0, requireReady() { this.calls += 1; return Promise.resolve({}); } };
    const manager = new TaskManager({ store, toolchain, safeStorage: { isEncryptionAvailable: () => false } });
    await manager.schedule();
    assert.equal(toolchain.calls, 0);
    assert.equal(store.getTask("a1111111-1111-4111-8111-111111111111").state, "queued");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
