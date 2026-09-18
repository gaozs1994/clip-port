const test = require("node:test");
const assert = require("node:assert/strict");
const { VoiceboxService, parseSseEvents } = require("../src/main/services/voicebox-service.cjs");

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
      if (pathname === "/") return json({ message: "voicebox API", version: "0.5.0" });
      return json({}, 404);
    },
  });
  const status = await service.getStatus();
  assert.equal(status.available, true);
  assert.equal(status.version, "0.5.0");
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

test("starts an async Voicebox generation and emits a playable completion", async () => {
  const id = "a1111111-1111-4111-8111-111111111111";
  let posted = null;
  let resolveCompleted;
  const completed = new Promise((resolve) => { resolveCompleted = resolve; });
  const service = new VoiceboxService({
    fetchImpl: async (url, options = {}) => {
      const pathname = new URL(url).pathname;
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
