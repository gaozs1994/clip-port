const fs = require("node:fs");
const path = require("node:path");
const { AppError, assertVoiceboxGeneration, assertVoiceboxGenerationId } = require("./validators.cjs");

const DEFAULT_ORIGIN = "http://127.0.0.1:17493";
const MAX_AUDIO_BYTES = 300 * 1024 * 1024;
const MAX_SAMPLE_BYTES = 50 * 1024 * 1024;
const VOICE_TYPES = new Set(["cloned", "preset", "designed"]);
const VOICE_ENGINES = new Set(["qwen", "qwen_custom_voice", "luxtts", "chatterbox", "chatterbox_turbo", "tada", "kokoro"]);
const VOICE_LANGUAGES = new Set(["zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it", "he", "ar", "da", "el", "fi", "hi", "ms", "nl", "no", "pl", "sv", "sw", "tr"]);
const TEN_LANGUAGES = ["zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"];
const VOICEBOX_TTS_MODELS = [
  { name: "qwen-tts-1.7B", displayName: "Qwen TTS 1.7B", engine: "qwen", repository: "Qwen/Qwen3-TTS-12Hz-1.7B-Base", modelSize: "1.7B", sizeMb: 3500, languages: TEN_LANGUAGES, description: "高质量声音克隆，适合正式成片" },
  { name: "qwen-tts-0.6B", displayName: "Qwen TTS 0.6B", engine: "qwen", repository: "Qwen/Qwen3-TTS-12Hz-0.6B-Base", modelSize: "0.6B", sizeMb: 1200, languages: TEN_LANGUAGES, description: "轻量声音克隆，资源占用更低" },
  { name: "qwen-custom-voice-1.7B", displayName: "Qwen CustomVoice 1.7B", engine: "qwen_custom_voice", repository: "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice", modelSize: "1.7B", sizeMb: 3500, languages: TEN_LANGUAGES, description: "内置音色与自然语言风格控制" },
  { name: "qwen-custom-voice-0.6B", displayName: "Qwen CustomVoice 0.6B", engine: "qwen_custom_voice", repository: "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice", modelSize: "0.6B", sizeMb: 1200, languages: TEN_LANGUAGES, description: "轻量预设音色与风格控制" },
  { name: "luxtts", displayName: "LuxTTS", engine: "luxtts", repository: "YatharthS/LuxTTS", modelSize: "", sizeMb: 300, languages: ["en"], description: "快速、CPU 友好的英文语音" },
  { name: "chatterbox-tts", displayName: "Chatterbox Multilingual", engine: "chatterbox", repository: "ResembleAI/chatterbox", modelSize: "", sizeMb: 3200, languages: [...VOICE_LANGUAGES], description: "覆盖 23 种语言的声音克隆" },
  { name: "chatterbox-turbo", displayName: "Chatterbox Turbo", engine: "chatterbox_turbo", repository: "ResembleAI/chatterbox-turbo", modelSize: "", sizeMb: 1500, languages: ["en"], description: "快速英文语音，支持情绪标签" },
  { name: "tada-1b", displayName: "TADA 1B", engine: "tada", repository: "HumeAI/tada-1b", modelSize: "1B", sizeMb: 4000, languages: ["en"], description: "高表现力英文语音模型" },
  { name: "tada-3b-ml", displayName: "TADA 3B Multilingual", engine: "tada", repository: "HumeAI/tada-3b-ml", modelSize: "3B", sizeMb: 8000, languages: ["en", "ar", "zh", "de", "es", "fr", "it", "ja", "pl", "pt"], description: "高表现力多语言大型模型" },
  { name: "kokoro", displayName: "Kokoro 82M", engine: "kokoro", repository: "hexgrad/Kokoro-82M", modelSize: "82M", sizeMb: 350, languages: ["en", "es", "fr", "hi", "it", "pt", "ja", "zh"], description: "体积小、CPU 实时的预设音色" },
];
const MODEL_CATALOG = new Map(VOICEBOX_TTS_MODELS.map((model) => [model.name, model]));

