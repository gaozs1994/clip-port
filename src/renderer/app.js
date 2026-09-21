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
  const VOICEBOX_ENGINE_LABELS = {
    qwen: "Qwen3-TTS",
    qwen_custom_voice: "Qwen CustomVoice",
    luxtts: "LuxTTS",
    chatterbox: "Chatterbox Multilingual",
    chatterbox_turbo: "Chatterbox Turbo",
    tada: "HumeAI TADA",
    kokoro: "Kokoro",
  };
  const VOICE_LANGUAGE_LABELS = {
    zh: "中文", en: "英语", ja: "日语", ko: "韩语", de: "德语", fr: "法语", ru: "俄语", pt: "葡萄牙语", es: "西班牙语", it: "意大利语",
    he: "希伯来语", ar: "阿拉伯语", da: "丹麦语", el: "希腊语", fi: "芬兰语", hi: "印地语", ms: "马来语", nl: "荷兰语", no: "挪威语", pl: "波兰语", sv: "瑞典语", sw: "斯瓦希里语", tr: "土耳其语",
  };
  const VOICEBOX_ENGINE_ORDER = ["qwen", "qwen_custom_voice", "luxtts", "chatterbox", "chatterbox_turbo", "tada", "kokoro"];
  const VOICE_SAMPLE_MAX_BYTES = 50 * 1024 * 1024;
  const VOICE_CAPTURE_MAX_MS = 30_000;
  const VOICE_SAMPLE_EXTENSIONS = new Set(["wav", "mp3", "m4a", "ogg", "flac", "aac", "webm", "opus"]);
  const VOICE_MIC_DEFAULT_HINT = "建议在安静环境中录制 10 至 30 秒";
  const VOICE_SYSTEM_DEFAULT_HINT = "先播放目标音频，再开始采集；最长 30 秒";
  const VOICEBOX_ENGINE_ICONS = {
    qwen: "audio-lines",
    qwen_custom_voice: "message-circle-more",
    luxtts: "gauge",
    chatterbox: "languages",
    chatterbox_turbo: "zap",
    tada: "sparkles",
    kokoro: "cpu",
  };
  const VOICEBOX_DEMO_LANGUAGES = ["zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"];
  const DEMO_VOICEBOX_MODELS = [
    { name: "qwen-tts-1.7B", displayName: "Qwen TTS 1.7B", engine: "qwen", repository: "Qwen/Qwen3-TTS-12Hz-1.7B-Base", modelSize: "1.7B", sizeMb: 3500, languages: VOICEBOX_DEMO_LANGUAGES, description: "高质量声音克隆，适合正式成片" },
    { name: "qwen-tts-0.6B", displayName: "Qwen TTS 0.6B", engine: "qwen", repository: "Qwen/Qwen3-TTS-12Hz-0.6B-Base", modelSize: "0.6B", sizeMb: 1200, languages: VOICEBOX_DEMO_LANGUAGES, description: "轻量声音克隆，资源占用更低" },
    { name: "qwen-custom-voice-1.7B", displayName: "Qwen CustomVoice 1.7B", engine: "qwen_custom_voice", repository: "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice", modelSize: "1.7B", sizeMb: 3500, languages: VOICEBOX_DEMO_LANGUAGES, description: "内置音色与自然语言风格控制" },
    { name: "qwen-custom-voice-0.6B", displayName: "Qwen CustomVoice 0.6B", engine: "qwen_custom_voice", repository: "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice", modelSize: "0.6B", sizeMb: 1200, languages: VOICEBOX_DEMO_LANGUAGES, description: "轻量预设音色与风格控制" },
    { name: "luxtts", displayName: "LuxTTS", engine: "luxtts", repository: "YatharthS/LuxTTS", modelSize: "", sizeMb: 300, languages: ["en"], description: "快速、CPU 友好的英文语音" },
    { name: "chatterbox-tts", displayName: "Chatterbox Multilingual", engine: "chatterbox", repository: "ResembleAI/chatterbox", modelSize: "", sizeMb: 3200, languages: Array.from({ length: 23 }, (_, index) => `lang-${index}`), description: "覆盖 23 种语言的声音克隆" },
    { name: "chatterbox-turbo", displayName: "Chatterbox Turbo", engine: "chatterbox_turbo", repository: "ResembleAI/chatterbox-turbo", modelSize: "", sizeMb: 1500, languages: ["en"], description: "快速英文语音，支持情绪标签" },
    { name: "tada-1b", displayName: "TADA 1B", engine: "tada", repository: "HumeAI/tada-1b", modelSize: "1B", sizeMb: 4000, languages: ["en"], description: "高表现力英文语音模型" },
    { name: "tada-3b-ml", displayName: "TADA 3B Multilingual", engine: "tada", repository: "HumeAI/tada-3b-ml", modelSize: "3B", sizeMb: 8000, languages: VOICEBOX_DEMO_LANGUAGES, description: "高表现力多语言大型模型" },
    { name: "kokoro", displayName: "Kokoro 82M", engine: "kokoro", repository: "hexgrad/Kokoro-82M", modelSize: "82M", sizeMb: 350, languages: ["en", "es", "fr", "hi", "it", "pt", "ja", "zh"], description: "体积小、CPU 实时的预设音色", downloaded: true, loaded: true },
  ].map((model) => ({ downloaded: false, downloading: false, loaded: false, ...model }));
  const VOICEBOX_ACTIVE_STATES = new Set(["queued", "loading_model", "generating"]);
  const ACTIVE_STATES = new Set(["preparing", "downloading", "processing", "verifying", "pausing", "canceling"]);
  const LOG_LEVEL_TEXT = {
    error: "ERROR",
    warn: "WARN",
    info: "INFO",
  };
  const LOG_SOURCE_LABELS = {
    app: "应用",
    renderer: "界面",
    media: "媒体解析",
    tasks: "任务中心",
    auth: "平台登录",
    toolchain: "工具链",
    updates: "应用更新",
    license: "设备授权",
    voicebox: "Voicebox",
    settings: "设置",
    files: "文件",
    security: "安全",
  };
  const state = {
    appVersion: "--",
    view: "download",
    settings: { downloadDirectory: "", concurrency: 2, theme: "dark" },
    toolchain: null,
    media: null,
    tasks: [],
    history: [],
    authPlatforms: [],
    voiceboxStatus: { available: false, message: "正在启动内置语音服务", profiles: [], models: [], runtime: { state: "starting", mode: "bundled" }, checkedAt: "" },
    voiceboxGeneration: null,
    voiceboxModelProgress: {},
    newVoiceProfileType: "preset",
    newVoiceSampleMode: "upload",
    updateStatus: { status: "idle", currentVersion: "--", latestVersion: "", progress: null, downloadedBytes: null, totalBytes: null, bytesPerSecond: null, message: "启动后自动检查更新" },
    licenseStatus: { status: "unlicensed", active: false, hasLicense: false, deviceCode: "", message: "正在读取设备授权状态" },
    preset: "recommended",
    taskFilter: "all",
    parsing: false,
    diagnosticLogs: [],
    logAutoScroll: true,
  };
  let newVoiceSample = null;
  let newVoiceSampleUrl = "";
  let voiceCapture = null;
  let voiceCaptureRequestId = 0;
  let voiceDeviceStatusRequestId = 0;

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
    const listeners = { task: new Set(), history: new Set(), tool: new Set(), auth: new Set(), update: new Set(), license: new Set(), voicebox: new Set(), voiceboxStatus: new Set(), voiceboxModel: new Set(), log: new Set(), logsCleared: new Set() };
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
    let demoLogs = [
      { id: crypto.randomUUID(), timestamp: new Date().toISOString(), level: "info", source: "app", message: "ClipPort 已启动", details: { version: "0.1.0-preview", platform: "browser" } },
      { id: crypto.randomUUID(), timestamp: new Date(Date.now() - 75_000).toISOString(), level: "warn", source: "voicebox", message: "语音模型尚未下载", details: { model: "qwen_custom_voice_1.7B" } },
      { id: crypto.randomUUID(), timestamp: new Date(Date.now() - 180_000).toISOString(), level: "error", source: "tasks", message: "示例下载任务连接超时", details: { code: "NETWORK_TIMEOUT" } },
    ];
    const demoAuthPlatforms = [
      { id: "douyin", name: "抖音", domain: "douyin.com", status: "ready", message: "本地校验通过，解析时在线复检", cookieCount: 8, expiresAt: "2026-10-16T08:00:00.000Z", lastCheckedAt: new Date().toISOString(), lastVerifiedAt: "" },
      { id: "bilibili", name: "哔哩哔哩", domain: "bilibili.com", status: "valid", message: "已通过真实解析验证", cookieCount: 6, expiresAt: "2026-12-01T08:00:00.000Z", lastCheckedAt: new Date().toISOString(), lastVerifiedAt: new Date().toISOString() },
      { id: "youtube", name: "YouTube", domain: "youtube.com", status: "not_connected", message: "未检测到登录状态", cookieCount: 0, expiresAt: "", lastCheckedAt: "", lastVerifiedAt: "" },
      { id: "xiaohongshu", name: "小红书", domain: "xiaohongshu.com", status: "invalid", message: "Cookie 不完整，请重新登录", cookieCount: 2, expiresAt: "", lastCheckedAt: new Date().toISOString(), lastVerifiedAt: "" },
    ];
    let demoUpdateStatus = { status: "current", currentVersion: "0.1.0-preview", latestVersion: "", progress: null, downloadedBytes: null, totalBytes: null, bytesPerSecond: null, message: "已是最新版本" };
    const demoIssuedAt = new Date();
    const demoExpiresAt = new Date(demoIssuedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    let demoLicenseStatus = { status: "active", active: true, hasLicense: true, deviceCode: "CPD1-DEMO-0000-0000-0000-0000-0000-0000", licenseId: "preview-license", holder: "预览用户", issuedAt: demoIssuedAt.toISOString(), expiresAt: demoExpiresAt.toISOString(), message: "设备已授权" };
    const demoVoiceboxStatus = {
      available: true,
      message: "内置 Voicebox 服务已就绪",
      version: "0.5.0",
      backend: "cpu",
      gpuAvailable: false,
      gpuType: "",
      modelLoaded: true,
      runtime: { state: "ready", mode: "bundled", message: "内置 Voicebox 服务已就绪" },
      checkedAt: new Date().toISOString(),
      models: structuredClone(DEMO_VOICEBOX_MODELS),
      profiles: [
        { id: "a1111111-1111-4111-8111-111111111111", name: "叙事女声", description: "清晰、自然，适合视频旁白", language: "zh", voiceType: "preset", engine: "qwen_custom_voice", hasPersonality: true, sampleCount: 0, generationCount: 18 },
        { id: "b2222222-2222-4222-8222-222222222222", name: "我的声音", description: "本地克隆档案", language: "zh", voiceType: "cloned", engine: "qwen", hasPersonality: false, sampleCount: 2, generationCount: 7 },
      ],
    };
    let timer = null;
    let voiceTimer = null;
    let voiceCompletionTimer = null;

    const emitTask = (task) => listeners.task.forEach((callback) => callback(structuredClone(task)));
    const emitAuth = (platform) => listeners.auth.forEach((callback) => callback(structuredClone(platform)));
    const emitUpdate = () => listeners.update.forEach((callback) => callback(structuredClone(demoUpdateStatus)));
    const emitLicense = () => listeners.license.forEach((callback) => callback(structuredClone(demoLicenseStatus)));
    const syncDemoVoiceTask = (status) => {
      const task = demoTasks.find((item) => item.id === status.id && item.kind === "voice");
      if (!task) return;
      const mapped = {
        queued: ["queued", "等待生成"], loading_model: ["preparing", "正在加载语音模型"], generating: ["processing", "正在生成语音"], completed: ["completed", "语音生成完成"], failed: ["failed", "语音生成失败"], canceled: ["canceled", "已取消"],
      }[status.status] || ["processing", "正在处理语音"];
      task.state = mapped[0];
      task.stage = status.error || mapped[1];
      task.progress = { percent: status.status === "completed" ? 100 : null };
      task.voice = { ...task.voice, duration: status.duration ?? task.voice.duration, audioUrl: status.audioUrl || task.voice.audioUrl };
      task.error = status.status === "failed" ? { code: "VOICE_GENERATION_FAILED", message: status.error || mapped[1] } : null;
      task.updatedAt = new Date().toISOString();
      task.completedAt = status.status === "completed" ? task.updatedAt : null;
      emitTask(task);
    };
    const emitVoicebox = (status) => {
      syncDemoVoiceTask(status);
      listeners.voicebox.forEach((callback) => callback(structuredClone(status)));
    };
    const emitVoiceboxStatus = () => listeners.voiceboxStatus.forEach((callback) => callback(structuredClone(demoVoiceboxStatus)));
    const emitVoiceboxModel = (status) => listeners.voiceboxModel.forEach((callback) => callback(structuredClone(status)));
    const downloadDemoUpdate = async () => {
      const totalBytes = 96 * 1024 * 1024;
      for (const percent of [0, 18, 43, 72, 100]) {
        demoUpdateStatus = { ...demoUpdateStatus, status: percent === 100 ? "downloaded" : "downloading", progress: percent, downloadedBytes: totalBytes * percent / 100, totalBytes, bytesPerSecond: percent === 100 ? 0 : 6.4 * 1024 * 1024, message: percent === 100 ? "更新已下载，等待重启安装" : `正在下载更新 ${percent}%` };
        emitUpdate();
        await sleep(350);
      }
      return structuredClone(demoUpdateStatus);
    };
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
        bootstrap: () => ok({ appVersion: "0.1.0-preview", platform: "browser", settings: demoSettings, tasks: demoTasks, history: demoHistory, toolchain: demoTools, authPlatforms: demoAuthPlatforms, voiceboxStatus: demoVoiceboxStatus, updateStatus: demoUpdateStatus, licenseStatus: demoLicenseStatus, diagnosticLogs: demoLogs }),
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
          const task = { id: crypto.randomUUID(), kind: "download", state: "downloading", stage: "正在下载", progress: { percent: 8, downloadedBytes: 96_000_000, totalBytes: 1_200_000_000, speed: 12_800_000, eta: 43 }, media: payload.media, options: payload.options, outputRoot: payload.outputRoot, finalOutputs: [], error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
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
          demoUpdateStatus = { ...demoUpdateStatus, status: "available", latestVersion: "0.1.1-preview", message: "发现新版本 0.1.1-preview" }; emitUpdate();
          return ok(await downloadDemoUpdate());
        },
        download: async () => ok(await downloadDemoUpdate()),
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
      voicebox: {
        status: () => ok(structuredClone(demoVoiceboxStatus)),
        restart: async () => { await sleep(350); emitVoiceboxStatus(); return ok(structuredClone(demoVoiceboxStatus)); },
        presetVoices: (engine) => ok(engine === "qwen_custom_voice" ? [{ id: "Vivian", name: "Vivian", gender: "female", language: "zh" }, { id: "Ryan", name: "Ryan", gender: "male", language: "en" }] : [{ id: "zf_xiaobei", name: "Xiaobei", gender: "female", language: "zh" }, { id: "am_adam", name: "Adam", gender: "male", language: "en" }]),
        createProfile: (payload) => {
          demoVoiceboxStatus.profiles.push({ id: crypto.randomUUID(), name: payload.name, description: payload.description || "", language: payload.language, voiceType: payload.voiceType, engine: payload.engine, hasPersonality: false, sampleCount: payload.voiceType === "cloned" ? 1 : 0, generationCount: 0 });
          emitVoiceboxStatus();
          return ok(structuredClone(demoVoiceboxStatus));
        },
        deleteProfile: (id) => {
          const index = demoVoiceboxStatus.profiles.findIndex((profile) => profile.id === id);
          if (index >= 0) demoVoiceboxStatus.profiles.splice(index, 1);
          emitVoiceboxStatus();
          return ok(structuredClone(demoVoiceboxStatus));
        },
        downloadModel: async (name) => {
          const model = demoVoiceboxStatus.models.find((item) => item.name === name);
          if (model) model.downloading = true;
          for (const progress of [8, 36, 68, 100]) {
            emitVoiceboxModel({ modelName: name, status: progress === 100 ? "complete" : "downloading", progress, current: progress * 35_000_000, total: 3_500_000_000, filename: "model.safetensors", error: "" });
            await sleep(180);
          }
          if (model) { model.downloading = false; model.downloaded = true; model.sizeMb = 3338; }
          emitVoiceboxStatus();
          return ok(true);
        },
        cancelModel: () => ok(true),
        unloadModel: (name) => { const model = demoVoiceboxStatus.models.find((item) => item.name === name); if (model) model.loaded = false; emitVoiceboxStatus(); return ok(structuredClone(demoVoiceboxStatus)); },
        deleteModel: (name) => { const model = demoVoiceboxStatus.models.find((item) => item.name === name); if (model) Object.assign(model, { downloaded: false, loaded: false, sizeMb: null }); emitVoiceboxStatus(); return ok(structuredClone(demoVoiceboxStatus)); },
        generate: (payload) => {
          const profile = demoVoiceboxStatus.profiles.find((item) => item.id === payload.profileId);
          const generation = { id: crypto.randomUUID(), status: "generating", duration: null, error: "", profileId: payload.profileId, profileName: profile?.name || "声音档案", engine: profile?.engine || "", language: payload.language };
          const createdAt = new Date().toISOString();
          const task = { id: generation.id, kind: "voice", state: "processing", stage: "正在生成语音", title: `语音生成 · ${generation.profileName}`, progress: { percent: null }, voice: { profileId: generation.profileId, profileName: generation.profileName, engine: generation.engine, language: generation.language, textLength: payload.text.trim().length, duration: null, audioUrl: "" }, error: null, createdAt, updatedAt: createdAt, completedAt: null };
          demoTasks.unshift(task);
          emitTask(task);
          clearTimeout(voiceTimer);
          clearTimeout(voiceCompletionTimer);
          voiceTimer = setTimeout(() => emitVoicebox({ ...generation, status: "loading_model" }), 350);
          voiceCompletionTimer = setTimeout(() => emitVoicebox({ ...generation, status: "completed", duration: 8.4, audioUrl: "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=" }), 1600);
          return ok(generation);
        },
        cancel: (id) => { clearTimeout(voiceTimer); clearTimeout(voiceCompletionTimer); const update = { id, status: "canceled", duration: null, error: "已取消生成" }; emitVoicebox(update); return ok(update); },
        saveAudio: () => ok("C:\\Users\\Public\\Downloads\\ClipPort-voice.wav"),
      },
      logs: {
        list: ({ level = "all", source = "all" } = {}) => ok(demoLogs.filter((entry) => (level === "all" || entry.level === level) && (source === "all" || entry.source === source))),
        record: (entry) => {
          const log = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), level: entry.level || "info", source: "renderer", message: entry.message || "界面日志", details: entry.details || null };
          demoLogs.unshift(log);
          listeners.log.forEach((callback) => callback(structuredClone(log)));
          return ok(true);
        },
        export: () => ok("C:\\Users\\Public\\Downloads\\ClipPort-diagnostics-preview.jsonl"),
        clear: () => { demoLogs = []; listeners.logsCleared.forEach((callback) => callback(true)); return ok(true); },
      },
      files: { open: () => ok(true), reveal: () => ok(true), openDownloadDirectory: () => ok(true) },
      events: {
        onTaskChanged: (callback) => { listeners.task.add(callback); return () => listeners.task.delete(callback); },
        onHistoryChanged: (callback) => { listeners.history.add(callback); return () => listeners.history.delete(callback); },
        onToolStatus: (callback) => { listeners.tool.add(callback); return () => listeners.tool.delete(callback); },
        onAuthChanged: (callback) => { listeners.auth.add(callback); return () => listeners.auth.delete(callback); },
        onUpdateStatus: (callback) => { listeners.update.add(callback); return () => listeners.update.delete(callback); },
        onLicenseStatus: (callback) => { listeners.license.add(callback); return () => listeners.license.delete(callback); },
        onVoiceboxStatus: (callback) => { listeners.voiceboxStatus.add(callback); return () => listeners.voiceboxStatus.delete(callback); },
        onVoiceboxModelProgress: (callback) => { listeners.voiceboxModel.add(callback); return () => listeners.voiceboxModel.delete(callback); },
        onVoiceboxGenerationStatus: (callback) => { listeners.voicebox.add(callback); return () => listeners.voicebox.delete(callback); },
        onLogEntry: (callback) => { listeners.log.add(callback); return () => listeners.log.delete(callback); },
        onLogsCleared: (callback) => { listeners.logsCleared.add(callback); return () => listeners.logsCleared.delete(callback); },
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

  function formatLogDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "未知时间";
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date);
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
    const previousView = state.view;
    state.view = ["download", "voice", "tasks", "history", "logs", "settings"].includes(view) ? view : "download";
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
    if (state.view === "logs" && previousView !== "logs") {
      state.logRenderLimit = 100;
      refreshDiagnosticLogs();
    }
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

  function selectedVoiceProfile() {
    const profiles = state.voiceboxStatus?.profiles || [];
    return profiles.find((profile) => profile.id === $("#voiceProfile").value) || profiles[0] || null;
  }

  function renderVoiceProfile(syncLanguage = false) {
    const profile = selectedVoiceProfile();
    $("#deleteVoiceProfile").disabled = !profile;
    if (!profile) {
      $("#voiceProfileName").textContent = "请选择声音档案";
      $("#voiceProfileDetail").textContent = "新建预设音色或已获授权的克隆音色";
      $("#voicePersonality").disabled = true;
      $("#voiceOutputEngine").textContent = "--";
      return;
    }
    $("#voiceProfileName").textContent = profile.name;
    const type = profile.voiceType === "preset" ? "预设音色" : profile.voiceType === "cloned" ? "克隆音色" : "声音档案";
    const engine = VOICEBOX_ENGINE_LABELS[profile.engine] || profile.engine || "自动选择";
    const samples = profile.sampleCount ? ` · ${profile.sampleCount} 个样本` : "";
    $("#voiceProfileDetail").textContent = `${type} · ${engine}${samples}`;
    if (syncLanguage && $("#voiceLanguage").querySelector(`option[value="${profile.language}"]`)) {
      $("#voiceLanguage").value = profile.language;
    }
    $("#voicePersonality").disabled = !profile.hasPersonality;
    if (!profile.hasPersonality) $("#voicePersonality").checked = false;
    $("#voiceOutputEngine").textContent = engine;
  }

  function voiceModelAction(name, title, action, iconName, { danger = false, label = "" } = {}) {
    const button = element("button", label ? `secondary-button compact voice-model-action${danger ? " danger" : ""}` : `icon-button bordered${danger ? " danger" : ""}`);
    button.type = "button";
    button.title = title;
    button.setAttribute("aria-label", title);
    button.dataset.voiceModelAction = action;
    button.dataset.voiceModelName = name;
    button.append(icon(iconName));
    if (label) button.append(element("span", "", label));
    return button;
  }

  function renderVoiceModels() {
    const models = Array.isArray(state.voiceboxStatus?.models) ? state.voiceboxStatus.models : [];
    const downloaded = models.filter((model) => model.downloaded).length;
    $("#voiceModelSummary").textContent = models.length ? `${downloaded} / ${models.length} 个模型已下载` : "暂未读取到模型";
    if (!models.length) {
      const empty = element("div", "voice-model-empty");
      append(empty, icon("package-open"), element("strong", "", "没有可用模型"), element("small", "", "重新连接 Voicebox 后再试"));
      $("#voiceModelList").replaceChildren(empty);
      refreshIcons();
      return;
    }

    const renderModel = (model) => {
      const progress = state.voiceboxModelProgress[model.name];
      const downloading = model.downloading || (progress && new Set(["queued", "downloading"]).has(progress.status));
      const failed = progress && new Set(["error", "failed"]).has(progress.status);
      const row = element("article", "voice-model-row");
      const modelIcon = element("span", `voice-model-status${model.loaded ? " loaded" : model.downloaded ? " downloaded" : failed ? " failed" : ""}`);
      modelIcon.title = model.loaded ? "已加载" : model.downloaded ? "已下载" : failed ? "下载失败" : "未下载";
      modelIcon.append(icon(model.loaded ? "cpu" : model.downloaded ? "circle-check" : failed ? "circle-alert" : "package"));
      const copy = element("span", "voice-model-copy");
      const stateText = downloading ? "正在下载" : model.loaded ? "已加载" : model.downloaded ? "已下载" : "未下载";
      const heading = element("span", "voice-model-heading");
      append(heading, element("strong", "", model.displayName || model.name));
      if (model.modelSize) heading.append(element("span", "voice-model-size", model.modelSize));
      const description = element("small", "voice-model-description", model.description || "Voicebox 语音生成模型");
      const metadata = element("span", "voice-model-metadata");
      const languageCount = Array.isArray(model.languages) ? model.languages.length : 0;
      if (languageCount) metadata.append(element("small", "", languageCount === 1 ? "单语言" : `${languageCount} 种语言`));
      if (model.sizeMb) metadata.append(element("small", "", `约 ${formatBytes(model.sizeMb * 1024 * 1024)}`));
      metadata.append(element("small", `voice-model-state ${downloading ? "downloading" : model.loaded ? "loaded" : model.downloaded ? "downloaded" : failed ? "failed" : ""}`, failed ? "下载失败" : stateText));
      append(copy, heading, description, metadata);
      if (model.repository) {
        const repository = element("small", "voice-model-repository", model.repository);
        repository.title = model.repository;
        copy.append(repository);
      }
      if (downloading) {
        const track = element("div", "voice-model-progress");
        track.setAttribute("role", "progressbar");
        track.setAttribute("aria-label", `${model.displayName} 下载进度`);
        track.setAttribute("aria-valuemin", "0");
        track.setAttribute("aria-valuemax", "100");
        const percent = Math.max(0, Math.min(100, Number(progress?.progress) || 0));
        track.setAttribute("aria-valuenow", String(Math.round(percent)));
        const bar = element("span");
        bar.style.width = `${percent}%`;
        track.append(bar);
        const meta = element("small", "voice-model-progress-meta", progress?.total ? `${percent.toFixed(0)}% · ${formatBytes(progress.current)} / ${formatBytes(progress.total)}` : `${percent.toFixed(0)}% · 正在连接模型仓库`);
        append(copy, track, meta);
      }
      const actions = element("span", "voice-model-actions");
      if (downloading) actions.append(voiceModelAction(model.name, `取消下载 ${model.displayName}`, "cancel", "square", { label: "取消" }));
      else if (!model.downloaded) actions.append(voiceModelAction(model.name, `下载 ${model.displayName}`, "download", failed ? "rotate-cw" : "download", { label: failed ? "重试" : "下载" }));
      else {
        if (model.loaded) actions.append(voiceModelAction(model.name, `从内存卸载 ${model.displayName}`, "unload", "power", { label: "卸载" }));
        actions.append(voiceModelAction(model.name, `删除本地模型 ${model.displayName}`, "delete", "trash-2", { danger: true }));
      }
      append(row, modelIcon, copy, actions);
      return row;
    };

    const engines = [...new Set([...VOICEBOX_ENGINE_ORDER, ...models.map((model) => model.engine).filter(Boolean)])];
    const groups = engines.flatMap((engine) => {
      const engineModels = models.filter((model) => model.engine === engine);
      if (!engineModels.length) return [];
      const group = element("section", "voice-model-group");
      const header = element("header", "voice-model-group-heading");
      const title = element("span");
      append(title, icon(VOICEBOX_ENGINE_ICONS[engine] || "boxes"), element("strong", "", VOICEBOX_ENGINE_LABELS[engine] || engine));
      const ready = engineModels.filter((model) => model.downloaded).length;
      append(header, title, element("small", "", `${ready} / ${engineModels.length} 已下载`));
      const list = element("div", "voice-model-group-list");
      list.append(...engineModels.map(renderModel));
      append(group, header, list);
      return [group];
    });
    $("#voiceModelList").replaceChildren(...groups);
    refreshIcons();
  }

  function renderVoiceboxGeneration() {
    const generation = state.voiceboxGeneration;
    const status = generation?.status || "idle";
    const active = VOICEBOX_ACTIVE_STATES.has(status);
    const labels = {
      idle: ["等待生成", "生成完成后可在这里试听"],
      queued: ["已加入队列", "Voicebox 将依次处理本机生成任务"],
      loading_model: ["正在加载模型", "首次使用模型时可能需要更长时间"],
      generating: ["正在生成语音", "请保持 Voicebox 运行"],
      completed: ["生成完成", generation?.duration ? `已生成 ${generation.duration.toFixed(1)} 秒语音` : "可以试听或保存音频"],
      failed: ["生成失败", generation?.error || "请检查 Voicebox 模型状态后重试"],
      not_found: ["任务不存在", "Voicebox 中未找到该生成任务"],
      canceled: ["已取消生成", "可修改文案后重新生成"],
    };
    const [title, detail] = labels[status] || ["正在处理", "请稍候"];
    const stage = $("#voiceOutputStage");
    stage.className = `voice-output-stage ${status}`;
    stage.setAttribute("aria-busy", String(active));
    $("#voiceOutputStatus").textContent = title;
    $("#voiceOutputDetail").textContent = detail;
    $("#generateVoice").disabled = active || !state.voiceboxStatus?.available || !(state.voiceboxStatus?.profiles?.length);
    $("#generateVoice").setAttribute("aria-busy", String(active));
    $("#generateVoice span").textContent = active ? "正在生成" : "生成语音";
    $("#cancelVoice").hidden = !active;
    const completed = status === "completed" && Boolean(generation?.audioUrl);
    const player = $("#voicePlayer");
    player.hidden = !completed;
    $("#voiceOutputActions").hidden = !completed;
    if (completed && player.dataset.source !== generation.audioUrl) {
      player.dataset.source = generation.audioUrl;
      player.src = generation.audioUrl;
      player.load();
    }
    if (!completed && player.dataset.source) {
      player.pause();
      player.removeAttribute("src");
      player.removeAttribute("data-source");
      player.load();
    }
    $("#voiceOutputDuration").textContent = generation?.duration ? formatDuration(generation.duration) : "--:--";
  }

  function renderVoicebox() {
    const status = state.voiceboxStatus || { available: false, profiles: [] };
    const profiles = Array.isArray(status.profiles) ? status.profiles : [];
    const runtimeState = status.runtime?.state || (status.available ? "ready" : "failed");
    const starting = runtimeState === "starting";
    const connection = $("#voiceConnection");
    connection.className = `voice-connection ${status.available ? "online" : starting ? "pending" : "offline"}`;
    connection.replaceChildren(
      element("span", `status-dot${status.available ? "" : starting ? " pending" : " error"}`),
      element("span", "", status.available ? "内置服务就绪" : starting ? "正在启动" : "服务异常"),
    );
    $("#voiceOffline").hidden = status.available;
    const offlineTitles = { starting: "正在启动语音服务", missing: "语音运行时缺失", failed: "语音服务启动失败", stopped: "语音服务已停止" };
    $("#voiceOfflineTitle").textContent = offlineTitles[runtimeState] || "语音服务暂不可用";
    $("#voiceOfflineMessage").textContent = status.message || "ClipPort 正在准备内置 Voicebox 运行时。";
    $("#getVoicebox").disabled = starting;
    $("#voiceResources").hidden = !status.available;
    $("#voiceStudio").hidden = !status.available || !profiles.length;
    $("#voiceEmptyProfiles").hidden = !status.available || Boolean(profiles.length);
    const select = $("#voiceProfile");
    const selectedId = select.value;
    select.replaceChildren(...profiles.map((profile) => {
      const option = element("option", "", profile.name);
      option.value = profile.id;
      return option;
    }));
    if (profiles.some((profile) => profile.id === selectedId)) select.value = selectedId;
    const profile = selectedVoiceProfile();
    if (profile && !selectedId) $("#voiceLanguage").value = profile.language || "zh";
    const runtime = status.gpuType || (status.backend ? status.backend.toUpperCase() : "CPU");
    $("#voiceRuntime").textContent = `${status.version ? `Voicebox ${status.version} · ` : ""}${runtime}`;
    renderVoiceProfile(false);
    renderVoiceModels();
    renderVoiceboxGeneration();
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
    $("#ytDlpStatus").textContent = ytDlp.available ? `${compactVersion(ytDlp.version)} · ${ytDlp.source}` : "未安装，需要安装或选择文件";
    $("#ffmpegStatus").textContent = ffmpeg.available ? `${compactVersion(ffmpeg.version)} · ${ffmpeg.source}` : "不可用，请选择可执行文件";
    $("#ffprobeStatus").textContent = ffprobe.available ? `${compactVersion(ffprobe.version)} · ${ffprobe.source}` : "不可用，请选择可执行文件";
    $("#toolchainAlert").hidden = status.ready;
    $("#allToolsReady").hidden = !status.ready;
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

  function isVoiceTask(task) {
    return task.kind === "voice";
  }

  function taskTitle(task) {
    return isVoiceTask(task) ? task.title || "语音生成" : task.media?.title || "未命名任务";
  }

  function taskSubtitle(task) {
    if (!isVoiceTask(task)) return `${PRESETS[task.options?.preset]?.label || "媒体下载"} · ${formatDuration(task.media?.duration)}`;
    const voice = task.voice || {};
    return ["语音生成", voice.profileName, VOICE_LANGUAGE_LABELS[voice.language] || voice.language].filter(Boolean).join(" · ");
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
    row.dataset.kind = task.kind || "download";
    row.dataset.taskId = task.id;
    const voiceTask = isVoiceTask(task);
    const nameCell = element("div", "task-name-cell");
    const typeIcon = element("span", `file-type ${voiceTask ? "voice" : ["audio", "mp3"].includes(task.options?.preset) ? "blue" : ""}`);
    typeIcon.append(icon(voiceTask ? "audio-lines" : ["audio", "mp3"].includes(task.options?.preset) ? "music-2" : task.options?.preset === "subtitles" ? "captions" : "file-video-2"));
    const title = element("span");
    append(title, element("strong", "", taskTitle(task)), element("small", "", taskSubtitle(task)));
    append(nameCell, typeIcon, title);

    const statusCell = element("div", "task-status-cell");
    const statusLine = element("div");
    const percent = Number(task.progress?.percent) || 0;
    const speedText = !voiceTask && task.state === "downloading"
      ? task.progress?.speed ? `${formatBytes(task.progress.speed)}/s` : "测速中"
      : task.stage || "";
    append(statusLine, element("span", task.state === "failed" ? "status-error" : "", `${stateLabel(task)}${!voiceTask && task.state === "downloading" ? ` · ${percent.toFixed(0)}%` : ""}`), element("span", "", speedText));
    const indeterminate = task.state === "processing" || task.state === "verifying" || (voiceTask && ACTIVE_STATES.has(task.state) && task.progress?.percent == null);
    const progress = element("div", `progress-track${indeterminate ? " processing" : ""}`);
    const value = element("span");
    if (!progress.classList.contains("processing")) value.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    progress.append(value);
    append(statusCell, statusLine, progress);
    if (task.error?.message) statusCell.append(element("small", "", task.error.message));

    const sizeCell = element("div", "task-size-cell");
    let sizePrimary;
    let sizeSecondary;
    if (voiceTask) {
      sizePrimary = task.state === "completed" && task.voice?.duration ? formatDuration(task.voice.duration) : `${task.voice?.textLength || 0} 字`;
      sizeSecondary = task.state === "completed" && task.voice?.duration ? "生成时长" : "输入文本";
    } else {
      const downloadedBytes = Number(task.progress?.downloadedBytes) || 0;
      const totalBytes = Number(task.progress?.totalBytes) || Number(task.media?.estimatedBytes) || 0;
      const completed = task.state === "completed" && task.finalOutputs?.length;
      sizePrimary = completed && totalBytes
        ? formatBytes(totalBytes)
        : downloadedBytes
          ? formatBytes(downloadedBytes)
          : totalBytes
            ? `约 ${formatBytes(totalBytes)}`
            : "--";
      sizeSecondary = completed && totalBytes
        ? "最终大小"
        : downloadedBytes && totalBytes
          ? `共 ${formatBytes(totalBytes)}`
          : downloadedBytes
            ? "已下载 · 总大小计算中"
            : totalBytes
              ? "预计大小"
              : "大小计算中";
    }
    append(sizeCell, element("strong", "", sizePrimary), element("small", "", sizeSecondary));
    const actions = element("div", "task-actions-cell");
    if (voiceTask) {
      if (task.state === "completed" && task.voice?.audioUrl) {
        actions.append(createIconButton("play", "试听语音", "voice-open", task.id));
        actions.append(createIconButton("download", "保存语音", "voice-save", task.id));
      }
      if (["queued", ...ACTIVE_STATES].includes(task.state)) actions.append(createIconButton("x", "取消语音任务", "cancel", task.id, "danger-hover"));
      else actions.append(createIconButton("trash-2", "移除任务", "remove", task.id, "danger-hover"));
    } else {
      if (ACTIVE_STATES.has(task.state)) actions.append(createIconButton("pause", "暂停任务", "pause", task.id));
      if (["paused", "failed", "interrupted"].includes(task.state)) actions.append(createIconButton("play", "继续任务", "resume", task.id));
      if (task.state === "completed" && task.finalOutputs?.length) actions.append(createIconButton("play", "打开文件", "open", task.id));
      if (["queued", "paused", ...ACTIVE_STATES].includes(task.state)) actions.append(createIconButton("x", "取消任务", "cancel", task.id, "danger-hover"));
      else actions.append(createIconButton("trash-2", "移除任务", "remove", task.id, "danger-hover"));
    }
    append(row, nameCell, statusCell, sizeCell, actions);
    return row;
  }

  function renderTasks() {
    const counts = taskCounts();
    const liveSpeed = state.tasks.reduce((sum, task) => sum + (!isVoiceTask(task) && task.state === "downloading" ? Number(task.progress?.speed) || 0 : 0), 0);
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
    row.dataset.kind = task.kind || "download";
    const voiceTask = isVoiceTask(task);
    const head = element("div", "queue-task-head");
    const thumb = element("span", `mini-thumb graphic-thumb ${voiceTask || ["audio", "mp3"].includes(task.options?.preset) ? "navy" : ""}`);
    thumb.append(icon(voiceTask ? "audio-lines" : ["audio", "mp3"].includes(task.options?.preset) ? "music-2" : "download"));
    const copy = element("span", "queue-task-copy");
    const queueSpeed = !voiceTask && task.state === "downloading" ? ` · ${task.progress?.speed ? `${formatBytes(task.progress.speed)}/s` : "测速中"}` : "";
    append(copy, element("strong", "", taskTitle(task)), element("small", "", `${stateLabel(task)}${queueSpeed}`));
    const action = voiceTask
      ? createIconButton("x", "取消语音任务", "cancel", task.id)
      : ACTIVE_STATES.has(task.state)
        ? createIconButton("pause", "暂停任务", "pause", task.id)
        : task.state === "paused"
          ? createIconButton("play", "继续任务", "resume", task.id)
          : createIconButton("x", "取消任务", "cancel", task.id);
    action.classList.remove("bordered");
    append(head, thumb, copy, action);
    const meta = element("div", "progress-meta");
    const downloadedBytes = Number(task.progress?.downloadedBytes) || 0;
    const totalBytes = Number(task.progress?.totalBytes) || Number(task.media?.estimatedBytes) || 0;
    const sizeText = voiceTask
      ? `${task.voice?.textLength || 0} 字 · ${VOICE_LANGUAGE_LABELS[task.voice?.language] || task.voice?.language || "自动"}`
      : totalBytes
        ? `${formatBytes(downloadedBytes)} / ${totalBytes === task.media?.estimatedBytes && !task.progress?.totalBytes ? "约 " : ""}${formatBytes(totalBytes)}`
        : downloadedBytes
          ? `已下载 ${formatBytes(downloadedBytes)}`
          : task.stage || "等待中";
    append(meta, element("span", "", voiceTask ? "语音" : `${Math.round(task.progress?.percent || 0)}%`), element("span", "", sizeText));
    const track = element("div", `progress-track${task.state === "processing" || task.state === "verifying" || (voiceTask && ACTIVE_STATES.has(task.state)) ? " processing" : ""}`);
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

  function renderDiagnosticLogs() {
    const list = $("#diagnosticLogList");
    if (!list) return;
    const logs = Array.isArray(state.diagnosticLogs) ? state.diagnosticLogs : [];
    $("#diagnosticLogCount").textContent = `${logs.length} 条日志`;
    list.replaceChildren();
    for (const entry of logs.slice().reverse()) {
      const row = element("article", `diagnostic-log-row ${entry.level || "info"}`);
      const levelName = LOG_LEVEL_TEXT[entry.level] || "INFO";
      const time = element("time", "diagnostic-time", formatLogDate(entry.timestamp));
      time.dateTime = entry.timestamp || "";
      time.title = entry.timestamp ? formatLicenseDate(entry.timestamp, true) : "未知时间";
      const output = element("div", "diagnostic-output");
      const line = element("p", "diagnostic-message");
      append(
        line,
        element("span", "diagnostic-level", levelName),
        element("span", "diagnostic-source", LOG_SOURCE_LABELS[entry.source] || entry.source || "应用"),
        document.createTextNode(entry.message || "未提供日志信息"),
      );
      output.append(line);
      const hasDetails = entry.details && (typeof entry.details !== "object" || Object.keys(entry.details).length > 0);
      if (hasDetails) {
        const disclosure = element("details", "diagnostic-details");
        const summary = element("summary", "", "展开详情");
        const detailOutput = element("pre", "", typeof entry.details === "string" ? entry.details : JSON.stringify(entry.details, null, 2));
        append(disclosure, summary, detailOutput);
        output.append(disclosure);
      }
      append(row, time, output);
      list.append(row);
    }
    $("#diagnosticLogEmpty").hidden = logs.length > 0;
    list.hidden = logs.length === 0;
    const viewer = $("#diagnosticLogViewer");
    if (state.logAutoScroll && viewer) requestAnimationFrame(() => { viewer.scrollTop = viewer.scrollHeight; });
    $("#scrollDiagnosticLogsBottom").hidden = state.logAutoScroll || logs.length === 0;
    refreshIcons();
  }

  function scrollDiagnosticLogsBottom() {
    const viewer = $("#diagnosticLogViewer");
    if (!viewer) return;
    state.logAutoScroll = true;
    viewer.scrollTo({ top: viewer.scrollHeight, behavior: "smooth" });
    $("#scrollDiagnosticLogsBottom").hidden = true;
  }

  function handleDiagnosticLogScroll(event) {
    const viewer = event.currentTarget;
    state.logAutoScroll = viewer.scrollHeight - viewer.scrollTop - viewer.clientHeight < 40;
    $("#scrollDiagnosticLogsBottom").hidden = state.logAutoScroll || state.diagnosticLogs.length === 0;
  }

  function upsertDiagnosticLog(entry) {
    if (!entry?.id) return;
    state.diagnosticLogs = [entry, ...(state.diagnosticLogs || []).filter((item) => item.id !== entry.id)].slice(0, 500);
    renderDiagnosticLogs();
  }

  async function refreshDiagnosticLogs(showResult = false) {
    if (!api.logs?.list) return;
    const button = $("#refreshDiagnosticLogs");
    if (button) button.disabled = true;
    try {
      state.diagnosticLogs = await call(api.logs.list({ limit: 500 }));
      renderDiagnosticLogs();
      if (showResult) showToast("诊断日志已刷新", `已读取 ${state.diagnosticLogs.length} 条最近记录`);
    } catch (error) {
      if (showResult) showToast("无法读取诊断日志", error.message, "error");
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function exportDiagnosticLogs() {
    const button = $("#exportDiagnosticLogs");
    button.disabled = true;
    try {
      const filePath = await call(api.logs.export());
      if (filePath) showToast("诊断日志已导出", "导出内容已自动隐藏敏感信息");
    } catch (error) {
      showToast("无法导出诊断日志", error.message, "error");
    } finally {
      button.disabled = false;
    }
  }

  async function clearDiagnosticLogs() {
    if (!window.clipport && !window.confirm("清空全部本地诊断日志？")) return;
    const button = $("#clearDiagnosticLogs");
    button.disabled = true;
    try {
      const cleared = await call(api.logs.clear());
      if (cleared) {
        state.diagnosticLogs = [];
        renderDiagnosticLogs();
        showToast("诊断日志已清空");
      }
    } catch (error) {
      showToast("无法清空诊断日志", error.message, "error");
    } finally {
      button.disabled = false;
    }
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

    const sidebarVersion = $("#sidebarAppVersion");
    const sidebarAction = $("#sidebarUpdateAction");
    const sidebarText = $("#sidebarUpdateText");
    const sidebarDot = $("#sidebarUpdateDot");
    const latestVersion = status.latestVersion ? `v${status.latestVersion}` : "";
    const sidebarLabels = {
      idle: "等待检查更新",
      checking: "正在检查更新",
      current: "已是最新版",
      available: latestVersion ? `发现 ${latestVersion}，准备下载` : "发现新版本，准备下载",
      downloading: `下载新版本 ${Math.round(Number(status.progress) || 0)}%`,
      downloaded: latestVersion ? `新版本 ${latestVersion}，点击安装` : "新版本已下载，点击安装",
      error: "检查失败，稍后自动重试",
      disabled: "开发版不检查更新",
    };
    const installReady = status.status === "downloaded";
    sidebarVersion.textContent = state.appVersion ? `v${state.appVersion}` : "--";
    sidebarText.textContent = sidebarLabels[status.status] || status.message || "等待检查更新";
    sidebarDot.className = `status-dot${new Set(["idle", "checking", "disabled"]).has(status.status) ? " pending" : status.status === "error" ? " error" : ""}`;
    sidebarAction.disabled = !installReady;
    sidebarAction.classList.toggle("actionable", installReady);
    sidebarAction.title = installReady ? "重启 ClipPort 并安装已下载的更新" : sidebarText.textContent;
    sidebarAction.setAttribute("aria-label", sidebarAction.title);

    statusNode.textContent = status.message || "可手动检查更新";
    const downloading = status.status === "downloading";
    const percent = Math.max(0, Math.min(100, Number(status.progress) || 0));
    const sizeText = status.totalBytes
      ? `${formatBytes(status.downloadedBytes)} / ${formatBytes(status.totalBytes)}`
      : status.downloadedBytes ? `已下载 ${formatBytes(status.downloadedBytes)}` : "正在准备下载";
    const speedText = status.bytesPerSecond ? ` · ${formatBytes(status.bytesPerSecond)}/s` : "";
    const progressMeta = `${Math.round(percent)}% · ${sizeText}${speedText}`;
    const inlineProgress = $("#updateInlineProgress");
    inlineProgress.hidden = !downloading;
    $("#updateInlineBar").style.transform = `scaleX(${percent / 100})`;
    $(".update-progress-track", inlineProgress).setAttribute("aria-valuenow", String(Math.round(percent)));
    $("#updateInlineMeta").textContent = progressMeta;

    const floatingProgress = $("#updateDownloadStatus");
    floatingProgress.hidden = !downloading;
    $("#updateDownloadTitle").textContent = status.latestVersion ? `正在下载 ClipPort ${status.latestVersion}` : "正在下载安装包";
    $("#updateDownloadPercent").textContent = `${Math.round(percent)}%`;
    $("#updateDownloadBar").style.transform = `scaleX(${percent / 100})`;
    $("#updateDownloadTrack").setAttribute("aria-valuenow", String(Math.round(percent)));
    $("#updateDownloadMeta").textContent = `${sizeText}${speedText}`;
    const buttonLabel = $("span", button);
    const busy = status.status === "checking" || downloading;
    button.disabled = busy || status.status === "disabled";
    button.toggleAttribute("aria-busy", busy);
    if (status.status === "checking") buttonLabel.textContent = "正在检查";
    else if (status.status === "downloading") buttonLabel.textContent = `下载中 ${Math.round(status.progress || 0)}%`;
    else if (status.status === "available") buttonLabel.textContent = "下载更新";
    else if (status.status === "downloaded") buttonLabel.textContent = "重启安装";
    else if (status.status === "disabled") buttonLabel.textContent = "仅安装版支持";
    else buttonLabel.textContent = "检查更新";
    const actionIconName = status.status === "downloaded"
      ? "refresh-cw"
      : status.status === "downloading" || status.status === "available"
        ? "download"
        : status.status === "checking"
          ? "loader-circle"
          : "search";
    const actionIcon = $("svg, i", button);
    if (actionIcon?.dataset.lucide !== actionIconName) {
      actionIcon?.replaceWith(icon(actionIconName));
      refreshIcons();
    }
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
    const task = state.tasks.find((item) => item.id === id);
    try {
      if (action === "open") await call(api.files.open("task", id));
      else if (action === "voice-open" && task?.voice?.audioUrl) {
        state.voiceboxGeneration = { id, status: "completed", duration: task.voice.duration, error: "", audioUrl: task.voice.audioUrl };
        renderVoiceboxGeneration();
        showView("voice");
        $("#voicePlayer").play().catch(() => {});
      }
      else if (action === "voice-save") {
        const filePath = await call(api.voicebox.saveAudio(id));
        if (filePath) showToast("语音已保存", filePath);
      }
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
      const title = method === "download" ? "更新下载失败" : method === "install" ? "无法安装更新" : "检查更新失败";
      showToast(title, error.message, "error");
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

  async function refreshVoicebox(showResult = true) {
    const button = $("#refreshVoicebox");
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try {
      state.voiceboxStatus = await call(api.voicebox.status());
      renderVoicebox();
      if (showResult) {
        showToast(
          state.voiceboxStatus.available ? "Voicebox 已连接" : "Voicebox 未连接",
          state.voiceboxStatus.message,
          state.voiceboxStatus.available ? "success" : "error",
        );
      }
    } catch (error) {
      showToast("Voicebox 连接失败", error.message, "error");
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  }

  async function restartVoicebox() {
    const button = $("#getVoicebox");
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try {
      state.voiceboxStatus = await call(api.voicebox.restart());
      renderVoicebox();
      showToast("语音服务正在启动", state.voiceboxStatus.message || "通过健康检查后会自动连接");
    } catch (error) {
      showToast("无法启动语音服务", error.message, "error");
    } finally {
      button.removeAttribute("aria-busy");
      if (state.voiceboxStatus?.runtime?.state !== "starting") button.disabled = false;
    }
  }

  async function loadPresetVoices() {
    if (state.newVoiceProfileType !== "preset") return;
    const select = $("#newPresetVoice");
    select.disabled = true;
    select.replaceChildren(new Option("正在读取音色", ""));
    try {
      const voices = await call(api.voicebox.presetVoices($("#newVoiceEngine").value));
      select.replaceChildren(...voices.map((voice) => new Option(`${voice.name}${voice.language ? ` · ${voice.language}` : ""}`, voice.id)));
      if (!voices.length) select.replaceChildren(new Option("该引擎没有可用预设音色", ""));
    } catch (error) {
      select.replaceChildren(new Option("读取预设音色失败", ""));
      showToast("无法读取预设音色", error.message, "error");
    } finally {
      select.disabled = false;
    }
  }

  function setVoiceProfileError(message, focusTarget) {
    const errorNode = $("#voiceProfileError");
    errorNode.textContent = message;
    errorNode.hidden = false;
    if (focusTarget) {
      focusTarget.setAttribute("aria-invalid", "true");
      focusTarget.focus();
    }
  }

  function clearVoiceProfileError() {
    $("#voiceProfileError").hidden = true;
    $$("#voiceProfileForm [aria-invalid='true']").forEach((node) => node.removeAttribute("aria-invalid"));
  }

  function supportedVoiceSampleName(name) {
    const extension = String(name || "").split(".").pop()?.toLowerCase();
    return Boolean(extension && VOICE_SAMPLE_EXTENSIONS.has(extension));
  }

  function voiceSampleSourceLabel(source) {
    return { upload: "上传文件", microphone: "麦克风录制", system: "系统音频" }[source] || "声音样本";
  }

  function renderVoiceSample() {
    const preview = $("#voiceSamplePreview");
    preview.hidden = !newVoiceSample;
    if (!newVoiceSample) {
      $("#voiceSamplePlayer").removeAttribute("src");
      return;
    }
    $("#voiceSampleName").textContent = newVoiceSample.name;
    $("#voiceSampleMeta").textContent = `${voiceSampleSourceLabel(newVoiceSample.source)} · ${formatBytes(newVoiceSample.blob.size)}`;
    const player = $("#voiceSamplePlayer");
    const sample = newVoiceSample;
    player.src = newVoiceSampleUrl;
    player.onloadedmetadata = () => {
      if (newVoiceSample !== sample) return;
      const duration = Number.isFinite(player.duration) ? ` · ${formatDuration(player.duration)}` : "";
      $("#voiceSampleMeta").textContent = `${voiceSampleSourceLabel(sample.source)} · ${formatBytes(sample.blob.size)}${duration}`;
    };
  }

  function clearVoiceSample() {
    if (newVoiceSampleUrl) URL.revokeObjectURL(newVoiceSampleUrl);
    newVoiceSampleUrl = "";
    newVoiceSample = null;
    $("#newVoiceSampleFile").value = "";
    renderVoiceSample();
  }

  function useVoiceSample(blob, name, source) {
    clearVoiceProfileError();
    if (!(blob instanceof Blob) || blob.size <= 0) {
      setVoiceProfileError("声音样本为空，请重新选择或录制");
      return false;
    }
    if (blob.size > VOICE_SAMPLE_MAX_BYTES) {
      setVoiceProfileError("声音样本不能超过 50 MB");
      return false;
    }
    if (!supportedVoiceSampleName(name)) {
      setVoiceProfileError("请选择 WAV、MP3、M4A、FLAC、OGG、AAC、WebM 或 Opus 音频");
      return false;
    }
    clearVoiceSample();
    newVoiceSample = { blob, name, type: blob.type || "application/octet-stream", source };
    newVoiceSampleUrl = URL.createObjectURL(blob);
    renderVoiceSample();
    return true;
  }

  function resetVoiceCaptureHints() {
    $("#voiceMicHint").textContent = VOICE_MIC_DEFAULT_HINT;
    $("#voiceSystemHint").textContent = VOICE_SYSTEM_DEFAULT_HINT;
  }

  async function refreshVoiceInputStatus() {
    const requestId = ++voiceDeviceStatusRequestId;
    const hint = $("#voiceMicHint");
    if (!navigator.mediaDevices?.enumerateDevices) {
      hint.textContent = "无法读取输入设备列表，仍可尝试开始录制";
      return;
    }
    hint.textContent = "正在检测麦克风";
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (requestId !== voiceDeviceStatusRequestId || state.newVoiceSampleMode !== "microphone") return;
      const inputs = devices.filter((device) => device.kind === "audioinput");
      const named = inputs.find((device) => device.label)?.label;
      hint.textContent = inputs.length
        ? `${named || `已检测到 ${inputs.length} 个输入设备`} · 可开始录制`
        : "暂未检测到麦克风；连接或启用输入设备后可直接重试";
    } catch {
      if (requestId === voiceDeviceStatusRequestId) hint.textContent = "无法读取输入设备列表，仍可尝试开始录制";
    }
  }

  function voiceCaptureFailure(error, mode) {
    const name = String(error?.name || "");
    const rawMessage = String(error?.message || "");
    const microphone = mode === "microphone";
    if (name === "NotFoundError" || name === "DevicesNotFoundError" || /requested device not found|未检测到可用麦克风|未检测到系统音频/i.test(rawMessage)) {
      return microphone
        ? {
            message: "未检测到可用麦克风。请连接或启用输入设备，并在 Windows 设置 > 系统 > 声音 > 输入 中确认设备可用；也可改用系统音频或上传音频。",
            hint: "未检测到麦克风；请连接或启用输入设备后重试",
          }
        : {
            message: "未检测到可采集的系统音频。请确认 Windows 存在可用的播放设备，并先开始播放音频。",
            hint: "未检测到播放设备或系统音频",
          };
    }
    if (name === "NotAllowedError" || name === "SecurityError") {
      return microphone
        ? {
            message: "麦克风权限被系统拒绝。请在 Windows 设置 > 隐私和安全性 > 麦克风 中允许桌面应用访问麦克风，然后重试。",
            hint: "麦克风权限未开启；修改 Windows 隐私设置后重试",
          }
        : {
            message: "系统音频采集未获允许。请重新开始采集；若仍失败，请确认正在使用 Windows 10/11 且播放设备可用。",
            hint: "系统音频采集未获允许，请重试",
          };
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return {
        message: microphone ? "麦克风当前无法读取，可能正被其他应用独占。请关闭占用麦克风的应用后重试。" : "系统音频当前无法读取，请确认播放设备未被独占后重试。",
        hint: microphone ? "麦克风可能正被其他应用占用" : "播放设备可能正被其他应用独占",
      };
    }
    if (name === "OverconstrainedError") {
      return { message: "当前音频设备不支持所需录制参数，请更换设备或改用上传音频。", hint: "当前设备不支持录制参数" };
    }
    return {
      message: `无法开始${microphone ? "录制" : "系统音频采集"}。请检查设备后重试，或改用上传音频。`,
      hint: microphone ? "无法启动麦克风，请检查设备后重试" : "无法启动系统音频采集，请重试",
    };
  }

  function setVoiceSampleMode(mode) {
    const selected = new Set(["upload", "microphone", "system"]).has(mode) ? mode : "upload";
    const previous = state.newVoiceSampleMode;
    if (previous !== selected) {
      voiceCaptureRequestId += 1;
      if (previous !== "upload") resetVoiceCaptureUi(previous);
      clearVoiceProfileError();
    }
    if (voiceCapture && voiceCapture.mode !== selected) stopVoiceCapture(true);
    state.newVoiceSampleMode = selected;
    $$("[data-voice-sample-mode]").forEach((button) => {
      const active = button.dataset.voiceSampleMode === selected;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    $("#voiceSampleUploadPanel").hidden = selected !== "upload";
    $("#voiceSampleMicPanel").hidden = selected !== "microphone";
    $("#voiceSampleSystemPanel").hidden = selected !== "system";
    if (selected === "microphone") refreshVoiceInputStatus();
  }

  function resetVoiceCaptureUi(mode) {
    const microphone = mode === "microphone";
    const panel = $(microphone ? "#voiceSampleMicPanel" : "#voiceSampleSystemPanel");
    const start = $(microphone ? "#startVoiceMic" : "#startVoiceSystem");
    const stop = $(microphone ? "#stopVoiceMic" : "#stopVoiceSystem");
    const time = $(microphone ? "#voiceMicTime" : "#voiceSystemTime");
    panel.classList.remove("recording");
    start.hidden = false;
    start.disabled = false;
    $("span", start).textContent = microphone ? "开始录制" : "开始采集";
    stop.hidden = true;
    stop.disabled = false;
    time.textContent = "00:00 / 00:30";
    time.dateTime = "PT0S";
  }

  function cleanupVoiceCapture(capture) {
    clearInterval(capture.timerId);
    if (voiceCapture === capture) voiceCapture = null;
    capture.sourceStream?.getTracks().forEach((track) => track.stop());
    resetVoiceCaptureUi(capture.mode);
  }

  function stopVoiceCapture(discard = false) {
    const capture = voiceCapture;
    if (!capture) return;
    capture.discard ||= discard;
    if (capture.recorder.state !== "inactive") capture.recorder.stop();
    else cleanupVoiceCapture(capture);
  }

  function updateVoiceCaptureTime(capture) {
    const elapsed = Math.min(VOICE_CAPTURE_MAX_MS, Date.now() - capture.startedAt);
    const seconds = Math.floor(elapsed / 1000);
    const time = $(capture.mode === "microphone" ? "#voiceMicTime" : "#voiceSystemTime");
    time.textContent = `00:${String(seconds).padStart(2, "0")} / 00:30`;
    time.dateTime = `PT${seconds}S`;
    if (elapsed >= VOICE_CAPTURE_MAX_MS) stopVoiceCapture();
  }

  function preferredRecordingType() {
    if (typeof MediaRecorder.isTypeSupported !== "function") return "";
    return ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type)) || "";
  }

  async function startVoiceCapture(mode) {
    clearVoiceProfileError();
    if (!navigator.mediaDevices || typeof MediaRecorder === "undefined") {
      setVoiceProfileError("当前环境不支持音频录制，请改用上传音频");
      return;
    }
    const captureMethod = mode === "microphone" ? navigator.mediaDevices.getUserMedia : navigator.mediaDevices.getDisplayMedia;
    if (typeof captureMethod !== "function") {
      setVoiceProfileError(mode === "microphone" ? "当前环境无法访问麦克风，请改用上传音频" : "当前环境不支持系统音频采集，请改用上传音频");
      return;
    }
    stopVoiceCapture(true);
    const requestId = ++voiceCaptureRequestId;
    const microphone = mode === "microphone";
    const start = $(microphone ? "#startVoiceMic" : "#startVoiceSystem");
    const hint = $(microphone ? "#voiceMicHint" : "#voiceSystemHint");
    start.disabled = true;
    $("span", start).textContent = microphone ? "正在获取麦克风" : "正在连接系统音频";
    hint.textContent = microphone ? "正在请求麦克风并初始化录制" : "正在连接 Windows 系统音频";
    let sourceStream;
    try {
      sourceStream = microphone
        ? await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
        : await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
      if (requestId !== voiceCaptureRequestId || !$("#voiceProfileDialog").open) {
        sourceStream.getTracks().forEach((track) => track.stop());
        resetVoiceCaptureUi(mode);
        return;
      }
      const audioTracks = sourceStream.getAudioTracks();
      if (!audioTracks.length) throw new Error(microphone ? "未检测到可用麦克风" : "未检测到系统音频，请先播放目标音频后重试");
      hint.textContent = microphone
        ? `${audioTracks[0].label || "默认麦克风"} · 正在录制`
        : "正在采集本机播放声音";
      const recordingStream = new MediaStream(audioTracks);
      const mimeType = preferredRecordingType();
      const recorder = mimeType ? new MediaRecorder(recordingStream, { mimeType }) : new MediaRecorder(recordingStream);
      const capture = { mode, recorder, sourceStream, chunks: [], discard: false, startedAt: Date.now(), timerId: 0 };
      voiceCapture = capture;
      recorder.addEventListener("dataavailable", (event) => { if (event.data.size) capture.chunks.push(event.data); });
      recorder.addEventListener("stop", () => {
        const durationMs = Date.now() - capture.startedAt;
        cleanupVoiceCapture(capture);
        if (capture.discard) return;
        const type = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(capture.chunks, { type });
        const prefix = mode === "microphone" ? "microphone" : "system-audio";
        if (durationMs < 500 || !blob.size) {
          setVoiceProfileError("录音时间过短，请至少录制 1 秒");
          return;
        }
        const extension = type.includes("ogg") ? "ogg" : "webm";
        useVoiceSample(blob, `${prefix}-${Date.now()}.${extension}`, mode);
        hint.textContent = microphone ? "录制完成，可试听或重新录制" : "采集完成，可试听或重新采集";
      }, { once: true });
      sourceStream.getTracks().forEach((track) => track.addEventListener("ended", () => {
        if (voiceCapture === capture) stopVoiceCapture();
      }, { once: true }));
      const panel = $(microphone ? "#voiceSampleMicPanel" : "#voiceSampleSystemPanel");
      panel.classList.add("recording");
      start.hidden = true;
      const stop = $(microphone ? "#stopVoiceMic" : "#stopVoiceSystem");
      stop.hidden = false;
      recorder.start(1000);
      updateVoiceCaptureTime(capture);
      capture.timerId = setInterval(() => updateVoiceCaptureTime(capture), 250);
    } catch (error) {
      sourceStream?.getTracks().forEach((track) => track.stop());
      resetVoiceCaptureUi(mode);
      const failure = voiceCaptureFailure(error, mode);
      hint.textContent = failure.hint;
      recordRendererError("声音采集启动失败", {
        mode,
        name: error?.name,
        message: error?.message,
        constraint: error?.constraint,
      });
      setVoiceProfileError(failure.message);
    }
  }

  function selectNewVoiceProfileType(type) {
    state.newVoiceProfileType = type === "cloned" ? "cloned" : "preset";
    $$('[data-voice-profile-type]').forEach((button) => {
      const active = button.dataset.voiceProfileType === state.newVoiceProfileType;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    const preset = state.newVoiceProfileType === "preset";
    $("#presetVoiceField").hidden = !preset;
    $("#voiceCloneFields").hidden = preset;
    if (preset) {
      voiceCaptureRequestId += 1;
      stopVoiceCapture(true);
      resetVoiceCaptureUi("microphone");
      resetVoiceCaptureUi("system");
    }
    const engines = preset
      ? [["kokoro", "Kokoro"], ["qwen_custom_voice", "Qwen CustomVoice"]]
      : [["qwen", "Qwen3-TTS"], ["luxtts", "LuxTTS"], ["chatterbox", "Chatterbox Multilingual"], ["chatterbox_turbo", "Chatterbox Turbo"], ["tada", "HumeAI TADA"]];
    $("#newVoiceEngine").replaceChildren(...engines.map(([value, label]) => new Option(label, value)));
    if (preset) loadPresetVoices();
  }

  function openVoiceProfileDialog() {
    $("#voiceProfileForm").reset();
    clearVoiceProfileError();
    clearVoiceSample();
    resetVoiceCaptureHints();
    voiceDeviceStatusRequestId += 1;
    voiceCaptureRequestId += 1;
    stopVoiceCapture(true);
    setVoiceSampleMode("upload");
    selectNewVoiceProfileType("preset");
    $("#voiceProfileDialog").showModal();
    requestAnimationFrame(() => $("#newVoiceName").focus());
  }

  function closeVoiceProfileDialog() {
    voiceCaptureRequestId += 1;
    stopVoiceCapture(true);
    clearVoiceSample();
    if ($("#voiceProfileDialog").open) $("#voiceProfileDialog").close();
  }

  async function createVoiceProfile(event) {
    event.preventDefault();
    const errorNode = $("#voiceProfileError");
    clearVoiceProfileError();
    const payload = {
      name: $("#newVoiceName").value.trim(),
      description: $("#newVoiceDescription").value.trim(),
      language: $("#newVoiceLanguage").value,
      voiceType: state.newVoiceProfileType,
      engine: $("#newVoiceEngine").value,
      voiceId: state.newVoiceProfileType === "preset" ? $("#newPresetVoice").value : "",
      referenceText: state.newVoiceProfileType === "cloned" ? $("#newVoiceReference").value.trim() : "",
    };
    if (!payload.name) {
      setVoiceProfileError("请输入档案名称", $("#newVoiceName"));
      return;
    }
    if (payload.voiceType === "cloned" && !newVoiceSample) {
      setVoiceProfileError("请上传、录制或采集一段声音样本", $("[data-voice-sample-mode].active"));
      return;
    }
    if (payload.voiceType === "cloned" && !payload.referenceText) {
      setVoiceProfileError("请准确填写声音样本中的原文", $("#newVoiceReference"));
      return;
    }
    const button = $("#submitVoiceProfile");
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    $("span", button).textContent = "正在创建";
    try {
      if (payload.voiceType === "cloned") {
        payload.sample = {
          name: newVoiceSample.name,
          type: newVoiceSample.type,
          bytes: new Uint8Array(await newVoiceSample.blob.arrayBuffer()),
        };
      }
      const status = await call(api.voicebox.createProfile(payload));
      if (!status) return;
      state.voiceboxStatus = status;
      closeVoiceProfileDialog();
      renderVoicebox();
      showToast("声音档案已创建", payload.voiceType === "cloned" ? "声音样本已保存在本机" : "预设音色可以开始使用");
    } catch (error) {
      errorNode.textContent = error.message;
      errorNode.hidden = false;
      if (error.code === "LICENSE_REQUIRED") focusLicenseSettings();
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      $("span", button).textContent = "创建档案";
    }
  }

  async function deleteVoiceProfile() {
    const profile = selectedVoiceProfile();
    if (!profile) return;
    const button = $("#deleteVoiceProfile");
    button.disabled = true;
    try {
      const status = await call(api.voicebox.deleteProfile(profile.id));
      if (!status) return;
      state.voiceboxStatus = status;
      renderVoicebox();
      showToast("声音档案已删除", profile.name);
    } catch (error) {
      showToast("无法删除声音档案", error.message, "error");
      if (error.code === "LICENSE_REQUIRED") focusLicenseSettings();
    } finally {
      button.disabled = false;
    }
  }

  async function handleVoiceModelAction(button) {
    const name = button.dataset.voiceModelName;
    const action = button.dataset.voiceModelAction;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try {
      if (action === "download") {
        state.voiceboxModelProgress[name] = { modelName: name, status: "queued", progress: 0, current: 0, total: 0 };
        renderVoiceModels();
        await call(api.voicebox.downloadModel(name));
        showToast("模型下载已开始", "可以继续使用 ClipPort 的其他功能");
        return;
      }
      if (action === "cancel") {
        await call(api.voicebox.cancelModel(name));
        delete state.voiceboxModelProgress[name];
        await refreshVoicebox(false);
        showToast("模型下载已取消");
        return;
      }
      const status = await call(action === "unload" ? api.voicebox.unloadModel(name) : api.voicebox.deleteModel(name));
      if (status) {
        state.voiceboxStatus = status;
        renderVoicebox();
      }
      showToast(action === "unload" ? "模型已从内存卸载" : "本地模型已删除");
    } catch (error) {
      showToast("模型操作失败", error.message, "error");
      if (error.code === "LICENSE_REQUIRED") focusLicenseSettings();
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  }

  function updateVoiceboxModelProgress(update) {
    if (!update?.modelName) return;
    state.voiceboxModelProgress[update.modelName] = update;
    renderVoiceModels();
    if (new Set(["complete", "completed"]).has(update.status)) showToast("语音模型下载完成", "现在可以创建对应引擎的声音档案");
    if (new Set(["error", "failed"]).has(update.status)) showToast("语音模型下载失败", update.error || "请检查网络后重试", "error");
  }

  function updateVoiceboxGeneration(update) {
    if (!update?.id) return;
    if (state.voiceboxGeneration?.id && state.voiceboxGeneration.id !== update.id && VOICEBOX_ACTIVE_STATES.has(state.voiceboxGeneration.status)) return;
    const previousStatus = state.voiceboxGeneration?.id === update.id ? state.voiceboxGeneration.status : "";
    state.voiceboxGeneration = { ...(state.voiceboxGeneration?.id === update.id ? state.voiceboxGeneration : {}), ...update };
    renderVoiceboxGeneration();
    if (update.status === "completed" && previousStatus !== "completed") showToast("语音生成完成", "现在可以试听或保存 WAV 音频");
    if (update.status === "failed" && previousStatus !== "failed") showToast("语音生成失败", update.error || "请检查 Voicebox 后重试", "error");
  }

  async function generateVoice(event) {
    event?.preventDefault();
    const profile = selectedVoiceProfile();
    const text = $("#voiceText").value.trim();
    const errorNode = $("#voiceError");
    errorNode.hidden = true;
    $("#voiceText").removeAttribute("aria-invalid");
    if (!profile) {
      errorNode.textContent = "请先在 Voicebox 中创建声音档案";
      errorNode.hidden = false;
      return;
    }
    if (!text) {
      errorNode.textContent = "请输入要转换为语音的文案";
      errorNode.hidden = false;
      $("#voiceText").setAttribute("aria-invalid", "true");
      $("#voiceText").focus();
      return;
    }
    $("#generateVoice").disabled = true;
    try {
      state.voiceboxGeneration = await call(api.voicebox.generate({
        profileId: profile.id,
        text,
        language: $("#voiceLanguage").value,
        instruct: $("#voiceInstruct").value.trim(),
        personality: $("#voicePersonality").checked,
      }));
      renderVoiceboxGeneration();
      showToast("语音任务已提交", "Voicebox 正在本机生成音频");
    } catch (error) {
      errorNode.textContent = error.message;
      errorNode.hidden = false;
      showToast("无法生成语音", error.message, "error");
      if (error.code === "LICENSE_REQUIRED") focusLicenseSettings();
    } finally {
      if (!VOICEBOX_ACTIVE_STATES.has(state.voiceboxGeneration?.status)) $("#generateVoice").disabled = false;
    }
  }

  async function cancelVoiceGeneration() {
    const id = state.voiceboxGeneration?.id;
    if (!id) return;
    $("#cancelVoice").disabled = true;
    try {
      updateVoiceboxGeneration(await call(api.voicebox.cancel(id)));
      showToast("语音生成已取消");
    } catch (error) {
      showToast("无法取消生成", error.message, "error");
    } finally {
      $("#cancelVoice").disabled = false;
    }
  }

  async function saveVoiceAudio() {
    const id = state.voiceboxGeneration?.id;
    if (!id) return;
    const button = $("#saveVoiceAudio");
    button.disabled = true;
    try {
      const filePath = await call(api.voicebox.saveAudio(id));
      if (filePath) showToast("语音已保存", filePath);
    } catch (error) {
      showToast("保存语音失败", error.message, "error");
      if (error.code === "LICENSE_REQUIRED") focusLicenseSettings();
    } finally {
      button.disabled = false;
    }
  }

  function handleVoicePlaybackError() {
    const player = $("#voicePlayer");
    const messages = {
      1: "语音播放已中止，请重新生成后再试",
      2: "读取生成音频失败，请稍后重试",
      3: "生成音频无法解码，请重新生成",
      4: "生成音频格式不受支持",
    };
    const mediaErrorCode = player.error?.code || 0;
    const message = messages[mediaErrorCode] || "读取生成音频失败，请稍后重试";
    showToast("无法播放语音", message, "error");
    recordRendererError("语音播放失败", {
      generationId: state.voiceboxGeneration?.id || "",
      mediaErrorCode,
      mediaErrorMessage: player.error?.message || "",
      networkState: player.networkState,
      readyState: player.readyState,
    });
  }

  function recordRendererError(message, details) {
    if (!api.logs?.record || recordRendererError.pending) return;
    recordRendererError.pending = true;
    call(api.logs.record({ level: "error", message, details }))
      .catch(() => {})
      .finally(() => { recordRendererError.pending = false; });
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
      const voiceModelAction = event.target.closest("[data-voice-model-action]");
      if (voiceModelAction) handleVoiceModelAction(voiceModelAction);
      const voiceProfileType = event.target.closest("[data-voice-profile-type]");
      if (voiceProfileType) selectNewVoiceProfileType(voiceProfileType.dataset.voiceProfileType);
      const voiceSampleMode = event.target.closest("[data-voice-sample-mode]");
      if (voiceSampleMode) setVoiceSampleMode(voiceSampleMode.dataset.voiceSampleMode);
    });
    document.addEventListener("keydown", (event) => {
      if (!new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]).has(event.key)) return;
      const groups = ["[data-preset]", "[data-option-tab]", "[data-task-filter]", "[data-voice-profile-type]", "[data-voice-sample-mode]"];
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
    $("#voiceForm").addEventListener("submit", generateVoice);
    $("#refreshVoicebox").addEventListener("click", () => refreshVoicebox(true));
    $("#getVoicebox").addEventListener("click", restartVoicebox);
    $("#createVoiceProfile").addEventListener("click", openVoiceProfileDialog);
    $("#createFirstVoiceProfile").addEventListener("click", openVoiceProfileDialog);
    $("#deleteVoiceProfile").addEventListener("click", deleteVoiceProfile);
    $("#voiceProfileForm").addEventListener("submit", createVoiceProfile);
    $("#closeVoiceProfileDialog").addEventListener("click", closeVoiceProfileDialog);
    $("#cancelVoiceProfile").addEventListener("click", closeVoiceProfileDialog);
    $("#newVoiceEngine").addEventListener("change", loadPresetVoices);
    $("#voiceProfileDialog").addEventListener("click", (event) => { if (event.target === event.currentTarget) closeVoiceProfileDialog(); });
    $("#voiceProfileDialog").addEventListener("close", () => {
      voiceCaptureRequestId += 1;
      stopVoiceCapture(true);
      clearVoiceSample();
    });
    $("#chooseVoiceSample").addEventListener("click", () => $("#newVoiceSampleFile").click());
    $("#newVoiceSampleFile").addEventListener("change", (event) => {
      const file = event.currentTarget.files?.[0];
      if (file) useVoiceSample(file, file.name, "upload");
    });
    for (const eventName of ["dragenter", "dragover"]) {
      $("#voiceUploadZone").addEventListener(eventName, (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        event.currentTarget.classList.add("dragging");
      });
    }
    for (const eventName of ["dragleave", "drop"]) {
      $("#voiceUploadZone").addEventListener(eventName, (event) => {
        event.preventDefault();
        event.currentTarget.classList.remove("dragging");
      });
    }
    $("#voiceUploadZone").addEventListener("drop", (event) => {
      const file = event.dataTransfer.files?.[0];
      if (file) useVoiceSample(file, file.name, "upload");
    });
    $("#startVoiceMic").addEventListener("click", () => startVoiceCapture("microphone"));
    $("#stopVoiceMic").addEventListener("click", () => stopVoiceCapture());
    $("#startVoiceSystem").addEventListener("click", () => startVoiceCapture("system"));
    $("#stopVoiceSystem").addEventListener("click", () => stopVoiceCapture());
    $("#removeVoiceSample").addEventListener("click", clearVoiceSample);
    $("#newVoiceReference").addEventListener("input", clearVoiceProfileError);
    $("#voiceProfile").addEventListener("change", () => renderVoiceProfile(true));
    $("#voiceText").addEventListener("input", (event) => {
      $("#voiceCharacterCount").textContent = `${event.currentTarget.value.length} / 10000`;
      event.currentTarget.removeAttribute("aria-invalid");
      $("#voiceError").hidden = true;
    });
    $("#cancelVoice").addEventListener("click", cancelVoiceGeneration);
    $("#saveVoiceAudio").addEventListener("click", saveVoiceAudio);
    $("#regenerateVoice").addEventListener("click", () => $("#voiceForm").requestSubmit());
    $("#voicePlayer").addEventListener("error", handleVoicePlaybackError);
    $("#checkUpdates").addEventListener("click", handleUpdateAction);
    $("#sidebarUpdateAction").addEventListener("click", handleUpdateAction);
    $("#refreshDiagnosticLogs").addEventListener("click", () => refreshDiagnosticLogs(true));
    $("#exportDiagnosticLogs").addEventListener("click", exportDiagnosticLogs);
    $("#clearDiagnosticLogs").addEventListener("click", clearDiagnosticLogs);
    $("#scrollDiagnosticLogsBottom").addEventListener("click", scrollDiagnosticLogsBottom);
    $("#diagnosticLogViewer").addEventListener("scroll", handleDiagnosticLogScroll);
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
    $("#installYtDlp").addEventListener("click", async (event) => { const button = event.currentTarget; button.disabled = true; button.setAttribute("aria-busy", "true"); $("span", button).textContent = "正在更新"; try { state.toolchain = await call(api.tools.installYtDlp()); renderToolchain(); showToast("yt-dlp 已更新并通过自检"); } catch (error) { showToast("更新失败", error.message, "error"); } finally { button.disabled = false; button.removeAttribute("aria-busy"); $("span", button).textContent = "检查更新"; } });
    $("#minimizeButton").addEventListener("click", api.app.minimize);
    $("#maximizeButton").addEventListener("click", api.app.toggleMaximize);
    $("#closeButton").addEventListener("click", api.app.close);
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (state.settings.theme === "system") applyTheme(); });
    window.addEventListener("hashchange", () => showView(location.hash.slice(1)));
    window.addEventListener("error", (event) => recordRendererError(event.message || "界面脚本异常", {
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
      stack: event.error?.stack,
    }));
    window.addEventListener("unhandledrejection", (event) => recordRendererError("界面出现未处理的异步异常", {
      message: event.reason?.message || String(event.reason || "未知错误"),
      stack: event.reason?.stack,
    }));
  }

  async function initialize() {
    bindEvents();
    refreshIcons();
    try {
      const bootstrap = await call(api.app.bootstrap());
      Object.assign(state, bootstrap);
      applyTheme(); renderSettings(); renderMedia(); renderTasks(); renderHistory(); renderVoicebox(); renderDiagnosticLogs(); selectPreset("recommended");
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
      api.events.onVoiceboxStatus?.((status) => {
        state.voiceboxStatus = status;
        for (const model of status.models || []) if (model.downloaded && state.voiceboxModelProgress[model.name]?.status === "complete") delete state.voiceboxModelProgress[model.name];
        renderVoicebox();
      });
      api.events.onVoiceboxModelProgress?.(updateVoiceboxModelProgress);
      api.events.onVoiceboxGenerationStatus?.(updateVoiceboxGeneration);
      api.events.onLogEntry?.(upsertDiagnosticLog);
      api.events.onLogsCleared?.(() => { state.diagnosticLogs = []; renderDiagnosticLogs(); });
      window.__clipportState = state;
    } catch (error) {
      showToast("ClipPort 启动失败", error.message, "error");
      $("#parseButton").disabled = true;
    }
  }

  initialize();
})();
