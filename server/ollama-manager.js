import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { OLLAMA_HOST, TAGS_TIMEOUT_MS } from "./config.js";

const execFileAsync = promisify(execFile);

const MAX_RETRIES = 2;
const INITIAL_BACKOFF_MS = 300;
const PULL_IDLE_TIMEOUT_MS = 600_000;

export class OllamaError extends Error {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function isLocalhostEndpoint(endpoint) {
  return ["localhost", "127.0.0.1", "::1"].some((h) => endpoint.includes(h));
}

export function formatSize(size) {
  const units = [
    ["GB", 1024 ** 3],
    ["MB", 1024 ** 2],
    ["KB", 1024],
  ];
  for (const [unit, threshold] of units) {
    if (size >= threshold) return `${(size / threshold).toFixed(1)} ${unit}`;
  }
  return `${size} B`;
}

export async function isReachable(endpoint = OLLAMA_HOST) {
  try {
    const resp = await fetch(`${endpoint}/api/version`, {
      signal: AbortSignal.timeout(TAGS_TIMEOUT_MS),
    });
    return resp.status === 200;
  } catch {
    return false;
  }
}

async function listModelsViaHttp(endpoint) {
  const resp = await fetch(`${endpoint}/api/tags`, {
    signal: AbortSignal.timeout(TAGS_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const models = (await resp.json()).models ?? [];
  return models.map((m) => ({
    name: m.name,
    id: m.model ?? m.name,
    size: formatSize(m.size ?? 0),
    modified: m.modified_at ?? "",
  }));
}

async function listModelsViaCli() {
  let out;
  try {
    out = await execFileAsync("ollama", ["list"], { timeout: 10_000 });
  } catch (err) {
    if (err.stderr !== undefined && err.code !== "ENOENT") {
      throw new OllamaError(`Ollama CLI error: ${String(err.stderr).trim()}`);
    }
    throw new OllamaError(`Ollama CLI not found or not responding: ${err.message}`);
  }
  const models = [];
  for (const line of out.stdout.split("\n").slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 4) {
      models.push({
        name: parts[0],
        id: parts[1],
        size: `${parts[2]} ${parts[3]}`,
        modified: parts.slice(4).join(" "),
      });
    }
  }
  return models;
}

export async function listModels(endpoint = OLLAMA_HOST) {
  let lastError = new OllamaError("unknown error");
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await listModelsViaHttp(endpoint);
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) await sleep(INITIAL_BACKOFF_MS * 2 ** attempt);
    }
  }

  if (isLocalhostEndpoint(endpoint)) {
    try {
      return await listModelsViaCli();
    } catch (cliErr) {
      throw new OllamaError(
        `Cannot reach Ollama at ${endpoint} (${lastError.message}). ` +
          `Also tried CLI: ${cliErr.message}`,
      );
    }
  }
  throw new OllamaError(
    `Cannot reach Ollama at ${endpoint}: ${lastError.message}. ` +
      "Check that the Ollama server is running.",
  );
}

export async function loadedModels(endpoint = OLLAMA_HOST) {
  try {
    const resp = await fetch(`${endpoint}/api/ps`, {
      signal: AbortSignal.timeout(TAGS_TIMEOUT_MS),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return (await resp.json()).models ?? [];
  } catch {
    return [];
  }
}

// Load the model into memory (empty prompt = no generation) and pin it for
// an hour. Used by POST /warmup so the first real report is instant.
export async function warmupModel(name, { endpoint = OLLAMA_HOST, cpuOnly = false } = {}) {
  const body = { model: name, keep_alive: "60m" };
  if (cpuOnly) body.options = { num_gpu: 0 };
  const resp = await fetch(`${endpoint}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(600_000),
  });
  if (!resp.ok) {
    throw new OllamaError(`Warmup failed: HTTP ${resp.status}`);
  }
}

export async function unloadModel(name, endpoint = OLLAMA_HOST) {
  try {
    await fetch(`${endpoint}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: name, keep_alive: 0 }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return;
  }
}

export async function deleteModel(name, endpoint = OLLAMA_HOST) {
  let resp;
  try {
    resp = await fetch(`${endpoint}/api/delete`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new OllamaError(`Failed to delete model: ${err.message}`);
  }
  if (resp.status !== 200) {
    const body = (await resp.text()).slice(0, 200);
    throw new OllamaError(`Failed to delete model (HTTP ${resp.status}): ${body}`);
  }
}

export async function pullModel(name, { endpoint = OLLAMA_HOST, onProgress } = {}) {
  const controller = new AbortController();
  let idleTimer = null;
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => controller.abort(new OllamaError("pull stalled: no data for 10 minutes")),
      PULL_IDLE_TIMEOUT_MS,
    );
  };

  resetIdle();
  try {
    const resp = await fetch(`${endpoint}/api/pull`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, stream: true }),
      signal: controller.signal,
    });
    if (resp.status !== 200) {
      const body = await resp.text();
      throw new OllamaError(`Failed to pull model (HTTP ${resp.status}): ${body}`);
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let lastPct = -1;
    for await (const chunk of resp.body) {
      resetIdle();
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.error) throw new OllamaError(`Ollama error: ${event.error}`);
        const total = event.total ?? 0;
        const completed = event.completed ?? 0;
        if (total > 0 && onProgress) {
          const pct = Math.floor((completed * 100) / total);
          if (pct !== lastPct) {
            onProgress(pct);
            lastPct = pct;
          }
        }
      }
    }
  } catch (err) {
    if (err instanceof OllamaError) throw err;
    if (controller.signal.aborted && controller.signal.reason instanceof OllamaError) {
      throw controller.signal.reason;
    }
    throw new OllamaError(`Pull failed: ${err.message}`);
  } finally {
    clearTimeout(idleTimer);
  }
}
