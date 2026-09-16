const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { AppStore } = require("../src/main/services/store.cjs");
const { TaskManager } = require("../src/main/services/task-manager.cjs");

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
