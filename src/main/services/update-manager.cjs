const DEFAULT_STATE = Object.freeze({
  status: "idle",
  latestVersion: "",
  progress: null,
  downloadedBytes: null,
  totalBytes: null,
  bytesPerSecond: null,
  message: "启动后自动检查更新",
});

class UpdateManager {
  constructor({ updater, app, dialog, platform = process.platform, getParentWindow = () => null, onStatus = () => {}, beforeInstall = async () => {} }) {
    this.updater = updater;
    this.app = app;
    this.dialog = dialog;
    this.getParentWindow = getParentWindow;
    this.onStatus = onStatus;
    this.beforeInstall = beforeInstall;
    this.enabled = Boolean(app.isPackaged && platform === "win32");
    this.state = {
      ...DEFAULT_STATE,
      status: this.enabled ? "idle" : "disabled",
      currentVersion: app.getVersion(),
      message: this.enabled ? DEFAULT_STATE.message : "开发环境不检查更新",
    };
    this.checkPromise = null;
    this.downloadPromise = null;
    this.startTimer = null;
    this.promptedAvailableVersion = "";
    this.promptedDownloadedVersion = "";

    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = true;
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
      void this.promptAvailable(latestVersion);
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
      void this.promptDownloaded(latestVersion);
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
    if (!this.enabled || this.startTimer) return;
    this.startTimer = setTimeout(() => {
      this.startTimer = null;
      void this.check();
    }, delay);
    this.startTimer.unref?.();
  }

  shutdown() {
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = null;
  }

  async check() {
    if (!this.enabled || this.downloadPromise) return this.getStatus();
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

  async showMessageBox(options) {
    const parent = this.getParentWindow();
    return parent
      ? this.dialog.showMessageBox(parent, options)
      : this.dialog.showMessageBox(options);
  }

  async promptAvailable(version) {
    if (this.promptedAvailableVersion === version) return;
    this.promptedAvailableVersion = version;
    const result = await this.showMessageBox({
      type: "info",
      title: "发现新版本",
      message: version ? `ClipPort ${version} 可用` : "ClipPort 有新版本可用",
      detail: `当前版本 ${this.state.currentVersion}。是否现在下载安装包？下载期间可以继续使用 ClipPort。`,
      buttons: ["稍后", "下载更新"],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
    });
    if (result.response === 1) await this.download();
  }

  async promptDownloaded(version) {
    if (this.promptedDownloadedVersion === version) return;
    this.promptedDownloadedVersion = version;
    const result = await this.showMessageBox({
      type: "info",
      title: "更新已准备好",
      message: version ? `ClipPort ${version} 已下载` : "ClipPort 更新已下载",
      detail: "重启后将开始安装；正在进行的下载会暂停，并可在下次启动后继续。",
      buttons: ["稍后重启", "重启并安装"],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
    });
    if (result.response === 1) await this.install();
  }
}

module.exports = { UpdateManager };
