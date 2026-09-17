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
let shutdownStarted = false;
const smokeTest = process.env.CLIPPORT_SMOKE_TEST === "1";

function send(channel, value) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, value);
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

function handle(channel, handler) {
  ipcMain.handle(channel, async (event, payload) => {
    if (!trustedSender(event)) return { ok: false, error: serializeError(new AppError("UNTRUSTED_SENDER", "请求来源无效")) };
    try {
      return { ok: true, data: await handler(payload || {}, event) };
    } catch (error) {
      return { ok: false, error: serializeError(error) };
    }
  });
}

function rendererRoot() {
  return path.resolve(__dirname, "..", "renderer");
}

function setupProtocol() {
  protocol.handle("clipport", (request) => {
    const requestUrl = new URL(request.url);
    if (requestUrl.host !== "app") return new Response("Not found", { status: 404 });
    const relative = decodeURIComponent(requestUrl.pathname.replace(/^\/+/, "") || "index.html");
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
  handle("app:bootstrap", async () => ({
    appVersion: app.getVersion(),
    platform: process.platform,
    settings: store.getSettings(),
    tasks: taskManager.list(),
    history: taskManager.history(),
    toolchain: await toolchain.getStatus({ fresh: true }),
    authPlatforms: await cookieManager.list(),
    updateStatus: updateManager.getStatus(),
    licenseStatus: licenseManager.getStatus(),
  }));

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
  store = new AppStore({ userDataPath: app.getPath("userData"), downloadsPath: app.getPath("downloads") });
  licenseManager = new LicenseManager({
    deviceIdentity: new DeviceIdentity(),
    safeStorage,
    userDataPath: app.getPath("userData"),
    publicKey: fs.readFileSync(path.join(__dirname, "license-public-key.pem"), "utf8"),
    enforce: app.isPackaged,
    onStatus: (status) => send("license:changed", status),
  });
  await licenseManager.initialize();
  cookieManager = new CookieManager({
    sessionModule: session,
    BrowserWindow,
    store,
    userDataPath: app.getPath("userData"),
    getParentWindow: () => mainWindow,
    onStatus: (status) => send("auth:changed", status),
  });
  toolchain = new ToolchainManager({
    store,
    userDataPath: app.getPath("userData"),
    onStatus: (status) => send("tools:changed", status),
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
    onTaskChanged: (task) => send("tasks:changed", task),
    onHistoryChanged: (entry) => send("history:changed", entry),
  });
  updateManager = new UpdateManager({
    updater: autoUpdater,
    app,
    dialog,
    getParentWindow: () => mainWindow,
    onStatus: (status) => send("updates:changed", status),
    beforeInstall: async () => {
      shutdownStarted = true;
      updateManager.shutdown();
      await taskManager.shutdown();
      cookieManager.shutdown();
    },
  });
  registerIpc();
  createWindow();
  if (licenseManager.isActive()) taskManager.schedule();
  updateManager.start();
}

app.whenReady().then(initialize);

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
  taskManager.shutdown().finally(() => {
    cookieManager?.shutdown();
    app.quit();
  });
});
