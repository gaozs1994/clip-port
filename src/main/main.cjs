const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  net,
  protocol,
  safeStorage,
  session,
  shell,
} = require("electron");
const { autoUpdater } = require("electron-updater");
const { AppStore } = require("./services/store.cjs");
const { ToolchainManager } = require("./services/toolchain.cjs");
const { MediaService } = require("./services/media-service.cjs");
const { TaskManager } = require("./services/task-manager.cjs");
const { CookieManager } = require("./services/cookie-manager.cjs");
const { DouyinResolver } = require("./services/douyin-resolver.cjs");
const { UpdateManager } = require("./services/update-manager.cjs");
const { DeviceIdentity } = require("./services/device-identity.cjs");
const { LicenseManager } = require("./services/license-manager.cjs");
const { WindowsLicenseStore } = require("./services/windows-license-store.cjs");
const { DiagnosticLog } = require("./services/diagnostic-log.cjs");
const { DEFAULT_ORIGIN, VoiceboxService } = require("./services/voicebox-service.cjs");
const { VoiceboxRuntimeManager } = require("./services/voicebox-runtime.cjs");
const { AppError, assertTaskId, sanitizeSettingsPatch } = require("./services/validators.cjs");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "clipport",
    privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
  },
]);

let mainWindow = null;
let store = null;
let toolchain = null;
let mediaService = null;
let taskManager = null;
let cookieManager = null;
let douyinResolver = null;
let updateManager = null;
let licenseManager = null;
let voiceboxService = null;
let voiceboxRuntime = null;
let diagnosticLog = null;
let shutdownStarted = false;
const smokeTest = process.env.CLIPPORT_SMOKE_TEST === "1";

function send(channel, value) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, value);
}

async function publishVoiceboxStatus() {
  if (!voiceboxService) return;
  send("voicebox:changed", await voiceboxService.getStatus());
}

function serializeError(error) {
  return {
    code: error?.code || "UNKNOWN_ERROR",
    message: error?.message || "发生未知错误",
    details: typeof error?.details === "string" ? error.details.slice(-6000) : "",
  };
}

function trustedSender(event) {
  try {
    const senderUrl = new URL(event.senderFrame.url);
    return senderUrl.protocol === "clipport:" && senderUrl.host === "app";
  } catch {
    return false;
  }
}

function logSource(channel) {
  return {
    media: "media",
    tasks: "tasks",
    auth: "auth",
    tools: "toolchain",
    updates: "updates",
    license: "license",
    voicebox: "voicebox",
    settings: "settings",
    files: "files",
    clipboard: "app",
    app: "app",
    logs: "app",
  }[String(channel).split(":")[0]] || "app";
}

function handle(channel, handler) {
  ipcMain.handle(channel, async (event, payload) => {
    if (!trustedSender(event)) {
      diagnosticLog?.warn("security", "已拒绝来源无效的 IPC 请求", { channel });
      return { ok: false, error: serializeError(new AppError("UNTRUSTED_SENDER", "请求来源无效")) };
    }
    try {
      return { ok: true, data: await handler(payload || {}, event) };
    } catch (error) {
      const serialized = serializeError(error);
      diagnosticLog?.error(logSource(channel), serialized.message, { channel, code: serialized.code, details: serialized.details });
      return { ok: false, error: serialized };
    }
  });
}

function rendererRoot() {
  return path.resolve(__dirname, "..", "renderer");
}

