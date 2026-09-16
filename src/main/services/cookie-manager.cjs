const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { AppError } = require("./validators.cjs");

const PLATFORM_DEFINITIONS = Object.freeze({
  douyin: {
    id: "douyin",
    name: "抖音",
    domainLabel: "douyin.com",
    sourceDomains: ["douyin.com", "iesdouyin.com"],
    cookieDomains: ["douyin.com", "iesdouyin.com"],
    allowedNavigationDomains: ["douyin.com", "iesdouyin.com", "bytedance.com", "snssdk.com", "zijieapi.com"],
    loginUrl: "https://www.douyin.com/",
    requiredCookieGroups: [["sessionid", "sessionid_ss", "sid_guard"]],
  },
  bilibili: {
    id: "bilibili",
    name: "哔哩哔哩",
    domainLabel: "bilibili.com",
    sourceDomains: ["bilibili.com", "b23.tv"],
    cookieDomains: ["bilibili.com"],
    allowedNavigationDomains: ["bilibili.com", "hdslb.com"],
    loginUrl: "https://passport.bilibili.com/login",
    requiredCookieGroups: [["SESSDATA"]],
  },
  youtube: {
    id: "youtube",
    name: "YouTube",
    domainLabel: "youtube.com",
    sourceDomains: ["youtube.com", "youtu.be", "googlevideo.com"],
    cookieDomains: ["youtube.com", "google.com"],
    allowedNavigationDomains: ["youtube.com", "youtu.be", "google.com", "gstatic.com", "googleusercontent.com", "googleapis.com"],
    loginUrl: "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F",
    requiredCookieGroups: [["SAPISID", "__Secure-1PAPISID", "__Secure-3PAPISID"]],
  },
  xiaohongshu: {
    id: "xiaohongshu",
    name: "小红书",
    domainLabel: "xiaohongshu.com",
    sourceDomains: ["xiaohongshu.com", "xhslink.com"],
    cookieDomains: ["xiaohongshu.com"],
    allowedNavigationDomains: ["xiaohongshu.com", "xhscdn.com"],
    loginUrl: "https://www.xiaohongshu.com/explore",
    requiredCookieGroups: [["web_session"]],
  },
});

