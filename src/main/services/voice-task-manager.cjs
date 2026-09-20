const { AppError, assertTaskId, publicTask } = require("./validators.cjs");

const VOICE_TASK_STATES = {
  queued: { state: "queued", stage: "等待生成" },
  loading_model: { state: "preparing", stage: "正在加载语音模型" },
  generating: { state: "processing", stage: "正在生成语音" },
  completed: { state: "completed", stage: "语音生成完成" },
  failed: { state: "failed", stage: "语音生成失败" },
  not_found: { state: "failed", stage: "语音任务不存在" },
  canceled: { state: "canceled", stage: "已取消" },
};

function now() {
  return new Date().toISOString();
}

function voiceTaskState(status) {
  return VOICE_TASK_STATES[status] || { state: "processing", stage: "正在处理语音" };
}

class VoiceTaskManager {
  constructor({ store, voiceboxService, onTaskChanged }) {
    this.store = store;
    this.voiceboxService = voiceboxService;
    this.onTaskChanged = onTaskChanged;
    this.pendingStatuses = new Map();
  }

  #emit(task) {
    this.onTaskChanged?.(publicTask(task));
  }

  #save(task, patch = {}) {
    Object.assign(task, patch, { updatedAt: now() });
    const saved = this.store.upsertTask(task);
    this.#emit(task);
    return saved;
  }

  async create(payload) {
    const generation = await this.voiceboxService.startGeneration(payload);
    const mapped = voiceTaskState(generation.status);
    const createdAt = now();
    const task = {
      id: generation.id,
      kind: "voice",
      state: mapped.state,
      stage: mapped.stage,
      title: `语音生成 · ${generation.profileName || "声音档案"}`,
      progress: { percent: mapped.state === "completed" ? 100 : null },
      voice: {
        profileId: generation.profileId || payload.profileId,
        profileName: generation.profileName || "声音档案",
        engine: generation.engine || "",
        language: generation.language || payload.language || "zh",
        textLength: typeof payload.text === "string" ? payload.text.trim().length : 0,
        duration: Number.isFinite(Number(generation.duration)) ? Number(generation.duration) : null,
        audioUrl: typeof generation.audioUrl === "string" ? generation.audioUrl : "",
      },
      error: null,
      createdAt,
      updatedAt: createdAt,
      completedAt: mapped.state === "completed" ? createdAt : null,
    };
    this.store.upsertTask(task);
    this.#emit(task);
    const pending = this.pendingStatuses.get(task.id);
    if (pending) {
      this.pendingStatuses.delete(task.id);
      this.update(pending);
    }
    return { generation, task: publicTask(this.store.getTask(task.id)) };
  }

  update(status) {
    if (!status?.id) return null;
    const task = this.store.getTask(status.id);
    if (!task || task.kind !== "voice") {
      this.pendingStatuses.set(status.id, status);
      return null;
    }
    const mapped = voiceTaskState(status.status);
    const completed = mapped.state === "completed";
    const failed = mapped.state === "failed";
    return this.#save(task, {
      state: mapped.state,
      stage: status.error || mapped.stage,
      progress: { percent: completed ? 100 : null },
      voice: {
        ...task.voice,
        duration: Number.isFinite(Number(status.duration)) ? Number(status.duration) : task.voice?.duration || null,
        audioUrl: typeof status.audioUrl === "string" ? status.audioUrl : task.voice?.audioUrl || "",
      },
      error: failed ? { code: status.status === "not_found" ? "VOICE_TASK_NOT_FOUND" : "VOICE_GENERATION_FAILED", message: status.error || mapped.stage } : null,
      completedAt: completed ? now() : null,
    });
  }

  async cancel(id) {
    assertTaskId(id);
    const task = this.store.getTask(id);
    if (!task || task.kind !== "voice") throw new AppError("TASK_NOT_FOUND", "语音任务不存在");
    if (!new Set(["queued", "preparing", "processing"]).has(task.state)) throw new AppError("TASK_NOT_ACTIVE", "语音任务当前不能取消");
    const status = await this.voiceboxService.cancelGeneration(id);
    this.update(status);
    return publicTask(this.store.getTask(id));
  }

  remove(id) {
    assertTaskId(id);
    const task = this.store.getTask(id);
    if (!task || task.kind !== "voice") return false;
    if (new Set(["queued", "preparing", "processing"]).has(task.state)) throw new AppError("TASK_ACTIVE", "请先取消活动语音任务");
    this.pendingStatuses.delete(id);
    this.store.removeTask(id);
    this.onTaskChanged?.({ id, removed: true });
    return true;
  }
}

module.exports = { VoiceTaskManager, voiceTaskState };
