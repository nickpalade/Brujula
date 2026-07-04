import { SUPPORTED_LANGUAGES } from "../config.js";
import { logger } from "../logger.js";
import * as modelConfig from "../model-config.js";
import { getProvider } from "../providers/index.js";
import { advise } from "./advisory.js";
import {
  AgentParse,
  DedupDecision,
  MatchDecision,
  SitrepOutput,
  agentParseJsonSchema,
  dedupJsonSchema,
  matchJsonSchema,
  sitrepJsonSchema,
} from "./schemas.js";
import * as store from "./store.js";

const STEP_RETRIES = 2;

export class PipelineError extends Error {}

function summaryLanguageName() {
  const code = modelConfig.getSummaryLanguage();
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)?.name ?? "English";
}

async function generateValidated({ systemPrompt, userText, jsonSchema, validator, step, images }) {
  const provider = getProvider();
  let lastError = "unknown";
  for (let attempt = 0; attempt < 1 + STEP_RETRIES; attempt += 1) {
    const raw = await provider.generateStructured({ systemPrompt, userText, jsonSchema, images });
    try {
      return validator.parse(JSON.parse(raw));
    } catch (err) {
      lastError = err.message;
      logger.warn(
        `[${step}] malformed model output (attempt ${attempt + 1}/${1 + STEP_RETRIES}): ` +
          `${err.message} | raw=${JSON.stringify(String(raw).slice(0, 300))}`,
      );
    }
  }
  throw new PipelineError(`${step} step returned malformed output: ${lastError}`);
}

// ---------------------------------------------------------------- 1. PARSE

function buildParsePrompt(languageName) {
  return `You are the intake agent of an offline disaster-coordination hub. Turn ONE raw
field report into structured JSON. Reports may be in any language, messy,
urgent, incomplete.

Field rules:
- "kind": need = someone requires help or supplies. resource = a team, piece
  of equipment, facility or supply is AVAILABLE to help (e.g. "tenemos una
  excavadora libre", "la clínica tiene 10 camas libres"). status = situational
  information only, nothing requested or offered.
- "category": rescue (people trapped/missing), medical, water, shelter, food,
  machinery (heavy equipment), hazard (fire/gas/collapse danger), status.
  For a resource, the category is what the resource provides.
- "location": the place as written in the report; null if none given.
- "people_estimate": integer. For needs: people affected ("una familia" ~ 4,
  "unas 40 familias" ~ 160 — estimate when reasonable). For resources:
  capacity if stated. null if not stated.
- "urgency": critical = life at risk right now (trapped victims, voices heard,
  no breathing); high = urgent, hours matter; medium = needed within a day;
  low = can wait. Resources are usually low.
- "resource_label": short label of what is offered ("excavadora + operador").
  null unless kind = resource.
- "summary": one short sentence in ${languageName} for the coordination board.

If a photo is attached, read it: visible damage, hazards, trapped or injured
people, crowding, water conditions. Combine what you see with the text; the
photo can raise urgency or fill in missing fields.

Output JSON only.`;
}

// ---------------------------------------------------------------- 2. DEDUP

const DEDUP_PROMPT = `You maintain the incident board of a disaster-coordination hub. Decide whether
the NEW REPORT describes the SAME real-world incident as one already open on
the board — the same event at the same place, possibly worded differently,
with different people counts, or reported by a different person.

Different places, different categories, or clearly separate events are NOT
duplicates. When unsure, prefer null (a duplicate dispatch wastes resources,
but a missed incident costs lives).

Output JSON only: {"duplicate_of": "<incident id or null>", "reason": "..."}`;

// ---------------------------------------------------------------- 4. MATCH

const MATCH_NEED_PROMPT = `You are the dispatch planner of a disaster-coordination hub. Given ONE need
incident and the list of AVAILABLE resources, choose the single best resource
to dispatch: the capability must actually serve the need (machinery for
trapped-under-rubble, medical capacity for casualties, water supply for water
needs), preferring the nearest by the locations given. If no available
resource genuinely fits, choose null — never force a bad match.

Output JSON only: {"chosen_id": "<resource id or null>", "reason": "..."}`;