function loopbackOrigin(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" || !new Set(["127.0.0.1", "localhost", "[::1]"]).has(parsed.hostname)) {
    throw new Error("Voicebox origin must use an HTTP loopback address");
  }
  return parsed.origin;
}

function assertModelName(value) {
  const modelName = typeof value === "string" ? value.trim() : "";
  if (!/^[a-z0-9._-]{1,100}$/i.test(modelName)) throw new AppError("INVALID_VOICEBOX_MODEL", "语音模型标识无效");
  return modelName;
}

function sanitizeModel(model = {}) {
  const catalog = MODEL_CATALOG.get(model.model_name) || {};
  const engine = VOICE_ENGINES.has(model.engine) ? model.engine : catalog.engine || "";
  const languages = Array.isArray(model.languages) ? model.languages : catalog.languages || [];
  return {
    name: typeof model.model_name === "string" ? model.model_name : "",
    displayName: typeof model.display_name === "string" ? model.display_name.slice(0, 120) : catalog.displayName || "未命名模型",
    engine,
    repository: typeof model.hf_repo_id === "string" ? model.hf_repo_id.slice(0, 240) : catalog.repository || "",
    modelSize: typeof model.model_size === "string" ? model.model_size.slice(0, 24) : catalog.modelSize || "",
    languages: languages.filter((language) => typeof language === "string" && VOICE_LANGUAGES.has(language)).slice(0, 30),
    description: catalog.description || "Voicebox 语音生成模型",
    downloaded: Boolean(model.downloaded),
    downloading: Boolean(model.downloading),
    loaded: Boolean(model.loaded),
    sizeMb: model.size_mb !== null && model.size_mb !== undefined && Number.isFinite(Number(model.size_mb)) ? Number(model.size_mb) : catalog.sizeMb || null,
  };
}

function mergeVoiceModels(models = []) {
  const rawModels = Array.isArray(models) ? models : [];
  const rawByName = new Map(rawModels.map((model) => [model?.model_name, model]));
  const catalogModels = VOICEBOX_TTS_MODELS.map((catalog) => sanitizeModel({
    model_name: catalog.name,
    display_name: catalog.displayName,
    engine: catalog.engine,
    hf_repo_id: catalog.repository,
    model_size: catalog.modelSize,
    size_mb: catalog.sizeMb,
    languages: catalog.languages,
    ...(rawByName.get(catalog.name) || {}),
  }));
  const catalogNames = new Set(VOICEBOX_TTS_MODELS.map((model) => model.name));
  const futureModels = rawModels
    .filter((model) => !catalogNames.has(model?.model_name) && VOICE_ENGINES.has(model?.engine))
    .map(sanitizeModel)
    .filter((model) => model.name);
  return [...catalogModels, ...futureModels];
}

function assertProfileInput(input = {}) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 100) throw new AppError("INVALID_VOICE_PROFILE", "声音名称需为 1 到 100 个字符");
  const voiceType = VOICE_TYPES.has(input.voiceType) ? input.voiceType : "preset";
  const language = VOICE_LANGUAGES.has(input.language) ? input.language : "zh";
  const engine = VOICE_ENGINES.has(input.engine) ? input.engine : voiceType === "preset" ? "kokoro" : "qwen";
  const voiceId = typeof input.voiceId === "string" ? input.voiceId.trim() : "";
  if (voiceType === "preset" && (!voiceId || voiceId.length > 100)) throw new AppError("INVALID_VOICE_PROFILE", "请选择预设音色");
  const description = typeof input.description === "string" ? input.description.trim().slice(0, 500) : "";
  const personality = typeof input.personality === "string" ? input.personality.trim().slice(0, 2000) : "";
  if (voiceType === "cloned" && input.consent !== true) throw new AppError("VOICE_CONSENT_REQUIRED", "请确认已取得声音样本的使用授权");
  return { name, voiceType, language, engine, voiceId, description, personality };
}

