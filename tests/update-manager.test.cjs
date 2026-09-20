const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { UpdateManager } = require("../src/main/services/update-manager.cjs");

const flush = () => new Promise((resolve) => setImmediate(resolve));

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.checkCalls = 0;
    this.downloadCalls = 0;
    this.installCalls = 0;
  }

  async checkForUpdates() {
    this.checkCalls += 1;
  }

  async downloadUpdate() {
    this.downloadCalls += 1;
  }

  quitAndInstall() {
    this.installCalls += 1;
  }
}

function createHarness({ packaged = true, checkIntervalMs = 21_600_000 } = {}) {
  const updater = new FakeUpdater();
  const states = [];
  const timers = [];
  const clearedTimers = [];
  let beforeInstallCalls = 0;
  const manager = new UpdateManager({
    updater,
    platform: "win32",
    app: { isPackaged: packaged, getVersion: () => "0.1.6" },
    onStatus: (status) => states.push(status),
    beforeInstall: async () => { beforeInstallCalls += 1; },
    checkIntervalMs,
    setTimer: (callback, delay) => {
      const timer = { callback, delay, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => clearedTimers.push(timer),
  });
  return { manager, updater, states, timers, clearedTimers, get beforeInstallCalls() { return beforeInstallCalls; } };
}

test("does not contact the update service in development", async () => {
  const { manager, updater } = createHarness({ packaged: false });
  const status = await manager.check();
  assert.equal(status.status, "disabled");
  assert.equal(updater.checkCalls, 0);
});

test("automatically downloads a newer version without prompting", async () => {
  const harness = createHarness();
  harness.updater.checkForUpdates = async () => {
    harness.updater.checkCalls += 1;
    harness.updater.emit("update-available", { version: "0.1.7" });
  };

  const status = await harness.manager.check();
  await flush();

  assert.equal(status.status, "downloading");
  assert.equal(status.latestVersion, "0.1.7");
  assert.equal(harness.updater.downloadCalls, 1);
  assert.equal(harness.updater.autoDownload, false);
  assert.equal(harness.updater.autoInstallOnAppQuit, false);
});

test("reports automatic update download progress", async () => {
  const harness = createHarness();
  harness.updater.emit("update-available", { version: "0.1.7" });
  await flush();
  await flush();

  assert.equal(harness.updater.downloadCalls, 1);
  harness.updater.emit("download-progress", { percent: 42.4, transferred: 44_459_622, total: 104_857_600, bytesPerSecond: 2_097_152 });
  assert.equal(harness.manager.getStatus().status, "downloading");
  assert.equal(harness.manager.getStatus().progress, 42.4);
  assert.equal(harness.manager.getStatus().downloadedBytes, 44_459_622);
  assert.equal(harness.manager.getStatus().totalBytes, 104_857_600);
  assert.equal(harness.manager.getStatus().bytesPerSecond, 2_097_152);
});

test("waits for an explicit install action before restarting into the installer", async () => {
  const harness = createHarness();
  harness.updater.emit("update-downloaded", { version: "0.1.7" });
  await flush();

  assert.equal(harness.beforeInstallCalls, 0);
  assert.equal(harness.updater.installCalls, 0);
  assert.equal(harness.manager.getStatus().status, "downloaded");
  await harness.manager.install();
  assert.equal(harness.beforeInstallCalls, 1);
  assert.equal(harness.updater.installCalls, 1);
});

test("checks after startup and schedules recurring checks", async () => {
  const harness = createHarness({ checkIntervalMs: 60_000 });
  harness.updater.checkForUpdates = async () => {
    harness.updater.checkCalls += 1;
    harness.updater.emit("update-not-available");
  };

  harness.manager.start(5000);
  assert.equal(harness.timers.length, 1);
  assert.equal(harness.timers[0].delay, 5000);
  harness.timers[0].callback();
  await flush();
  await flush();
  assert.equal(harness.updater.checkCalls, 1);
  assert.equal(harness.timers[1].delay, 60_000);

  harness.timers[1].callback();
  await flush();
  await flush();
  assert.equal(harness.updater.checkCalls, 2);
  harness.manager.shutdown();
  assert.equal(harness.clearedTimers.length, 1);
});
