// Brújula agent pipeline — Gemma steps 2-6 (PRD §4.2), plus a step-1 parse that
// emits the v1 Incident vocabulary (CONTRACTS.md §4).
//
// Every function here is PURE / dependency-injected: no store import, no HTTP.
// HUB imports these and wires them to server/store.js. Fallbacks guarantee the
// pipeline NEVER throws into the hub, EXCEPT parseReport (allowed to throw so
// HUB can store the report as pending) — CONTRACTS §4.

import { logger } from "../logger.js";
import { generateValidated, PipelineModelError, summaryLanguageName } from "./model.js";
import { buildParsePrompt, buildSitrepPrompt, DEDUP_PROMPT, MATCH_PROMPT } from "./prompts.js";
import {
  DedupModel,
  dedupJsonSchema,
  MatchModel,
  matchJsonSchema,
  ParsePipeline,
  parsePipelineJsonSchema,
  SitrepModel,
  sitrepJsonSchema,
  URGENCIES,
} from "./schemas.js";

export { PipelineModelError } from "./model.js";

// ------------------------------------------------------------- digests
// Compact projections sent to the model — small prompts = fast + reliable.

function incidentDigest(incident) {
  return {
    id: incident.id,
    category: incident.category,
    urgency: incident.urgency,
    location: incident.location ?? null,
    people_count: incident.people_count ?? null,
    summary: incident.summary ?? null,
  };
}

// A deterministic backstop for dedup: even if the model picks a match, reject
// it unless the categories are compatible. Blocks the common gemma3:4b failure
// of merging two incidents just because they share a town.
function categoriesCompatible(a, b) {
  if (a === b) return true;
  const pair = new Set([a, b]);
  // A collapse can be reported as a rescue OR as a request for machinery.
  if (pair.has("rescue") && pair.has("machinery")) return true;
  return false;
}

function resourceDigest(resource) {
  return {
    id: resource.id,
    type: resource.type,
    label: resource.label,
    location: resource.location ?? null,
    capacity: resource.capacity ?? null,
    quantity: resource.quantity ?? null,
    unit: resource.unit ?? null,
    status: resource.status,
    // Mission state for crews: idle (at base) or returning (re-taskable,
    // location = the site they're leaving). Engaged crews are filtered out
    // before the digest is built.
    field_status: resource.field_status ?? "idle",
  };
}

// A resource the matcher may propose: available, or a returning crew
// (re-taskable). Engaged crews (traveling / on_site) never reach the model.
function isMatchable(r) {
  if (r.field_status === "traveling" || r.field_status === "on_site") return false;
  return r.status === "available" || r.field_status === "returning";
}

// ============================================================= 1. PARSE
// parseReport(text, lang, images?) → {kind, category, location, people_count,
//   urgency, summary, resource_label}
// images: [{base64, mime}] — photo triage; only this step sees the photo,
// downstream steps work on the structured record (base64 never persisted).
// May throw PipelineModelError — HUB catches and stores the report as pending.
export async function parseReport(text, lang, images) {
  const languageName = summaryLanguageName();
  const parsed = await generateValidated({
    step: "parse",
    systemPrompt: buildParsePrompt(languageName),
    userText: text?.trim()
      ? (lang ? `[reported language: ${lang}]\n${text}` : text)
      : "(no text — photo-only report)",
    jsonSchema: parsePipelineJsonSchema(),
    validator: ParsePipeline,
    images,
  });
  // Deterministic normalization: a label only makes sense for offered resources.
  if (parsed.kind !== "resource") parsed.resource_label = null;
  // Guard against the model's "-1 = unknown" habit.
  if (typeof parsed.people_count === "number" && parsed.people_count < 0) {
    parsed.people_count = null;
  }
  return parsed;
}

