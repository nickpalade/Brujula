import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

import { logger } from "../logger.js";
import * as store from "../store.js";
import { geocodeLabel } from "../geocode.js";
import {
  AlertRequest,
  CrewStatusRequest,
  DispatchActionRequest,
  DispatchStatusRequest,
  HubReportRequest,
  IncidentPatchRequest,
  RegisterRequest,
  ResourcePatchRequest,
} from "../schemas.js";

// Agent HUB — the hub data layer's REST API (CONTRACTS §3, PRD §5B/§6).
// Mounted once by server/main.js (`app.use(hubRouter)`); routes carry their
// full `/api/...` paths so a sub-router (advise) can be mounted alongside.

const HERE = path.dirname(fileURLToPath(import.meta.url));

function envelope(res, { data = null, error = null, status = 200 } = {}) {
  res.status(status).json({ success: error === null, data, error });
}

// Normalize a person's name for matching: lowercase, remove accents, collapse whitespace.
function normalizePersonName(name) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
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

// Where does an incident's map pin come from? Phone GPS on the report when
// the browser granted it, else the offline gazetteer resolves the parsed
// location label. Either way {lat, lon} or {} — the map simply skips
// incidents without coordinates. (Exported for tests.)
export function resolveCoords(reportCoords, locationLabel) {
  if (Number.isFinite(reportCoords?.lat) && Number.isFinite(reportCoords?.lon)) {
    return { lat: reportCoords.lat, lon: reportCoords.lon };
  }
  const hit = geocodeLabel(locationLabel);
  return hit ? { lat: hit.lat, lon: hit.lon } : {};
}