const MATCH_RESOURCE_PROMPT = `You are the dispatch planner of a disaster-coordination hub. A NEW RESOURCE
just became available. Given the list of OPEN need incidents, choose the
single incident this resource should serve first: the capability must
actually serve the need, prefer higher urgency, then proximity by the
locations given. If it serves none of them, choose null.

Output JSON only: {"chosen_id": "<incident id or null>", "reason": "..."}`;

function incidentDigest(incident) {
  return {
    id: incident.id,
    category: incident.category,
    urgency: incident.urgency,
    location: incident.location,
    people_estimate: incident.people_estimate,
    summary: incident.summary,
  };
}

function resourceDigest(resource) {
  return {
    id: resource.id,
    category: resource.category,
    label: resource.label,
    location: resource.location,
    capacity: resource.capacity,
  };
}

// ------------------------------------------------------------ orchestrator

export async function ingestReport({ text, sourceDevice, imageBase64, imageMime }) {
  const languageName = summaryLanguageName();

  // 1. PARSE — the only step that sees the photo; downstream steps work on
  // the structured record. The base64 is not persisted to the board file.
  const images = imageBase64 ? [{ base64: imageBase64, mime: imageMime }] : undefined;
  const parsed = await generateValidated({
    systemPrompt: buildParsePrompt(languageName),
    userText: text?.trim() ? text : "(no text — photo-only report)",
    jsonSchema: agentParseJsonSchema(),
    validator: AgentParse,
    step: "parse",
    images,
  });
  parsed.has_image = Boolean(imageBase64);
  const report = store.addReport({ rawText: text ?? "", sourceDevice, parsed });

  if (parsed.kind === "status") {
    return {
      report,
      parsed,
      incident: null,
      resource: null,
      dedup: null,
      dispatch: null,
      advisory: null,
      next_step: "none",
    };
  }

  if (parsed.kind === "resource") {
    const resource = store.addResource({
      category: parsed.category,
      label: parsed.resource_label ?? parsed.summary,
      location: parsed.location,
      capacity: parsed.people_estimate,
      reportId: report.id,
    });
    // 4. MATCH (resource → waiting need)
    const dispatch = await matchResourceToNeed(resource);
    return {
      report,
      parsed,
      incident: null,
      resource,
      dedup: null,
      dispatch,
      advisory: null,
      next_step: dispatch ? "confirm_dispatch" : "none",
    };
  }

  // kind === "need"
  // 2. DEDUP against open incidents
  let incident = null;
  let dedup = null;
  const open = store.openIncidents();
  if (open.length > 0) {
    const openIds = open.map((i) => i.id);
    const decision = await generateValidated({
      systemPrompt: DEDUP_PROMPT,
      userText:
        `NEW REPORT:\n${JSON.stringify({ ...parsed, raw_text: text })}\n\n` +
        `OPEN INCIDENTS:\n${JSON.stringify(open.map(incidentDigest))}`,
      jsonSchema: dedupJsonSchema(openIds),
      validator: DedupDecision,
      step: "dedup",
    });
    if (decision.duplicate_of && openIds.includes(decision.duplicate_of)) {
      incident = store.mergeIntoIncident(decision.duplicate_of, {
        reportId: report.id,
        parsed,
      });
      dedup = { merged_into: decision.duplicate_of, reason: decision.reason };
    }
  }
  if (!incident) {
    incident = store.addIncident({
      category: parsed.category,
      location: parsed.location,
      peopleEstimate: parsed.people_estimate,
      urgency: parsed.urgency,
      summary: parsed.summary,
      reportId: report.id,
    });
  }

  // 4. MATCH (need → available resource). Skip if this incident already has
  // a live dispatch — don't propose a second team for a merged duplicate.
  let dispatch = null;
  const existing = store
    .getIncident(incident.id)
    .dispatches.filter((d) => d.state === "proposed" || d.state === "confirmed");
  if (existing.length > 0) {
    dispatch = existing[existing.length - 1];
  } else {
    dispatch = await matchNeedToResource(incident);
  }

  // 5. ADVISE
  const advisory = await advise(incident.category, {
    location: incident.location,
    summary: incident.summary,
  });

  // 6. EMIT — the action card. Priority is computed against the whole board.
  const prioritized = store.prioritizedIncidents();
  const ranked = prioritized.find((i) => i.id === incident.id);

  return {
    report,
    parsed,
    incident: ranked ?? incident,
    resource: null,
    dedup,
    dispatch,
    advisory,
    next_step: dispatch && dispatch.state === "proposed" ? "confirm_dispatch" : "none",
  };
}

