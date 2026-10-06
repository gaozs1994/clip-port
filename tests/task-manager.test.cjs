const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { AppStore } = require("../src/main/services/store.cjs");
const { TaskManager, mergeTaskProgress, outputSize } = require("../src/main/services/task-manager.cjs");

test("preserves known progress metrics and derives speed when an update omits them", () => {
  const previous = { percent: 10, downloadedBytes: 1_000, totalBytes: 10_000, speed: 500, eta: 18 };
  const merged = mergeTaskProgress(previous, { percent: null, downloadedBytes: 3_000, totalBytes: null, speed: null, eta: null }, 2_000);
  assert.equal(merged.downloadedBytes, 3_000);
  assert.equal(merged.totalBytes, 10_000);
  assert.equal(merged.speed, 1_000);
  assert.equal(merged.percent, 30);
  assert.equal(merged.eta, 18);
});

test("calculates final size from all output files", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clipport-output-size-"));
  try {
    const first = path.join(directory, "first.mp4");
    const second = path.join(directory, "second.srt");
    fs.writeFileSync(first, Buffer.alloc(1_024));
    fs.writeFileSync(second, Buffer.alloc(256));
    assert.equal(outputSize([first, second, path.join(directory, "missing")]), 1_280);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("reserves launching tasks so rapid scheduling cannot start a task twice", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clipport-schedule-"));
  const store = new AppStore({ userDataPath: directory, downloadsPath: directory });
  store.updateSettings({ concurrency: 2 });
  const toolchain = {
    calls: 0,
    requireReady() {
      this.calls += 1;
      return new Promise(() => {});
    },
  };
  const manager = new TaskManager({
    store,
    toolchain,
    safeStorage: { isEncryptionAvailable: () => false },
  });
  const media = { id: "sample", title: "Sample", uploader: "Tester", extractor: "test" };

  manager.create({ url: "https://example.com/one", outputRoot: directory, media });
  manager.create({ url: "https://example.com/two", outputRoot: directory, media });

  assert.equal(toolchain.calls, 2);
  assert.equal(manager.launching.size, 2);
  assert.ok(path.resolve(directory).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
  fs.rmSync(directory, { recursive: true, force: true });
});

test("does not start a queued task canceled during tool discovery", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clipport-cancel-"));
  const store = new AppStore({ userDataPath: directory, downloadsPath: directory });
  let releaseTools;
  const toolchain = {
    requireReady: () => new Promise((resolve) => { releaseTools = resolve; }),
  };
  const manager = new TaskManager({
    store,
    toolchain,
    safeStorage: { isEncryptionAvailable: () => false },
  });
  const task = manager.create({
    url: "https://example.com/canceled",
    outputRoot: directory,
    media: { id: "sample", title: "Sample", uploader: "Tester", extractor: "test" },
  });

  await manager.cancel(task.id);
  releaseTools({ ytDlpPath: "missing", ffmpegPath: "missing", ffprobePath: "missing" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(store.getTask(task.id).state, "canceled");
  assert.equal(manager.running.size, 0);
  assert.equal(manager.launching.size, 0);
  assert.ok(path.resolve(directory).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
  fs.rmSync(directory, { recursive: true, force: true });
});

test("keeps queued tasks idle while the device license is inactive", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clipport-license-gate-"));
  const store = new AppStore({ userDataPath: directory, downloadsPath: directory });
  const toolchain = { calls: 0, requireReady() { this.calls += 1; return Promise.resolve({}); } };
  const manager = new TaskManager({
    store,
    toolchain,
    safeStorage: { isEncryptionAvailable: () => false },
    canStartTask: () => false,
  });
  manager.create({
    url: "https://example.com/licensed",
    outputRoot: directory,
    media: { id: "sample", title: "Sample", uploader: "Tester", extractor: "test", best: { estimatedBytes: 12_345 } },
  });

  assert.equal(store.listTasks()[0].state, "queued");
  assert.equal(store.listTasks()[0].media.estimatedBytes, 12_345);
  assert.equal(toolchain.calls, 0);
  assert.equal(manager.launching.size, 0);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("download scheduling ignores queued voice tasks in the shared store", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clipport-shared-tasks-"));
  try {
    const store = new AppStore({ userDataPath: directory, downloadsPath: directory });
    store.upsertTask({
      id: "a1111111-1111-4111-8111-111111111111",
      kind: "voice",
      state: "queued",
      stage: "等待生成",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const toolchain = { calls: 0, requireReady() { this.calls += 1; return Promise.resolve({}); } };
    const manager = new TaskManager({ store, toolchain, safeStorage: { isEncryptionAvailable: () => false } });
    await manager.schedule();
    assert.equal(toolchain.calls, 0);
    assert.equal(store.getTask("a1111111-1111-4111-8111-111111111111").state, "queued");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("completes an image task with full text in its ZIP without probing a nonexistent video", { timeout: 5000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clipport-image-task-"));
  let manager;
  try {
    const store = new AppStore({ userDataPath: directory, downloadsPath: directory });
    let finished;
    const completion = new Promise((resolve) => { finished = resolve; });
    let spawnCount = 0;
    let savedText;
    const fullTitle = "图文标题".repeat(150);
    const description = '完整正文\n\n第二段 "引号"\n#话题 ' + "文案".repeat(600);
    manager = new TaskManager({
      store,
      toolchain: { requireReady: async () => ({ ytDlpPath: "yt-dlp", ffprobePath: "ffprobe", versions: {} }) },
      safeStorage: { isEncryptionAvailable: () => false },
      onHistoryChanged: finished,
      onTaskChanged(task) {
        if (task.state === "verifying") savedText = fs.readFileSync(path.join(directory, `.clipport-${task.id}`, "images", "文案.txt"), "utf8");
      },
      spawnProcess(binary, args, options) {
        spawnCount += 1;
        assert.equal(binary, "yt-dlp");
        assert.ok(args.includes("--write-all-thumbnails"));
        const staging = path.dirname(args[args.indexOf("--output") + 1]);
        return { child: {}, completion: Promise.resolve().then(() => {
          const thumbnails = ["one", "two"].map((id) => {
            const filepath = path.join(staging, `${id}.png`);
            fs.writeFileSync(filepath, id);
            return { url: `https://sns-webpic-qc.xhscdn.com/spectrum/${id}!nd_dft_webp`, filepath };
          });
          const line = `CLIPPORT_IMAGES:${JSON.stringify(thumbnails)}`;
          options.onStdoutLine(line);
          options.onStdoutLine(`CLIPPORT_TEXT:${JSON.stringify({ title: fullTitle, description })}`);
          return { code: 0, stderr: "", stdout: line };
        }) };
      },
    });
    const task = manager.create({
      url: "https://www.xiaohongshu.com/explore/note?xsec_token=private",
      outputRoot: directory,
      media: { id: "note", title: fullTitle, extractor: "XiaoHongShu", contentType: "images", imageCount: 2 },
      options: { resolution: "1080" },
    });
    const history = await completion;
    await new Promise((resolve) => setImmediate(resolve));
    const completed = store.getTask(task.id);
    assert.equal(completed.state, "completed");
    assert.equal(completed.options.resolution, "best");
    assert.equal(completed.media.contentType, "images");
    assert.equal(completed.progress.percent, 100);
    assert.ok(completed.progress.totalBytes > 0);
    assert.equal(spawnCount, 1);
    assert.equal(history.contentType, "images");
    assert.equal(history.imageCount, 2);
    assert.equal(history.probe, null);
    assert.match(completed.finalOutputs[0], / images\.zip$/);
    const zip = fs.readFileSync(completed.finalOutputs[0]);
    assert.ok(zip.includes(Buffer.from("001.png")));
    assert.ok(zip.includes(Buffer.from("002.png")));
    assert.ok(zip.includes(Buffer.from("文案.txt")));
    assert.equal(savedText, `\uFEFF${fullTitle}\n\n${description}\n`);
    assert.equal(completed.media.title.length, 500);
    assert.equal(fs.existsSync(path.join(directory, `.clipport-${task.id}`)), false);
    assert.doesNotMatch(JSON.stringify(store.state), /xhscdn|private/);
    assert.equal(JSON.stringify(store.state).includes("完整正文"), false);
  } finally {
    await manager?.shutdown();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

for (const [name, metadata] of [
  ["absent", undefined],
  ["empty", { title: "视频标题", description: "" }],
  ["duplicate", { title: "视频标题", description: "视频标题" }],
  ["invalid", { title: null, description: { value: "not text" } }],
  ["complete", { title: "视频标题", description: "完整视频正文\n\n#话题" }],
]) {
  test(`includes video text in the ZIP when metadata is ${name}`, { timeout: 5000 }, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clipport-video-text-"));
    let manager;
    try {
      const store = new AppStore({ userDataPath: directory, downloadsPath: directory });
      let finished;
      const completion = new Promise((resolve) => { finished = resolve; });
      let savedText;
      let probeCount = 0;
      manager = new TaskManager({
        store,
        toolchain: { requireReady: async () => ({ ytDlpPath: "yt-dlp", ffprobePath: "ffprobe", versions: {} }) },
        safeStorage: { isEncryptionAvailable: () => false },
        onHistoryChanged: finished,
        onTaskChanged(task) {
          if (task.state === "verifying") savedText = fs.readFileSync(path.join(directory, `.clipport-${task.id}`, "文案.txt"), "utf8");
        },
        spawnProcess(binary, args, options) {
          if (binary === "ffprobe") {
            probeCount += 1;
            assert.match(args.at(-1), /video\.mp4$/);
            return { child: {}, completion: Promise.resolve({ code: 0, stdout: "{}", stderr: "" }) };
          }
          assert.equal(binary, "yt-dlp");
          const staging = path.dirname(args[args.indexOf("--output") + 1]);
          return { child: {}, completion: Promise.resolve().then(() => {
            fs.writeFileSync(path.join(staging, "video.mp4"), "video");
            if (metadata) options.onStdoutLine(`CLIPPORT_TEXT:${JSON.stringify(metadata)}`);
            return { code: 0, stdout: "", stderr: "" };
          }) };
        },
      });
      const task = manager.create({
        url: "https://example.com/video", outputRoot: directory,
        media: { id: "video", title: "视频标题" },
      });
      await completion;
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(store.getTask(task.id).state, "completed");
      assert.equal(savedText, name === "complete" ? "\uFEFF视频标题\n\n完整视频正文\n\n#话题\n" : "\uFEFF视频标题\n");
      assert.equal(probeCount, 1);
      assert.ok(fs.readFileSync(store.getTask(task.id).finalOutputs[0]).includes(Buffer.from("文案.txt")));
    } finally {
      await manager?.shutdown();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("does not create a TXT-only ZIP when no media was downloaded", { timeout: 5000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clipport-empty-text-"));
  let manager;
  try {
    const store = new AppStore({ userDataPath: directory, downloadsPath: directory });
    let failed;
    const failure = new Promise((resolve) => { failed = resolve; });
    manager = new TaskManager({
      store,
      toolchain: { requireReady: async () => ({ ytDlpPath: "yt-dlp" }) },
      safeStorage: { isEncryptionAvailable: () => false },
      onTaskChanged: (task) => { if (task.state === "failed") failed(task); },
      spawnProcess(binary, args, options) {
        return { child: {}, completion: Promise.resolve().then(() => {
          options.onStdoutLine('CLIPPORT_TEXT:{"title":"Title","description":"Caption"}');
          return { code: 0, stderr: "", stdout: "" };
        }) };
      },
    });
    manager.create({ url: "https://example.com/video", outputRoot: directory, media: { id: "video", title: "Title" } });
    const task = await failure;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(task.error.code, "PACKAGE_EMPTY");
    assert.equal(task.finalOutputs.length, 0);
    assert.equal(fs.readdirSync(directory).some((name) => name.endsWith(".zip")), false);
  } finally {
    await manager?.shutdown();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("does not complete an image task when the downloader silently misses a picture", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clipport-image-partial-"));
  let manager;
  try {
    const store = new AppStore({ userDataPath: directory, downloadsPath: directory });
    let failed;
    const failure = new Promise((resolve) => { failed = resolve; });
    manager = new TaskManager({
      store,
      toolchain: { requireReady: async () => ({ ytDlpPath: "yt-dlp" }) },
      safeStorage: { isEncryptionAvailable: () => false },
      onTaskChanged: (task) => { if (task.state === "failed") failed(task); },
      spawnProcess: () => ({ child: {}, completion: Promise.resolve({ code: 0, stderr: "WARNING: Image download failed", stdout: "" }) }),
    });
    manager.create({
      url: "https://xhslink.com/a/note",
      outputRoot: directory,
      media: { id: "note", title: "Photo note", contentType: "images", imageCount: 2 },
    });
    const task = await failure;
    assert.equal(task.error.code, "IMAGE_DOWNLOAD_INCOMPLETE");
    assert.equal(task.finalOutputs.length, 0);
    assert.equal(fs.readdirSync(directory).some((name) => name.endsWith(".zip")), false);
  } finally {
    await manager?.shutdown();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("only accepts image tasks for Xiaohongshu with a positive image count", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clipport-image-validation-"));
  try {
    const store = new AppStore({ userDataPath: directory, downloadsPath: directory });
    const manager = new TaskManager({ store, toolchain: {}, canStartTask: () => false });
    const media = { id: "note", title: "Photo note", contentType: "images", imageCount: 2 };
    assert.throws(() => manager.create({ url: "https://example.com/note", media, outputRoot: directory }), { code: "INVALID_MEDIA" });
    assert.throws(() => manager.create({ url: "https://xhslink.com/a/note", media: { ...media, imageCount: 0 }, outputRoot: directory }), { code: "INVALID_MEDIA" });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