// ============================================================= 2. DEDUP
// dedupCheck(parsedIncident, openIncidents)
//   → {is_duplicate, matching_incident_id, confidence, reason}
// Fallback (any failure): not a duplicate.
export async function dedupCheck(parsedIncident, openIncidents) {
  const open = Array.isArray(openIncidents) ? openIncidents : [];
  if (open.length === 0) {
    return {
      is_duplicate: false,
      matching_incident_id: null,
      confidence: 0,
      reason: "No open incidents to compare against.",
    };
  }

  const ids = open.map((i) => i.id);
  const newReport = {
    category: parsedIncident.category,
    location: parsedIncident.location ?? null,
    people_count: parsedIncident.people_count ?? null,
    summary: parsedIncident.summary ?? null,
    raw_text: parsedIncident.raw_text ?? undefined,
  };

  try {
    const decision = await generateValidated({
      step: "dedup",
      systemPrompt: DEDUP_PROMPT,
      userText:
        `NEW REPORT:\n${JSON.stringify(newReport)}\n\n` +
        `OPEN INCIDENTS:\n${JSON.stringify(open.map(incidentDigest))}`,
      jsonSchema: dedupJsonSchema(ids),
      validator: DedupModel,
    });

    let matching =
      decision.matching_incident_id && ids.includes(decision.matching_incident_id)
        ? decision.matching_incident_id
        : null;

    // Category-compatibility backstop (see categoriesCompatible).
    if (matching) {
      const matched = open.find((i) => i.id === matching);
      if (matched && !categoriesCompatible(matched.category, parsedIncident.category)) {
        logger.warn(
          `[pipeline:dedup] rejected cross-category merge ` +
            `(${parsedIncident.category} → ${matched.category} @ ${matching})`,
        );
        matching = null;
      }
    }

    return {
      is_duplicate: Boolean(matching),
      matching_incident_id: matching,
      confidence: matching ? decision.confidence : 0,
      reason: matching ? decision.reason : "No matching open incident (or cross-category match rejected).",
    };
  } catch (err) {
    if (!(err instanceof PipelineModelError)) throw err;
    logger.warn(`[pipeline:dedup] fallback → not duplicate (${err.message})`);
    return {
      is_duplicate: false,
      matching_incident_id: null,
      confidence: 0,
      reason: "Dedup step unavailable — treated as a new incident.",
    };
  }
}

// ========================================================= 3. PRIORITIZE
// prioritize(incidents) → Incident[] ordered, urgency recomputed.
// Deterministic + explainable on purpose (PRD §4.2 step 3; CONTRACTS §4 allows
// plain code). Live-victim rescues float to the top; within a tier, more people
// and longer-waiting incidents rank higher (age decay). No model call → 0 ms,
// never throws.

const URGENCY_RANK = { critical: 3, high: 2, medium: 1, low: 0 };
const STATUS_RANK = { open: 2, dispatched: 1, resolved: 0 };
const URGENCY_BASE_SCORE = { critical: 90, high: 65, medium: 40, low: 15 };

function recomputeUrgency(incident) {
  // Live victims / active rescue always outrank everything else.
  if (incident.category === "rescue") return "critical";
  return URGENCIES.includes(incident.urgency) ? incident.urgency : "medium";
}

function ageMinutes(incident, now) {
  const t = Date.parse(incident.created_at ?? "");
  if (Number.isNaN(t)) return 0;
  return Math.max(0, (now - t) / 60000);
}

export function prioritize(incidents) {
  const list = Array.isArray(incidents) ? incidents : [];
  const now = Date.now();

  const scored = list.map((inc) => {
    const urgency = recomputeUrgency(inc);
    const uRank = URGENCY_RANK[urgency] ?? 0;
    const sRank = STATUS_RANK[inc.status] ?? 2;
    const people = Math.min(Number(inc.people_count) || 0, 999);
    const waited = ageMinutes(inc, now);

    // Sort key: status tier, then urgency, then people, then age (older first).
    const sortKey =
      sRank * 1e9 + uRank * 1e6 + people * 1e3 + Math.min(waited, 999);

    // 0-100 display score: urgency base, nudged up by scale + waiting time.
    const urgency_score = Math.min(
      100,
      Math.round((URGENCY_BASE_SCORE[urgency] ?? 40) + Math.min(people / 20, 6) + Math.min(waited / 60, 4)),
    );

    return { incident: { ...inc, urgency, urgency_score }, sortKey };
  });

  scored.sort((a, b) => b.sortKey - a.sortKey);
  return scored.map((s) => s.incident);
}

