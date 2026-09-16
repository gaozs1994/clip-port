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

function createHarness({ packaged = true, dialogResponses = [] } = {}) {
  const updater = new FakeUpdater();
  const prompts = [];
  const states = [];
  let beforeInstallCalls = 0;
  const manager = new UpdateManager({
    updater,
    platform: "win32",
    app: { isPackaged: packaged, getVersion: () => "0.1.6" },
    dialog: {
      async showMessageBox(...args) {
        prompts.push(args.at(-1));
        return { response: dialogResponses.shift() ?? 0 };
      },
    },
    onStatus: (status) => states.push(status),
    beforeInstall: async () => { beforeInstallCalls += 1; },
  });
  return { manager, updater, prompts, states, get beforeInstallCalls() { return beforeInstallCalls; } };
}

test("does not contact the update service in development", async () => {
  const { manager, updater } = createHarness({ packaged: false });
  const status = await manager.check();
  assert.equal(status.status, "disabled");
  assert.equal(updater.checkCalls, 0);
});

test("prompts when a newer version is available and lets the user defer", async () => {
  const harness = createHarness({ dialogResponses: [0] });
  harness.updater.checkForUpdates = async () => {
    harness.updater.checkCalls += 1;
    harness.updater.emit("update-available", { version: "0.1.7" });
  };

  const status = await harness.manager.check();
  await flush();

  assert.equal(status.status, "available");
  assert.equal(status.latestVersion, "0.1.7");
  assert.equal(harness.prompts[0].buttons[1], "下载更新");
  assert.equal(harness.updater.downloadCalls, 0);
});

test("downloads an accepted update and reports progress", async () => {
  const harness = createHarness({ dialogResponses: [1] });
  harness.updater.emit("update-available", { version: "0.1.7" });
  await flush();
  await flush();

  assert.equal(harness.updater.downloadCalls, 1);
  harness.updater.emit("download-progress", { percent: 42.4 });
  assert.equal(harness.manager.getStatus().status, "downloading");
  assert.equal(harness.manager.getStatus().progress, 42.4);
});

test("finishes active work before restarting into the installer", async () => {
  const harness = createHarness({ dialogResponses: [1] });
  harness.updater.emit("update-downloaded", { version: "0.1.7" });
  await flush();
  await flush();

  assert.equal(harness.beforeInstallCalls, 1);
  assert.equal(harness.updater.installCalls, 1);
  assert.equal(harness.prompts[0].buttons[1], "重启并安装");
});