function sanitizeProfile(profile = {}) {
  const voiceType = typeof profile.voice_type === "string" ? profile.voice_type : "cloned";
  const presetEngine = VOICE_ENGINES.has(profile.preset_engine) ? profile.preset_engine : "";
  const defaultEngine = VOICE_ENGINES.has(profile.default_engine) ? profile.default_engine : "";
  return {
    id: typeof profile.id === "string" ? profile.id : "",
    name: typeof profile.name === "string" ? profile.name.slice(0, 100) : "未命名声音",
    description: typeof profile.description === "string" ? profile.description.slice(0, 500) : "",
    language: typeof profile.language === "string" ? profile.language : "en",
    voiceType,
    engine: voiceType === "preset" ? presetEngine || defaultEngine || "kokoro" : defaultEngine || "qwen",
    hasPersonality: Boolean(profile.personality),
    sampleCount: Number.isFinite(Number(profile.sample_count)) ? Number(profile.sample_count) : 0,
    generationCount: Number.isFinite(Number(profile.generation_count)) ? Number(profile.generation_count) : 0,
  };
}

function parseSseEvents(buffer) {
  const events = [];
  let boundary = buffer.search(/\r?\n\r?\n/);
  while (boundary >= 0) {
    const block = buffer.slice(0, boundary);
    const separatorLength = buffer.slice(boundary).startsWith("\r\n\r\n") ? 4 : 2;
    buffer = buffer.slice(boundary + separatorLength);
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (data) {
      try {
        events.push(JSON.parse(data));
      } catch {
        // Ignore malformed keepalive/event frames from a newer backend.
      }
    }
    boundary = buffer.search(/\r?\n\r?\n/);
  }
  return { events, remainder: buffer };
}

class VoiceboxService {
  constructor({ fetchImpl = globalThis.fetch, origin = DEFAULT_ORIGIN, getRuntimeStatus, onGenerationStatus, onModelProgress } = {}) {
    this.fetch = fetchImpl;
    this.origin = loopbackOrigin(origin);
    this.getRuntimeStatus = getRuntimeStatus;
    this.onGenerationStatus = onGenerationStatus;
    this.onModelProgress = onModelProgress;
    this.monitors = new Map();
    this.modelMonitors = new Map();
    this.profiles = [];
  }

  setOrigin(origin) {
    this.origin = loopbackOrigin(origin);
  }

