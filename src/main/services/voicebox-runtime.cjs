const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const EXTERNAL_DEV_ORIGIN = "http://127.0.0.1:17493";
const START_PORT = 17494;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function waitForExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.off?.("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timeout = setTimeout(() => finish(false), timeoutMs);
    child.once?.("exit", onExit);
  });
}

function normalizeLoopbackOrigin(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" || !new Set(["127.0.0.1", "localhost", "[::1]"]).has(parsed.hostname)) {
    throw new Error("Voicebox runtime origin must use an HTTP loopback address");
  }
  return parsed.origin;
}

function findAvailablePort({ host = "127.0.0.1", startPort = START_PORT, attempts = 64, netModule = net } = {}) {
  return new Promise((resolve, reject) => {
    let port = startPort;
    const tryPort = () => {
      if (port >= startPort + attempts) {
        reject(new Error("没有可用的本机端口来启动 Voicebox"));
        return;
      }
      const server = netModule.createServer();
      server.unref?.();
      server.once("error", () => {
        port += 1;
        tryPort();
      });
      server.listen(port, host, () => {
        const selected = port;
        server.close((error) => error ? reject(error) : resolve(selected));
      });
    };
    tryPort();
  });
}

class VoiceboxRuntimeManager {
  constructor({
    userDataPath,
    resourcesPath = process.resourcesPath,
    projectRoot = path.resolve(__dirname, "..", "..", ".."),
    isPackaged = false,
    binaryPath = "",
    fetchImpl = globalThis.fetch,
    spawnImpl = spawn,
    findPort = findAvailablePort,
    randomInt = crypto.randomInt,
    externalDevOrigin = EXTERNAL_DEV_ORIGIN,
    parentPid = process.pid,
    startupTimeoutMs = 120_000,
    pollIntervalMs = 500,
    onStatus,
  } = {}) {
    if (!userDataPath) throw new Error("Voicebox runtime requires a user data directory");
    this.userDataPath = userDataPath;
    this.dataDirectory = path.join(userDataPath, "voicebox");
    this.modelsDirectory = path.join(this.dataDirectory, "models");
    this.binaryPath = binaryPath || (isPackaged
      ? path.join(resourcesPath, "tools", "voicebox", "voicebox-server.exe")
      : path.join(projectRoot, "vendor", "voicebox", "win32-x64", "voicebox-server.exe"));
    this.isPackaged = isPackaged;
    this.fetch = fetchImpl;
    this.spawn = spawnImpl;
    this.findPort = findPort;
    this.randomInt = randomInt;
    this.externalDevOrigin = normalizeLoopbackOrigin(externalDevOrigin);
    this.parentPid = parentPid;
    this.startupTimeoutMs = startupTimeoutMs;
    this.pollIntervalMs = pollIntervalMs;
    this.onStatus = onStatus;
    this.child = null;
    this.readyPromise = null;
    this.stopping = false;
    this.status = {
      state: "stopped",
      mode: "bundled",
      origin: "",
      message: "Voicebox 服务尚未启动",
      startedAt: "",
      error: "",
    };
  }

  getStatus() {
    return { ...this.status };
  }