// ============================================================= 4. MATCH
// proposeMatch(incident, availableResources)
//   → {resource_id, rationale, distance_note} | null
// Fallback (any failure or no fit): null.
export async function proposeMatch(incident, availableResources) {
  const available = Array.isArray(availableResources)
    ? availableResources.filter(isMatchable)
    : [];
  if (available.length === 0) return null;

  const ids = available.map((r) => r.id);

  try {
    const decision = await generateValidated({
      step: "match",
      systemPrompt: MATCH_PROMPT,
      userText:
        `NEED INCIDENT:\n${JSON.stringify(incidentDigest(incident))}\n\n` +
        `AVAILABLE RESOURCES:\n${JSON.stringify(available.map(resourceDigest))}`,
      jsonSchema: matchJsonSchema(ids),
      validator: MatchModel,
    });

    if (!decision.resource_id || !ids.includes(decision.resource_id)) return null;
    return {
      resource_id: decision.resource_id,
      rationale: decision.rationale,
      distance_note: decision.distance_note ?? "",
    };
  } catch (err) {
    if (!(err instanceof PipelineModelError)) throw err;
    logger.warn(`[pipeline:match] fallback → no match (${err.message})`);
    return null;
  }
}

// ============================================================ 6. SITREP
// generateSitrep(board) → string. board = {incidents, resources, dispatches}.
// Fallback (any failure): deterministic plain-code summary. Never throws.
export async function generateSitrep(board) {
  const incidents = Array.isArray(board?.incidents) ? board.incidents : [];
  const resources = Array.isArray(board?.resources) ? board.resources : [];
  const dispatches = Array.isArray(board?.dispatches) ? board.dispatches : [];

  const ranked = prioritize(incidents);
  const digest = {
    incidents: ranked.map((i) => ({
      ...incidentDigest(i),
      status: i.status,
      urgency_score: i.urgency_score,
    })),
    resources: resources.map(resourceDigest),
    dispatches: dispatches.map((d) => ({
      incident_id: d.incident_id,
      resource_id: d.resource_id,
      state: d.state,
    })),
  };

  try {
    const { sitrep } = await generateValidated({
      step: "sitrep",
      systemPrompt: buildSitrepPrompt(summaryLanguageName()),
      userText: JSON.stringify(digest),
      jsonSchema: sitrepJsonSchema(),
      validator: SitrepModel,
    });
    return sitrep;
  } catch (err) {
    if (!(err instanceof PipelineModelError)) throw err;
    logger.warn(`[pipeline:sitrep] fallback → deterministic summary (${err.message})`);
    return fallbackSitrep(ranked, resources, dispatches);
  }
}

function fallbackSitrep(rankedIncidents, resources, dispatches) {
  const open = rankedIncidents.filter((i) => i.status === "open");
  const confirmedIncidentIds = new Set(
    dispatches.filter((d) => d.state === "confirmed" || d.state === "done").map((d) => d.incident_id),
  );
  const unmet = open.filter((i) => !confirmedIncidentIds.has(i.id));
  const available = resources.filter((r) => r.status === "available");
  const confirmed = dispatches.filter((d) => d.state === "confirmed" || d.state === "done");

  const lines = [];
  lines.push("SITUATION REPORT (auto-generated, model offline).");
  lines.push(`Open incidents: ${open.length}. Highest priority first:`);
  for (const i of open.slice(0, 5)) {
    const ppl = i.people_count != null ? `, ~${i.people_count} people` : "";
    lines.push(`  - [${i.urgency.toUpperCase()}] ${i.category} @ ${i.location ?? "location unknown"}${ppl} — ${i.summary ?? ""}`);
  }
  lines.push(`Unmet needs (no confirmed dispatch): ${unmet.length}.`);
  lines.push(`Confirmed deployments: ${confirmed.length}.`);
  lines.push(`Resources still available: ${available.length}.`);
  return lines.join("\n");
}
