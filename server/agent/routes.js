import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

import { logger } from "../logger.js";
import { OllamaError } from "../ollama-manager.js";
import { CloudError } from "../providers/cloud-provider.js";
import { advise } from "./advisory.js";
import { PipelineError, generateSitrep, ingestReport } from "./pipeline.js";
import { IngestRequest } from "./schemas.js";
import * as store from "./store.js";

const SEED_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "fixtures",
  "seed_board.json",
);

function envelope(res, { data = null, error = null, status = 200 } = {}) {
  res.status(status).json({ success: error === null, data, error });
}

function handleAgentError(res, err) {
  if (err instanceof OllamaError || err instanceof CloudError) {
    logger.error(`Provider failure: ${err.message}`);
    return envelope(res, { error: err.message, status: 503 });
  }
  if (err instanceof PipelineError) {
    logger.error(err.message);
    return envelope(res, { error: err.message, status: 502 });
  }
  throw err;
}

export const agentRouter = express.Router();

// Full pipeline ingest: parse → dedup → prioritize → match → advise → emit.
agentRouter.post("/reports", async (req, res) => {
  const parsed = IngestRequest.safeParse(req.body);
  if (!parsed.success) {
    return envelope(res, {
      error:
        "body must be {\"text\"?: \"<1-8000 chars>\", \"image_base64\"?: \"...\", " +
        "\"image_mime\"?: \"...\", \"source_device\"?: \"...\"} with text or image",
      status: 422,
    });
  }
  try {
    const card = await ingestReport({
      text: parsed.data.text,
      sourceDevice: parsed.data.source_device,
      imageBase64: parsed.data.image_base64,
      imageMime: parsed.data.image_mime,
    });
    envelope(res, { data: card });
  } catch (err) {
    handleAgentError(res, err);
  }
});

agentRouter.get("/board", (req, res) => {
  const board = store.getBoard();
  const incidents = store.prioritizedIncidents();
  envelope(res, {
    data: {
      incidents,
      resources: board.resources,
      dispatches: board.dispatches,
      stats: {
        open_incidents: incidents.filter((i) => i.status === "open").length,
        available_resources: board.resources.filter((r) => r.status === "available").length,
        proposed_dispatches: board.dispatches.filter((d) => d.state === "proposed").length,
        reports_ingested: board.reports.length,
      },
    },
  });
});

agentRouter.get("/incidents/:id", async (req, res) => {
  const found = store.getIncident(req.params.id);
  if (!found) {
    return envelope(res, { error: `no incident ${req.params.id}`, status: 404 });
  }
  const advisory = await advise(found.incident.category, {
    location: found.incident.location,
    summary: found.incident.summary,
    people_estimate: found.incident.people_estimate,
  });
  envelope(res, { data: { ...found, advisory } });
});

agentRouter.post("/incidents/:id/resolve", (req, res) => {
  const incident = store.setIncidentStatus(req.params.id, "resolved");
  if (!incident) {
    return envelope(res, { error: `no incident ${req.params.id}`, status: 404 });
  }
  envelope(res, { data: incident });
});

// The human-in-command step: every AI-proposed dispatch is confirmed or
// rejected by the coordinator, never auto-executed.
agentRouter.post("/dispatches/:id/confirm", (req, res) => {
  const dispatch = store.getDispatch(req.params.id);
  if (!dispatch) {
    return envelope(res, { error: `no dispatch ${req.params.id}`, status: 404 });
  }
  if (dispatch.state !== "proposed") {
    return envelope(res, { error: `dispatch is already ${dispatch.state}`, status: 409 });
  }
  const confirmed = store.setDispatchState(dispatch.id, "confirmed");
  store.setResourceStatus(dispatch.resource_id, "committed");
  store.setIncidentStatus(dispatch.incident_id, "dispatched");
  envelope(res, { data: confirmed });
});

agentRouter.post("/dispatches/:id/reject", (req, res) => {
  const dispatch = store.getDispatch(req.params.id);
  if (!dispatch) {
    return envelope(res, { error: `no dispatch ${req.params.id}`, status: 404 });
  }
  if (dispatch.state !== "proposed") {
    return envelope(res, { error: `dispatch is already ${dispatch.state}`, status: 409 });
  }
  envelope(res, { data: store.setDispatchState(dispatch.id, "rejected") });
});

agentRouter.get("/sitrep", async (req, res) => {
  try {
    envelope(res, { data: { sitrep: await generateSitrep() } });
  } catch (err) {
    handleAgentError(res, err);
  }
});

agentRouter.post("/board/seed", (req, res) => {
  let seedData = req.body;
  if (!seedData || Object.keys(seedData).length === 0) {
    try {
      seedData = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"));
    } catch (err) {
      return envelope(res, { error: `could not read seed file: ${err.message}`, status: 500 });
    }
  }
  envelope(res, { data: store.seed(seedData) });
});

agentRouter.post("/board/reset", (req, res) => {
  store.reset();
  envelope(res, { data: { reset: true } });
});
