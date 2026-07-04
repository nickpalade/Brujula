import { createSocket } from "node:dgram";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import { z } from "zod";

import {
  HOST,
  OLLAMA_HOST,
  PORT,
  RECOMMENDED_MODELS,
  SUPPORTED_LANGUAGES,
} from "./config.js";
import { logger } from "./logger.js";
import * as modelConfig from "./model-config.js";
import * as modelDownloads from "./model-downloads.js";
import * as ollamaLifecycle from "./ollama-lifecycle.js";
import * as ollamaManager from "./ollama-manager.js";
import { OllamaError, deleteModel, listModels } from "./ollama-manager.js";
import { getProvider } from "./providers/index.js";
import { CloudError } from "./providers/cloud-provider.js";
import {
  ParsedReport,
  ReportRequest,
  VoiceTranscriptionRequest,
  parsedReportJsonSchema,
} from "./schemas.js";
import { TranscriptionError, transcribeAudio } from "./transcription.js";
import { hubRouter } from "./routes/hub.js";
import { askRouter } from "./routes/ask.js";

function buildParsePrompt(summaryLanguage) {
  return `You turn raw disaster field reports into structured JSON for a coordination
hub. Reports may be in any language, and are often messy, urgent, and
incomplete.

Field rules:
- "type": rescue (people trapped/missing), medical (injury/illness/medicine),
  shelter (housing/refuge needs), supply (food/water/equipment), other.
- "location": the place as written in the report; null if none is given.
- "people_estimate": integer count of people affected; null if not stated.
  "a family" ~ 4, "about 40 families" ~ 160 — estimate when reasonable.
- "severity": critical = life-threatening right now; high = urgent, hours
  matter; medium = needed within a day; low = can wait.
- "summary": one short sentence in ${summaryLanguage} for the coordination board.

Output JSON only.`;
}

const PARSE_RETRIES = 2;

const STATIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "static");
// Built React app (Vite output). Served so phones need only the one LAN URL:
//   http://<lan-ip>:8000/field   and   http://<lan-ip>:8000/command
// Build it with `npm install && npm run build` from the repo root (produces app/dist).
const APP_DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app", "dist");

const NameRequest = z.object({ name: z.string().min(1) });
const ComputeRequest = z.object({ mode: z.string() });
const LanguageRequest = z.object({ language: z.string().min(1) });

function detectLanIp() {
  return new Promise((resolve) => {
    const fallback = () => {
      for (const infos of Object.values(os.networkInterfaces())) {
        for (const info of infos ?? []) {
          if (info.family === "IPv4" && !info.internal) return info.address;
        }
      }
      return "127.0.0.1";
    };
    try {
      const sock = createSocket("udp4");
      sock.once("error", () => {
        sock.close();
        resolve(fallback());
      });
      sock.connect(1, "10.255.255.255", () => {
        const { address } = sock.address();
        sock.close();
        resolve(address);
      });
    } catch {
      resolve(fallback());
    }
  });
}

function envelope(res, { data = null, error = null, status = 200 } = {}) {
  res.status(status).json({ success: error === null, data, error });
}

async function ollamaReachable() {
  return ollamaManager.isReachable(OLLAMA_HOST);
}

const app = express();
// 25mb: field reports may attach a photo as base64 (see POST /api/reports).
app.use(express.json({ limit: "25mb" }));

app.get("/", (req, res) => {
  res.sendFile("index.html", { root: STATIC_DIR });
});

app.get("/health", async (req, res) => {
  const provider = getProvider();
  const status = await provider.health();
  const reachable =
    provider.name === "ollama" ? status.reachable : await ollamaReachable();
  const loaded = await ollamaManager.loadedModels(OLLAMA_HOST);
  const gpuInUse = loaded.some((m) => (m.size_vram ?? 0) > 0);
  envelope(res, {
    data: {
      status: "ok",
      provider: provider.name,
      model: status.model,
      ollama_reachable: reachable,
      compute_mode: modelConfig.getComputeMode(),
      summary_language: modelConfig.getSummaryLanguage(),
      gpu_in_use: gpuInUse,
      detail: status.detail,
    },
  });
});

// Pre-load the active model so the first report of the demo is instant.
app.post("/warmup", async (req, res) => {
  const provider = getProvider();
  if (provider.name !== "ollama") {
    return envelope(res, { data: { warmed: false, detail: "cloud provider needs no warmup" } });
  }
  try {
    const model = await provider.resolveModel();
    await ollamaManager.warmupModel(model, {
      cpuOnly: modelConfig.getComputeMode() === "cpu",
    });
    const loaded = await ollamaManager.loadedModels(OLLAMA_HOST);
    envelope(res, {
      data: {
        warmed: true,
        model,
        gpu_in_use: loaded.some((m) => (m.size_vram ?? 0) > 0),
      },
    });
  } catch (err) {
    if (err instanceof OllamaError) {
      return envelope(res, { error: err.message, status: 503 });
    }
    throw err;
  }
});