function setupProtocol() {
  protocol.handle("clipport", async (request) => {
    const requestUrl = new URL(request.url);
    if (requestUrl.host !== "app") return new Response("Not found", { status: 404 });
    const relative = decodeURIComponent(requestUrl.pathname.replace(/^\/+/, "") || "index.html");
    const voiceboxAudioMatch = relative.match(/^voicebox-audio\/([a-f0-9-]{20,64})$/i);
    if (voiceboxAudioMatch) {
      if (!voiceboxService) return new Response("Voicebox unavailable", { status: 503 });
      return voiceboxService.audioResponse(voiceboxAudioMatch[1]);
    }
    const root = rendererRoot();
    const target = path.resolve(root, relative);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) return new Response("Forbidden", { status: 403 });
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(target).toString());
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 980,
    minHeight: 680,
    show: false,
    frame: false,
    icon: path.resolve(__dirname, "..", "..", "build", "icon.png"),
    backgroundColor: "#f4f7f6",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    if (!smokeTest) mainWindow.show();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("clipport://app/")) event.preventDefault();
  });
  mainWindow.loadURL("clipport://app/index.html");

  if (smokeTest) {
    mainWindow.webContents.once("did-finish-load", async () => {
      try {
        const result = await mainWindow.webContents.executeJavaScript(`(async () => {
          const response = await window.clipport.app.bootstrap();
          return {
            title: document.title,
            url: location.href,
            bridgeAvailable: Boolean(window.clipport?.app?.bootstrap),
            nodeExposed: typeof require !== "undefined" || typeof process !== "undefined",
            bootstrapOk: response?.ok === true,
            activeView: document.querySelector(".view.active")?.dataset.view || "",
            toolchainReady: response?.data?.toolchain?.ready === true
          };
        })()`);
        console.log(`CLIPPORT_SMOKE:${JSON.stringify(result)}`);
        process.exitCode = result.bridgeAvailable && !result.nodeExposed && result.bootstrapOk && result.activeView === "download" ? 0 : 1;
      } catch (error) {
        console.error(`CLIPPORT_SMOKE_ERROR:${error.stack || error.message}`);
        process.exitCode = 1;
      } finally {
        app.quit();
      }
    });
  }
}

function findOutput(recordType, id) {
  assertTaskId(id);
  if (recordType === "task") return store.getTask(id)?.finalOutputs?.find((value) => fs.existsSync(value)) || "";
  if (recordType === "history") return store.findHistory(id)?.outputs?.find((value) => fs.existsSync(value)) || "";
  throw new AppError("INVALID_RECORD", "文件记录类型无效");
}

