const { spawn } = require("node:child_process");
const readline = require("node:readline");

function spawnWithLines(binary, args, options = {}) {
  const child = spawn(binary, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  const stdoutReader = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  const stderrReader = readline.createInterface({ input: child.stderr, crlfDelay: Infinity });

  stdoutReader.on("line", (line) => {
    stdout += `${line}\n`;
    options.onStdoutLine?.(line);
  });
  stderrReader.on("line", (line) => {
    stderr += `${line}\n`;
    options.onStderrLine?.(line);
  });

  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });

  return { child, completion };
}

async function terminateProcessTree(child) {
  if (!child || child.killed || !child.pid) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], {
        shell: false,
        windowsHide: true,
        stdio: "ignore",
      });
      killer.once("error", resolve);
      killer.once("close", resolve);
    });
    return;
  }
  try {
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 800));
    if (!child.killed) child.kill("SIGKILL");
  } catch {
    // Process already exited.
  }
}

module.exports = { spawnWithLines, terminateProcessTree };
