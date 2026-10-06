const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { UpdateManager } = require("../src/main/services/update-manager.cjs");
const { COS_UPDATE_URL, UPDATE_SOURCES } = require("../src/main/services/update-config.cjs");

const flush = () => new Promise((resolve) => setImmediate(resolve));

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.checkCalls = 0;
    this.downloadCalls = 0;
    this.installCalls = 0;
    this.feeds = [];
  }

  setFeedURL(options) {
    this.feeds.push(options);
    this.feed = options;
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
  const sourceErrors = [];
  const timers = [];
  const clearedTimers = [];
  let beforeInstallCalls = 0;
  const manager = new UpdateManager({
    updater,
    platform: "win32",
    app: { isPackaged: packaged, getVersion: () => "0.1.6" },
    onStatus: (status) => states.push(status),
    onSourceError: (error) => sourceErrors.push(error),
    beforeInstall: async () => { beforeInstallCalls += 1; },
    checkIntervalMs,
    setTimer: (callback, delay) => {
      const timer = { callback, delay, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => clearedTimers.push(timer),
  });
  return { manager, updater, states, sourceErrors, timers, clearedTimers, get beforeInstallCalls() { return beforeInstallCalls; } };
}

test("does not contact the update service in development", async () => {
  const { manager, updater } = createHarness({ packaged: false });
  const status = await manager.check();
  assert.equal(status.status, "disabled");
  assert.equal(updater.checkCalls, 0);
  assert.equal(updater.feeds.length, 0);
});

test("uses the public COS update folder with single range requests", async () => {
  const { manager, updater } = createHarness();
  updater.checkForUpdates = async () => updater.emit("update-not-available");
  assert.equal((await manager.check()).status, "current");
  assert.deepEqual(updater.feeds, [UPDATE_SOURCES[0].options]);
  assert.equal(updater.feed.url, COS_UPDATE_URL);
  assert.equal(updater.feed.useMultipleRangeRequest, false);
  assert.equal(UPDATE_SOURCES[1].options.repo, require("../package.json").build.publish[0].repo);
});

test("falls back to GitHub on a COS check error without flashing an error state", async () => {
  const harness = createHarness();
  harness.updater.checkForUpdates = async () => {
    if (harness.updater.feed.provider === "generic") {
      const error = new Error("COS unavailable");
      harness.updater.emit("error", error);
      throw error;
    }
    harness.updater.emit("update-available", { version: "0.1.7" });
  };
  await harness.manager.check();
  await flush();
  assert.deepEqual(harness.updater.feeds, UPDATE_SOURCES.map((source) => source.options));
  assert.equal(harness.updater.downloadCalls, 1);
  assert.equal(harness.manager.getStatus().latestVersion, "0.1.7");
  assert.equal(harness.states.some((status) => status.status === "error"), false);
  assert.equal(harness.sourceErrors[0].source, "COS");
});

test("reports a final check failure and tries COS again on the next check", async () => {
  const harness = createHarness();
  harness.updater.checkForUpdates = async () => {
    const error = new Error("Unavailable");
    harness.updater.emit("error", error);
    throw error;
  };
  assert.equal((await harness.manager.check()).status, "error");
  assert.equal(harness.sourceErrors.length, 2);
  harness.updater.checkForUpdates = async () => harness.updater.emit("update-not-available");
  assert.equal((await harness.manager.check()).status, "current");
  assert.equal(harness.updater.feeds[2].provider, "generic");
});

test("rechecks GitHub and downloads the same version when COS download fails", async () => {
  const harness = createHarness();
  harness.updater.checkForUpdates = async () => {
    harness.updater.emit("checking-for-update");
    harness.updater.emit("update-available", { version: "0.1.7" });
    return { isUpdateAvailable: true, updateInfo: { version: "0.1.7" } };
  };
  harness.updater.downloadUpdate = async () => {
    harness.updater.downloadCalls += 1;
    if (harness.updater.feed.provider === "generic") {
      const error = new Error("COS download failed");
      harness.updater.emit("error", error);
      throw error;
    }
    harness.updater.emit("download-progress", { percent: 100, transferred: 100, total: 100, bytesPerSecond: 10 });
    harness.updater.emit("update-downloaded", { version: "0.1.7" });
  };
  await harness.manager.check();
  await harness.manager.downloadPromise;
  assert.equal(harness.updater.downloadCalls, 2);
  assert.equal(harness.manager.getStatus().status, "downloaded");
  assert.equal(harness.manager.getStatus().latestVersion, "0.1.7");
  assert.equal(harness.updater.installCalls, 0);
  assert.equal(harness.states.some((status) => status.status === "error"), false);
  assert.equal(harness.sourceErrors[0].phase, "download");
});

test("does not switch to a different or unavailable release during download fallback", async () => {
  for (const backupVersion of ["0.1.6", "0.1.8"]) {
    const harness = createHarness();
    harness.updater.checkForUpdates = async () => {
      const version = harness.updater.feed.provider === "generic" ? "0.1.7" : backupVersion;
      const available = version !== "0.1.6";
      harness.updater.emit(available ? "update-available" : "update-not-available", { version });
      return { isUpdateAvailable: available, updateInfo: { version } };
    };
    harness.updater.downloadUpdate = async () => {
      harness.updater.downloadCalls += 1;
      throw new Error("Download unavailable");
    };
    await harness.manager.check();
    await harness.manager.downloadPromise;
    assert.equal(harness.manager.getStatus().status, "error");
    assert.equal(harness.manager.getStatus().latestVersion, "0.1.7");
    assert.equal(harness.updater.downloadCalls, 1);
    assert.equal(harness.updater.installCalls, 0);
    assert.equal(harness.states.some((status) => status.status === "current"), false);
  }
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
