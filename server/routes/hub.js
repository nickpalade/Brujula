import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

import { logger } from "../logger.js";
import * as store from "../store.js";
import { DispatchActionRequest, HubReportRequest } from "../schemas.js";

// Agent HUB — the hub data layer's REST API (CONTRACTS §3, PRD §5B/§6).
// Mounted once by server/main.js (`app.use(hubRouter)`); routes carry their
// full `/api/...` paths so a sub-router (advise) can be mounted alongside.

const HERE = path.dirname(fileURLToPath(import.meta.url));

function envelope(res, { data = null, error = null, status = 200 } = {}) {
  res.status(status).json({ success: error === null, data, error });
}

// ---- pipeline plug-in (agent PIPELINE, server/pipeline/index.js) -----------
// PIPELINE may not exist yet. We import it lazily, memoize the result, and
// every call site guards with try/catch so the hub degrades (stores the report
// as pending, returns a deterministic order) instead of 5xx-ing. When PIPELINE
// ships its index.js exporting the CONTRACTS §4 signatures, it plugs in with no
// hub change required.
let pipelinePromise;
function loadPipeline() {
  if (pipelinePromise === undefined) {
    const file = path.join(HERE, "..", "pipeline", "index.js");
    if (!fs.existsSync(file)) {
      pipelinePromise = Promise.resolve(null);
    } else {
      pipelinePromise = import("../pipeline/index.js").catch((err) => {
        logger.warn(`[hub] pipeline present but failed to import: ${err.message}`);
        return null;
      });
    }
  }
  return pipelinePromise;
}

const URGENCY_RANK = { critical: 3, high: 2, medium: 1, low: 0 };

// Deterministic fallback ordering used when the pipeline's prioritize() is
// unavailable: open first, then urgency, then people affected, then oldest.
function fallbackPrioritize(incidents) {
  return [...incidents].sort((a, b) => {
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    const u = (URGENCY_RANK[b.urgency] ?? 0) - (URGENCY_RANK[a.urgency] ?? 0);
    if (u !== 0) return u;
    const p = (b.people_count ?? 0) - (a.people_count ?? 0);
    if (p !== 0) return p;
    return (a.created_at ?? "") < (b.created_at ?? "") ? -1 : 1;
  });
}

function fallbackSitrep(brd) {
  const open = brd.incidents.filter((i) => i.status === "open");
  const confirmed = brd.dispatches.filter((d) => d.state === "confirmed");
  const lines = [
    `SITREP — ${new Date().toISOString()}`,
    `Open incidents: ${open.length}. Confirmed deployments: ${confirmed.length}.`,
    ...fallbackPrioritize(open).map(
      (i) => `- [${(i.urgency ?? "?").toUpperCase()}] ${i.category} @ ${i.location ?? "unknown"} — ${i.summary}`,
    ),
  ];
  return lines.join("\n");
}

export const hubRouter = express.Router();

// POST /api/reports — store the raw report, then run the pipeline
// (parse → dedup → match). On any pipeline failure the report is kept as
// pending (parsed_into: null) and we return 200 with incident: null.
// How long POST /api/reports waits for the pipeline before acknowledging
// anyway. Phone browsers abort requests after ~60s; on a CPU-only laptop one
// Gemma parse can take minutes, so past this deadline we return 200 with
// incident:null and let the pipeline finish in the background — the incident
// then reaches every client through /api/sync. On GPU the pipeline finishes
// well inside the deadline and the response carries the incident inline.
const REPORT_ACK_TIMEOUT_MS = Number(process.env.REPORT_ACK_TIMEOUT_MS ?? 20_000);
const ACK_TIMEOUT = Symbol("ack-timeout");

