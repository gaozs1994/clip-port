const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DiagnosticLog, redactText } = require("../src/main/services/diagnostic-log.cjs");

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "clipport-log-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("persists diagnostic entries and filters them newest first", (t) => {
  const directory = temporaryDirectory(t);
  const logger = new DiagnosticLog({ userDataPath: directory });
  logger.info("app", "应用启动");
  logger.error("tasks", "下载失败", { code: "PROCESS_ERROR" });

  const restored = new DiagnosticLog({ userDataPath: directory });
  assert.deepEqual(restored.list({ level: "error" }).map((entry) => entry.message), ["下载失败"]);
  assert.deepEqual(restored.list({ source: "app" }).map((entry) => entry.message), ["应用启动"]);
  assert.equal(restored.list()[0].source, "tasks");
});

test("redacts credentials, licenses, URLs and local paths before persistence", (t) => {
  const directory = temporaryDirectory(t);
  const logger = new DiagnosticLog({ userDataPath: directory });
  logger.error(
    "media",
    "Cookie: session-secret https://v.douyin.com/private-id/?token=abc C:\\Users\\Tester\\Downloads\\private.mp4",
    {
      authorization: "Bearer secret",
      licenseCode: "CPL1.payload.signature",
      deviceCode: "CPD1-986C-A6AA-6F04-A7AF-154A-0974-1CAD-4147",
      outputPath: "C:\\Users\\Tester\\Downloads\\private.mp4",
    },
  );

  const serialized = fs.readFileSync(logger.file, "utf8");
  for (const secret of ["session-secret", "private-id", "token=abc", "Bearer secret", "payload.signature", "986C-A6AA", "Users\\Tester"]) {
    assert.equal(serialized.includes(secret), false, `must redact ${secret}`);
  }
  assert.match(serialized, /\[REDACTED\]/);
  assert.match(serialized, /\[LOCAL_PATH\]/);
});

test("rotates bounded log files and exports valid JSON lines", (t) => {
  const directory = temporaryDirectory(t);
  const logger = new DiagnosticLog({ userDataPath: directory, maxFileBytes: 240, maxEntries: 20 });
  for (let index = 0; index < 12; index += 1) logger.info("app", `事件 ${index}`, { index });

  assert.equal(fs.existsSync(logger.archiveFile), true);
  const exported = logger.exportText();
  assert.doesNotThrow(() => exported.split("\n").filter(Boolean).forEach((line) => JSON.parse(line)));
  logger.clear();
  assert.deepEqual(logger.list(), []);
});

test("redacts sensitive inline values without changing ordinary diagnostics", () => {
  assert.equal(redactText("下载速度为 12 MB/s"), "下载速度为 12 MB/s");
  assert.equal(redactText("token=abcdef"), "token=[REDACTED]");
});