  #setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.onStatus?.(this.getStatus());
    return this.getStatus();
  }

  async #isHealthy(origin, timeoutMs = 1500) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetch(`${origin}/health`, {
        redirect: "error",
        signal: controller.signal,
        headers: { accept: "application/json", "x-voicebox-client-id": "clipport" },
      });
      if (!response.ok) return false;
      const health = await response.json();
      return health?.status === "healthy";
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  async start() {
    if (new Set(["starting", "ready"]).has(this.status.state)) return this.getStatus();
    this.stopping = false;

    if (!fs.existsSync(this.binaryPath)) {
      if (!this.isPackaged && await this.#isHealthy(this.externalDevOrigin)) {
        return this.#setStatus({
          state: "ready",
          mode: "external-dev",
          origin: this.externalDevOrigin,
          message: "已连接开发环境中的 Voicebox 服务",
          startedAt: new Date().toISOString(),
          error: "",
        });
      }
      return this.#setStatus({
        state: "missing",
        mode: "bundled",
        origin: "",
        message: this.isPackaged ? "安装包缺少内置 Voicebox 运行时" : "开发环境尚未准备 Voicebox 运行时",
        startedAt: "",
        error: "",
      });
    }

    try {
      fs.mkdirSync(this.modelsDirectory, { recursive: true });
    } catch (error) {
      return this.#setStatus({ state: "failed", origin: "", message: "无法准备 Voicebox 数据目录", error: error.message });
    }
    let port;
    try {
      port = await this.findPort({ host: "127.0.0.1", startPort: START_PORT + this.randomInt(0, 512) });
    } catch (error) {
      return this.#setStatus({ state: "failed", origin: "", message: "Voicebox 启动失败", error: error.message });
    }
    const origin = `http://127.0.0.1:${port}`;
    let child;
    try {
      child = this.spawn(this.binaryPath, [
        "--host", "127.0.0.1",
        "--port", String(port),
        "--data-dir", this.dataDirectory,
        "--parent-pid", String(this.parentPid),
      ], {
        windowsHide: true,
        stdio: "ignore",
        env: { ...process.env, VOICEBOX_MODELS_DIR: this.modelsDirectory },
      });
      child.unref?.();
    } catch (error) {
      return this.#setStatus({ state: "failed", origin, message: "无法启动内置 Voicebox 服务", error: error.message });
    }

    this.child = child;
    child.once?.("error", (error) => {
      if (this.child !== child || this.stopping) return;
      this.child = null;
      this.#setStatus({ state: "failed", message: "内置 Voicebox 服务启动失败", error: error.message });
    });
    child.once?.("exit", (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      if (this.stopping) return;
      this.#setStatus({
        state: "failed",
        message: "内置 Voicebox 服务已停止",
        error: `退出码 ${code ?? "--"}${signal ? `，信号 ${signal}` : ""}`,
      });
    });

    this.#setStatus({
      state: "starting",
      mode: "bundled",
      origin,
      message: "正在启动内置 Voicebox 服务",
      startedAt: new Date().toISOString(),
      error: "",
    });
    this.readyPromise = this.#waitUntilReady(child, origin);
    this.readyPromise.catch(() => {});
    return this.getStatus();
  }

  async #waitUntilReady(child, origin) {
    const deadline = Date.now() + this.startupTimeoutMs;
    while (!this.stopping && this.child === child && Date.now() < deadline) {
      if (await this.#isHealthy(origin, 2000)) {
        return this.#setStatus({ state: "ready", message: "内置 Voicebox 服务已就绪", error: "" });
      }
      await sleep(this.pollIntervalMs);
    }
    if (!this.stopping && this.child === child) {
      this.#setStatus({ state: "failed", message: "Voicebox 启动超时", error: "服务未在两分钟内通过健康检查" });
    }
    return this.getStatus();
  }

  async restart() {
    await this.shutdown();
    return this.start();
  }

  async shutdown() {
    this.stopping = true;
    const child = this.child;
    const origin = this.status.origin;
    this.child = null;
    if (child && origin) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1200);
      try {
        await this.fetch(`${origin}/shutdown`, {
          method: "POST",
          redirect: "error",
          signal: controller.signal,
          headers: { "x-voicebox-client-id": "clipport" },
        });
      } catch {
        // A forced child termination below is the fallback for an unresponsive server.
      } finally {
        clearTimeout(timeout);
      }
      if (!await waitForExit(child, 2500) && child.exitCode === null && !child.killed) child.kill?.();
      await waitForExit(child, 2500);
    }
    this.readyPromise = null;
    this.#setStatus({ state: "stopped", origin: "", message: "Voicebox 服务已停止", error: "" });
    this.stopping = false;
  }
}

module.exports = {
  EXTERNAL_DEV_ORIGIN,
  START_PORT,
  VoiceboxRuntimeManager,
  findAvailablePort,
  normalizeLoopbackOrigin,
  waitForExit,
};