function registerIpc() {
  handle("app:bootstrap", async () => {
    const [toolchainStatus, authPlatforms, voiceboxStatus] = await Promise.all([
      toolchain.getStatus({ fresh: true }),
      cookieManager.list(),
      voiceboxService.getStatus(),
    ]);
    return {
      appVersion: app.getVersion(),
      platform: process.platform,
      settings: store.getSettings(),
      tasks: taskManager.list(),
      history: taskManager.history(),
      toolchain: toolchainStatus,
      authPlatforms,
      voiceboxStatus,
      updateStatus: updateManager.getStatus(),
      licenseStatus: licenseManager.getStatus(),
      diagnosticLogs: diagnosticLog.list({ limit: 500 }),
    };
  });

  handle("media:parse", ({ url }) => {
    licenseManager.requireActive();
    return mediaService.parse(url);
  });
  handle("media:cancel-parse", () => mediaService.cancel());
  handle("clipboard:read-text", () => clipboard.readText().slice(0, 20_000));
  handle("tasks:create", (payload) => {
    licenseManager.requireActive();
    return taskManager.create(payload);
  });
  handle("tasks:pause", ({ id }) => taskManager.pause(id));
  handle("tasks:resume", ({ id }) => {
    licenseManager.requireActive();
    return taskManager.resume(id);
  });
  handle("tasks:cancel", ({ id }) => taskManager.cancel(id));
  handle("tasks:remove", ({ id }) => taskManager.remove(id));

  handle("settings:update", async (payload) => {
    const settings = store.updateSettings(sanitizeSettingsPatch(payload));
    toolchain.invalidate();
    taskManager.schedule();
    return { settings, toolchain: await toolchain.getStatus({ fresh: true }) };
  });
  handle("settings:choose-download-directory", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择默认下载目录",
      defaultPath: store.getSettings().downloadDirectory,
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const settings = store.updateSettings({ downloadDirectory: result.filePaths[0] });
    return settings;
  });

  handle("tools:status", () => toolchain.getStatus({ fresh: true }));
  handle("tools:install-ytdlp", () => toolchain.installYtDlp());
  handle("tools:choose-binary", async ({ tool }) => {
    if (!new Set(["ytDlp", "ffmpeg", "ffprobe"]).has(tool)) throw new AppError("INVALID_TOOL", "工具类型无效");
    const result = await dialog.showOpenDialog(mainWindow, {
      title: `选择 ${tool} 可执行文件`,
      properties: ["openFile"],
      filters: process.platform === "win32" ? [{ name: "可执行文件", extensions: ["exe"] }] : [],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    store.updateSettings({ toolPaths: { [tool]: result.filePaths[0] } });
    toolchain.invalidate();
    return toolchain.getStatus({ fresh: true });
  });

  handle("auth:list", () => cookieManager.list());
  handle("auth:open-login", ({ platformId }) => cookieManager.openLogin(platformId));
  handle("auth:validate", ({ platformId }) => cookieManager.validate(platformId));
  handle("auth:clear", async ({ platformId }) => {
    const platform = await cookieManager.getStatus(platformId);
    const result = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "清除登录状态",
      message: `清除 ${platform.name} 的登录状态？`,
      detail: "该平台在 ClipPort 中保存的 Cookie 与站点数据将被删除，其他浏览器不受影响。",
      buttons: ["取消", "清除"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (result.response !== 1) return null;
    return cookieManager.clear(platformId);
  });

  handle("updates:status", () => updateManager.getStatus());
  handle("updates:check", () => updateManager.check());
  handle("updates:download", () => updateManager.download());
  handle("updates:install", () => updateManager.install());

  handle("license:status", () => licenseManager.getStatus());
  handle("license:copy-device-code", () => {
    clipboard.writeText(licenseManager.getStatus().deviceCode);
    return true;
  });
  handle("license:activate", ({ code }) => {
    const status = licenseManager.activate(code);
    taskManager.schedule();
    return status;
  });
  handle("license:clear", async () => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "清除设备授权",
      message: "清除此设备保存的授权码？",
      detail: "清除后将不能创建或继续下载任务，重新输入有效授权码即可恢复。",
      buttons: ["取消", "清除授权"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return result.response === 1 ? licenseManager.clear() : null;
  });

  handle("voicebox:status", () => voiceboxService.getStatus());
  handle("voicebox:restart", async () => {
    const runtime = await voiceboxRuntime.restart();
    if (runtime.origin) voiceboxService.setOrigin(runtime.origin);
    return voiceboxService.getStatus();
  });
  handle("voicebox:preset-voices", ({ engine }) => voiceboxService.listPresetVoices(engine));
  handle("voicebox:create-profile", async (payload) => {
    licenseManager.requireActive();
    let samplePath = "";
    if (payload.voiceType === "cloned") {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: "选择已获授权的声音样本",
        properties: ["openFile"],
        filters: [{ name: "音频文件", extensions: ["wav", "mp3", "m4a", "ogg", "flac", "aac", "webm", "opus"] }],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      samplePath = result.filePaths[0];
    }
    const profile = await voiceboxService.createProfile(payload);
    try {
      if (samplePath) await voiceboxService.addProfileSample(profile.id, samplePath, payload.referenceText);
    } catch (error) {
      await voiceboxService.deleteProfile(profile.id).catch(() => {});
      throw error;
    }
    return voiceboxService.getStatus();
  });
  handle("voicebox:delete-profile", async ({ id }) => {
    licenseManager.requireActive();
    const profile = (await voiceboxService.getStatus()).profiles.find((item) => item.id === id);
    if (!profile) throw new AppError("INVALID_VOICE_PROFILE", "声音档案不存在");
    const result = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "删除声音档案",
      message: `删除“${profile.name}”？`,
      detail: "档案中的声音样本会一并删除，此操作无法撤销。",
      buttons: ["取消", "删除"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (result.response !== 1) return null;
    await voiceboxService.deleteProfile(id);
    return voiceboxService.getStatus();
  });
  handle("voicebox:download-model", async ({ name }) => {
    licenseManager.requireActive();
    await voiceboxService.downloadModel(name);
    return true;
  });
  handle("voicebox:cancel-model", ({ name }) => voiceboxService.cancelModelDownload(name));
  handle("voicebox:unload-model", async ({ name }) => {
    await voiceboxService.unloadModel(name);
    return voiceboxService.getStatus();
  });
  handle("voicebox:delete-model", async ({ name }) => {
    licenseManager.requireActive();
    const model = (await voiceboxService.getStatus()).models.find((item) => item.name === name);
    if (!model) throw new AppError("INVALID_VOICEBOX_MODEL", "语音模型不存在");
    const result = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "删除语音模型",
      message: `删除“${model.displayName}”？`,
      detail: "释放的磁盘空间可稍后通过重新下载恢复。",
      buttons: ["取消", "删除"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (result.response !== 1) return null;
    await voiceboxService.deleteModel(name);
    return voiceboxService.getStatus();
  });
  handle("voicebox:generate", (payload) => {
    licenseManager.requireActive();
    return voiceboxService.startGeneration(payload);
  });
  handle("voicebox:cancel", ({ id }) => voiceboxService.cancelGeneration(id));
  handle("voicebox:save-audio", async ({ id }) => {
    licenseManager.requireActive();
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "保存生成语音",
      defaultPath: path.join(app.getPath("downloads"), `ClipPort-voice-${new Date().toISOString().replace(/[:.]/g, "-")}.wav`),
      filters: [{ name: "WAV 音频", extensions: ["wav"] }],
    });
    if (result.canceled || !result.filePath) return null;
    const audio = await voiceboxService.downloadAudio(id);
    fs.writeFileSync(result.filePath, audio);
    return result.filePath;
  });

  handle("logs:list", (filters) => diagnosticLog.list(filters));
  handle("logs:record", ({ level, message, details }) => {
    diagnosticLog.log(level, "renderer", message, details);
    return true;
  });
  handle("logs:export", async () => {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "导出诊断日志",
      defaultPath: path.join(app.getPath("downloads"), `ClipPort-diagnostics-${stamp}.jsonl`),
      filters: [{ name: "JSON Lines 日志", extensions: ["jsonl"] }],
    });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, diagnosticLog.exportText(), "utf8");
    diagnosticLog.info("app", "诊断日志已导出");
    return result.filePath;
  });
  handle("logs:clear", async () => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "清空诊断日志",
      message: "清空全部本地诊断日志？",
      detail: "此操作不会影响下载记录、登录状态或设备授权。",
      buttons: ["取消", "清空"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (result.response !== 1) return false;
    diagnosticLog.clear();
    send("logs:cleared", true);
    return true;
  });

  handle("files:open", async ({ recordType, id }) => {
    const output = findOutput(recordType, id);
    if (!output) throw new AppError("FILE_MISSING", "输出文件不存在");
    const error = await shell.openPath(output);
    if (error) throw new AppError("OPEN_FAILED", "无法打开文件", error);
    return true;
  });
  handle("files:reveal", ({ recordType, id }) => {
    const output = findOutput(recordType, id);
    if (!output) throw new AppError("FILE_MISSING", "输出文件不存在");
    shell.showItemInFolder(output);
    return true;
  });
  handle("files:open-download-directory", async () => {
    const directory = store.getSettings().downloadDirectory;
    fs.mkdirSync(directory, { recursive: true });
    const error = await shell.openPath(directory);
    if (error) throw new AppError("OPEN_FAILED", "无法打开下载目录", error);
    return true;
  });

  ipcMain.on("window:minimize", (event) => {
    if (trustedSender(event)) BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.on("window:toggle-maximize", (event) => {
    if (!trustedSender(event)) return;
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  ipcMain.on("window:close", (event) => {
    if (trustedSender(event)) app.quit();
  });
}

async function initialize() {
  if (process.platform === "win32") app.setAppUserModelId("app.clipport.desktop");
  setupProtocol();
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  diagnosticLog = new DiagnosticLog({
    userDataPath: app.getPath("userData"),
    onEntry: (entry) => send("logs:changed", entry),
  });
  diagnosticLog.info("app", "ClipPort 已启动", { version: app.getVersion(), platform: process.platform, packaged: app.isPackaged });
  store = new AppStore({ userDataPath: app.getPath("userData"), downloadsPath: app.getPath("downloads") });
  licenseManager = new LicenseManager({
    deviceIdentity: new DeviceIdentity(),
    safeStorage,
    persistentStore: new WindowsLicenseStore(),
    userDataPath: app.getPath("userData"),
    publicKey: fs.readFileSync(path.join(__dirname, "license-public-key.pem"), "utf8"),
    enforce: app.isPackaged,
    onStatus: (status) => {
      send("license:changed", status);
      if (new Set(["expired", "invalid", "device_mismatch", "unavailable"]).has(status.status)) {
        diagnosticLog.warn("license", status.message || "设备授权状态异常", { status: status.status });
      }
    },
  });
  await licenseManager.initialize();
  cookieManager = new CookieManager({
    sessionModule: session,
    BrowserWindow,
    store,
    userDataPath: app.getPath("userData"),
    getParentWindow: () => mainWindow,
    onStatus: (status) => {
      send("auth:changed", status);
      if (status.status === "invalid") diagnosticLog.warn("auth", status.message || "平台登录状态无效", { platform: status.id });
    },
  });
  toolchain = new ToolchainManager({
    store,
    userDataPath: app.getPath("userData"),
    onStatus: (status) => send("tools:changed", status),
  });
  voiceboxRuntime = new VoiceboxRuntimeManager({
    userDataPath: app.getPath("userData"),
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged,
    onStatus: (status) => {
      if (new Set(["failed", "missing"]).has(status.state)) {
        diagnosticLog.error("voicebox", status.message || "Voicebox 服务不可用", { state: status.state, error: status.error });
      }
      if (!voiceboxService) return;
      if (status.origin) voiceboxService.setOrigin(status.origin);
      publishVoiceboxStatus().catch(() => {});
    },
  });
  const voiceboxRuntimeStatus = await voiceboxRuntime.start();
  voiceboxService = new VoiceboxService({
    origin: voiceboxRuntimeStatus.origin || DEFAULT_ORIGIN,
    getRuntimeStatus: () => voiceboxRuntime.getStatus(),
    onGenerationStatus: (status) => {
      send("voicebox:generation-status", status);
      if (status.status === "failed") diagnosticLog.error("voicebox", status.error || "语音生成失败", { generationId: status.id });
    },
    onModelProgress: (status) => {
      send("voicebox:model-progress", status);
      if (new Set(["error", "failed"]).has(status.status)) {
        diagnosticLog.error("voicebox", status.error || "语音模型下载失败", { model: status.modelName });
      }
      if (new Set(["complete", "completed", "error", "failed", "canceled", "cancelled"]).has(status.status)) {
        publishVoiceboxStatus().catch(() => {});
      }
    },
  });
  douyinResolver = new DouyinResolver();
  mediaService = new MediaService({ toolchain, cookieManager, douyinResolver });
  taskManager = new TaskManager({
    store,
    toolchain,
    safeStorage,
    cookieManager,
    douyinResolver,
    canStartTask: () => licenseManager.isActive(),
    onTaskChanged: (task) => {
      send("tasks:changed", task);
      if (task.state === "failed") {
        diagnosticLog.error("tasks", task.error?.message || task.stage || "下载任务失败", {
          taskId: task.id,
          code: task.error?.code,
          details: task.error?.details,
          extractor: task.media?.extractor,
        });
      }
    },
    onHistoryChanged: (entry) => send("history:changed", entry),
  });
  updateManager = new UpdateManager({
    updater: autoUpdater,
    app,
    onStatus: (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setProgressBar(status.status === "downloading" ? Math.max(0, Math.min(1, Number(status.progress) / 100 || 0)) : -1);
      }
      send("updates:changed", status);
      if (status.status === "error") diagnosticLog.error("updates", status.message || "检查或下载更新失败");
    },
    beforeInstall: async () => {
      shutdownStarted = true;
      updateManager.shutdown();
      await taskManager.shutdown();
      cookieManager.shutdown();
      voiceboxService.shutdown();
      await voiceboxRuntime.shutdown();
    },
  });
  registerIpc();
  createWindow();
  if (licenseManager.isActive()) taskManager.schedule();
  updateManager.start();
}

process.on("uncaughtExceptionMonitor", (error, origin) => {
  diagnosticLog?.error("app", "主进程发生未捕获异常", {
    code: error?.code,
    message: error?.message,
    stack: error?.stack,
    origin,
  });
});

app.whenReady().then(initialize);

app.on("render-process-gone", (_event, _webContents, details) => {
  diagnosticLog?.error("renderer", "界面进程异常退出", { reason: details.reason, exitCode: details.exitCode });
});

app.on("child-process-gone", (_event, details) => {
  if (details.type === "Utility" && details.reason === "clean-exit") return;
  diagnosticLog?.warn("app", "Electron 子进程已退出", {
    type: details.type,
    reason: details.reason,
    exitCode: details.exitCode,
    serviceName: details.serviceName,
  });
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  updateManager?.shutdown();
  if (shutdownStarted || !taskManager) return;
  event.preventDefault();
  shutdownStarted = true;
  taskManager.shutdown().then(() => voiceboxRuntime?.shutdown()).finally(() => {
    cookieManager?.shutdown();
    voiceboxService?.shutdown();
    app.quit();
  });
});