app.get("/compute-config", async (req, res) => {
  const loaded = await ollamaManager.loadedModels(OLLAMA_HOST);
  const gpuInUse = loaded.some((m) => (m.size_vram ?? 0) > 0);
  envelope(res, {
    data: { mode: modelConfig.getComputeMode(), gpu_in_use: gpuInUse },
  });
});

app.post("/compute-config", async (req, res) => {
  const parsed = ComputeRequest.safeParse(req.body);
  if (!parsed.success) {
    return envelope(res, { error: "body must be {\"mode\": \"gpu\"|\"cpu\"}", status: 400 });
  }
  try {
    modelConfig.saveComputeMode(parsed.data.mode);
  } catch (err) {
    return envelope(res, { error: err.message, status: 400 });
  }
  for (const m of await ollamaManager.loadedModels(OLLAMA_HOST)) {
    await ollamaManager.unloadModel(m.name);
  }
  envelope(res, { data: { mode: parsed.data.mode } });
});

app.get("/language-config", (req, res) => {
  envelope(res, {
    data: {
      language: modelConfig.getSummaryLanguage(),
      languages: SUPPORTED_LANGUAGES,
    },
  });
});

app.post("/language-config", (req, res) => {
  const parsed = LanguageRequest.safeParse(req.body);
  if (!parsed.success) {
    return envelope(res, {
      error: "body must be {\"language\": \"<code>\"}",
      status: 400,
    });
  }
  try {
    modelConfig.saveSummaryLanguage(parsed.data.language);
  } catch (err) {
    return envelope(res, { error: err.message, status: 400 });
  }
  envelope(res, { data: { language: parsed.data.language } });
});

app.get("/models", async (req, res) => {
  try {
    envelope(res, { data: { models: await listModels() } });
  } catch (err) {
    if (err instanceof OllamaError) {
      return envelope(res, { error: err.message, status: 503 });
    }
    throw err;
  }
});

app.get("/models/recommended", async (req, res) => {
  let installed = new Set();
  try {
    installed = new Set((await listModels()).map((m) => m.name));
  } catch (err) {
    if (!(err instanceof OllamaError)) throw err;
  }
  envelope(res, {
    data: {
      models: RECOMMENDED_MODELS.map((m) => ({
        ...m,
        installed: installed.has(m.name),
      })),
    },
  });
});

app.post("/models/pull", async (req, res) => {
  const parsed = NameRequest.safeParse(req.body);
  if (!parsed.success) {
    return envelope(res, { error: "body must be {\"name\": \"<model>\"}", status: 400 });
  }
  if (!(await ollamaReachable())) {
    return envelope(res, { error: "Ollama not reachable; cannot pull.", status: 503 });
  }
  if (!modelDownloads.start(parsed.data.name)) {
    return envelope(res, {
      error: `${parsed.data.name} is already being downloaded.`,
      status: 409,
    });
  }
  envelope(res, { data: { started: parsed.data.name } });
});

app.get("/models/pull-status", (req, res) => {
  envelope(res, { data: { downloads: modelDownloads.getStatus() } });
});

app.post("/models/pull-status/clear", (req, res) => {
  const parsed = NameRequest.safeParse(req.body);
  if (!parsed.success) {
    return envelope(res, { error: "body must be {\"name\": \"<model>\"}", status: 400 });
  }
  modelDownloads.clearFinished(parsed.data.name);
  envelope(res, { data: { cleared: parsed.data.name } });
});

app.delete("/models/*name", async (req, res) => {
  const name = Array.isArray(req.params.name)
    ? req.params.name.join("/")
    : req.params.name;
  try {
    await deleteModel(name);
  } catch (err) {
    if (err instanceof OllamaError) {
      return envelope(res, { error: err.message, status: 502 });
    }
    throw err;
  }
  envelope(res, { data: { deleted: name } });
});

app.get("/model-config", async (req, res) => {
  const provider = getProvider();
  const status = await provider.health();
  envelope(res, {
    data: { selected: modelConfig.getSelectedModel(), active: status.model },
  });
});

app.post("/model-config", async (req, res) => {
  const parsed = NameRequest.safeParse(req.body);
  if (!parsed.success) {
    return envelope(res, { error: "body must be {\"name\": \"<model>\"}", status: 400 });
  }
  let installed;
  try {
    installed = new Set((await listModels()).map((m) => m.name));
  } catch (err) {
    if (err instanceof OllamaError) {
      return envelope(res, { error: err.message, status: 503 });
    }
    throw err;
  }
  if (!installed.has(parsed.data.name)) {
    return envelope(res, { error: `${parsed.data.name} is not installed.`, status: 400 });
  }
  modelConfig.saveSelectedModel(parsed.data.name);
  envelope(res, { data: { selected: parsed.data.name } });
});

