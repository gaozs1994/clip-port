(() => {
  "use strict";

  const PRESETS = {
    recommended: { label: "推荐视频", detail: "最高 1440p", tab: "video" },
    best: { label: "原始最佳", detail: "最高可用质量", tab: "video" },
    mp4: { label: "兼容 MP4", detail: "最高 1080p", tab: "video" },
    audio: { label: "仅音频", detail: "原始音质", tab: "audio" },
    mp3: { label: "MP3 音频", detail: "320K", tab: "audio" },
    subtitles: { label: "仅字幕", detail: "全部语言", tab: "subtitle" },
  };
  const AUTH_PLATFORM_UI = {
    douyin: { src: "./assets/platforms/douyin.jpg" },
    bilibili: { src: "./assets/platforms/bilibili.svg" },
    youtube: { src: "./assets/platforms/youtube.png" },
    xiaohongshu: { src: "./assets/platforms/xiaohongshu.png" },
  };
  const AUTH_STATUS_LABELS = {
    not_connected: "未登录",
    login_open: "等待登录",
    ready: "已就绪",
    valid: "有效",
    invalid: "已失效",
  };
  const LICENSE_STATUS_LABELS = {
    unlicensed: "未授权",
    active: "已授权",
    expired: "已过期",
    invalid: "授权无效",
    device_mismatch: "设备不匹配",
    unavailable: "设备码不可用",
    development: "开发模式",
  };
  const ACTIVE_STATES = new Set(["preparing", "downloading", "processing", "verifying", "pausing", "canceling"]);
  const state = {
    appVersion: "--",
    view: "download",
    settings: { downloadDirectory: "", concurrency: 2, theme: "dark" },
    toolchain: null,
    media: null,
    tasks: [],
    history: [],
    authPlatforms: [],
    updateStatus: { status: "idle", currentVersion: "--", latestVersion: "", progress: null, message: "启动后自动检查更新" },
    licenseStatus: { status: "unlicensed", active: false, hasLicense: false, deviceCode: "", message: "正在读取设备授权状态" },
    preset: "recommended",
    taskFilter: "all",
    parsing: false,
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const icon = (name) => {
    const node = document.createElement("i");
    node.dataset.lucide = name;
    return node;
  };
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const append = (parent, ...children) => {
    for (const child of children) if (child !== null && child !== undefined) parent.append(child);
    return parent;
  };
  const refreshIcons = () => window.lucide?.createIcons({ attrs: { "aria-hidden": "true" } });
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function extractPreviewUrl(value) {
    if (typeof value !== "string") return "";
    const index = value.search(/https?:\/\//i);
    if (index < 0) return "";
    const remainder = value.slice(index);
    const delimiter = remainder.search(/[\s<>"'`()\[\]{}【】（）《》，。！？；：、…]/u);
    return remainder
      .slice(0, delimiter < 0 ? remainder.length : delimiter)
      .replace(/[.,!?;:，。！？；：、]+$/u, "");
  }

  function ok(data) {
    return Promise.resolve({ ok: true, data });
  }

  function createDemoApi() {
    const listeners = { task: new Set(), history: new Set(), tool: new Set(), auth: new Set(), update: new Set(), license: new Set() };
    const demoSettings = { downloadDirectory: "C:\\Users\\Public\\Downloads\\ClipPort", concurrency: 2, theme: "dark", toolPaths: {} };
    const demoTools = {
      ready: true,
      tools: {
        ytDlp: { available: true, version: "2026.09.12", source: "ClipPort 管理", path: "yt-dlp.exe" },
        ffmpeg: { available: true, version: "8.0-static", source: "应用内置", path: "ffmpeg.exe" },
        ffprobe: { available: true, version: "8.0-static", source: "应用内置", path: "ffprobe.exe" },
      },
    };
    const demoTasks = [];
    const demoHistory = [];
    const demoAuthPlatforms = [
      { id: "douyin", name: "抖音", domain: "douyin.com", status: "ready", message: "本地校验通过，解析时在线复检", cookieCount: 8, expiresAt: "2026-10-16T08:00:00.000Z", lastCheckedAt: new Date().toISOString(), lastVerifiedAt: "" },
      { id: "bilibili", name: "哔哩哔哩", domain: "bilibili.com", status: "valid", message: "已通过真实解析验证", cookieCount: 6, expiresAt: "2026-12-01T08:00:00.000Z", lastCheckedAt: new Date().toISOString(), lastVerifiedAt: new Date().toISOString() },
      { id: "youtube", name: "YouTube", domain: "youtube.com", status: "not_connected", message: "未检测到登录状态", cookieCount: 0, expiresAt: "", lastCheckedAt: "", lastVerifiedAt: "" },
      { id: "xiaohongshu", name: "小红书", domain: "xiaohongshu.com", status: "invalid", message: "Cookie 不完整，请重新登录", cookieCount: 2, expiresAt: "", lastCheckedAt: new Date().toISOString(), lastVerifiedAt: "" },
    ];
    let demoUpdateStatus = { status: "idle", currentVersion: "0.1.0-preview", latestVersion: "", progress: null, message: "可手动检查更新" };
    const demoIssuedAt = new Date();
    const demoExpiresAt = new Date(demoIssuedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    let demoLicenseStatus = { status: "active", active: true, hasLicense: true, deviceCode: "CPD1-DEMO-0000-0000-0000-0000-0000-0000", licenseId: "preview-license", holder: "预览用户", issuedAt: demoIssuedAt.toISOString(), expiresAt: demoExpiresAt.toISOString(), message: "设备已授权" };
    let timer = null;

    const emitTask = (task) => listeners.task.forEach((callback) => callback(structuredClone(task)));
    const emitAuth = (platform) => listeners.auth.forEach((callback) => callback(structuredClone(platform)));
    const emitUpdate = () => listeners.update.forEach((callback) => callback(structuredClone(demoUpdateStatus)));
    const emitLicense = () => listeners.license.forEach((callback) => callback(structuredClone(demoLicenseStatus)));
    const findDemoAuth = (platformId) => demoAuthPlatforms.find((platform) => platform.id === platformId);
    const progressDemo = (task) => {
      if (timer) clearInterval(timer);
      timer = setInterval(() => {
        if (!ACTIVE_STATES.has(task.state)) return;
        const percent = Math.min(100, (task.progress.percent || 0) + 2.4);
        task.state = percent >= 100 ? "completed" : "downloading";
        task.stage = percent >= 100 ? "下载完成" : "正在下载";
        task.progress = { percent, downloadedBytes: percent * 12_000_000, totalBytes: 1_200_000_000, speed: percent >= 100 ? null : 12_800_000, eta: Math.max(0, Math.round((100 - percent) / 2.4)) };
        if (percent >= 100) {
          clearInterval(timer);
          timer = null;
          task.finalOutputs = ["C:\\Users\\Public\\Downloads\\ClipPort\\demo.mp4"];
          const entry = { id: crypto.randomUUID(), taskId: task.id, title: task.media.title, uploader: task.media.uploader, extractor: task.media.extractor, result: "completed", completedAt: new Date().toISOString(), outputs: task.finalOutputs, options: task.options, probe: { format: { size: "1200000000" } } };
          demoHistory.unshift(entry);
          listeners.history.forEach((callback) => callback(structuredClone(entry)));
        }
        emitTask(task);
      }, 700);
    };

    return {
      app: {
        bootstrap: () => ok({ appVersion: "0.1.0-preview", platform: "browser", settings: demoSettings, tasks: demoTasks, history: demoHistory, toolchain: demoTools, authPlatforms: demoAuthPlatforms, updateStatus: demoUpdateStatus, licenseStatus: demoLicenseStatus }),
        minimize: () => {}, toggleMaximize: () => {}, close: () => {},
      },
      clipboard: { readText: async () => ({ ok: true, data: await navigator.clipboard?.readText().catch(() => "") || "" }) },
      media: {
        parse: async (url) => {
          await sleep(650);
          const resolvedUrl = extractPreviewUrl(url);
          if (!resolvedUrl) return { ok: false, error: { code: "INVALID_URL", message: "未识别到以 http 或 https 开头的媒体链接" } };
          return { ok: true, data: { id: "clipport-preview", title: "沿着北纬 68°：峡湾、公路与极昼", uploader: "Northbound Studio", extractor: "Web video", duration: 1122, uploadDate: "20260824", webpageUrl: resolvedUrl, resolvedUrl, liveStatus: "not_live", thumbnailDataUrl: "", best: { height: 2160, fps: 60, container: "webm", estimatedBytes: 1840000000 }, availableHeights: [2160, 1440, 1080, 720], subtitleLanguages: ["zh-Hans", "en"], hasManualSubtitles: true, hasAutomaticSubtitles: true } };
        },
        cancelParse: () => ok(true),
      },
      tasks: {
        create: (payload) => {
          const task = { id: crypto.randomUUID(), state: "downloading", stage: "正在下载", progress: { percent: 8, downloadedBytes: 96_000_000, totalBytes: 1_200_000_000, speed: 12_800_000, eta: 43 }, media: payload.media, options: payload.options, outputRoot: payload.outputRoot, finalOutputs: [], error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
          demoTasks.unshift(task); emitTask(task); progressDemo(task); return ok(task);
        },
        pause: (id) => { const task = demoTasks.find((item) => item.id === id); if (task) { task.state = "paused"; task.stage = "已暂停，可继续下载"; emitTask(task); } return ok(task); },
        resume: (id) => { const task = demoTasks.find((item) => item.id === id); if (task) { task.state = "downloading"; task.stage = "正在下载"; emitTask(task); progressDemo(task); } return ok(task); },
        cancel: (id) => { const task = demoTasks.find((item) => item.id === id); if (task) { task.state = "canceled"; task.stage = "已取消"; emitTask(task); } return ok(task); },
        remove: (id) => { const index = demoTasks.findIndex((item) => item.id === id); if (index >= 0) demoTasks.splice(index, 1); emitTask({ id, removed: true }); return ok(true); },
      },
      settings: {
        update: (patch) => { Object.assign(demoSettings, patch); return ok({ settings: structuredClone(demoSettings), toolchain: demoTools }); },
        chooseDownloadDirectory: () => ok(structuredClone(demoSettings)),
      },
      tools: { status: () => ok(demoTools), installYtDlp: () => ok(demoTools), chooseBinary: () => ok(demoTools) },
      auth: {
        list: () => ok(structuredClone(demoAuthPlatforms)),
        openLogin: async (platformId) => {
          const platform = findDemoAuth(platformId);
          platform.status = "login_open"; platform.message = "登录窗口已打开"; emitAuth(platform);
          await sleep(350);
          platform.status = "ready"; platform.message = "本地校验通过，解析时在线复检"; platform.cookieCount = 8; platform.lastCheckedAt = new Date().toISOString(); emitAuth(platform);
          return { ok: true, data: structuredClone(platform) };
        },
        validate: async (platformId) => {
          await sleep(300);
          const platform = findDemoAuth(platformId);
          if (platform.cookieCount) { platform.status = "valid"; platform.message = "已通过真实解析验证"; platform.lastVerifiedAt = new Date().toISOString(); }
          platform.lastCheckedAt = new Date().toISOString(); emitAuth(platform);
          return { ok: true, data: structuredClone(platform) };
        },
        clear: (platformId) => {
          const platform = findDemoAuth(platformId);
          Object.assign(platform, { status: "not_connected", message: "未检测到登录状态", cookieCount: 0, expiresAt: "", lastCheckedAt: new Date().toISOString(), lastVerifiedAt: "" }); emitAuth(platform);
          return ok(structuredClone(platform));
        },
      },
      updates: {
        status: () => ok(structuredClone(demoUpdateStatus)),
        check: async () => {
          demoUpdateStatus = { ...demoUpdateStatus, status: "checking", message: "正在检查新版本" }; emitUpdate(); await sleep(450);
          demoUpdateStatus = { ...demoUpdateStatus, status: "current", message: "已是最新版本" }; emitUpdate(); return ok(structuredClone(demoUpdateStatus));
        },
        download: () => ok(structuredClone(demoUpdateStatus)),
        install: () => ok(false),
      },
      license: {
        status: () => ok(structuredClone(demoLicenseStatus)),
        copyDeviceCode: () => ok(true),
        activate: async (code) => {
          await sleep(300);
          if (!String(code || "").startsWith("CPL1.")) return { ok: false, error: { code: "LICENSE_INVALID", message: "授权码格式不正确" } };
          demoLicenseStatus = { ...demoLicenseStatus, status: "active", active: true, hasLicense: true, holder: "预览用户", expiresAt: "", message: "设备已永久授权" };
          emitLicense(); return ok(structuredClone(demoLicenseStatus));
        },
        clear: () => { demoLicenseStatus = { ...demoLicenseStatus, status: "unlicensed", active: false, hasLicense: false, licenseId: "", holder: "", issuedAt: "", expiresAt: "", message: "尚未绑定授权码" }; emitLicense(); return ok(structuredClone(demoLicenseStatus)); },
      },
      files: { open: () => ok(true), reveal: () => ok(true), openDownloadDirectory: () => ok(true) },
      events: {
        onTaskChanged: (callback) => { listeners.task.add(callback); return () => listeners.task.delete(callback); },
        onHistoryChanged: (callback) => { listeners.history.add(callback); return () => listeners.history.delete(callback); },
        onToolStatus: (callback) => { listeners.tool.add(callback); return () => listeners.tool.delete(callback); },
        onAuthChanged: (callback) => { listeners.auth.add(callback); return () => listeners.auth.delete(callback); },
        onUpdateStatus: (callback) => { listeners.update.add(callback); return () => listeners.update.delete(callback); },
        onLicenseStatus: (callback) => { listeners.license.add(callback); return () => listeners.license.delete(callback); },
      },
    };
  }

  const api = window.clipport || createDemoApi();

  async function call(resultPromise) {
    const result = await resultPromise;
    if (!result?.ok) {
      const error = new Error(result?.error?.message || "操作失败");
      Object.assign(error, result?.error || {});
      throw error;
    }
    return result.data;
  }

  function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) return "--";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const amount = bytes / 1024 ** index;
    return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remaining = Math.floor(seconds % 60);
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}` : `${minutes}:${String(remaining).padStart(2, "0")}`;
  }

  function formatDate(value) {
    if (!value) return "未知时间";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "未知时间";
    return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function formatLicenseDate(value, includeTime = false) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "未知时间";
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    }).format(date);
  }

  function compactVersion(value) {
    if (!value) return "不可用";
    return String(value).split(/\s+/).slice(0, 2).join(" ").slice(0, 28);
  }

  function applyTheme(theme = state.settings.theme) {
    const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.body.dataset.theme = dark ? "dark" : "light";
    const button = $("#themeToggle");
    button.replaceChildren(icon(dark ? "sun" : "moon"));
    button.setAttribute("aria-label", dark ? "切换浅色主题" : "切换深色主题");
    button.title = dark ? "切换浅色主题" : "切换深色主题";
    refreshIcons();
  }

  function showToast(title, message = "", type = "success") {
    const toast = $("#toast");
    toast.classList.toggle("error", type === "error");
    $("#toastTitle").textContent = title;
    $("#toastMessage").textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 3600);
  }

  function showView(view) {
    state.view = ["download", "tasks", "history", "settings"].includes(view) ? view : "download";
    $$("[data-view]").forEach((section) => {
      const active = section.dataset.view === state.view;
      section.hidden = !active;
      section.classList.toggle("active", active);
    });
    $$(".nav-item").forEach((button) => {
      const active = button.dataset.nav === state.view;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
    });
    history.replaceState(null, "", `#${state.view}`);
    $("#workspace").scrollTop = 0;
  }

  function activateSettingsSection(sectionId, behavior = "smooth") {
    $$(`[data-settings-anchor]`).forEach((button) => button.classList.toggle("active", button.dataset.settingsAnchor === sectionId));
    $(`#${sectionId}`)?.scrollIntoView({ behavior, block: "start" });
  }

  function focusLicenseSettings() {
    const section = $("#licenseSettings");
    showView("settings");
    activateSettingsSection("licenseSettings", "auto");
    section.classList.remove("is-targeted");
    requestAnimationFrame(() => {
      section.classList.add("is-targeted");
      $("#licenseCode").focus({ preventScroll: true });
      clearTimeout(focusLicenseSettings.timer);
      focusLicenseSettings.timer = setTimeout(() => section.classList.remove("is-targeted"), 1800);
    });
  }

  function renderMedia() {
    const media = state.media;
    $("#resultPanel").hidden = !media;
    $("#downloadBar").hidden = !media;
    if (!media) return;
    $("#mediaDuration").textContent = formatDuration(media.duration);
    $("#mediaExtractor").textContent = String(media.extractor || "MEDIA").toUpperCase().slice(0, 16);
    $("#mediaCreator").textContent = media.uploader || "未知来源";
    $("#mediaTitle").textContent = media.title || "未命名媒体";
    const date = /^\d{8}$/.test(media.uploadDate || "") ? `${media.uploadDate.slice(0, 4)}-${media.uploadDate.slice(4, 6)}-${media.uploadDate.slice(6, 8)}` : "发布日期未知";
    $("#mediaDescription").textContent = `${date} · ${media.best?.container?.toUpperCase() || "格式未知"}`;
    $("#mediaQuality").textContent = media.best?.height ? `${media.best.height}p${media.best.fps ? ` · ${media.best.fps}fps` : ""}` : "未知";
    $("#mediaSubtitles").textContent = media.subtitleLanguages?.length ? media.subtitleLanguages.slice(0, 4).join("、") : "无可用字幕";
    $("#mediaSize").textContent = media.best?.estimatedBytes ? `约 ${formatBytes(media.best.estimatedBytes)}` : "由下载格式决定";
    const frame = $("#mediaThumbnail");
    frame.querySelector("img")?.remove();
    const placeholder = $(".thumbnail-placeholder", frame);
    if (media.thumbnailDataUrl) {
      const image = document.createElement("img");
      image.src = media.thumbnailDataUrl;
      image.alt = `${media.title} 封面`;
      image.addEventListener("error", () => { image.remove(); placeholder.hidden = false; });
      frame.prepend(image);
      placeholder.hidden = true;
    } else {
      placeholder.hidden = false;
    }
    $("#downloadDestination").textContent = state.settings.downloadDirectory;
    refreshIcons();
  }

  function selectPreset(preset) {
    if (!PRESETS[preset]) return;
    state.preset = preset;
    $$("[data-preset]").forEach((button) => {
      const selected = button.dataset.preset === preset;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-checked", String(selected));
    });
    $("#selectedPreset").textContent = PRESETS[preset].label;
    $("#selectedQuality").textContent = PRESETS[preset].detail;
    if (preset === "recommended") $("#resolutionSelect").value = "1440";
    if (preset === "mp4") $("#resolutionSelect").value = "1080";
    selectOptionTab(PRESETS[preset].tab);
  }

  function selectOptionTab(tab) {
    $$("[data-option-tab]").forEach((button) => {
      const active = button.dataset.optionTab === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    $$("[data-option-panel]").forEach((panel) => {
      const active = panel.dataset.optionPanel === tab;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    });
  }

  function renderToolchain() {
    const status = state.toolchain;
    if (!status) return;
    const { ytDlp, ffmpeg, ffprobe } = status.tools;
    $("#sideYtDlpVersion").textContent = compactVersion(ytDlp.version);
    $("#ytDlpStatus").textContent = ytDlp.available ? `${compactVersion(ytDlp.version)} · ${ytDlp.source}` : "未安装，需要安装或选择文件";
    $("#ffmpegStatus").textContent = ffmpeg.available ? `${compactVersion(ffmpeg.version)} · ${ffmpeg.source}` : "不可用，请选择可执行文件";
    $("#ffprobeStatus").textContent = ffprobe.available ? `${compactVersion(ffprobe.version)} · ${ffprobe.source}` : "不可用，请选择可执行文件";
    $("#toolchainAlert").hidden = status.ready;
    $("#allToolsReady").hidden = !status.ready;
    const dot = $("#engineStatusDot");
    dot.className = `status-dot${status.ready ? "" : " error"}`;
    dot.setAttribute("aria-label", status.ready ? "工具链可用" : "工具链不可用");
  }

  function taskCounts() {
    return {
      all: state.tasks.length,
      active: state.tasks.filter((task) => ACTIVE_STATES.has(task.state)).length,
      queued: state.tasks.filter((task) => task.state === "queued").length,
      failed: state.tasks.filter((task) => task.state === "failed").length,
      completed: state.tasks.filter((task) => task.state === "completed" || task.state === "partial").length,
    };
  }

  function filterMatches(task) {
    if (state.taskFilter === "all") return true;
    if (state.taskFilter === "active") return ACTIVE_STATES.has(task.state);
    return task.state === state.taskFilter;
  }

  function stateLabel(task) {
    const labels = { queued: "等待中", preparing: "准备中", downloading: "下载中", processing: "处理中", verifying: "校验中", pausing: "正在暂停", paused: "已暂停", canceling: "正在取消", canceled: "已取消", completed: "已完成", partial: "部分完成", failed: "失败", interrupted: "已中断" };
    return labels[task.state] || task.stage || task.state;
  }

  function createIconButton(name, title, action, taskId, className = "") {
    const button = element("button", `icon-button bordered ${className}`.trim());
    button.type = "button";
    button.title = title;
    button.setAttribute("aria-label", title);
    button.dataset.taskAction = action;
    button.dataset.taskId = taskId;
    button.append(icon(name));
    return button;
  }

  function createTaskRow(task) {
    const row = element("article", "task-row");
    row.dataset.state = task.state;
    row.dataset.taskId = task.id;
    const nameCell = element("div", "task-name-cell");
    const typeIcon = element("span", `file-type ${["audio", "mp3"].includes(task.options?.preset) ? "blue" : ""}`);
    typeIcon.append(icon(["audio", "mp3"].includes(task.options?.preset) ? "music-2" : task.options?.preset === "subtitles" ? "captions" : "file-video-2"));
    const title = element("span");
    append(title, element("strong", "", task.media?.title || "未命名任务"), element("small", "", `${PRESETS[task.options?.preset]?.label || "媒体"} · ${formatDuration(task.media?.duration)}`));
    append(nameCell, typeIcon, title);

    const statusCell = element("div", "task-status-cell");
    const statusLine = element("div");
    const percent = Number(task.progress?.percent) || 0;
    append(statusLine, element("span", task.state === "failed" ? "status-error" : "", `${stateLabel(task)}${task.state === "downloading" ? ` · ${percent.toFixed(0)}%` : ""}`), element("span", "", ACTIVE_STATES.has(task.state) && task.progress?.speed ? `${formatBytes(task.progress.speed)}/s` : task.stage || ""));
    const progress = element("div", `progress-track${task.state === "processing" || task.state === "verifying" ? " processing" : ""}`);
    const value = element("span");
    if (!progress.classList.contains("processing")) value.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    progress.append(value);
    append(statusCell, statusLine, progress);
    if (task.error?.message) statusCell.append(element("small", "", task.error.message));

    const sizeCell = element("div", "task-size-cell");
    append(sizeCell, element("strong", "", formatBytes(task.progress?.downloadedBytes)), element("small", "", task.progress?.totalBytes ? `共 ${formatBytes(task.progress.totalBytes)}` : task.progress?.eta ? `约 ${task.progress.eta} 秒` : "大小未知"));
    const actions = element("div", "task-actions-cell");
    if (ACTIVE_STATES.has(task.state)) actions.append(createIconButton("pause", "暂停任务", "pause", task.id));
    if (["paused", "failed", "interrupted"].includes(task.state)) actions.append(createIconButton("play", "继续任务", "resume", task.id));
    if (task.state === "completed" && task.finalOutputs?.length) actions.append(createIconButton("play", "打开文件", "open", task.id));
    if (["queued", "paused", ...ACTIVE_STATES].includes(task.state)) actions.append(createIconButton("x", "取消任务", "cancel", task.id, "danger-hover"));
    else actions.append(createIconButton("trash-2", "移除任务", "remove", task.id, "danger-hover"));
    append(row, nameCell, statusCell, sizeCell, actions);
    return row;
  }

  function renderTasks() {
    const counts = taskCounts();
    const liveSpeed = state.tasks.reduce((sum, task) => sum + (ACTIVE_STATES.has(task.state) ? Number(task.progress?.speed) || 0 : 0), 0);
    $("#metricActive").textContent = counts.active;
    $("#metricQueued").textContent = counts.queued;
    $("#metricCompleted").textContent = counts.completed;
    $("#metricSpeed").textContent = liveSpeed ? `${formatBytes(liveSpeed)}/s` : "0 B/s";
    $("#queueSpeed").textContent = liveSpeed ? `${formatBytes(liveSpeed)}/s` : "0 B/s";
    $("#queueState").textContent = counts.active ? "运行中" : counts.queued ? "等待中" : "空闲";
    $("#navTaskCount").textContent = counts.active + counts.queued;
    $("#navTaskCount").hidden = counts.active + counts.queued === 0;
    $$("[data-task-filter]").forEach((button) => {
      const active = button.dataset.taskFilter === state.taskFilter;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      $("span", button).textContent = counts[button.dataset.taskFilter] ?? 0;
    });
    const table = $("#taskTable");
    $$(".task-row", table).forEach((node) => node.remove());
    const visible = state.tasks.filter(filterMatches);
    $("#taskEmpty").hidden = visible.length > 0;
    visible.forEach((task) => table.append(createTaskRow(task)));
    renderQueue();
    refreshIcons();
  }

  function createQueueTask(task) {
    const row = element("article", "queue-task");
    row.dataset.state = task.state;
    const head = element("div", "queue-task-head");
    const thumb = element("span", `mini-thumb graphic-thumb ${["audio", "mp3"].includes(task.options?.preset) ? "navy" : ""}`);
    thumb.append(icon(["audio", "mp3"].includes(task.options?.preset) ? "music-2" : "download"));
    const copy = element("span", "queue-task-copy");
    append(copy, element("strong", "", task.media?.title || "未命名任务"), element("small", "", `${stateLabel(task)}${task.progress?.speed ? ` · ${formatBytes(task.progress.speed)}/s` : ""}`));
    const action = ACTIVE_STATES.has(task.state) ? createIconButton("pause", "暂停任务", "pause", task.id) : task.state === "paused" ? createIconButton("play", "继续任务", "resume", task.id) : createIconButton("x", "取消任务", "cancel", task.id);
    action.classList.remove("bordered");
    append(head, thumb, copy, action);
    const meta = element("div", "progress-meta");
    append(meta, element("span", "", `${Math.round(task.progress?.percent || 0)}%`), element("span", "", task.progress?.totalBytes ? `${formatBytes(task.progress.downloadedBytes)} / ${formatBytes(task.progress.totalBytes)}` : task.stage || "等待中"));
    const track = element("div", `progress-track${task.state === "processing" || task.state === "verifying" ? " processing" : ""}`);
    const value = element("span"); value.style.width = `${Math.max(0, Math.min(100, task.progress?.percent || 0))}%`; track.append(value);
    append(row, head, meta, track);
    return row;
  }

  function renderQueue() {
    const tasks = state.tasks.filter((task) => ACTIVE_STATES.has(task.state) || task.state === "queued" || task.state === "paused");
    $("#queueCount").textContent = tasks.length;
    const list = $("#queueList");
    list.replaceChildren();
    if (!tasks.length) {
      const empty = element("div", "empty-state compact");
      append(empty, icon("layers-3"), element("span", "", "暂无活动任务"));
      list.append(empty);
    } else tasks.slice(0, 6).forEach((task) => list.append(createQueueTask(task)));
  }

  function historySize(entry) {
    const size = Number(entry.probe?.format?.size);
    return Number.isFinite(size) ? formatBytes(size) : "大小未知";
  }

  function createHistoryRow(entry) {
    const row = element("article", "history-row");
    const thumb = element("span", `history-thumb graphic-thumb ${["audio", "mp3"].includes(entry.options?.preset) ? "navy" : ""}`);
    thumb.append(icon(["audio", "mp3"].includes(entry.options?.preset) ? "music-2" : entry.options?.preset === "subtitles" ? "captions" : "file-video-2"));
    const main = element("div", "history-main"); append(main, element("strong", "", entry.title || "未命名媒体"), element("span", "", `${entry.uploader || "未知来源"} · ${formatDate(entry.completedAt)}`));
    const format = element("div", "history-format"); append(format, element("strong", "", PRESETS[entry.options?.preset]?.label || "媒体"), element("span", "", historySize(entry)));
    const status = element("span", "completed-state"); append(status, icon(entry.result === "completed" ? "circle-check" : "circle-alert"), document.createTextNode(entry.result === "completed" ? "已完成" : "部分完成"));
    const actions = element("div", "history-actions");
    const open = element("button", "secondary-button compact"); open.type = "button"; open.dataset.historyAction = "open"; open.dataset.historyId = entry.id; append(open, icon("play"), element("span", "", "打开"));
    const reveal = createIconButton("folder-open", "打开所在目录", "", ""); delete reveal.dataset.taskAction; delete reveal.dataset.taskId; reveal.dataset.historyAction = "reveal"; reveal.dataset.historyId = entry.id;
    append(actions, open, reveal); append(row, thumb, main, format, status, actions);
    return row;
  }

  function renderHistory() {
    const query = $("#historySearch").value.trim().toLocaleLowerCase();
    const entries = state.history.filter((entry) => `${entry.title || ""} ${entry.uploader || ""} ${entry.extractor || ""}`.toLocaleLowerCase().includes(query));
    const list = $("#historyList"); list.replaceChildren(); entries.forEach((entry) => list.append(createHistoryRow(entry)));
    const empty = $("#historyEmpty"); empty.hidden = entries.length > 0;
    $("strong", empty).textContent = query ? "没有匹配的下载记录" : "暂无下载记录";
    $("span", empty).textContent = query ? "尝试搜索其他标题或来源" : "完成的任务会保存在这里";
    refreshIcons();
  }

  function createAuthPlatformRow(platform) {
    const ui = AUTH_PLATFORM_UI[platform.id];
    const row = element("article", "platform-row");
    row.dataset.platform = platform.id;

    const platformIcon = element("span", `platform-icon ${platform.id}`);
    if (ui?.src) {
      const brandImage = document.createElement("img");
      brandImage.src = ui.src;
      brandImage.alt = "";
      brandImage.setAttribute("aria-hidden", "true");
      platformIcon.append(brandImage);
    } else {
      platformIcon.append(icon("globe-2"));
    }
    const copy = element("div", "platform-copy");
    const detailParts = [platform.domain, platform.message];
    if (platform.expiresAt) detailParts.push(`有效期至 ${formatDate(platform.expiresAt)}`);
    append(copy, element("strong", "", platform.name), element("span", "", detailParts.filter(Boolean).join(" · ")));

    const status = element("span", `auth-status ${platform.status}`, AUTH_STATUS_LABELS[platform.status] || "检查中");
    const actions = element("div", "platform-actions");
    const login = element("button", "secondary-button compact");
    login.type = "button";
    login.dataset.authAction = "login";
    login.dataset.platformId = platform.id;
    login.disabled = platform.status === "login_open";
    append(login, icon(platform.status === "login_open" ? "loader-circle" : "log-in"), element("span", "", platform.cookieCount ? "重新登录" : "登录"));

    const validate = element("button", "text-button", "验证");
    validate.type = "button";
    validate.dataset.authAction = "validate";
    validate.dataset.platformId = platform.id;
    validate.disabled = !platform.cookieCount || platform.status === "login_open";

    const clear = element("button", "icon-button bordered danger-hover");
    clear.type = "button";
    clear.dataset.authAction = "clear";
    clear.dataset.platformId = platform.id;
    clear.disabled = !platform.cookieCount || platform.status === "login_open";
    clear.setAttribute("aria-label", `清除 ${platform.name} 登录状态`);
    clear.title = "清除登录状态";
    clear.append(icon("trash-2"));
    append(actions, login, validate, clear);
    append(row, platformIcon, copy, status, actions);
    return row;
  }

  function renderAuthPlatforms() {
    const list = $("#authPlatformList");
    list.replaceChildren();
    state.authPlatforms.forEach((platform) => list.append(createAuthPlatformRow(platform)));
    const connected = state.authPlatforms.filter((platform) => platform.cookieCount > 0).length;
    $("#authSummary").textContent = `${connected} 个平台已连接`;
    refreshIcons();
  }

  function upsertAuthPlatform(platform) {
    if (!platform?.id) return;
    const index = state.authPlatforms.findIndex((item) => item.id === platform.id);
    if (index >= 0) state.authPlatforms[index] = platform;
    else state.authPlatforms.push(platform);
    renderAuthPlatforms();
  }

  function renderSettings() {
    $("#settingsDirectory").textContent = state.settings.downloadDirectory;
    $("#downloadDestination").textContent = state.settings.downloadDirectory;
    $("#concurrencySelect").value = String(state.settings.concurrency || 2);
    $("#themeSelect").value = state.settings.theme || "system";
    $("#appVersion").textContent = state.appVersion;
    renderLicenseStatus();
    renderUpdateStatus();
    renderAuthPlatforms();
    renderToolchain();
  }

  function renderLicenseStatus() {
    const status = state.licenseStatus || {};
    const badge = $("#licenseStatus");
    badge.className = `license-status ${status.status || "unlicensed"}`;
    badge.textContent = LICENSE_STATUS_LABELS[status.status] || "状态未知";
    const topStatus = $("#topLicenseStatus");
    const topStatusText = $("span", topStatus);
    topStatus.className = `top-license-status ${status.status || "unlicensed"}`;
    if (status.status === "active" && status.expiresAt) {
      topStatusText.textContent = `授权至 ${formatLicenseDate(status.expiresAt)}`;
      topStatus.setAttribute("aria-label", `设备授权有效期至 ${formatLicenseDate(status.expiresAt, true)}，前往设备授权设置`);
    } else if (status.status === "active") {
      topStatusText.textContent = "永久授权";
      topStatus.setAttribute("aria-label", "设备已永久授权，前往设备授权设置");
    } else if (status.status === "development") {
      topStatusText.textContent = "开发模式";
      topStatus.setAttribute("aria-label", "开发模式不校验授权，前往设备授权设置");
    } else {
      topStatusText.textContent = LICENSE_STATUS_LABELS[status.status] || "授权异常";
      topStatus.setAttribute("aria-label", `${topStatusText.textContent}，前往设备授权设置`);
    }
    topStatus.title = topStatus.getAttribute("aria-label");
    $("#licenseMessage").textContent = status.message || "无法读取设备授权状态";
    $("#licenseDeviceCode").textContent = status.deviceCode || "设备码不可用";
    $("#copyDeviceCode").disabled = !status.deviceCode;
    $("#clearLicense").hidden = !status.hasLicense;

    const detail = $("#licenseDetail");
    if (status.status === "active") {
      const owner = status.holder ? `授权给 ${status.holder}` : "授权已绑定当前设备";
      detail.textContent = status.expiresAt ? `${owner} · 有效期至 ${formatDate(status.expiresAt)}` : `${owner} · 永久有效`;
    } else if (status.status === "expired" && status.expiresAt) {
      detail.textContent = `授权已于 ${formatDate(status.expiresAt)} 到期`;
    } else if (status.status === "development") {
      detail.textContent = "正式安装包将校验设备授权";
    } else {
      detail.textContent = "将设备码发送给作者以获取授权码";
    }
  }

  function renderUpdateStatus() {
    const status = state.updateStatus || {};
    const statusNode = $("#updateStatus");
    const button = $("#checkUpdates");
    if (!statusNode || !button) return;

    statusNode.textContent = status.message || "可手动检查更新";
    const buttonLabel = $("span", button);
    const busy = status.status === "checking" || status.status === "downloading";
    button.disabled = busy || status.status === "disabled";
    button.toggleAttribute("aria-busy", busy);
    if (status.status === "checking") buttonLabel.textContent = "正在检查";
    else if (status.status === "downloading") buttonLabel.textContent = `下载中 ${Math.round(status.progress || 0)}%`;
    else if (status.status === "available") buttonLabel.textContent = "下载更新";
    else if (status.status === "downloaded") buttonLabel.textContent = "重启安装";
    else if (status.status === "disabled") buttonLabel.textContent = "仅安装版支持";
    else buttonLabel.textContent = "检查更新";
  }

  function upsertTask(task) {
    const index = state.tasks.findIndex((item) => item.id === task.id);
    if (task.removed) {
      if (index >= 0) state.tasks.splice(index, 1);
    } else if (index >= 0) state.tasks[index] = task;
    else state.tasks.unshift(task);
    renderTasks();
  }

  function upsertHistory(entry) {
    const index = state.history.findIndex((item) => item.id === entry.id);
    if (index >= 0) state.history[index] = entry; else state.history.unshift(entry);
    renderHistory();
  }

  async function pasteUrl() {
    try {
      const value = await call(api.clipboard?.readText ? api.clipboard.readText() : Promise.resolve({ ok: true, data: await navigator.clipboard.readText() }));
      if (!value) throw new Error("剪贴板中没有文本");
      $("#sourceUrl").value = value.trim();
      $("#sourceUrl").focus();
    } catch (error) {
      showToast("无法粘贴链接", error.message, "error");
    }
  }

  async function parseUrl(event) {
    event?.preventDefault();
    if (state.parsing) return;
    try {
      state.licenseStatus = await call(api.license.status());
      renderLicenseStatus();
    } catch (error) {
      showToast("无法校验设备授权", error.message, "error");
      focusLicenseSettings();
      return;
    }
    if (!state.licenseStatus.active) {
      showToast("请先完成设备授权", state.licenseStatus.message || "已跳转到设备授权设置", "error");
      focusLicenseSettings();
      return;
    }
    const url = $("#sourceUrl").value.trim();
    state.parsing = true;
    $("#parseError").hidden = true;
    $("#parseButton").disabled = true;
    $("#parseButton").setAttribute("aria-busy", "true");
    $("#parseButton span").textContent = "正在解析";
    $("#parseHint").replaceChildren(append(element("span", "is-loading"), icon("loader-circle"), document.createTextNode("正在读取媒体信息")));
    refreshIcons();
    try {
      state.media = await call(api.media.parse(url));
      if (state.media.resolvedUrl) $("#sourceUrl").value = state.media.resolvedUrl;
      renderMedia();
      selectPreset("recommended");
      const recognizedFromText = Boolean(state.media.resolvedUrl && state.media.resolvedUrl !== url);
      $("#parseHint").replaceChildren(append(element("span"), icon("circle-check"), document.createTextNode(recognizedFromText ? "已从分享内容识别链接并完成解析" : "已识别单个媒体")));
    } catch (error) {
      state.media = null;
      renderMedia();
      $("#parseError").textContent = error.message;
      $("#parseError").hidden = false;
      $("#parseHint").replaceChildren(append(element("span"), icon("scan-search"), document.createTextNode("自动识别文案中的首个链接 · 仅在本机解析")));
      if (error.code === "LICENSE_REQUIRED") {
        try {
          state.licenseStatus = await call(api.license.status());
          renderLicenseStatus();
        } catch {}
        showToast("请先完成设备授权", error.message, "error");
        focusLicenseSettings();
      } else if (error.code === "AUTH_REQUIRED") {
        showToast("需要平台登录", "请完成对应平台登录后重新解析", "error");
        showView("settings");
        activateSettingsSection("authSettings", "auto");
      }
    } finally {
      state.parsing = false;
      $("#parseButton").disabled = false;
      $("#parseButton").removeAttribute("aria-busy");
      $("#parseButton span").textContent = "解析链接";
      refreshIcons();
    }
  }

  function taskOptions() {
    return {
      preset: state.preset,
      resolution: state.preset === "best" ? "best" : $("#resolutionSelect").value,
      container: state.preset === "best" ? "auto" : "mp4",
      fps: "60",
      embedThumbnail: $("#embedThumbnail").checked,
      writeMetadata: $("#writeMetadata").checked,
      audioFormat: state.preset === "mp3" ? "mp3" : "original",
      audioQuality: "320",
      subtitleLanguages: state.media?.subtitleLanguages || [],
      includeAutomaticSubtitles: $("#includeAutoSubtitles").checked,
    };
  }

  async function createTask() {
    if (!state.media) return;
    const button = $("#downloadButton"); button.disabled = true;
    try {
      const sourceUrl = state.media.resolvedUrl || state.media.webpageUrl || $("#sourceUrl").value.trim();
      const task = await call(api.tasks.create({ url: sourceUrl, media: state.media, options: taskOptions(), outputRoot: state.settings.downloadDirectory }));
      upsertTask(task);
      showToast("任务已加入队列", "下载将在可用时自动开始");
      showView("tasks");
    } catch (error) {
      showToast("无法创建任务", error.message, "error");
      if (/工具|yt-dlp|FFmpeg/i.test(error.message)) showView("settings");
      if (error.code === "LICENSE_REQUIRED") {
        showView("settings");
        activateSettingsSection("licenseSettings", "auto");
      }
    } finally { button.disabled = false; }
  }

  async function handleTaskAction(button) {
    const { taskAction: action, taskId: id } = button.dataset;
    try {
      if (action === "open") await call(api.files.open("task", id));
      else if (action === "pause") upsertTask(await call(api.tasks.pause(id)));
      else if (action === "resume") upsertTask(await call(api.tasks.resume(id)));
      else if (action === "cancel") upsertTask(await call(api.tasks.cancel(id)));
      else if (action === "remove") await call(api.tasks.remove(id));
    } catch (error) {
      showToast("任务操作失败", error.message, "error");
      if (error.code === "LICENSE_REQUIRED") {
        showView("settings");
        activateSettingsSection("licenseSettings", "auto");
      }
    }
  }

  async function updateSettings(patch, successMessage = "设置已保存") {
    try {
      const result = await call(api.settings.update(patch));
      state.settings = result.settings;
      state.toolchain = result.toolchain;
      applyTheme(); renderSettings(); showToast(successMessage);
    } catch (error) { showToast("设置保存失败", error.message, "error"); }
  }

  async function refreshTools(showResult = true) {
    $("#checkTools").disabled = true;
    try {
      state.toolchain = await call(api.tools.status());
      renderToolchain();
      if (showResult) showToast(state.toolchain.ready ? "工具链可用" : "工具链需要处理", state.toolchain.ready ? "所有组件已通过自检" : "请在设置中安装或选择缺失工具", state.toolchain.ready ? "success" : "error");
    } catch (error) { showToast("检查失败", error.message, "error"); }
    finally { $("#checkTools").disabled = false; }
  }

  async function handleUpdateAction() {
    const status = state.updateStatus?.status;
    const method = status === "available" ? "download" : status === "downloaded" ? "install" : "check";
    try {
      const result = await call(api.updates[method]());
      if (result && typeof result === "object") {
        state.updateStatus = result;
        renderUpdateStatus();
      }
      if (state.updateStatus?.status === "current") showToast("已是最新版本", `当前版本 ${state.appVersion}`);
      else if (state.updateStatus?.status === "error") showToast("检查更新失败", state.updateStatus.message, "error");
    } catch (error) {
      showToast(method === "download" ? "更新下载失败" : "检查更新失败", error.message, "error");
    }
  }

  async function copyDeviceCode() {
    try {
      await call(api.license.copyDeviceCode());
      showToast("设备码已复制", "可发送给作者签发授权码");
    } catch (error) {
      showToast("无法复制设备码", error.message, "error");
    }
  }

  async function activateLicense(event) {
    event?.preventDefault();
    const code = $("#licenseCode").value.trim();
    const field = $("#licenseCode");
    const errorNode = $("#licenseError");
    errorNode.hidden = true;
    field.removeAttribute("aria-invalid");
    if (!code) {
      errorNode.textContent = "请输入以 CPL1 开头的完整授权码";
      errorNode.hidden = false;
      field.setAttribute("aria-invalid", "true");
      showToast("请输入授权码", "授权码以 CPL1 开头", "error");
      field.focus();
      return;
    }
    const button = $("#activateLicense");
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    $("span", button).textContent = "正在验证";
    try {
      state.licenseStatus = await call(api.license.activate(code));
      field.value = "";
      renderLicenseStatus();
      showToast("设备授权已绑定", state.licenseStatus.message);
    } catch (error) {
      errorNode.textContent = error.message;
      errorNode.hidden = false;
      field.setAttribute("aria-invalid", "true");
      showToast("授权码验证失败", error.message, "error");
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      $("span", button).textContent = "验证并绑定";
    }
  }

  async function clearLicense() {
    try {
      const status = await call(api.license.clear());
      if (!status) return;
      state.licenseStatus = status;
      renderLicenseStatus();
      showToast("设备授权已清除", "重新输入有效授权码即可恢复下载");
    } catch (error) {
      showToast("无法清除设备授权", error.message, "error");
    }
  }

  async function handleAuthAction(button) {
    const { authAction: action, platformId } = button.dataset;
    const platform = state.authPlatforms.find((item) => item.id === platformId);
    const method = action === "login" ? "openLogin" : action;
    if (!platform || !api.auth?.[method]) return;
    if (action === "clear" && !window.clipport && !window.confirm(`清除 ${platform.name} 的登录状态？`)) return;

    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try {
      if (action === "login") {
        const status = await call(api.auth.openLogin(platformId));
        if (status) upsertAuthPlatform(status);
        showToast("登录窗口已打开", `完成 ${platform.name} 登录后关闭窗口`);
      } else if (action === "validate") {
        const status = await call(api.auth.validate(platformId));
        if (status) upsertAuthPlatform(status);
        showToast(status?.status === "valid" ? "Cookie 有效" : "本地校验完成", status?.message || "将在解析时再次验证");
      } else if (action === "clear") {
        const status = await call(api.auth.clear(platformId));
        if (status) {
          upsertAuthPlatform(status);
          showToast("登录状态已清除", `${platform.name} Cookie 已从 ClipPort 删除`);
        }
      }
    } catch (error) {
      showToast("登录状态操作失败", error.message, "error");
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const nav = event.target.closest("[data-nav]"); if (nav) showView(nav.dataset.nav);
      const preset = event.target.closest("[data-preset]"); if (preset) selectPreset(preset.dataset.preset);
      const tab = event.target.closest("[data-option-tab]"); if (tab) selectOptionTab(tab.dataset.optionTab);
      const filter = event.target.closest("[data-task-filter]"); if (filter) { state.taskFilter = filter.dataset.taskFilter; renderTasks(); }
      const taskAction = event.target.closest("[data-task-action]"); if (taskAction) handleTaskAction(taskAction);
      const historyAction = event.target.closest("[data-history-action]");
      if (historyAction) call(api.files[historyAction.dataset.historyAction]("history", historyAction.dataset.historyId)).catch((error) => showToast("无法打开文件", error.message, "error"));
      const settingsAnchor = event.target.closest("[data-settings-anchor]");
      if (settingsAnchor) activateSettingsSection(settingsAnchor.dataset.settingsAnchor);
      const authAction = event.target.closest("[data-auth-action]");
      if (authAction) handleAuthAction(authAction);
      const selectTool = event.target.closest("[data-select-tool]");
      if (selectTool) call(api.tools.chooseBinary(selectTool.dataset.selectTool)).then((status) => { if (status) { state.toolchain = status; renderToolchain(); showToast("工具路径已更新"); } }).catch((error) => showToast("无法选择工具", error.message, "error"));
    });
    document.addEventListener("keydown", (event) => {
      if (!new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]).has(event.key)) return;
      const groups = ["[data-preset]", "[data-option-tab]", "[data-task-filter]"];
      const selector = groups.find((value) => event.target.matches(value));
      if (!selector) return;
      const buttons = $$(selector).filter((button) => !button.disabled && !button.hidden);
      const current = buttons.indexOf(event.target);
      if (current < 0) return;
      event.preventDefault();
      const direction = new Set(["ArrowRight", "ArrowDown"]).has(event.key) ? 1 : -1;
      const next = buttons[(current + direction + buttons.length) % buttons.length];
      next.focus();
      next.click();
    });
    $("#parseForm").addEventListener("submit", parseUrl);
    $("#pasteButton").addEventListener("click", pasteUrl);
    $("#pasteTopButton").addEventListener("click", pasteUrl);
    $("#resetPreset").addEventListener("click", () => selectPreset("recommended"));
    $("#downloadButton").addEventListener("click", createTask);
    $("#destinationButton").addEventListener("click", () => $("#chooseDirectory").click());
    $("#historySearch").addEventListener("input", renderHistory);
    $("#closeToast").addEventListener("click", () => $("#toast").classList.remove("show"));
    $("#openFolder").addEventListener("click", () => call(api.files.openDownloadDirectory()).catch((error) => showToast("无法打开目录", error.message, "error")));
    $("#checkTools").addEventListener("click", () => refreshTools(true));
    $("#checkUpdates").addEventListener("click", handleUpdateAction);
    $("#licenseForm").addEventListener("submit", activateLicense);
    $("#licenseCode").addEventListener("input", (event) => {
      event.currentTarget.removeAttribute("aria-invalid");
      $("#licenseError").hidden = true;
    });
    $("#copyDeviceCode").addEventListener("click", copyDeviceCode);
    $("#clearLicense").addEventListener("click", clearLicense);
    $("#chooseDirectory").addEventListener("click", async () => { try { const settings = await call(api.settings.chooseDownloadDirectory()); if (settings) { state.settings = settings; renderSettings(); showToast("默认目录已更新"); } } catch (error) { showToast("无法选择目录", error.message, "error"); } });
    $("#concurrencySelect").addEventListener("change", (event) => updateSettings({ concurrency: Number(event.target.value) }));
    $("#themeSelect").addEventListener("change", (event) => updateSettings({ theme: event.target.value }));
    $("#topLicenseStatus").addEventListener("click", focusLicenseSettings);
    $("#themeToggle").addEventListener("click", () => updateSettings({ theme: document.body.dataset.theme === "dark" ? "light" : "dark" }));
    $("#installYtDlp").addEventListener("click", async (event) => { const button = event.currentTarget; button.disabled = true; button.setAttribute("aria-busy", "true"); $("span", button).textContent = "正在安装"; try { state.toolchain = await call(api.tools.installYtDlp()); renderToolchain(); showToast("yt-dlp 已安装并通过自检"); } catch (error) { showToast("安装失败", error.message, "error"); } finally { button.disabled = false; button.removeAttribute("aria-busy"); $("span", button).textContent = "安装/更新"; } });
    $("#minimizeButton").addEventListener("click", api.app.minimize);
    $("#maximizeButton").addEventListener("click", api.app.toggleMaximize);
    $("#closeButton").addEventListener("click", api.app.close);
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (state.settings.theme === "system") applyTheme(); });
    window.addEventListener("hashchange", () => showView(location.hash.slice(1)));
  }

  async function initialize() {
    bindEvents();
    refreshIcons();
    try {
      const bootstrap = await call(api.app.bootstrap());
      Object.assign(state, bootstrap);
      applyTheme(); renderSettings(); renderMedia(); renderTasks(); renderHistory(); selectPreset("recommended");
      showView(location.hash.slice(1) || "download");
      api.events.onTaskChanged(upsertTask);
      api.events.onHistoryChanged(upsertHistory);
      api.events.onToolStatus((status) => {
        if (status?.tools) { state.toolchain = status; renderToolchain(); }
        else if (status?.message) showToast("工具链", status.message);
      });
      api.events.onAuthChanged?.(upsertAuthPlatform);
      api.events.onUpdateStatus?.((status) => {
        state.updateStatus = status;
        renderUpdateStatus();
      });
      api.events.onLicenseStatus?.((status) => {
        state.licenseStatus = status;
        renderLicenseStatus();
      });
      window.__clipportState = state;
    } catch (error) {
      showToast("ClipPort 启动失败", error.message, "error");
      $("#parseButton").disabled = true;
    }
  }

  initialize();
})();