function normalizeDomain(value = "") {
  return String(value).replace(/^#HttpOnly_/, "").replace(/^\./, "").toLowerCase();
}

function domainMatches(hostname, domain) {
  const host = normalizeDomain(hostname);
  const target = normalizeDomain(domain);
  return host === target || host.endsWith(`.${target}`);
}

function assertPlatform(platformId) {
  const platform = PLATFORM_DEFINITIONS[platformId];
  if (!platform) throw new AppError("INVALID_PLATFORM", "不支持这个登录平台");
  return platform;
}

function detectPlatform(value) {
  try {
    const hostname = new URL(value).hostname;
    return Object.values(PLATFORM_DEFINITIONS).find((platform) => platform.sourceDomains.some((domain) => domainMatches(hostname, domain))) || null;
  } catch {
    return null;
  }
}

function relevantCookies(platform, cookies) {
  return cookies.filter((cookie) => platform.cookieDomains.some((domain) => domainMatches(cookie.domain, domain)));
}

function isFreshCookie(cookie, nowSeconds = Date.now() / 1000) {
  return !Number.isFinite(cookie.expirationDate) || cookie.expirationDate > nowSeconds;
}

function hasRequiredCookies(platform, cookies) {
  const freshNames = new Set(cookies.filter((cookie) => isFreshCookie(cookie)).map((cookie) => cookie.name));
  return platform.requiredCookieGroups.every((group) => group.some((name) => freshNames.has(name)));
}

function serializeNetscapeCookies(cookies) {
  const lines = ["# Netscape HTTP Cookie File", "# Generated temporarily by ClipPort. Do not share this file."];
  for (const cookie of cookies) {
    const rawDomain = String(cookie.domain || "");
    const cleanDomain = rawDomain.replace(/^#HttpOnly_/, "");
    if (!cleanDomain || /[\t\r\n]/.test(`${cookie.name}${cookie.value}${cleanDomain}${cookie.path || ""}`)) continue;
    const includeSubdomains = cleanDomain.startsWith(".") ? "TRUE" : "FALSE";
    const domain = cookie.httpOnly ? `#HttpOnly_${cleanDomain}` : cleanDomain;
    const expires = Number.isFinite(cookie.expirationDate) ? Math.max(0, Math.floor(cookie.expirationDate)) : 0;
    lines.push([
      domain,
      includeSubdomains,
      cookie.path || "/",
      cookie.secure ? "TRUE" : "FALSE",
      expires,
      cookie.name,
      cookie.value,
    ].join("\t"));
  }
  return `${lines.join("\r\n")}\r\n`;
}

class CookieManager {
  constructor({ sessionModule, BrowserWindow, store, userDataPath, getParentWindow, onStatus }) {
    this.sessionModule = sessionModule;
    this.BrowserWindow = BrowserWindow;
    this.store = store;
    this.userDataPath = userDataPath;
    this.getParentWindow = getParentWindow;
    this.onStatus = onStatus;
    this.loginWindows = new Map();
    this.loginBaselines = new Map();
    this.skipCloseValidation = new WeakSet();
    this.configuredSessions = new Set();
    this.temporaryDirectory = path.join(userDataPath, "auth-temp");
    this.#cleanupStaleCookieFiles();
  }

  #partition(platformId) {
    return `persist:clipport-auth-${platformId}`;
  }

  #getSession(platformId) {
    const authSession = this.sessionModule.fromPartition(this.#partition(platformId), { cache: true });
    if (!this.configuredSessions.has(platformId)) {
      authSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
      authSession.setPermissionCheckHandler(() => false);
      authSession.on("will-download", (event) => event.preventDefault());
      this.configuredSessions.add(platformId);
    }
    return authSession;
  }

  #cleanupStaleCookieFiles() {
    if (!fs.existsSync(this.temporaryDirectory)) return;
    for (const name of fs.readdirSync(this.temporaryDirectory)) {
      if (/^clipport-cookies-[a-z]+-[a-f0-9-]+\.txt$/i.test(name)) {
        try {
          fs.unlinkSync(path.join(this.temporaryDirectory, name));
        } catch {
          // A running process may still own the file; it will be retried next launch.
        }
      }
    }
  }

  #metadata(platformId) {
    return this.store.getAuthMetadata?.(platformId) || {};
  }

  #updateMetadata(platformId, patch) {
    return this.store.updateAuthMetadata?.(platformId, patch) || patch;
  }

  #navigationAllowed(platform, targetUrl) {
    if (targetUrl === "about:blank") return true;
    try {
      const parsed = new URL(targetUrl);
      return parsed.protocol === "https:" && platform.allowedNavigationDomains.some((domain) => domainMatches(parsed.hostname, domain));
    } catch {
      return false;
    }
  }

  async #cookies(platform) {
    const cookies = await this.#getSession(platform.id).cookies.get({});
    return relevantCookies(platform, cookies);
  }

  #cookieFingerprint(cookies) {
    const normalized = cookies
      .map((cookie) => [cookie.domain, cookie.path, cookie.name, cookie.value, cookie.expirationDate || 0].join("\t"))
      .sort()
      .join("\n");
    return crypto.createHash("sha256").update(normalized).digest("hex");
  }

  async getStatus(platformId) {
    const platform = assertPlatform(platformId);
    const cookies = await this.#cookies(platform);
    const metadata = this.#metadata(platformId);
    const freshCookies = cookies.filter((cookie) => isFreshCookie(cookie));
    const hasCredentials = hasRequiredCookies(platform, cookies);
    const rejectedAfterVerification = metadata.lastRejectedAt
      && (!metadata.lastVerifiedAt || metadata.lastRejectedAt >= metadata.lastVerifiedAt);
    const expirationDates = freshCookies.map((cookie) => cookie.expirationDate).filter(Number.isFinite);
    const expiresAt = expirationDates.length ? new Date(Math.min(...expirationDates) * 1000).toISOString() : "";

    let status = "not_connected";
    let message = "未检测到登录状态";
    if (cookies.length && !hasCredentials) {
      status = "invalid";
      message = "Cookie 不完整，请重新登录";
    } else if (hasCredentials && rejectedAfterVerification) {
      status = "invalid";
      message = "最近一次解析未通过平台验证";
    } else if (hasCredentials && metadata.lastVerifiedAt) {
      status = "valid";
      message = "已通过真实解析验证";
    } else if (hasCredentials) {
      status = "ready";
      message = "本地校验通过，解析时在线复检";
    }

    if (this.loginWindows.has(platformId)) {
      status = "login_open";
      message = "登录窗口已打开";
    }

    return {
      id: platform.id,
      name: platform.name,
      domain: platform.domainLabel,
      status,
      message,
      cookieCount: freshCookies.length,
      expiresAt,
      lastCheckedAt: metadata.lastCheckedAt || "",
      lastVerifiedAt: metadata.lastVerifiedAt || "",
    };
  }

  async list() {
    return Promise.all(Object.keys(PLATFORM_DEFINITIONS).map((platformId) => this.getStatus(platformId)));
  }

  async #emit(platformId) {
    const status = await this.getStatus(platformId);
    this.onStatus?.(status);
    return status;
  }

  async openLogin(platformId) {
    const platform = assertPlatform(platformId);
    const existing = this.loginWindows.get(platformId);
    if (existing && !existing.isDestroyed()) {
      existing.show();
      existing.focus();
      return this.getStatus(platformId);
    }

    const authSession = this.#getSession(platformId);
    this.loginBaselines.set(platformId, this.#cookieFingerprint(await this.#cookies(platform)));
    const loginWindow = new this.BrowserWindow({
      width: 1080,
      height: 760,
      minWidth: 760,
      minHeight: 560,
      title: `${platform.name}登录 - ClipPort`,
      parent: this.getParentWindow?.() || undefined,
      modal: false,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: "#ffffff",
      webPreferences: {
        session: authSession,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        devTools: false,
        navigateOnDragDrop: false,
      },
    });
    this.loginWindows.set(platformId, loginWindow);

    const guardNavigation = (event, targetUrl) => {
      if (!this.#navigationAllowed(platform, targetUrl)) event.preventDefault();
    };
    loginWindow.webContents.on("will-navigate", guardNavigation);
    loginWindow.webContents.on("will-redirect", guardNavigation);
    loginWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (this.#navigationAllowed(platform, url)) loginWindow.loadURL(url).catch(() => {});
      return { action: "deny" };
    });
    loginWindow.once("ready-to-show", () => loginWindow.show());
    loginWindow.once("closed", async () => {
      this.loginWindows.delete(platformId);
      if (this.skipCloseValidation.has(loginWindow)) {
        this.loginBaselines.delete(platformId);
        return;
      }
      const localStatus = await this.getStatus(platformId);
      const currentFingerprint = this.#cookieFingerprint(await this.#cookies(platform));
      const cookiesChanged = currentFingerprint !== this.loginBaselines.get(platformId);
      this.loginBaselines.delete(platformId);
      const now = new Date().toISOString();
      this.#updateMetadata(platformId, {
        lastCheckedAt: now,
        lastRejectedAt: localStatus.cookieCount > 0 && cookiesChanged ? "" : this.#metadata(platformId).lastRejectedAt || "",
        lastVerifiedAt: cookiesChanged ? "" : this.#metadata(platformId).lastVerifiedAt || "",
      });
      await this.#emit(platformId);
    });

    try {
      await loginWindow.loadURL(platform.loginUrl);
    } catch (error) {
      this.loginWindows.delete(platformId);
      this.loginBaselines.delete(platformId);
      this.skipCloseValidation.add(loginWindow);
      if (!loginWindow.isDestroyed()) loginWindow.destroy();
      throw new AppError("LOGIN_PAGE_FAILED", `无法打开 ${platform.name} 登录页面`, error.message);
    }
    return this.#emit(platformId);
  }

  async validate(platformId) {
    assertPlatform(platformId);
    this.#updateMetadata(platformId, { lastCheckedAt: new Date().toISOString() });
    return this.#emit(platformId);
  }

  async clear(platformId) {
    assertPlatform(platformId);
    const loginWindow = this.loginWindows.get(platformId);
    if (loginWindow && !loginWindow.isDestroyed()) {
      this.skipCloseValidation.add(loginWindow);
      loginWindow.close();
    }
    const authSession = this.#getSession(platformId);
    await authSession.clearStorageData({ storages: ["cookies", "localstorage", "indexdb", "serviceworkers", "cachestorage"] });
    await authSession.clearCache();
    this.store.clearAuthMetadata?.(platformId);
    return this.#emit(platformId);
  }

  async createAuthContext(rawUrl) {
    const platform = detectPlatform(rawUrl);
    if (!platform) return null;
    const cookies = await this.#cookies(platform);
    if (!hasRequiredCookies(platform, cookies)) return null;

    fs.mkdirSync(this.temporaryDirectory, { recursive: true });
    const cookieFile = path.join(this.temporaryDirectory, `clipport-cookies-${platform.id}-${crypto.randomUUID()}.txt`);
    fs.writeFileSync(cookieFile, serializeNetscapeCookies(cookies), { encoding: "utf8", flag: "wx", mode: 0o600 });
    let cleaned = false;
    return {
      platformId: platform.id,
      cookieFile,
      userAgent: this.#getSession(platform.id).getUserAgent(),
      cleanup: () => {
        if (cleaned) return;
        cleaned = true;
        try {
          fs.unlinkSync(cookieFile);
        } catch {
          // The startup sweep removes leftovers after a crash or locked process.
        }
      },
    };
  }

  async markAccepted(rawUrl) {
    const platform = detectPlatform(rawUrl);
    if (!platform) return null;
    const now = new Date().toISOString();
    this.#updateMetadata(platform.id, { lastCheckedAt: now, lastVerifiedAt: now, lastRejectedAt: "" });
    return this.#emit(platform.id);
  }

  async markRejected(rawUrl) {
    const platform = detectPlatform(rawUrl);
    if (!platform) return null;
    const now = new Date().toISOString();
    this.#updateMetadata(platform.id, { lastCheckedAt: now, lastRejectedAt: now });
    return this.#emit(platform.id);
  }

  shutdown() {
    for (const loginWindow of this.loginWindows.values()) {
      if (!loginWindow.isDestroyed()) {
        this.skipCloseValidation.add(loginWindow);
        loginWindow.destroy();
      }
    }
    this.loginWindows.clear();
    this.loginBaselines.clear();
  }
}

module.exports = {
  CookieManager,
  PLATFORM_DEFINITIONS,
  detectPlatform,
  domainMatches,
  hasRequiredCookies,
  relevantCookies,
  serializeNetscapeCookies,
};
