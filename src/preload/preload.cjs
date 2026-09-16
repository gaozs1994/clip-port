const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);
const subscribe = (channel, callback) => {
  if (typeof callback !== "function") return () => {};
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld("clipport", {
  app: {
    bootstrap: () => invoke("app:bootstrap"),
    minimize: () => ipcRenderer.send("window:minimize"),
    toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
    close: () => ipcRenderer.send("window:close"),
  },
  clipboard: {
    readText: () => invoke("clipboard:read-text"),
  },
  media: {
    parse: (url) => invoke("media:parse", { url }),
    cancelParse: () => invoke("media:cancel-parse"),
  },
  tasks: {
    create: (payload) => invoke("tasks:create", payload),
    pause: (id) => invoke("tasks:pause", { id }),
    resume: (id) => invoke("tasks:resume", { id }),
    cancel: (id) => invoke("tasks:cancel", { id }),
    remove: (id) => invoke("tasks:remove", { id }),
  },
  settings: {
    update: (patch) => invoke("settings:update", patch),
    chooseDownloadDirectory: () => invoke("settings:choose-download-directory"),
  },
  tools: {
    status: () => invoke("tools:status"),
    installYtDlp: () => invoke("tools:install-ytdlp"),
    chooseBinary: (tool) => invoke("tools:choose-binary", { tool }),
  },
  auth: {
    list: () => invoke("auth:list"),
    openLogin: (platformId) => invoke("auth:open-login", { platformId }),
    validate: (platformId) => invoke("auth:validate", { platformId }),
    clear: (platformId) => invoke("auth:clear", { platformId }),
  },
  files: {
    open: (recordType, id) => invoke("files:open", { recordType, id }),
    reveal: (recordType, id) => invoke("files:reveal", { recordType, id }),
    openDownloadDirectory: () => invoke("files:open-download-directory"),
  },
  events: {
    onTaskChanged: (callback) => subscribe("tasks:changed", callback),
    onHistoryChanged: (callback) => subscribe("history:changed", callback),
    onToolStatus: (callback) => subscribe("tools:changed", callback),
    onAuthChanged: (callback) => subscribe("auth:changed", callback),
  },
});
