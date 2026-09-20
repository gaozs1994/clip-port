const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const LEVELS = new Set(["info", "warn", "error"]);
const MAX_MESSAGE_LENGTH = 2_000;
const MAX_DETAIL_LENGTH = 6_000;
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 500;

const SENSITIVE_KEY = /(?:authorization|cookie|password|passwd|secret|token|api[_-]?key|license|devicecode|device_code)/i;
const PATH_KEY = /(?:path|directory|folder|file|output)/i;

function redactText(value, maxLength = MAX_DETAIL_LENGTH) {
  let text = String(value ?? "");
  text = text.replace(/\bCPL1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "CPL1.[REDACTED]");
  text = text.replace(/\bCPD1(?:-[A-Fa-f0-9]{4}){4,}\b/g, "CPD1-[REDACTED]");
  text = text.replace(
    /\b(cookie|authorization|proxy-authorization|password|passwd|secret|token|api[-_ ]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
    (_match, key) => `${key}=[REDACTED]`,
  );
  text = text.replace(/https?:\/\/[^\s<>"'`\]\[(){}]+/gi, (candidate) => {
    try {
      const parsed = new URL(candidate);
      return `${parsed.protocol}//${parsed.host}/[REDACTED]`;
    } catch {
      return "[REDACTED_URL]";
    }
  });
  text = text.replace(/\b[A-Za-z]:\\[^\r\n"'<>|]*/g, "[LOCAL_PATH]");
  text = text.replace(/\\\\[^\s\\]+\\[^\r\n"'<>|]*/g, "[NETWORK_PATH]");
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function sanitizeValue(value, key = "", depth = 0) {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (value === null || value === undefined) return value ?? null;
  if (PATH_KEY.test(key) && typeof value === "string") return "[LOCAL_PATH]";
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 4) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeValue(item, key, depth + 1));
  if (typeof value === "object") {
    const result = {};
    for (const [childKey, childValue] of Object.entries(value).slice(0, 30)) {
      result[childKey] = sanitizeValue(childValue, childKey, depth + 1);
    }
    return result;
  }
  return redactText(value);
}

function parseLines(content) {
  return String(content || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const entry = JSON.parse(line);
        return entry && typeof entry === "object" ? [entry] : [];
      } catch {
        return [];
      }
    });
}

class DiagnosticLog {
  constructor({ userDataPath, onEntry, maxFileBytes = DEFAULT_MAX_FILE_BYTES, maxEntries = DEFAULT_MAX_ENTRIES }) {
    this.directory = path.join(userDataPath, "logs");
    this.file = path.join(this.directory, "diagnostics.jsonl");
    this.archiveFile = path.join(this.directory, "diagnostics.1.jsonl");
    this.onEntry = onEntry;
    this.maxFileBytes = maxFileBytes;
    this.maxEntries = maxEntries;
    try {
      fs.mkdirSync(this.directory, { recursive: true });
    } catch {
      // The app remains usable even when diagnostics cannot be persisted.
    }
  }

  info(source, message, details) {
    return this.log("info", source, message, details);
  }

  warn(source, message, details) {
    return this.log("warn", source, message, details);
  }

  error(source, message, details) {
    return this.log("error", source, message, details);
  }

  log(level, source, message, details = null) {
    const entry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      level: LEVELS.has(level) ? level : "info",
      source: redactText(source || "app", 40).toLowerCase().replace(/[^a-z0-9_-]/g, "_") || "app",
      message: redactText(message || "未提供日志信息", MAX_MESSAGE_LENGTH),
      details: sanitizeValue(details),
    };
    const line = `${JSON.stringify(entry)}\n`;
    try {
      fs.mkdirSync(this.directory, { recursive: true });
      this.#rotateIfNeeded(Buffer.byteLength(line));
      fs.appendFileSync(this.file, line, "utf8");
    } catch {
      return null;
    }
    try {
      this.onEntry?.(entry);
    } catch {
      // Logging must never interrupt the operation being diagnosed.
    }
    return entry;
  }

  list({ level = "all", source = "all", limit = 200 } = {}) {
    const safeLimit = Math.max(1, Math.min(this.maxEntries, Number(limit) || 200));
    const entries = [this.archiveFile, this.file].flatMap((file) => {
      try {
        return fs.existsSync(file) ? parseLines(fs.readFileSync(file, "utf8")) : [];
      } catch {
        return [];
      }
    });
    return entries
      .filter((entry) => (level === "all" || entry.level === level) && (source === "all" || entry.source === source))
      .slice(-safeLimit)
      .reverse();
  }

  exportText() {
    return this.list({ limit: this.maxEntries })
      .reverse()
      .map((entry) => JSON.stringify(entry))
      .join("\n");
  }

  clear() {
    for (const file of [this.file, this.archiveFile]) {
      try {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch {
        // A locked file should not make the settings screen unusable.
      }
    }
  }

  #rotateIfNeeded(incomingBytes) {
    let currentBytes = 0;
    try {
      currentBytes = fs.statSync(this.file).size;
    } catch {
      return;
    }
    if (currentBytes + incomingBytes <= this.maxFileBytes) return;
    if (fs.existsSync(this.archiveFile)) fs.unlinkSync(this.archiveFile);
    fs.renameSync(this.file, this.archiveFile);
  }
}

module.exports = {
  DiagnosticLog,
  redactText,
  sanitizeValue,
};