async function matchNeedToResource(incident) {
  const available = store.availableResources();
  if (available.length === 0) return null;
  const ids = available.map((r) => r.id);
  const decision = await generateValidated({
    systemPrompt: MATCH_NEED_PROMPT,
    userText:
      `NEED INCIDENT:\n${JSON.stringify(incidentDigest(incident))}\n\n` +
      `AVAILABLE RESOURCES:\n${JSON.stringify(available.map(resourceDigest))}`,
    jsonSchema: matchJsonSchema(ids),
    validator: MatchDecision,
    step: "match",
  });
  if (!decision.chosen_id || !ids.includes(decision.chosen_id)) return null;
  return store.addDispatch({
    incidentId: incident.id,
    resourceId: decision.chosen_id,
    reason: decision.reason,
  });
}

async function matchResourceToNeed(resource) {
  const dispatched = new Set(
    store
      .getBoard()
      .dispatches.filter((d) => d.state === "proposed" || d.state === "confirmed")
      .map((d) => d.incident_id),
  );
  const waiting = store.openIncidents().filter((i) => !dispatched.has(i.id));
  if (waiting.length === 0) return null;
  const ids = waiting.map((i) => i.id);
  const decision = await generateValidated({
    systemPrompt: MATCH_RESOURCE_PROMPT,
    userText:
      `NEW RESOURCE:\n${JSON.stringify(resourceDigest(resource))}\n\n` +
      `OPEN NEED INCIDENTS:\n${JSON.stringify(waiting.map(incidentDigest))}`,
    jsonSchema: matchJsonSchema(ids),
    validator: MatchDecision,
    step: "match",
  });
  if (!decision.chosen_id || !ids.includes(decision.chosen_id)) return null;
  return store.addDispatch({
    incidentId: decision.chosen_id,
    resourceId: resource.id,
    reason: decision.reason,
  });
}

// ------------------------------------------------------------------ SITREP

export async function generateSitrep() {
  const languageName = summaryLanguageName();
  const board = store.getBoard();
  const digest = {
    incidents: store.prioritizedIncidents().map((i) => ({
      ...incidentDigest(i),
      status: i.status,
      priority: i.priority,
    })),
    resources: board.resources.map((r) => ({ ...resourceDigest(r), status: r.status })),
    dispatches: board.dispatches.map((d) => ({
      incident_id: d.incident_id,
      resource_id: d.resource_id,
      state: d.state,
    })),
  };
  const { sitrep } = await generateValidated({
    systemPrompt:
      `You write situation reports for a disaster-coordination command post, for
handoff to the next shift or up the chain of command. Write in ${languageName}.
Cover, briefly and factually: top open incidents by priority, unmet needs
(open incidents with no dispatch), resources committed and still available,
and confirmed deployments. Plain language, no speculation, no fluff.

Output JSON only: {"sitrep": "..."}`,
    userText: JSON.stringify(digest),
    jsonSchema: sitrepJsonSchema(),
    validator: SitrepOutput,
    step: "sitrep",
  });
  return sitrep;
}