  async #json(pathname, options = {}, timeoutMs = 6000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetch(`${this.origin}${pathname}`, {
        ...options,
        redirect: "error",
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "x-voicebox-client-id": "clipport",
          ...(typeof options.body === "string" ? { "content-type": "application/json" } : {}),
          ...options.headers,
        },
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch {}
      if (!response.ok) {
        const message = typeof data?.detail === "string" ? data.detail : `Voicebox 返回 HTTP ${response.status}`;
        throw new AppError("VOICEBOX_API_ERROR", message, text.slice(-2000));
      }
      return data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error?.name === "AbortError") throw new AppError("VOICEBOX_TIMEOUT", "内置 Voicebox 服务响应超时");
      throw new AppError("VOICEBOX_UNAVAILABLE", "无法连接内置 Voicebox 服务", error?.message || "");
    } finally {
      clearTimeout(timeout);
    }
  }

  async getStatus() {
    const runtime = this.getRuntimeStatus?.() || null;
    if (runtime && runtime.state !== "ready") {
      return {
        available: false,
        message: runtime.error ? `${runtime.message}：${runtime.error}` : runtime.message,
        version: "",
        backend: "",
        gpuAvailable: false,
        gpuType: "",
        modelLoaded: false,
        profiles: [],
        models: [],
        runtime,
        checkedAt: new Date().toISOString(),
      };
    }
    try {
      const health = await this.#json("/health", {}, 3500);
      const [profiles, root, modelStatus] = await Promise.all([
        this.#json("/profiles", {}, 5000),
        this.#json("/", {}, 3500).catch(() => null),
        this.#json("/models/status", {}, 15_000).catch(() => ({ models: [] })),
      ]);
      this.profiles = Array.isArray(profiles) ? profiles.map(sanitizeProfile).filter((profile) => profile.id) : [];
      const models = mergeVoiceModels(modelStatus?.models);
      for (const model of models) {
        if (model.downloading && !this.modelMonitors.has(model.name)) this.#monitorModel(model.name);
      }
      return {
        available: health?.status === "healthy",
        message: health?.status === "healthy" ? "Voicebox 本地服务已连接" : "Voicebox 服务状态异常",
        version: typeof root?.version === "string" ? root.version : "",
        backend: typeof health?.backend_variant === "string" ? health.backend_variant : "cpu",
        gpuAvailable: Boolean(health?.gpu_available),
        gpuType: typeof health?.gpu_type === "string" ? health.gpu_type : "",
        modelLoaded: Boolean(health?.model_loaded),
        profiles: this.profiles,
        models,
        runtime,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        available: false,
        message: error?.message || "无法连接 Voicebox",
        version: "",
        backend: "",
        gpuAvailable: false,
        gpuType: "",
        modelLoaded: false,
        profiles: [],
        models: [],
        runtime,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  async listPresetVoices(value) {
    const engine = VOICE_ENGINES.has(value) ? value : "kokoro";
    const result = await this.#json(`/profiles/presets/${encodeURIComponent(engine)}`, {}, 10_000);
    return Array.isArray(result?.voices) ? result.voices.map((voice) => ({
      id: typeof voice.voice_id === "string" ? voice.voice_id : "",
      name: typeof voice.name === "string" ? voice.name.slice(0, 100) : "未命名音色",
      gender: typeof voice.gender === "string" ? voice.gender : "",
      language: typeof voice.language === "string" ? voice.language : "",
    })).filter((voice) => voice.id) : [];
  }

  async createProfile(input) {
    const profile = assertProfileInput(input);
    const created = await this.#json("/profiles", {
      method: "POST",
      body: JSON.stringify({
        name: profile.name,
        description: profile.description || null,
        language: profile.language,
        voice_type: profile.voiceType,
        preset_engine: profile.voiceType === "preset" ? profile.engine : null,
        preset_voice_id: profile.voiceType === "preset" ? profile.voiceId : null,
        default_engine: profile.voiceType === "preset" ? profile.engine : profile.engine,
        personality: profile.personality || null,
      }),
    }, 15_000);
    return sanitizeProfile(created);
  }

  async deleteProfile(value) {
    const profileId = typeof value === "string" ? value.trim() : "";
    if (!/^[a-z0-9-]{1,100}$/i.test(profileId)) throw new AppError("INVALID_VOICE_PROFILE", "声音档案标识无效");
    await this.#json(`/profiles/${encodeURIComponent(profileId)}`, { method: "DELETE" }, 10_000);
    return true;
  }

  async addProfileSample(value, filePath, referenceText) {
    const profileId = typeof value === "string" ? value.trim() : "";
    if (!/^[a-z0-9-]{1,100}$/i.test(profileId)) throw new AppError("INVALID_VOICE_PROFILE", "声音档案标识无效");
    const transcript = typeof referenceText === "string" ? referenceText.trim() : "";
    if (!transcript || transcript.length > 1000) throw new AppError("INVALID_VOICE_SAMPLE", "样本原文需为 1 到 1000 个字符");
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_SAMPLE_BYTES) throw new AppError("INVALID_VOICE_SAMPLE", "声音样本必须是不超过 50 MB 的音频文件");
    const extension = path.extname(filePath).toLowerCase();
    const mimeTypes = { ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".flac": "audio/flac", ".aac": "audio/aac", ".webm": "audio/webm", ".opus": "audio/ogg" };
    if (!mimeTypes[extension]) throw new AppError("INVALID_VOICE_SAMPLE", "声音样本格式不受支持");
    const form = new FormData();
    form.append("file", new Blob([fs.readFileSync(filePath)], { type: mimeTypes[extension] }), path.basename(filePath));
    form.append("reference_text", transcript);
    return this.#json(`/profiles/${encodeURIComponent(profileId)}/samples`, { method: "POST", body: form }, 60_000);
  }

  async downloadModel(value) {
    const modelName = assertModelName(value);
    const result = await this.#json("/models/download", {
      method: "POST",
      body: JSON.stringify({ model_name: modelName }),
    }, 20_000);
    this.#monitorModel(modelName);
    return result;
  }

  async #monitorModel(modelName) {
    this.modelMonitors.get(modelName)?.abort();
    const controller = new AbortController();
    this.modelMonitors.set(modelName, controller);
    try {
      const response = await this.fetch(`${this.origin}/models/progress/${encodeURIComponent(modelName)}`, {
        redirect: "error",
        signal: controller.signal,
        headers: { accept: "text/event-stream", "x-voicebox-client-id": "clipport" },
      });
      if (!response.ok || !response.body) throw new AppError("VOICEBOX_API_ERROR", `无法读取模型下载状态：HTTP ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const parsed = parseSseEvents(buffer);
        buffer = parsed.remainder;
        for (const event of parsed.events) {
          const update = {
            modelName,
            status: typeof event.status === "string" ? event.status : "downloading",
            progress: Number.isFinite(Number(event.progress)) ? Number(event.progress) : 0,
            current: Number.isFinite(Number(event.current)) ? Number(event.current) : 0,
            total: Number.isFinite(Number(event.total)) ? Number(event.total) : 0,
            filename: typeof event.filename === "string" ? event.filename.slice(0, 240) : "",
            error: typeof event.error === "string" ? event.error.slice(0, 1000) : "",
          };
          this.onModelProgress?.(update);
          if (new Set(["complete", "completed", "error", "failed", "canceled", "cancelled"]).has(update.status)) return;
        }
        if (done) return;
      }
    } catch (error) {
      if (error?.name !== "AbortError") this.onModelProgress?.({ modelName, status: "failed", progress: 0, current: 0, total: 0, filename: "", error: error?.message || "模型下载状态连接已中断" });
    } finally {
      if (this.modelMonitors.get(modelName) === controller) this.modelMonitors.delete(modelName);
    }
  }

  async cancelModelDownload(value) {
    const modelName = assertModelName(value);
    await this.#json("/models/download/cancel", {
      method: "POST",
      body: JSON.stringify({ model_name: modelName }),
    }, 10_000);
    this.modelMonitors.get(modelName)?.abort();
    this.modelMonitors.delete(modelName);
    return true;
  }

  async deleteModel(value) {
    const modelName = assertModelName(value);
    await this.#json(`/models/${encodeURIComponent(modelName)}`, { method: "DELETE" }, 30_000);
    return true;
  }

  async unloadModel(value) {
    const modelName = assertModelName(value);
    await this.#json(`/models/${encodeURIComponent(modelName)}/unload`, { method: "POST" }, 15_000);
    return true;
  }

  async startGeneration(input) {
    const payload = assertVoiceboxGeneration(input);
    let profile = this.profiles.find((item) => item.id === payload.profileId);
    if (!profile) {
      const profiles = await this.#json("/profiles", {}, 5000);
      this.profiles = Array.isArray(profiles) ? profiles.map(sanitizeProfile).filter((item) => item.id) : [];
      profile = this.profiles.find((item) => item.id === payload.profileId);
    }
    if (!profile) throw new AppError("INVALID_VOICE_PROFILE", "声音档案不存在，请刷新后重试");
    const generation = await this.#json("/generate", {
      method: "POST",
      body: JSON.stringify({
        profile_id: payload.profileId,
        text: payload.text,
        language: payload.language,
        personality: payload.personality,
        instruct: payload.instruct || null,
        engine: profile.engine,
        normalize: true,
      }),
    }, 20_000);
    const id = assertVoiceboxGenerationId(generation?.id);
    const initial = { id, status: generation?.status || "generating", error: "", duration: null };
    this.onGenerationStatus?.(initial);
    this.#monitor(id);
    return initial;
  }

  async #monitor(id) {
    const controller = new AbortController();
    this.monitors.set(id, controller);
    try {
      const response = await this.fetch(`${this.origin}/generate/${encodeURIComponent(id)}/status`, {
        redirect: "error",
        signal: controller.signal,
        headers: { accept: "text/event-stream", "x-voicebox-client-id": "clipport" },
      });
      if (!response.ok || !response.body) throw new AppError("VOICEBOX_API_ERROR", `无法读取生成状态：HTTP ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const parsed = parseSseEvents(buffer);
        buffer = parsed.remainder;
        for (const event of parsed.events) {
          const status = typeof event.status === "string" ? event.status : "generating";
          const update = {
            id,
            status,
            duration: Number.isFinite(Number(event.duration)) ? Number(event.duration) : null,
            error: typeof event.error === "string" ? event.error : "",
            ...(status === "completed" ? { audioUrl: `clipport://app/voicebox-audio/${id}` } : {}),
          };
          this.onGenerationStatus?.(update);
          if (new Set(["completed", "failed", "not_found"]).has(status)) return;
        }
        if (done) return;
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        this.onGenerationStatus?.({ id, status: "failed", duration: null, error: error?.message || "生成状态连接已中断" });
      }
    } finally {
      this.monitors.delete(id);
    }
  }

  async cancelGeneration(value) {
    const id = assertVoiceboxGenerationId(value);
    try {
      await this.#json(`/generate/${encodeURIComponent(id)}/cancel`, { method: "POST" }, 8000);
    } finally {
      this.monitors.get(id)?.abort();
      this.monitors.delete(id);
    }
    const update = { id, status: "canceled", duration: null, error: "已取消生成" };
    this.onGenerationStatus?.(update);
    return update;
  }

  async audioResponse(value) {
    const id = assertVoiceboxGenerationId(value);
    try {
      const response = await this.fetch(`${this.origin}/audio/${encodeURIComponent(id)}`, {
        redirect: "error",
        headers: { accept: "audio/*", "x-voicebox-client-id": "clipport" },
      });
      if (!response.ok || !response.body) return new Response("Audio unavailable", { status: response.status || 502 });
      return new Response(response.body, {
        status: 200,
        headers: {
          "content-type": response.headers.get("content-type") || "audio/wav",
          "cache-control": "no-store",
        },
      });
    } catch {
      return new Response("Voicebox unavailable", { status: 502 });
    }
  }

  async downloadAudio(value) {
    const id = assertVoiceboxGenerationId(value);
    try {
      const response = await this.fetch(`${this.origin}/audio/${encodeURIComponent(id)}`, {
        redirect: "error",
        headers: { accept: "audio/*", "x-voicebox-client-id": "clipport" },
      });
      if (!response.ok) throw new AppError("VOICEBOX_AUDIO_FAILED", `无法读取生成音频：HTTP ${response.status}`);
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > MAX_AUDIO_BYTES) throw new AppError("VOICEBOX_AUDIO_TOO_LARGE", "生成音频超过 300 MB，无法保存");
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_AUDIO_BYTES) throw new AppError("VOICEBOX_AUDIO_TOO_LARGE", "生成音频超过 300 MB，无法保存");
      return buffer;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("VOICEBOX_UNAVAILABLE", "无法从 Voicebox 读取音频，请确认应用仍在运行", error?.message || "");
    }
  }

  shutdown() {
    for (const controller of this.monitors.values()) controller.abort();
    this.monitors.clear();
    for (const controller of this.modelMonitors.values()) controller.abort();
    this.modelMonitors.clear();
  }
}

module.exports = { DEFAULT_ORIGIN, VOICEBOX_TTS_MODELS, VoiceboxService, assertProfileInput, mergeVoiceModels, parseSseEvents, sanitizeModel, sanitizeProfile };
