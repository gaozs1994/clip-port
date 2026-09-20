const test = require("node:test");
const assert = require("node:assert/strict");
const { VOICEBOX_TTS_MODELS, VoiceboxService, mergeVoiceModels, parseSseEvents } = require("../src/main/services/voicebox-service.cjs");

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("parses complete SSE frames and keeps partial data", () => {
  const parsed = parseSseEvents('data: {"status":"generating"}\n\ndata: {"status":"completed"}\n\ndata: {"status"');
  assert.deepEqual(parsed.events.map((event) => event.status), ["generating", "completed"]);
  assert.equal(parsed.remainder, 'data: {"status"');
});

test("reports Voicebox health and sanitizes profiles", async () => {
  const service = new VoiceboxService({
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === "/health") return json({ status: "healthy", backend_variant: "cuda", gpu_available: true, gpu_type: "CUDA", model_loaded: true });
      if (pathname === "/profiles") return json([{ id: "profile-1", name: "Narrator", language: "en", voice_type: "preset", preset_engine: "kokoro", personality: "calm", sample_count: 0 }]);
      if (pathname === "/models/status") return json({ models: [{ model_name: "kokoro", display_name: "Kokoro 82M", hf_repo_id: "hexgrad/Kokoro-82M", downloaded: true, loaded: true, size_mb: 350 }] });
      if (pathname === "/") return json({ message: "voicebox API", version: "0.5.0" });
      return json({}, 404);
    },
  });
  const status = await service.getStatus();
  assert.equal(status.available, true);
  assert.equal(status.version, "0.5.0");
  assert.equal(status.models.length, 10);
  const kokoro = status.models.find((model) => model.name === "kokoro");
  assert.equal(kokoro.displayName, "Kokoro 82M");
  assert.equal(kokoro.engine, "kokoro");
  assert.equal(kokoro.sizeMb, 350);
  assert.equal(kokoro.loaded, true);
  assert.deepEqual(status.profiles[0], {
    id: "profile-1",
    name: "Narrator",
    description: "",
    language: "en",
    voiceType: "preset",
    engine: "kokoro",
    hasPersonality: true,
    sampleCount: 0,
    generationCount: 0,
  });
});

test("keeps every Voicebox TTS model visible while merging live download state", () => {
  const models = mergeVoiceModels([
    { model_name: "kokoro", downloaded: true, loaded: false, size_mb: 364 },
  ]);
  assert.equal(models.length, VOICEBOX_TTS_MODELS.length);
  assert.deepEqual(models.map((model) => model.name), VOICEBOX_TTS_MODELS.map((model) => model.name));
  assert.deepEqual(models.find((model) => model.name === "kokoro"), {
    name: "kokoro",
    displayName: "Kokoro 82M",
    engine: "kokoro",
    repository: "hexgrad/Kokoro-82M",
    modelSize: "82M",
    languages: ["en", "es", "fr", "hi", "it", "pt", "ja", "zh"],
    description: "体积小、CPU 实时的预设音色",
    downloaded: true,
    downloading: false,
    loaded: false,
    sizeMb: 364,
  });
  assert.equal(models.find((model) => model.name === "qwen-tts-0.6B").downloaded, false);
});

test("uses a preset profile engine even when Voicebox also returns a conflicting default engine", async () => {
  const generationId = "a1111111-1111-4111-8111-111111111111";
  let generationPayload = null;
  let resolveProgress;
  const progressEvent = new Promise((resolve) => { resolveProgress = resolve; });
  const service = new VoiceboxService({
    fetchImpl: async (url, options = {}) => {
      const pathname = new URL(url).pathname;
      if (pathname === "/health") return json({ status: "healthy", backend_variant: "cpu" });
      if (pathname === "/profiles") return json([{ id: "profile-1", name: "Kokoro", language: "zh", voice_type: "preset", preset_engine: "kokoro", default_engine: "qwen" }]);
      if (pathname === "/models/status") return json({ models: [] });
      if (pathname === "/") return json({ version: "0.5.0" });
      if (pathname === "/generate") { generationPayload = JSON.parse(options.body); return json({ id: generationId, status: "queued" }); }
      if (pathname.endsWith("/status")) return new Response(`data: ${JSON.stringify({ status: "completed" })}\n\n`, { headers: { "content-type": "text/event-stream" } });
      if (pathname === "/models/download") return json({ message: "started" });
      if (pathname === "/models/progress/kokoro") return new Response(`data: ${JSON.stringify({ status: "complete", progress: 100, current: 10, total: 10 })}\n\n`, { headers: { "content-type": "text/event-stream" } });
      return json({}, 404);
    },
    onModelProgress: resolveProgress,
  });
  await service.getStatus();
  await service.startGeneration({ profileId: "profile-1", text: "你好", language: "zh", consent: true });
  assert.equal(generationPayload.engine, "kokoro");
  await service.downloadModel("kokoro");
  const progress = await progressEvent;
  assert.equal(progress.progress, 100);
  assert.equal(progress.status, "complete");
});

test("starts an async Voicebox generation and emits a playable completion", async () => {
  const id = "a1111111-1111-4111-8111-111111111111";
  let posted = null;
  let resolveCompleted;
  const completed = new Promise((resolve) => { resolveCompleted = resolve; });
  const service = new VoiceboxService({
    fetchImpl: async (url, options = {}) => {
      const pathname = new URL(url).pathname;
      if (pathname === "/profiles") return json([{ id: "profile-1", name: "Narrator", language: "en", voice_type: "cloned", default_engine: "qwen" }]);
      if (pathname === "/generate" && options.method === "POST") {
        posted = JSON.parse(options.body);
        return json({ id, status: "generating" });
      }
      if (pathname.endsWith("/status")) {
        return new Response(`data: ${JSON.stringify({ id, status: "generating", duration: 0 })}\n\ndata: ${JSON.stringify({ id, status: "completed", duration: 2.5 })}\n\n`, { headers: { "content-type": "text/event-stream" } });
      }
      return json({}, 404);
    },
    onGenerationStatus: (status) => {
      if (status.status === "completed") resolveCompleted(status);
    },
  });
  const started = await service.startGeneration({ profileId: "profile-1", text: "Hello", language: "en", consent: true });
  const result = await completed;
  assert.equal(started.id, id);
  assert.equal(result.status, "completed");
  assert.equal(result.audioUrl, `clipport://app/voicebox-audio/${id}`);
  assert.equal(posted.profile_id, "profile-1");
  assert.equal(posted.text, "Hello");
  assert.equal(Object.hasOwn(posted, "consent"), false);
});

test("returns an offline status when the local Voicebox service is unavailable", async () => {
  const service = new VoiceboxService({ fetchImpl: async () => { throw new Error("ECONNREFUSED"); } });
  const status = await service.getStatus();
  assert.equal(status.available, false);
  assert.deepEqual(status.profiles, []);
  assert.match(status.message, /Voicebox/);
});
