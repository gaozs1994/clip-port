const DEFAULT_STATE = Object.freeze({
  status: "idle",
  latestVersion: "",
  progress: null,
  downloadedBytes: null,
  totalBytes: null,
  bytesPerSecond: null,
  message: "启动后自动检查更新",
});
const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

class UpdateManager {
  constructor({
    updater,
    app,
    platform = process.platform,
    onStatus = () => {},
    beforeInstall = async () => {},
    checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  }) {
    this.updater = updater;
    this.app = app;
    this.onStatus = onStatus;
    this.beforeInstall = beforeInstall;
    this.checkIntervalMs = Number.isFinite(checkIntervalMs) && checkIntervalMs > 0 ? checkIntervalMs : DEFAULT_CHECK_INTERVAL_MS;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.enabled = Boolean(app.isPackaged && platform === "win32");
    this.state = {
      ...DEFAULT_STATE,
      status: this.enabled ? "idle" : "disabled",
      currentVersion: app.getVersion(),
      message: this.enabled ? DEFAULT_STATE.message : "开发环境不检查更新",
    };
    this.checkPromise = null;
    this.downloadPromise = null;
    this.scheduleTimer = null;
    this.started = false;

    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.logger = null;
    this.bindEvents();
  }

  bindEvents() {
    this.updater.on("checking-for-update", () => {
      this.setState({ status: "checking", progress: null, downloadedBytes: null, totalBytes: null, bytesPerSecond: null, message: "正在连接更新服务" });
    });
    this.updater.on("update-not-available", () => {
      this.setState({ status: "current", latestVersion: "", progress: null, downloadedBytes: null, totalBytes: null, bytesPerSecond: null, message: "已是最新版本" });
    });
    this.updater.on("update-available", (info = {}) => {
      const latestVersion = String(info.version || "");
      this.setState({ status: "available", latestVersion, progress: null, downloadedBytes: null, totalBytes: null, bytesPerSecond: null, message: latestVersion ? `发现新版本 ${latestVersion}` : "发现新版本" });
      void this.download();
    });
    this.updater.on("download-progress", (progress = {}) => {
      const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
      const downloadedBytes = Math.max(0, Number(progress.transferred) || 0);
      const totalBytes = Math.max(0, Number(progress.total) || 0);
      const bytesPerSecond = Math.max(0, Number(progress.bytesPerSecond) || 0);
      this.setState({ status: "downloading", progress: percent, downloadedBytes, totalBytes, bytesPerSecond, message: `正在下载更新 ${Math.round(percent)}%` });
    });
    this.updater.on("update-downloaded", (info = {}) => {
      const latestVersion = String(info.version || this.state.latestVersion || "");
      this.setState({ status: "downloaded", latestVersion, progress: 100, downloadedBytes: this.state.totalBytes, bytesPerSecond: 0, message: "更新已下载，等待重启安装" });
    });
    this.updater.on("error", () => {
      this.setState({
        status: "error",
        progress: null,
        downloadedBytes: null,
        totalBytes: null,
        bytesPerSecond: null,
        message: "无法连接更新服务，请稍后重试",
      });
    });
  }

  getStatus() {
    return { ...this.state };
  }

  setState(patch) {
    this.state = { ...this.state, ...patch };
    this.onStatus(this.getStatus());
  }

  start(delay = 8000) {
    if (!this.enabled || this.started) return;
    this.started = true;
    this.scheduleNext(delay);
  }

  scheduleNext(delay) {
    if (!this.started || this.scheduleTimer) return;
    this.scheduleTimer = this.setTimer(() => {
      this.scheduleTimer = null;
      Promise.resolve(this.check()).finally(() => this.scheduleNext(this.checkIntervalMs));
    }, delay);
    this.scheduleTimer?.unref?.();
  }

  shutdown() {
    this.started = false;
    if (this.scheduleTimer) this.clearTimer(this.scheduleTimer);
    this.scheduleTimer = null;
  }

  async check() {
    if (!this.enabled || this.downloadPromise || new Set(["downloading", "downloaded"]).has(this.state.status)) return this.getStatus();
    if (this.checkPromise) return this.checkPromise;

    this.setState({ status: "checking", progress: null, downloadedBytes: null, totalBytes: null, bytesPerSecond: null, message: "正在检查新版本" });
    this.checkPromise = this.updater.checkForUpdates()
      .catch(() => {
        this.setState({ status: "error", progress: null, downloadedBytes: null, totalBytes: null, bytesPerSecond: null, message: "无法连接更新服务，请稍后重试" });
      })
      .then(() => this.getStatus())
      .finally(() => { this.checkPromise = null; });
    return this.checkPromise;
  }

  async download() {
    if (!this.enabled || this.state.status !== "available") return this.getStatus();
    if (this.downloadPromise) return this.downloadPromise;

    this.setState({ status: "downloading", progress: 0, downloadedBytes: 0, totalBytes: null, bytesPerSecond: null, message: "正在准备下载更新" });
    this.downloadPromise = this.updater.downloadUpdate()
      .catch(() => {
        this.setState({ status: "error", progress: null, downloadedBytes: null, totalBytes: null, bytesPerSecond: null, message: "更新下载失败，请稍后重试" });
      })
      .then(() => this.getStatus())
      .finally(() => { this.downloadPromise = null; });
    return this.downloadPromise;
  }

  async install() {
    if (!this.enabled || this.state.status !== "downloaded") return false;
    await this.beforeInstall();
    this.updater.quitAndInstall(false, true);
    return true;
  }
}

module.exports = { DEFAULT_CHECK_INTERVAL_MS, UpdateManager };
