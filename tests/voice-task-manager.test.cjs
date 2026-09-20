const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { AppStore } = require("../src/main/services/store.cjs");
const { VoiceTaskManager, voiceTaskState } = require("../src/main/services/voice-task-manager.cjs");

const generationId = "a1111111-1111-4111-8111-111111111111";

test("maps Voicebox statuses into shared task states", () => {
  assert.deepEqual(voiceTaskState("queued"), { state: "queued", stage: "等待生成" });
  assert.deepEqual(voiceTaskState("loading_model"), { state: "preparing", stage: "正在加载语音模型" });
  assert.deepEqual(voiceTaskState("generating"), { state: "processing", stage: "正在生成语音" });
  assert.deepEqual(voiceTaskState("completed"), { state: "completed", stage: "语音生成完成" });
  assert.deepEqual(voiceTaskState("failed"), { state: "failed", stage: "语音生成失败" });
});

test("persists voice generations as generic tasks without storing the script", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clipport-voice-task-"));
  try {
    const store = new AppStore({ userDataPath: directory, downloadsPath: directory });
    const events = [];
    let manager;
    const voiceboxService = {
      async startGeneration() {
        manager.update({ id: generationId, status: "loading_model", duration: null, error: "" });
        return { id: generationId, status: "queued", profileId: "profile-1", profileName: "叙事女声", engine: "kokoro", language: "zh", duration: null, error: "" };
      },
      async cancelGeneration(id) {
        return { id, status: "canceled", duration: null, error: "已取消生成" };
      },
    };
    manager = new VoiceTaskManager({ store, voiceboxService, onTaskChanged: (task) => events.push(task) });
    await manager.create({ profileId: "profile-1", text: "这是一段不应写入任务存储的测试文案", language: "zh" });

    let task = store.getTask(generationId);
    assert.equal(task.kind, "voice");
    assert.equal(task.state, "preparing");
    assert.equal(task.title, "语音生成 · 叙事女声");
    assert.equal(task.voice.textLength, 17);
    assert.equal(JSON.stringify(task).includes("不应写入任务存储"), false);

    manager.update({ id: generationId, status: "completed", duration: 8.4, audioUrl: `clipport://app/voicebox-audio/${generationId}`, error: "" });
    task = store.getTask(generationId);
    assert.equal(task.state, "completed");
    assert.equal(task.progress.percent, 100);
    assert.equal(task.voice.duration, 8.4);
    assert.match(task.voice.audioUrl, /voicebox-audio/);
    assert.ok(task.completedAt);
    assert.ok(events.length >= 3);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("cancels and removes voice tasks through the shared task lifecycle", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clipport-voice-cancel-"));
  try {
    const store = new AppStore({ userDataPath: directory, downloadsPath: directory });
    const voiceboxService = {
      startGeneration: async () => ({ id: generationId, status: "generating", profileId: "profile-1", profileName: "旁白", engine: "kokoro", language: "zh", duration: null, error: "" }),
      cancelGeneration: async (id) => ({ id, status: "canceled", duration: null, error: "已取消生成" }),
    };
    const manager = new VoiceTaskManager({ store, voiceboxService });
    await manager.create({ profileId: "profile-1", text: "取消任务", language: "zh" });
    const canceled = await manager.cancel(generationId);
    assert.equal(canceled.state, "canceled");
    assert.equal(manager.remove(generationId), true);
    assert.equal(store.getTask(generationId), null);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