app.post("/parse-report", async (req, res) => {
  const parsed = ReportRequest.safeParse(req.body);
  if (!parsed.success) {
    return envelope(res, {
      error: "body must be {\"text\": \"<1-8000 chars>\"}",
      status: 422,
    });
  }
  const provider = getProvider();
  const languageCode = modelConfig.getSummaryLanguage();
  const languageName =
    SUPPORTED_LANGUAGES.find((l) => l.code === languageCode)?.name ?? "English";
  let lastError = "unknown";
  for (let attempt = 0; attempt < 1 + PARSE_RETRIES; attempt += 1) {
    let raw;
    try {
      raw = await provider.generateStructured({
        systemPrompt: buildParsePrompt(languageName),
        userText: parsed.data.text,
        jsonSchema: parsedReportJsonSchema(),
      });
    } catch (err) {
      if (err instanceof OllamaError || err instanceof CloudError) {
        logger.error(`Provider failure: ${err.message}`);
        return envelope(res, { error: err.message, status: 503 });
      }
      throw err;
    }

    try {
      const report = ParsedReport.parse(JSON.parse(raw));
      return envelope(res, { data: report });
    } catch (err) {
      lastError = err.message;
      logger.warn(
        `Malformed model output (attempt ${attempt + 1}/${1 + PARSE_RETRIES}): ` +
          `${err.message} | raw=${JSON.stringify(String(raw).slice(0, 500))}`,
      );
    }
  }

  logger.error(`All parse attempts returned malformed output: ${lastError}`);
  envelope(res, {
    error: "Model returned malformed output; try again or rephrase the report.",
    status: 502,
  });
});

// Phone voice path: the phone records a short clip, the laptop hub transcribes
// with a local model/command, then the phone confirms or edits before reporting.
app.post("/api/transcribe", async (req, res) => {
  const parsed = VoiceTranscriptionRequest.safeParse(req.body);
  if (!parsed.success) {
    return envelope(res, {
      error: "body must be {\"audio_base64\", \"audio_mime\"?, \"lang\"?}",
      status: 422,
    });
  }
  try {
    const result = await transcribeAudio(parsed.data);
    envelope(res, { data: result });
  } catch (err) {
    if (err instanceof TranscriptionError) {
      return envelope(res, { error: err.message, status: err.status });
    }
    throw err;
  }
});

// Hub data layer + REST API under /api/* (agent HUB): reports, incidents,
// resources, dispatch confirm/override, sync deltas, sitrep, advise.
app.use(hubRouter);

// Field assistant — POST /api/ask: grounded Q&A for responders (answers come
// from the live board + the offline protocol KB, never open-ended).
app.use(askRouter);

// Offline map tiles for the Command Post map (prefetched once with
// `npm run fetch:tiles` into data/tiles/{z}/{x}/{y}.png). Missing tiles just
// 404 — Leaflet shows a blank square, never an error. Immutable cache: tile
// content never changes between prefetches.
const TILES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "tiles");
app.use("/tiles", express.static(TILES_DIR, { immutable: true, maxAge: "30d" }));
if (!fs.existsSync(TILES_DIR)) {
  logger.warn("[web] data/tiles not found — run `npm run fetch:tiles` (once, with internet) to enable the offline map");
}

// Built React app (Vite): serve app/dist assets + the two SPA routes so phones
// and the command laptop need only the single LAN URL (INTEGRATION, Prompt 7.3).
// The existing model-server admin UI stays at "/" (registered above); the React
// client lives at /command and /field. If app/dist is missing (not built yet),
// this block is skipped and only the API + admin UI are served.
if (fs.existsSync(APP_DIST)) {
  app.use(express.static(APP_DIST));
  const sendApp = (req, res) => res.sendFile("index.html", { root: APP_DIST });
  app.get("/command", sendApp);
  app.get("/field", sendApp);
  logger.info(`[web] serving built React app from ${APP_DIST} at /command and /field`);
} else {
  logger.warn(`[web] app/dist not found — run \`npm run build\` to serve the UI (${APP_DIST})`);
}

// Express only treats 4-arity middleware as an error handler — _next must stay
app.use((err, req, res, _next) => {
  if (err.type === "entity.parse.failed") {
    return envelope(res, { error: "invalid JSON body", status: 400 });
  }
  logger.error(`Unhandled error on ${req.method} ${req.path}:`, err);
  envelope(res, { error: "internal server error", status: 500 });
});

async function main() {
  const ollamaStatus = await ollamaLifecycle.ensureRunning();

  const wantGpu = modelConfig.getComputeMode() === "gpu";
  for (const m of await ollamaManager.loadedModels(OLLAMA_HOST)) {
    if (((m.size_vram ?? 0) > 0) !== wantGpu) {
      await ollamaManager.unloadModel(m.name);
    }
  }

  const provider = getProvider();
  const health = await provider.health();
  const lanUrl = `http://${await detectLanIp()}:${PORT}`;

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, HOST, resolve);
  });

  const banner =
    "\n" +
    "=".repeat(60) +
    "\n  BRUJULA model server" +
    `\n  Point phones at:  ${lanUrl}` +
    `\n  Provider: ${provider.name}   Model: ${health.model || "NONE"}` +
    `\n  Backend:  ${health.reachable ? "reachable" : "NOT REACHABLE"} (${health.detail})` +
    `\n  Ollama:   ${ollamaStatus.detail}` +
    "\n" +
    "=".repeat(60);
  console.log(banner);

  const stop = () => {
    ollamaLifecycle.shutdown();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3_000).unref();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  logger.error("Fatal startup error:", err);
  ollamaLifecycle.shutdown();
  process.exit(1);
});
