import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { OLLAMA_HOST } from "./config.js";
import { logger } from "./logger.js";

const STARTUP_WAIT_MS = 30_000;
const LOG_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "ollama_serve.log",
);

let spawned = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function findOllamaExe() {
  const isWin = process.platform === "win32";
  const exeName = isWin ? "ollama.exe" : "ollama";
  const candidates = (process.env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((dir) => path.join(dir, exeName));

  if (isWin) {
    const local = process.env.LOCALAPPDATA || "";
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    candidates.push(
      path.join(local, "Programs", "Ollama", "ollama.exe"),
      path.join(programFiles, "Ollama", "ollama.exe"),
    );
  } else {
    candidates.push("/usr/local/bin/ollama", "/opt/homebrew/bin/ollama");
  }

  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

async function serverUp(timeoutMs = 2_000) {
  try {
    const resp = await fetch(`${OLLAMA_HOST}/api/version`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return resp.status === 200;
  } catch {
    return false;
  }
}

export async function ensureRunning() {
  if (await serverUp()) {
    return { running: true, managed_by: "external", detail: "server already up" };
  }

  const exe = findOllamaExe();
  if (!exe) {
    return {
      running: false,
      managed_by: null,
      detail: "ollama binary not found — run bootstrap first",
    };
  }

  logger.info(`Spawning embedded 'ollama serve' (${exe})`);
  const env = { ...process.env };
  delete env.OLLAMA_LLM_LIBRARY;

  let spawnError = null;
  try {
    const logFd = fs.openSync(LOG_PATH, "a");
    spawned = spawn(exe, ["serve"], {
      stdio: ["ignore", logFd, logFd],
      env,
      windowsHide: true,
    });
    spawned.on("error", (err) => {
      spawnError = err;
    });
  } catch (err) {
    return { running: false, managed_by: null, detail: `spawn failed: ${err.message}` };
  }

  const deadline = Date.now() + STARTUP_WAIT_MS;
  while (Date.now() < deadline) {
    if (spawnError) {
      const detail = `spawn failed: ${spawnError.message}`;
      spawned = null;
      return { running: false, managed_by: null, detail };
    }
    if (await serverUp()) {
      return {
        running: true,
        managed_by: "brujula",
        detail: `embedded ollama serve started (pid ${spawned.pid})`,
      };
    }
    if (spawned.exitCode !== null) {
      spawned = null;
      return {
        running: false,
        managed_by: null,
        detail: "ollama serve exited immediately (port conflict or bad install?)",
      };
    }
    await sleep(500);
  }
  return {
    running: false,
    managed_by: null,
    detail: "ollama serve did not answer in 30s",
  };
}

export function shutdown() {
  if (spawned !== null && spawned.exitCode === null) {
    logger.info(`Stopping embedded ollama serve (pid ${spawned.pid})`);
    spawned.kill();
    const child = spawned;
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 10_000).unref();
  }
  spawned = null;
}