// Full pipeline for one stored report: parse → dedup → merge/add incident →
// match. Returns the incident, or null when the report stays pending. Never
// throws — this also runs detached (post-ack), where a throw would be fatal.
async function runReportPipeline(reportId, { text, lang, images }) {
  let incident = null;
  try {
    const pipeline = await loadPipeline();
    if (!pipeline || typeof pipeline.parseReport !== "function") {
      throw new Error("pipeline unavailable");
    }

    // 1. PARSE (only this step is allowed to throw — CONTRACTS §4).
    const fields = await pipeline.parseReport(text, lang, images);

    // 2. DEDUP — merge into an existing open incident when the model says so.
    let dedup = { is_duplicate: false };
    try {
      if (typeof pipeline.dedupCheck === "function") {
        dedup = await pipeline.dedupCheck(fields, store.openIncidents());
      }
    } catch (err) {
      logger.warn(`[hub] dedupCheck failed, treating as new incident: ${err.message}`);
    }

    if (dedup?.is_duplicate && dedup.matching_incident_id) {
      const existing = store.getIncident(dedup.matching_incident_id);
      if (existing) {
        incident = mergeReportIntoIncident(existing, reportId, fields);
      }
    }
    if (!incident) {
      incident = store.addIncident({ ...fields, merged_report_ids: [reportId] });
    }

    store.updateReport(reportId, { parsed_into: incident.id });

    // 3. MATCH — for a need, propose the best available resource (proposal
    // only; the coordinator confirms via POST /api/incidents/:id/dispatch).
    if (incident.kind === "need" && !incident.proposed_dispatch_id) {
      try {
        if (typeof pipeline.proposeMatch === "function") {
          const match = await pipeline.proposeMatch(incident, store.availableResources());
          if (match && match.resource_id && store.getResource(match.resource_id)) {
            const dispatch = store.addDispatch({
              incident_id: incident.id,
              resource_id: match.resource_id,
              rationale: [match.rationale, match.distance_note].filter(Boolean).join(" "),
              proposed_by_ai: true,
            });
            incident = store.updateIncident(incident.id, {
              proposed_dispatch_id: dispatch.id,
            });
          }
        }
      } catch (err) {
        logger.warn(`[hub] proposeMatch failed, no dispatch proposed: ${err.message}`);
      }
    }
  } catch (err) {
    // Pipeline unavailable or parse threw — degrade gracefully, keep pending.
    logger.warn(`[hub] report ${reportId} stored pending (unparsed): ${err.message}`);
    incident = null;
  }
  return incident;
}

hubRouter.post("/api/reports", async (req, res) => {
  const parsed = HubReportRequest.safeParse(req.body);
  if (!parsed.success) {
    return envelope(res, {
      error:
        "body must be {\"text\"?: \"<1-8000 chars>\", \"image_base64\"?, \"image_mime\"?, " +
        "\"source_device\"?, \"lang\"?, \"client_ref\"?} with text or image",
      status: 400,
    });
  }
  const {
    text = null,
    image_base64 = null,
    image_mime = null,
    source_device = null,
    lang = null,
    client_ref = null,
  } = parsed.data;

  // Idempotent replay: the field outbox resends with the same client_ref until
  // it hears a 200, so a retry must return the already-stored report instead
  // of creating a duplicate.
  if (client_ref) {
    const existing = store.listReports().find((r) => r.client_ref === client_ref);
    if (existing) {
      const incident = existing.parsed_into ? store.getIncident(existing.parsed_into) : null;
      logger.info(`[hub] report replay (client_ref ${client_ref}) → ${existing.id}`);
      return envelope(res, { data: { report: existing, incident } });
    }
  }

  // Photo triage: the image goes to the parse step only; the base64 is never
  // persisted — the stored report just records that a photo informed it.
  const images = image_base64 ? [{ base64: image_base64, mime: image_mime }] : undefined;

  const report = store.addReport({
    raw_text: text ?? "",
    source_device,
    lang,
    has_image: Boolean(image_base64),
    client_ref,
  });

  const work = runReportPipeline(report.id, { text, lang, images });
  const outcome = await Promise.race([
    work,
    new Promise((resolve) => {
      const t = setTimeout(() => resolve(ACK_TIMEOUT), REPORT_ACK_TIMEOUT_MS);
      if (typeof t.unref === "function") t.unref();
    }),
  ]);

  if (outcome === ACK_TIMEOUT) {
    logger.info(
      `[hub] report ${report.id} acknowledged before the pipeline finished ` +
        `(> ${REPORT_ACK_TIMEOUT_MS}ms); incident will surface via /api/sync`,
    );
    return envelope(res, { data: { report: store.getReport(report.id), incident: null } });
  }

  envelope(res, { data: { report: store.getReport(report.id), incident: outcome } });
});

// Merge a new report's parsed fields into an existing incident. Raises what we
// know (max urgency, max people_count, fill missing location) and records the
// merged report id — the dedup evidence the Command UI renders.
function mergeReportIntoIncident(incident, reportId, fields) {
  const patch = {
    merged_report_ids: [...(incident.merged_report_ids ?? []), reportId],
  };
  if ((URGENCY_RANK[fields.urgency] ?? 0) > (URGENCY_RANK[incident.urgency] ?? 0)) {
    patch.urgency = fields.urgency;
  }
  if (
    fields.people_count != null &&
    (incident.people_count == null || fields.people_count > incident.people_count)
  ) {
    patch.people_count = fields.people_count;
  }
  if (incident.location == null && fields.location != null) {
    patch.location = fields.location;
  }
  return store.updateIncident(incident.id, patch);
}

