const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnWithLines, terminateProcessTree } = require("./process-utils.cjs");
const {
  ACTIVE_TASK_STATES,
  AppError,
  extractHttpUrl,
  assertOutputDirectory,
  assertTaskId,
  canPersistCanonicalUrl,
  fingerprintUrl,
  publicTask,
  redactUrl,
  sanitizeTaskOptions,
} = require("./validators.cjs");
const { buildDownloadArgs, classifyError, parseProgressLine } = require("./yt-dlp.cjs");

function now() {
  return new Date().toISOString();
}

function tail(value, limit = 12_000) {
  return value.length <= limit ? value : value.slice(-limit);
}

class TaskManager {
  constructor({ store, toolchain, safeStorage, cookieManager, onTaskChanged, onHistoryChanged }) {
    this.store = store;
    this.toolchain = toolchain;
    this.safeStorage = safeStorage;
    this.cookieManager = cookieManager;
    this.onTaskChanged = onTaskChanged;
    this.onHistoryChanged = onHistoryChanged;
    this.running = new Map();
    this.launching = new Set();
    this.urls = new Map();
    this.scheduling = false;
    this.stopping = false;
  }

  list() {
    return this.store.listTasks();
  }

  history() {
    return this.store.listHistory();
  }

  #encrypt(value) {
    if (!this.safeStorage?.isEncryptionAvailable()) return "";
    return this.safeStorage.encryptString(value).toString("base64");
  }

  #decrypt(task) {
    if (this.urls.has(task.id)) return this.urls.get(task.id);
    if (!task.sourceUrlEncrypted || !this.safeStorage?.isEncryptionAvailable()) return "";
    try {
      return this.safeStorage.decryptString(Buffer.from(task.sourceUrlEncrypted, "base64"));
    } catch {
      return "";
    }
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

  create(payload = {}) {
    const sourceUrl = extractHttpUrl(payload.url);
    const outputRoot = assertOutputDirectory(payload.outputRoot || this.store.getSettings().downloadDirectory);
    fs.mkdirSync(outputRoot, { recursive: true });
    fs.accessSync(outputRoot, fs.constants.W_OK);
    const options = sanitizeTaskOptions(payload.options);
    const media = payload.media || {};
    if (typeof media.id !== "string" || typeof media.title !== "string") {
      throw new AppError("INVALID_MEDIA", "请先解析媒体链接");
    }

    const task = {
      id: crypto.randomUUID(),
      state: "queued",
      stage: "等待下载",
      progress: { percent: 0, downloadedBytes: 0, totalBytes: null, speed: null, eta: null },
      media: {
        id: media.id,
        title: media.title.slice(0, 500),
        uploader: String(media.uploader || "未知来源").slice(0, 200),
        extractor: String(media.extractor || "unknown").slice(0, 100),
        duration: Number.isFinite(media.duration) ? media.duration : null,
      },
      redactedUrl: redactUrl(sourceUrl),
      urlFingerprint: fingerprintUrl(sourceUrl),
      sourceUrlEncrypted: this.#encrypt(sourceUrl),
      options,
      outputRoot,
      finalOutputs: [],
      error: null,
      attempt: 0,
      createdAt: now(),
      updatedAt: now(),
      completedAt: null,
    };
    this.urls.set(task.id, sourceUrl);
    this.store.upsertTask(task);
    this.#emit(task);
    this.schedule();
    return publicTask(task);
  }

  async schedule() {
    if (this.scheduling || this.stopping) return;
    this.scheduling = true;
    try {
      const limit = this.store.getSettings().concurrency;
      const available = Math.max(0, limit - this.running.size - this.launching.size);
      const queued = this.store.state.tasks
        .filter((task) => task.state === "queued" && !this.launching.has(task.id))
        .slice(0, available);
      for (const task of queued) {
        this.launching.add(task.id);
        this.#run(task).catch(() => {}).finally(() => {
          this.launching.delete(task.id);
          this.schedule();
        });
      }
    } finally {
      this.scheduling = false;
    }
  }

  async #run(task) {
    if (this.running.has(task.id) || this.stopping) return;
    const sourceUrl = this.#decrypt(task);
    if (!sourceUrl) {
      this.#save(task, {
        state: "failed",
        stage: "需要重新粘贴链接",
        error: { code: "URL_UNAVAILABLE", message: "安全存储不可用，无法恢复该任务链接" },
      });
      return;
    }

    try {
      fs.mkdirSync(task.outputRoot, { recursive: true });
      fs.accessSync(task.outputRoot, fs.constants.W_OK);
    } catch (error) {
      this.#save(task, { state: "failed", stage: "保存目录不可写", error: { code: "OUTPUT_NOT_WRITABLE", message: error.message } });
      return;
    }

    let tools;
    try {
      tools = await this.toolchain.requireReady();
    } catch (error) {
      this.#save(task, { state: "failed", stage: "工具链不可用", error: { code: error.code || "TOOL_ERROR", message: error.message } });
      return;
    }
    if (this.stopping || task.state !== "queued") return;

    let authContext = null;
    try {
      authContext = await this.cookieManager?.createAuthContext(sourceUrl);
    } catch (error) {
      this.#save(task, {
        state: "failed",
        stage: "无法准备登录状态",
        error: { code: error.code || "AUTH_ERROR", message: error.message },
      });
      return;
    }

    task.attempt += 1;
    task.error = null;
    task.progress = { percent: 0, downloadedBytes: 0, totalBytes: null, speed: null, eta: null };
    this.#save(task, { state: "preparing", stage: "正在准备下载" });
    const runtimeTask = { ...task, sourceUrl };
    const context = { reason: "", outputPaths: [], log: "", lastProgressAt: 0, tools, child: null, completion: null };
    const consume = (line) => {
      const event = parseProgressLine(line);
      if (!event) {
        context.log = tail(`${context.log}${line}\n`);
        return;
      }
      if (event.type === "output" && typeof event.value === "string") {
        context.outputPaths.push(event.value);
      } else if (event.type === "postprocess") {
        this.#save(task, { state: "processing", stage: "正在处理媒体" });
      } else if (event.type === "progress") {
        const time = Date.now();
        if (time - context.lastProgressAt < 250 && event.value.percent !== 100) return;
        context.lastProgressAt = time;
        this.#save(task, { state: "downloading", stage: "正在下载", progress: event.value });
      }
    };
    const processHandle = spawnWithLines(tools.ytDlpPath, buildDownloadArgs(runtimeTask, { ...tools, ...(authContext || {}) }), {
      cwd: task.outputRoot,
      onStdoutLine: consume,
      onStderrLine: consume,
    });
    Object.assign(context, processHandle);
    this.running.set(task.id, context);
    this.launching.delete(task.id);

    try {
      const result = await processHandle.completion;
      context.log = tail(`${context.log}${result.stderr}`);
      if (context.reason === "shutdown") {
        // shutdown() already persisted the interrupted state.
      } else if (context.reason === "pause") {
        this.#save(task, { state: "paused", stage: "已暂停，可继续下载" });
      } else if (context.reason === "cancel") {
        this.#save(task, { state: "canceled", stage: "已取消" });
      } else if (result.code !== 0) {
        const failure = classifyError(result.stderr || context.log);
        if (failure.code === "AUTH_REQUIRED" && authContext) await this.cookieManager?.markRejected(sourceUrl);
        this.#save(task, {
          state: "failed",
          stage: failure.message,
          error: { code: failure.code, message: failure.message, details: tail(failure.details || "", 4000) },
        });
      } else {
        if (authContext) await this.cookieManager?.markAccepted(sourceUrl);
        await this.#complete(task, context);
      }
    } catch (error) {
      this.#save(task, {
        state: "failed",
        stage: "无法启动下载工具",
        error: { code: error.code || "PROCESS_ERROR", message: error.message },
      });
    } finally {
      authContext?.cleanup();
      this.running.delete(task.id);
      this.schedule();
    }
  }

  async #complete(task, context) {
    const outputs = [...new Set(context.outputPaths.map((value) => path.resolve(value)).filter((value) => fs.existsSync(value)))];
    this.#save(task, { state: "verifying", stage: "正在校验输出", finalOutputs: outputs });
    let probe = null;
    if (outputs[0]) {
      const handle = spawnWithLines(context.tools.ffprobePath, ["-v", "error", "-show_format", "-show_streams", "-of", "json", outputs[0]]);
      const result = await handle.completion;
      if (result.code === 0) {
        try {
          probe = JSON.parse(result.stdout);
        } catch {
          probe = null;
        }
      }
    }
    const completedAt = now();
    this.#save(task, {
      state: outputs.length ? "completed" : "partial",
      stage: outputs.length ? "下载完成" : "主体完成，未确认输出路径",
      progress: { ...task.progress, percent: 100, speed: null, eta: 0 },
      finalOutputs: outputs,
      completedAt,
    });

    const sourceUrl = this.#decrypt(task);
    const entry = {
      id: crypto.randomUUID(),
      taskId: task.id,
      title: task.media.title,
      uploader: task.media.uploader,
      extractor: task.media.extractor,
      mediaId: task.media.id,
      result: outputs.length ? "completed" : "partial",
      completedAt,
      outputs,
      canonicalUrl: sourceUrl && canPersistCanonicalUrl(sourceUrl) ? sourceUrl : "",
      redactedUrl: task.redactedUrl,
      urlFingerprint: task.urlFingerprint,
      options: task.options,
      toolVersions: context.tools.versions,
      probe,
    };
    this.store.addHistory(entry);
    this.onHistoryChanged?.(entry);
    this.urls.delete(task.id);
  }

  async pause(id) {
    assertTaskId(id);
    const task = this.store.getTask(id);
    if (!task || !ACTIVE_TASK_STATES.has(task.state)) throw new AppError("TASK_NOT_ACTIVE", "任务当前不能暂停");
    const context = this.running.get(id);
    if (!context) throw new AppError("TASK_NOT_ACTIVE", "任务进程不存在");
    context.reason = "pause";
    this.#save(task, { state: "pausing", stage: "正在暂停" });
    await terminateProcessTree(context.child);
    return publicTask(task);
  }

  resume(id) {
    assertTaskId(id);
    const task = this.store.getTask(id);
    if (!task || !new Set(["paused", "interrupted", "failed"]).has(task.state)) throw new AppError("TASK_NOT_RESUMABLE", "任务当前不能继续");
    if (!this.#decrypt(task)) throw new AppError("URL_UNAVAILABLE", "请重新解析链接后创建任务");
    this.#save(task, { state: "queued", stage: "等待继续", error: null });
    this.schedule();
    return publicTask(task);
  }

  async cancel(id) {
    assertTaskId(id);
    const task = this.store.getTask(id);
    if (!task) throw new AppError("TASK_NOT_FOUND", "任务不存在");
    const context = this.running.get(id);
    if (context) {
      context.reason = "cancel";
      this.#save(task, { state: "canceling", stage: "正在取消" });
      await terminateProcessTree(context.child);
    } else if (task.state === "queued" || task.state === "paused") {
      this.#save(task, { state: "canceled", stage: "已取消" });
    }
    return publicTask(task);
  }

  remove(id) {
    assertTaskId(id);
    const task = this.store.getTask(id);
    if (!task) return false;
    if (ACTIVE_TASK_STATES.has(task.state) || task.state === "queued") throw new AppError("TASK_ACTIVE", "请先取消活动任务");
    this.urls.delete(id);
    this.store.removeTask(id);
    this.onTaskChanged?.({ id, removed: true });
    return true;
  }

  async shutdown() {
    this.stopping = true;
    const pending = [];
    for (const [id, context] of this.running) {
      context.reason = "shutdown";
      const task = this.store.getTask(id);
      if (task) this.#save(task, { state: "interrupted", stage: "应用已退出，可重新开始" });
      pending.push(terminateProcessTree(context.child));
    }
    await Promise.allSettled(pending);
  }
}

module.exports = { TaskManager };
