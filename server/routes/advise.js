import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import { z } from "zod";

import { logger } from "../logger.js";

// Agent KB-MOCK — POST /api/advise (CONTRACTS §3, PRD §5D).
//
// This is a PROXY-WITH-LOCAL-FALLBACK to Rares' knowledge-service, NOT a
// local-only KB (context/decisions.md D1, binding). Upstream-first:
//   1. If RARES_KB_URL (alias PROTOCOL_KB_URL) is set, POST {URL}/advise with
//      Rares' request shape (~5s timeout), mapping our Incident.category →
//      his incident_type, and normalize his response back into our Advisory.
//   2. On URL unset / unreachable / non-2xx / empty guidance → serve the local
//      offline fallback in server/kb/protocols.json (same four domains as
//      Rares, so the demo looks identical whether or not his box is up).
// Unknown/unmapped category → generic-safety Advisory, never a 500.
//
// Logic ported from the working reference integration in
// server/agent/advisory.js (KB_INCIDENT_TYPE + fromKbResponse) — not copied.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KB_FILE = path.join(HERE, "..", "kb", "protocols.json");

// Load the local fallback content once at startup (fully offline, no I/O per
// request). If it's somehow missing/corrupt we degrade to a hard-coded
// generic-safety response rather than crashing the mount.
let KB;
try {
  KB = JSON.parse(fs.readFileSync(KB_FILE, "utf8"));
} catch (err) {
  logger.warn(`[advise] could not load ${KB_FILE} (${err.message}); using minimal built-in fallback.`);
  KB = null;
}

const STANDARD_CAUTION =
  "Operational protocol for trained responders — not medical advice or patient diagnosis.";

const HARD_GENERIC = {
  incident_type: "other",
  steps: [
    "Size up the scene and confirm it is safe before committing responders.",
    "Identify the primary need and report it up the chain with location and headcount.",
    "Apply the relevant humanitarian standard for the confirmed need; escalate to a specialist team.",
  ],
  source_label: "General disaster-response size-up practice (condensed)",
  cautions: [STANDARD_CAUTION],
};

// Our board categories → knowledge-service incident_types
// (knowledge-service/CLAUDE.md, decisions.md D1). Anything not mapped goes as
// "other"; his service degrades gracefully by contract.
const KB_INCIDENT_TYPE = {
  rescue: "structural_collapse",
  machinery: "structural_collapse",
  medical: "casualty_triage",
  water: "water_sanitation",
  shelter: "shelter_disease",
};

// Accept the Incident.category vocabulary (CONTRACTS §2); context is optional
// and may be a free-text string OR an object with location/people/notes hints.
const AdviseRequest = z.object({
  incident_type: z.string().min(1),
  context: z.union([z.string(), z.record(z.string(), z.unknown())]).nullish(),
});

function envelope(res, { data = null, error = null, status = 200 } = {}) {
  res.status(status).json({ success: error === null, data, error });
}

// Pull the fields Rares' /advise wants out of our loose `context` (string or
// object). Everything is best-effort — nulls are fine (his matcher is forgiving).
function extractContext(context) {
  if (context == null) return { location_label: null, casualty_count: null, notes: null };
  if (typeof context === "string") {
    return { location_label: null, casualty_count: null, notes: context };
  }
  const people = context.people_count ?? context.people_estimate ?? context.casualty_count ?? null;
  return {
    location_label: context.location ?? context.location_label ?? null,
    casualty_count: typeof people === "number" ? people : null,
    notes: context.notes ?? context.summary ?? context.raw_text ?? null,
  };
}

// Normalize Rares' response
//   {incident_type, guidance:[{action, rationale, ...}], safety_flags,
//    disclaimer, source_standards}
// into our Advisory {incident_type, steps[], source_label, cautions[]}.
// Returns null when there is no usable guidance so the caller falls back local.
function fromKbResponse(body, requestedType) {
  if (!Array.isArray(body?.guidance) || body.guidance.length === 0) return null;
  const steps = body.guidance
    .map((g) => (g?.rationale ? `${g.action} (${g.rationale})` : g?.action))
    .filter((s) => typeof s === "string" && s.length > 0);
  if (steps.length === 0) return null;
  const cautions = [
    ...(Array.isArray(body.safety_flags) ? body.safety_flags : []),
    ...(body.disclaimer ? [body.disclaimer] : []),
  ];
  return {
    incident_type: requestedType,
    steps,
    source_label: (Array.isArray(body.source_standards) ? body.source_standards : []).join(", ") ||
      "knowledge-service (Rares)",
    cautions: cautions.length ? cautions : [STANDARD_CAUTION],
  };
}

// Local offline fallback — always echoes the caller's requested incident_type.
function localAdvisory(incidentType) {
  const entry = KB?.protocols?.[incidentType] ?? KB?.generic ?? HARD_GENERIC;
  return {
    incident_type: incidentType,
    steps: entry.steps,
    source_label: entry.source_label,
    cautions: entry.cautions?.length ? entry.cautions : [STANDARD_CAUTION],
  };
}

async function tryUpstream(incidentType, context) {
  const rawUrl = process.env.RARES_KB_URL || process.env.PROTOCOL_KB_URL;
  if (!rawUrl) return null;

  const url = `${rawUrl.replace(/\/+$/, "")}/advise`;
  const kbType = KB_INCIDENT_TYPE[incidentType] ?? "other";
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        incident_type: kbType,
        needs: [incidentType],
        context: extractContext(context),
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) {
      logger.warn(`[advise] Rares KB returned HTTP ${resp.status}; using local fallback.`);
      return null;
    }
    const advisory = fromKbResponse(await resp.json(), incidentType);
    if (advisory) {
      logger.info(`[advise] served upstream (Rares KB) for '${incidentType}' → '${kbType}'.`);
      return advisory;
    }
    logger.warn("[advise] Rares KB returned empty/unusable guidance; using local fallback.");
    return null;
  } catch (err) {
    logger.warn(`[advise] Rares KB unreachable (${err.message}); using local fallback.`);
    return null;
  }
}

export const adviseRouter = express.Router();

// POST /api/advise — {incident_type, context?} → Advisory (CONTRACTS §3).
adviseRouter.post("/api/advise", async (req, res) => {
  const parsed = AdviseRequest.safeParse(req.body);
  if (!parsed.success) {
    return envelope(res, {
      status: 400,
      error: 'body must be {"incident_type": "<category>", "context"?: <string|object>}',
    });
  }

  const incidentType = parsed.data.incident_type.trim().toLowerCase();
  const { context } = parsed.data;

  // Upstream-first, local fallback on any failure. Never throws to a 500 — a
  // handler-level catch guarantees a usable advisory even if something above
  // misbehaves (D1: the advisory panel must demo whether or not Rares is up).
  try {
    const upstream = await tryUpstream(incidentType, context);
    if (upstream) return envelope(res, { data: upstream });
  } catch (err) {
    logger.warn(`[advise] unexpected upstream error (${err.message}); using local fallback.`);
  }

  return envelope(res, { data: localAdvisory(incidentType) });
});

export default adviseRouter;
