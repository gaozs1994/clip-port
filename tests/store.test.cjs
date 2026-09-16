const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { AppStore } = require("../src/main/services/store.cjs");

test("persists settings and marks active tasks interrupted after restart", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clipport-store-"));
  try {
    const first = new AppStore({ userDataPath: directory, downloadsPath: directory });
    first.updateSettings({ concurrency: 3 });
    first.updateAuthMetadata("douyin", { lastVerifiedAt: "2026-09-16T08:00:00.000Z" });
    first.upsertTask({
      id: "12345678-1234-1234-1234-123456789012",
      state: "downloading",
      stage: "正在下载",
      updatedAt: new Date().toISOString(),
      sourceUrlEncrypted: "secret",
    });

    const second = new AppStore({ userDataPath: directory, downloadsPath: directory });
    assert.equal(second.getSettings().concurrency, 3);
    assert.equal(second.getAuthMetadata("douyin").lastVerifiedAt, "2026-09-16T08:00:00.000Z");
    assert.equal(second.getTask("12345678-1234-1234-1234-123456789012").state, "interrupted");
    assert.equal(Object.hasOwn(second.listTasks()[0], "sourceUrlEncrypted"), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