// GET /api/incidents — priority-ordered board.
hubRouter.get("/api/incidents", async (req, res) => {
  const incidents = store.listIncidents();
  let ordered = fallbackPrioritize(incidents);
  try {
    const pipeline = await loadPipeline();
    if (pipeline && typeof pipeline.prioritize === "function") {
      const result = await pipeline.prioritize(incidents);
      if (Array.isArray(result) && result.length === incidents.length) {
        ordered = result;
      }
    }
  } catch (err) {
    logger.warn(`[hub] prioritize failed, using deterministic order: ${err.message}`);
  }
  envelope(res, { data: ordered });
});

// GET /api/resources — inventory.
hubRouter.get("/api/resources", (req, res) => {
  envelope(res, { data: store.listResources() });
});

// GET /api/reports?ids=rep_a,rep_b — fetch report bodies by id (dedup evidence
// for the Command Post drawer; COMMAND-UI inbox 002). Omit `ids` → all reports.
// INTEGRATION added this (CONTRACTS addition, additive/non-breaking).
hubRouter.get("/api/reports", (req, res) => {
  const idsParam = req.query.ids;
  if (idsParam !== undefined) {
    const ids = String(idsParam)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const reports = ids.map((id) => store.getReport(id)).filter(Boolean);
    return envelope(res, { data: reports });
  }
  envelope(res, { data: store.listReports() });
});

// POST /api/incidents/:id/dispatch — confirm/override a proposed dispatch.
hubRouter.post("/api/incidents/:id/dispatch", (req, res) => {
  const parsed = DispatchActionRequest.safeParse(req.body);
  if (!parsed.success) {
    return envelope(res, {
      error:
        "body must be {\"dispatch_id\": \"...\", \"action\": \"confirm\"|\"override\", " +
        "\"resource_id\"?: \"...\" (required for override)}",
      status: 400,
    });
  }
  const { dispatch_id, action, resource_id } = parsed.data;

  const incident = store.getIncident(req.params.id);
  if (!incident) {
    return envelope(res, { error: `no incident ${req.params.id}`, status: 404 });
  }
  const dispatch = store.getDispatch(dispatch_id);
  if (!dispatch || dispatch.incident_id !== incident.id) {
    return envelope(res, { error: `no dispatch ${dispatch_id} for ${incident.id}`, status: 404 });
  }
  if (dispatch.state !== "proposed") {
    return envelope(res, { error: `dispatch is already ${dispatch.state}`, status: 409 });
  }

  const patch = { state: "confirmed", confirmed_by_human_at: new Date().toISOString() };

  if (action === "override") {
    const chosen = store.getResource(resource_id);
    if (!chosen) {
      return envelope(res, { error: `no resource ${resource_id}`, status: 404 });
    }
    // Free the originally proposed resource if it was committed by an earlier
    // step (defensive — proposals don't commit, but overrides should be clean).
    if (dispatch.resource_id && dispatch.resource_id !== resource_id) {
      const prev = store.getResource(dispatch.resource_id);
      if (prev && prev.status === "committed") {
        store.updateResource(prev.id, { status: "available" });
      }
    }
    patch.resource_id = resource_id;
    patch.proposed_by_ai = false;
  }

  const updated = store.updateDispatch(dispatch.id, patch);
  store.updateResource(updated.resource_id, { status: "committed" });
  store.updateIncident(incident.id, { status: "dispatched" });

  envelope(res, { data: updated });
});

// GET /api/sync?since=<seq> — deltas since a monotonic seq (default full board).
hubRouter.get("/api/sync", (req, res) => {
  const since = Number.parseInt(req.query.since ?? "0", 10);
  envelope(res, { data: store.syncSince(Number.isNaN(since) ? 0 : since) });
});

// GET /api/sitrep — plain-language situation report.
hubRouter.get("/api/sitrep", async (req, res) => {
  const brd = store.board();
  let text = fallbackSitrep(brd);
  try {
    const pipeline = await loadPipeline();
    if (pipeline && typeof pipeline.generateSitrep === "function") {
      const result = await pipeline.generateSitrep(brd);
      if (typeof result === "string" && result.trim()) text = result;
    }
  } catch (err) {
    logger.warn(`[hub] generateSitrep failed, using fallback: ${err.message}`);
  }
  envelope(res, { data: { text, generated_at: new Date().toISOString() } });
});

// POST /api/advise (agent KB-MOCK, server/routes/advise.js) — mounted here if
// present, so the advisory panel works once KB-MOCK ships its router.
const ADVISE_FILE = path.join(HERE, "advise.js");
if (fs.existsSync(ADVISE_FILE)) {
  try {
    const mod = await import("./advise.js");
    const adviseRouter = mod.adviseRouter ?? mod.default ?? mod.router;
    if (adviseRouter) {
      hubRouter.use(adviseRouter);
      logger.info("[hub] mounted advise router (server/routes/advise.js)");
    } else {
      logger.warn("[hub] advise.js found but exports no router");
    }
  } catch (err) {
    logger.warn(`[hub] advise.js present but failed to mount: ${err.message}`);
  }
}
