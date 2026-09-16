const fs = require("node:fs");
const path = require("node:path");
const { ACTIVE_TASK_STATES, publicTask } = require("./validators.cjs");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class AppStore {
  constructor({ userDataPath, downloadsPath }) {
    this.directory = userDataPath;
    this.file = path.join(userDataPath, "state.json");
    this.state = this.#load(downloadsPath);
    this.#markInterrupted();
  }

  #defaults(downloadsPath) {
    return {
      version: 1,
      settings: {
        downloadDirectory: path.join(downloadsPath, "ClipPort"),
        concurrency: 2,
        theme: "dark",
        toolPaths: { ytDlp: "", ffmpeg: "", ffprobe: "" },
      },
      auth: { platforms: {} },
      tasks: [],
      history: [],
    };
  }

  #load(downloadsPath) {
    fs.mkdirSync(this.directory, { recursive: true });
    const defaults = this.#defaults(downloadsPath);
    if (!fs.existsSync(this.file)) return defaults;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return {
        ...defaults,
        ...parsed,
        settings: {
          ...defaults.settings,
          ...(parsed.settings || {}),
          toolPaths: { ...defaults.settings.toolPaths, ...(parsed.settings?.toolPaths || {}) },
        },
        auth: {
          platforms: { ...defaults.auth.platforms, ...(parsed.auth?.platforms || {}) },
        },
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        history: Array.isArray(parsed.history) ? parsed.history : [],
      };
    } catch {
      const backup = `${this.file}.corrupt-${Date.now()}`;
      fs.copyFileSync(this.file, backup);
      return defaults;
    }
  }

  #markInterrupted() {
    let changed = false;
    const now = new Date().toISOString();
    for (const task of this.state.tasks) {
      if (ACTIVE_TASK_STATES.has(task.state)) {
        task.state = "interrupted";
        task.stage = "应用上次未正常结束";
        task.updatedAt = now;
        changed = true;
      }
    }
    if (changed) this.save();
  }

  save() {
    fs.mkdirSync(this.directory, { recursive: true });
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), "utf8");
    fs.renameSync(temporary, this.file);
  }

  getSettings() {
    return clone(this.state.settings);
  }

  updateSettings(patch) {
    this.state.settings = {
      ...this.state.settings,
      ...patch,
      toolPaths: { ...this.state.settings.toolPaths, ...(patch.toolPaths || {}) },
    };
    this.save();
    return this.getSettings();
  }

  getAuthMetadata(platformId) {
    return clone(this.state.auth?.platforms?.[platformId] || {});
  }

  updateAuthMetadata(platformId, patch) {
    this.state.auth ||= { platforms: {} };
    this.state.auth.platforms ||= {};
    this.state.auth.platforms[platformId] = {
      ...(this.state.auth.platforms[platformId] || {}),
      ...patch,
    };
    this.save();
    return this.getAuthMetadata(platformId);
  }

  clearAuthMetadata(platformId) {
    if (this.state.auth?.platforms) delete this.state.auth.platforms[platformId];
    this.save();
  }

  listTasks() {
    return this.state.tasks.map((task) => publicTask(clone(task)));
  }

  getTask(id) {
    return this.state.tasks.find((task) => task.id === id) || null;
  }

  upsertTask(task) {
    const index = this.state.tasks.findIndex((item) => item.id === task.id);
    if (index === -1) this.state.tasks.unshift(task);
    else this.state.tasks[index] = task;
    this.state.tasks = this.state.tasks.slice(0, 250);
    this.save();
    return publicTask(clone(task));
  }

  removeTask(id) {
    this.state.tasks = this.state.tasks.filter((task) => task.id !== id);
    this.save();
  }

  listHistory() {
    return clone(this.state.history);
  }

  addHistory(entry) {
    this.state.history = [entry, ...this.state.history.filter((item) => item.taskId !== entry.taskId)].slice(0, 1000);
    this.save();
    return clone(entry);
  }

  findHistory(id) {
    return this.state.history.find((entry) => entry.id === id) || null;
  }
}

module.exports = { AppStore };
