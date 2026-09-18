const { AppError, assertVoiceboxGeneration, assertVoiceboxGenerationId } = require("./validators.cjs");

const DEFAULT_ORIGIN = "http://127.0.0.1:17493";
const MAX_AUDIO_BYTES = 300 * 1024 * 1024;

function sanitizeProfile(profile = {}) {
  return {
    id: typeof profile.id === "string" ? profile.id : "",
    name: typeof profile.name === "string" ? profile.name.slice(0, 100) : "未命名声音",
    description: typeof profile.description === "string" ? profile.description.slice(0, 500) : "",
    language: typeof profile.language === "string" ? profile.language : "en",
    voiceType: typeof profile.voice_type === "string" ? profile.voice_type : "cloned",
    engine: typeof profile.default_engine === "string"
      ? profile.default_engine
      : typeof profile.preset_engine === "string"
        ? profile.preset_engine
        : "qwen",
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
  constructor({ fetchImpl = globalThis.fetch, origin = DEFAULT_ORIGIN, onGenerationStatus } = {}) {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" || !new Set(["127.0.0.1", "localhost", "[::1]"]).has(parsed.hostname)) {
      throw new Error("Voicebox origin must use an HTTP loopback address");
    }
    this.fetch = fetchImpl;
    this.origin = parsed.origin;
    this.onGenerationStatus = onGenerationStatus;
    this.monitors = new Map();
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
          ...(options.body ? { "content-type": "application/json" } : {}),
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
      if (error?.name === "AbortError") throw new AppError("VOICEBOX_TIMEOUT", "连接 Voicebox 超时，请确认应用已启动");
      throw new AppError("VOICEBOX_UNAVAILABLE", "无法连接 Voicebox，请先启动 Voicebox 桌面应用", error?.message || "");
    } finally {
      clearTimeout(timeout);
    }
  }

  async getStatus() {
    try {
      const health = await this.#json("/health", {}, 3500);
      const [profiles, root] = await Promise.all([
        this.#json("/profiles", {}, 5000),
        this.#json("/", {}, 3500).catch(() => null),
      ]);
      return {
        available: health?.status === "healthy",
        message: health?.status === "healthy" ? "Voicebox 本地服务已连接" : "Voicebox 服务状态异常",
        version: typeof root?.version === "string" ? root.version : "",
        backend: typeof health?.backend_variant === "string" ? health.backend_variant : "cpu",
        gpuAvailable: Boolean(health?.gpu_available),
        gpuType: typeof health?.gpu_type === "string" ? health.gpu_type : "",
        modelLoaded: Boolean(health?.model_loaded),
        profiles: Array.isArray(profiles) ? profiles.map(sanitizeProfile).filter((profile) => profile.id) : [],
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
        checkedAt: new Date().toISOString(),
      };
    }
  }

  async startGeneration(input) {
    const payload = assertVoiceboxGeneration(input);
    const generation = await this.#json("/generate", {
      method: "POST",
      body: JSON.stringify({
        profile_id: payload.profileId,
        text: payload.text,
        language: payload.language,
        personality: payload.personality,
        instruct: payload.instruct || null,
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
  }
}

module.exports = { DEFAULT_ORIGIN, VoiceboxService, parseSseEvents, sanitizeProfile };