// Full pipeline for one stored report: parse → dedup → merge/add incident →
// match. Returns the incident, or null when the report stays pending. Never
// throws — this also runs detached (post-ack), where a throw would be fatal.
async function runReportPipeline(reportId, { text, lang, images, coords }) {
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

    const resolved = resolveCoords(coords, fields.location);

    if (dedup?.is_duplicate && dedup.matching_incident_id) {
      const existing = store.getIncident(dedup.matching_incident_id);
      if (existing) {
        incident = mergeReportIntoIncident(existing, reportId, fields, resolved);
      }
    }
    if (!incident) {
      incident = store.addIncident({ ...fields, ...resolved, merged_report_ids: [reportId] });
    }

    store.updateReport(reportId, { parsed_into: incident.id });

    // 2.5. PERSONS — extract missing-persons registry from parsed fields.
    // Wrapped in try-catch so person handling can never break report processing.
    try {
      const persons = Array.isArray(fields.persons) ? fields.persons : [];
      for (const person of persons) {
        if (!person.name) continue;
        const nameKey = normalizePersonName(person.name);
        const existing = store.findPersonByNameKey(nameKey);
        const newDetail = person.detail ?? "";

        if (existing) {
          // Check if statuses differ: missing vs. found/safe
          const existingIsMissing = existing.status === "missing";
          const newIsMissing = person.status === "missing";
          if (existingIsMissing && !newIsMissing) {
            // Update to found/safe, mark as matched
            const combinedDetail = existing.detail && newDetail
              ? `${existing.detail} | ${newDetail}`
              : (newDetail || existing.detail);
            store.updatePerson(existing.id, {
              status: person.status,
              detail: combinedDetail,
              matched: true,
            });
          } else if (!existingIsMissing && newIsMissing) {
            // Don't downgrade found/safe to missing
            if (newDetail && !existing.detail) {
              store.updatePerson(existing.id, { detail: newDetail });
            }
          } else {
            // Same status; just update detail if new info
            if (newDetail && (!existing.detail || newDetail.length > existing.detail.length)) {
              store.updatePerson(existing.id, { detail: newDetail });
            }
          }
        } else {
          // Insert new person
          store.addPerson({
            name: person.name,
            name_key: nameKey,
            status: person.status,
            detail: newDetail || null,
            report_id: reportId,
            incident_id: incident.id,
          });
        }
      }
    } catch (err) {
      logger.warn(`[hub] person handling failed, continuing: ${err.message}`);
    }

    // 3. MATCH — for a need, propose the best available resource (proposal
    // only; the coordinator confirms via POST /api/incidents/:id/dispatch).
    if (incident.kind === "need" && !incident.proposed_dispatch_id) {
      try {
        if (typeof pipeline.proposeMatch === "function") {
          // matchable = available + returning crews (re-taskable); engaged
          // crews (traveling / on_site) are excluded before Gemma ever looks.
          const match = await pipeline.proposeMatch(incident, store.matchableResources());
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
    reported_by = null,
    date = null,
    lat = null,
    lon = null,
    accuracy = null,
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

  // GPS is all-or-nothing: a lone lat (its pair mangled away by validation)
  // is meaningless, so store null coords rather than half a fix.
  const hasGps = Number.isFinite(lat) && Number.isFinite(lon);

  const report = store.addReport({
    raw_text: text ?? "",
    source_device,
    lang,
    has_image: Boolean(image_base64),
    client_ref,
    reported_by,
    date,
    lat: hasGps ? lat : null,
    lon: hasGps ? lon : null,
    accuracy: hasGps && Number.isFinite(accuracy) ? accuracy : null,
  });

  const work = runReportPipeline(report.id, {
    text,
    lang,
    images,
    coords: hasGps ? { lat, lon } : null,
  });
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
// (Exported for tests.)
export function mergeReportIntoIncident(incident, reportId, fields, coords = {}) {
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
  // First non-null coordinates win — later reports never move an existing pin.
  if (incident.lat == null && Number.isFinite(coords.lat) && Number.isFinite(coords.lon)) {
    patch.lat = coords.lat;
    patch.lon = coords.lon;
  }
  return store.updateIncident(incident.id, patch);
}

// ---- personnel registration -------------------------------------------------

const SKILL_LABEL = {
  rescue: "rescate",
  medical: "médico",
  water: "agua",
  shelter: "refugio",
  food: "comida",
  machinery: "maquinaria",
};

function resourceFieldsFor(person) {
  if (person.role === "volunteer") {
    return {
      type: "volunteer",
      label: `${person.name} — equipo voluntario${person.team_size ? ` ×${person.team_size}` : ""}`,
      location: person.location ?? null,
      capacity: person.team_size ?? null,
    };
  }
  // crew: the resource carries the actual capability so the matcher can use it.
  const skill = person.skill ?? "rescue";
  return {
    type: skill,
    label: `${person.name} — equipo ${SKILL_LABEL[skill] ?? skill}${person.team_size ? ` ×${person.team_size}` : ""}`,
    location: person.location ?? null,
    capacity: person.team_size ?? null,
  };
}

// POST /api/register — field device signs up as reporter / volunteer / crew.
// Upsert by device_id (safe to call on every app launch). Volunteers and crews
// also get (or refresh) a linked resource on the board, which the pipeline's
// match step reads — Gemma proposes dispatching them like any other resource.
hubRouter.post("/api/register", (req, res) => {
  const parsed = RegisterRequest.safeParse(req.body);
  if (!parsed.success) {
    return envelope(res, {
      error:
        "body must be {\"role\": \"reporter\"|\"volunteer\"|\"crew\", \"name\", \"device_id\", " +
        "\"skill\"? (crew), \"location\"?, \"team_size\"?}",
      status: 400,
    });
  }
  const { role, name, skill = null, location = null, team_size = null, device_id } = parsed.data;

  let person = store.getPersonnelByDevice(device_id);
  const fields = { role, name, skill, location, team_size, device_id };
  person = person
    ? store.updatePersonnel(person.id, fields)
    : store.addPersonnel(fields);

  let resource = null;
  if (role === "volunteer" || role === "crew") {
    const rf = resourceFieldsFor(person);
    const existing = person.resource_id ? store.getResource(person.resource_id) : null;
    if (existing) {
      // Refresh profile fields; keep dispatch status (committed stays committed).
      resource = store.updateResource(existing.id, rf);
    } else {
      resource = store.addResource({ ...rf, status: "available", field_status: "idle" });
      person = store.updatePersonnel(person.id, { resource_id: resource.id });
    }
    logger.info(`[hub] registered ${role} '${name}' (${device_id}) → resource ${resource.id}`);
  } else {
    // Role switched to reporter: their old resource is no longer offerable.
    if (person.resource_id) {
      const old = store.getResource(person.resource_id);
      if (old && old.status === "available") {
        store.updateResource(old.id, { status: "unavailable" });
      }
      person = store.updatePersonnel(person.id, { resource_id: null });
    }
    logger.info(`[hub] registered reporter '${name}' (${device_id})`);
  }

  envelope(res, { data: { personnel: person, resource } });
});

// GET /api/personnel — the roster (registered devices), for the command side.
hubRouter.get("/api/personnel", (req, res) => {
  envelope(res, { data: store.listPersonnel() });
});

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
  // Confirmed = the crew is now en route; engaged crews leave the match pool.
  // Handle resource quantity: if quantity is a number, decrement; if it becomes 0, commit fully.
  const resource = store.getResource(updated.resource_id);
  if (resource) {
    const resourcePatch = { field_status: "traveling" };
    if (typeof resource.quantity === "number") {
      const newQuantity = Math.max(0, resource.quantity - 1);
      resourcePatch.quantity = newQuantity;
      if (newQuantity === 0) {
        resourcePatch.status = "committed";
      } else {
        resourcePatch.status = "available";
      }
    } else {
      resourcePatch.status = "committed";
    }
    store.updateResource(updated.resource_id, resourcePatch);
  }
  store.updateIncident(incident.id, { status: "dispatched" });

  envelope(res, { data: updated });
});

// POST /api/crew-status — a volunteer/crew phone updates its mission state.
// Deterministic lifecycle glue around the matcher:
//   idle       → back at base: resource available again, location = home base
//   traveling  → engaged (excluded from matching)
//   on_site    → engaged; location = the dispatched incident's site
//   returning  → re-taskable; location stays at the site they're leaving, so
//                "closest to the new incident" is meaningful for Gemma
// (Phone GPS will replace this honor-system location once the map lands.)
hubRouter.post("/api/crew-status", (req, res) => {
  const parsed = CrewStatusRequest.safeParse(req.body);
  if (!parsed.success) {
    return envelope(res, {
      error:
        "body must be {\"device_id\", \"field_status\": \"idle\"|\"traveling\"|\"on_site\"|\"returning\"}",
      status: 400,
    });
  }
  const { device_id, field_status } = parsed.data;

  const person = store.getPersonnelByDevice(device_id);
  if (!person) {
    return envelope(res, { error: `no registration for device ${device_id}`, status: 404 });
  }
  if (!person.resource_id) {
    return envelope(res, { error: "device is registered as a reporter (no crew resource)", status: 409 });
  }
  const resource = store.getResource(person.resource_id);
  if (!resource) {
    return envelope(res, { error: `resource ${person.resource_id} not found (board reseeded? re-register)`, status: 404 });
  }

  const patch = { field_status };

  // Where is the crew? on_site/returning → at/near their dispatched incident;
  // idle → back at their registered base.
  if (field_status === "on_site" || field_status === "returning") {
    const lastConfirmed = store
      .listDispatches()
      .filter((d) => d.resource_id === resource.id && (d.state === "confirmed" || d.state === "done"))
      .sort((a, b) => (a.confirmed_by_human_at ?? "") < (b.confirmed_by_human_at ?? "") ? -1 : 1)
      .pop();
    const site = lastConfirmed ? store.getIncident(lastConfirmed.incident_id)?.location : null;
    if (site) patch.location = site;
  } else if (field_status === "idle") {
    patch.location = person.location ?? resource.location;
    patch.status = "available"; // mission over — fully back in the pool
  }

  const updated = store.updateResource(resource.id, patch);
  logger.info(`[hub] crew-status ${person.name} (${device_id}) → ${field_status}${patch.location ? ` @ ${patch.location}` : ""}`);
  envelope(res, { data: { personnel: person, resource: updated } });
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

// ---- Broadcast alerts ---------------------------------------------------

// POST /api/alerts — create a broadcast alert.
hubRouter.post("/api/alerts", (req, res) => {
  const parsed = AlertRequest.safeParse(req.body);
  if (!parsed.success) {
    return envelope(res, {
      error:
        "body must be {\"message\": \"<1-500 chars>\", \"severity\": \"info\"|\"warning\"|\"critical\", \"zone\"?: string}",
      status: 400,
    });
  }
  const { message, severity, zone = null } = parsed.data;
  const alert = store.addAlert({ message, severity, zone });
  envelope(res, { data: alert });
});

// POST /api/alerts/:id/deactivate — deactivate an alert.
hubRouter.post("/api/alerts/:id/deactivate", (req, res) => {
  const alert = store.getAlert(req.params.id);
  if (!alert) {
    return envelope(res, { error: `no alert ${req.params.id}`, status: 404 });
  }
  const updated = store.updateAlert(req.params.id, { active: false });
  envelope(res, { data: updated });
});

// GET /api/alerts — list all alerts.
hubRouter.get("/api/alerts", (req, res) => {
  envelope(res, { data: store.listAlerts() });
});

// ---- Incident correction ------------------------------------------------

// PATCH /api/incidents/:id — human correction of incident fields.
hubRouter.patch("/api/incidents/:id", (req, res) => {
  const parsed = IncidentPatchRequest.safeParse(req.body);
  if (!parsed.success) {
    return envelope(res, {
      error:
        "body must be at least one of: {\"category\", \"location\", \"people_count\", " +
        "\"urgency\", \"summary\", \"status\"}",
      status: 400,
    });
  }

  const incident = store.getIncident(req.params.id);
  if (!incident) {
    return envelope(res, { error: `no incident ${req.params.id}`, status: 404 });
  }

  const patch = {};
  for (const [key, val] of Object.entries(parsed.data)) {
    if (val !== undefined) patch[key] = val;
  }
  patch.corrected_by_human = true;

  const updated = store.updateIncident(req.params.id, patch);
  envelope(res, { data: updated });
});

// POST /api/incidents/:id/rematch — escalation watchdog: rematch a need incident.
hubRouter.post("/api/incidents/:id/rematch", async (req, res) => {
  const incident = store.getIncident(req.params.id);
  if (!incident) {
    return envelope(res, { error: `no incident ${req.params.id}`, status: 404 });
  }

  let newDispatch = null;
  try {
    const pipeline = await loadPipeline();
    if (!pipeline || typeof pipeline.proposeMatch !== "function") {
      return envelope(res, { data: { dispatch: null } });
    }

    const match = await pipeline.proposeMatch(incident, store.matchableResources());
    if (match && match.resource_id && store.getResource(match.resource_id)) {
      // Withdraw the old proposed dispatch if one exists
      if (incident.proposed_dispatch_id) {
        const oldDispatch = store.getDispatch(incident.proposed_dispatch_id);
        if (oldDispatch && oldDispatch.state === "proposed") {
          store.updateDispatch(oldDispatch.id, { state: "withdrawn" });
        }
      }

      // Create new dispatch
      newDispatch = store.addDispatch({
        incident_id: incident.id,
        resource_id: match.resource_id,
        rationale: [match.rationale, match.distance_note].filter(Boolean).join(" "),
        proposed_by_ai: true,
      });

      // Update incident with new proposed dispatch
      store.updateIncident(incident.id, {
        proposed_dispatch_id: newDispatch.id,
      });
    }
  } catch (err) {
    logger.warn(`[hub] rematch failed: ${err.message}`);
  }

  envelope(res, { data: { dispatch: newDispatch } });
});

// ---- Assignment lifecycle -----------------------------------------------

// POST /api/dispatches/:id/status — update dispatch state through lifecycle.
hubRouter.post("/api/dispatches/:id/status", (req, res) => {
  const parsed = DispatchStatusRequest.safeParse(req.body);
  if (!parsed.success) {
    return envelope(res, {
      error:
        "body must be {\"state\": \"accepted\"|\"en_route\"|\"on_site\"|\"done\", \"outcome\"?: string}",
      status: 400,
    });
  }

  const dispatch = store.getDispatch(req.params.id);
  if (!dispatch) {
    return envelope(res, { error: `no dispatch ${req.params.id}`, status: 404 });
  }

  const { state, outcome = null } = parsed.data;

  // State lifecycle validation: must move forward in order
  // Allowed states after confirmation: confirmed → accepted → en_route → on_site → done
  const stateOrder = ["confirmed", "accepted", "en_route", "on_site", "done"];
  const currentIdx = stateOrder.indexOf(dispatch.state);
  const newIdx = stateOrder.indexOf(state);

  if (currentIdx === -1) {
    return envelope(res, {
      error: `dispatch state '${dispatch.state}' not in lifecycle order`,
      status: 400,
    });
  }

  if (newIdx === -1) {
    return envelope(res, {
      error: `unknown state '${state}'`,
      status: 400,
    });
  }

  if (newIdx <= currentIdx) {
    return envelope(res, {
      error: `cannot move backward in lifecycle (current: ${dispatch.state}, requested: ${state})`,
      status: 400,
    });
  }

  // Build patch
  const patch = { state, status_updated_at: new Date().toISOString() };
  if (state === "done" && outcome) {
    patch.outcome = outcome;
  }

  const updated = store.updateDispatch(req.params.id, patch);

  // On done: free the resource and update incident outcome
  if (state === "done") {
    const resource = store.getResource(dispatch.resource_id);
    if (resource) {
      store.updateResource(dispatch.resource_id, {
        status: "available",
        field_status: "returning",
      });
    }

    const incident = store.getIncident(dispatch.incident_id);
    if (incident && outcome) {
      store.updateIncident(dispatch.incident_id, { outcome });
    }
  }

  const resource = store.getResource(dispatch.resource_id);
  const incident = store.getIncident(dispatch.incident_id);

  envelope(res, {
    data: {
      dispatch: updated,
      resource: resource || null,
      incident: incident || null,
    },
  });
});

// ---- Resource quantity --------------------------------------------------

// PATCH /api/resources/:id — update resource quantity/unit/status.
hubRouter.patch("/api/resources/:id", (req, res) => {
  const parsed = ResourcePatchRequest.safeParse(req.body);
  if (!parsed.success) {
    return envelope(res, {
      error:
        "body must be at least one of: {\"quantity\": int|null, \"unit\": string|null, \"status\": \"available\"|\"committed\"}",
      status: 400,
    });
  }

  const resource = store.getResource(req.params.id);
  if (!resource) {
    return envelope(res, { error: `no resource ${req.params.id}`, status: 404 });
  }

  const patch = {};
  for (const [key, val] of Object.entries(parsed.data)) {
    if (val !== undefined) patch[key] = val;
  }

  const updated = store.updateResource(req.params.id, patch);
  envelope(res, { data: updated });
});

// ---- Missing-persons registry -------------------------------------------

// GET /api/persons — list all persons in the registry.
hubRouter.get("/api/persons", (req, res) => {
  envelope(res, { data: store.listPersons() });
});

// ---- Trends (deterministic analytics) -----------------------------------

// GET /api/trends?window=120 — compare incident trends over time windows.
hubRouter.get("/api/trends", (req, res) => {
  const windowMinutes = Math.min(
    1440,
    Math.max(15, Number.parseInt(req.query.window ?? "120", 10) || 120)
  );
  const now = new Date();
  const currentStart = new Date(now.getTime() - windowMinutes * 60000);
  const prevStart = new Date(now.getTime() - 2 * windowMinutes * 60000);
  const prevEnd = currentStart;

  // Count reports by category/location in each window
  const allReports = store.listReports();
  const allIncidents = store.listIncidents();
  const allDispatches = store.listDispatches();

  // Build incident lookup
  const incidentById = {};
  for (const inc of allIncidents) {
    incidentById[inc.id] = inc;
  }

  const categoryMap = {};
  const locationMap = {};

  for (const report of allReports) {
    const timestamp = new Date(report.created_at);
    const isCurrent = timestamp >= currentStart;
    const isPrev = timestamp >= prevStart && timestamp < prevEnd;

    if (!isCurrent && !isPrev) continue;

    // Resolve category and location via incident
    let category = "pending";
    let location = "unknown";

    if (report.parsed_into) {
      const incident = incidentById[report.parsed_into];
      if (incident) {
        category = incident.category ?? "pending";
        location = incident.location ?? "unknown";
      }
    }

    // Update category counts
    if (!categoryMap[category]) {
      categoryMap[category] = { current: 0, previous: 0, delta: 0 };
    }
    if (isCurrent) {
      categoryMap[category].current += 1;
    } else if (isPrev) {
      categoryMap[category].previous += 1;
    }

    // Update location counts
    if (!locationMap[location]) {
      locationMap[location] = { current: 0, previous: 0, delta: 0 };
    }
    if (isCurrent) {
      locationMap[location].current += 1;
    } else if (isPrev) {
      locationMap[location].previous += 1;
    }
  }

  // Compute deltas and filter
  const categories = Object.entries(categoryMap)
    .map(([category, counts]) => ({
      category,
      current: counts.current,
      previous: counts.previous,
      delta: counts.current - counts.previous,
    }))
    .filter((c) => c.current > 0 || c.previous > 0)
    .sort((a, b) => {
      const deltaDiff = Math.abs(b.delta) - Math.abs(a.delta);
      return deltaDiff !== 0 ? deltaDiff : b.current - a.current;
    });

  const locations = Object.entries(locationMap)
    .map(([location, counts]) => ({
      location,
      current: counts.current,
      previous: counts.previous,
      delta: counts.current - counts.previous,
    }))
    .filter((l) => l.current > 0 || l.previous > 0)
    .sort((a, b) => {
      const deltaDiff = Math.abs(b.delta) - Math.abs(a.delta);
      return deltaDiff !== 0 ? deltaDiff : b.current - a.current;
    });

  envelope(res, {
    data: {
      generated_at: now.toISOString(),
      window_minutes: windowMinutes,
      categories,
      locations,
    },
  });
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
