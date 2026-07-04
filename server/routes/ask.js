import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import { z } from "zod";

import { logger } from "../logger.js";
import * as store from "../store.js";
import { generateValidated, PipelineModelError } from "../pipeline/model.js";

// POST /api/ask — the field assistant. A volunteer (or anyone) asks a plain
// question from their phone; Gemma answers GROUNDED in the live board + the
// offline protocol KB — never from open-ended model knowledge. If the data
// doesn't contain the answer, the assistant says so and points at the
// Command Post instead of inventing something.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KB_FILE = path.join(HERE, "..", "kb", "protocols.json");

let KB = null;
try {
  KB = JSON.parse(fs.readFileSync(KB_FILE, "utf8"));
} catch (err) {
  logger.warn(`[ask] could not load ${KB_FILE} (${err.message}); protocol grounding disabled.`);
}

const AskRequest = z.object({
  question: z.string().min(1).max(600),
  device_id: z.string().max(120).nullish(),
  lang: z.string().max(20).nullish(),
});

const AskAnswer = z.object({
  answer: z.string().min(1).max(1500),
});

const askJsonSchema = () => ({
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false,
});

const LANGUAGE_NAME = { es: "Spanish", en: "English" };

function askPrompt(languageName) {
  return `You are the field assistant of Brújula, an OFFLINE disaster-coordination hub
(2026 Venezuela earthquakes). A responder asks a question from their phone.
Answer ONLY from the DATA sections in the user message:
- YOU: who is asking (role, team, current mission state), when known.
- BOARD: live incidents, resources and dispatches on the coordination board.
- PROTOCOLS: condensed humanitarian field protocols with sources.

Rules:
- Ground every statement in the data. NEVER invent incidents, resources,
  counts, names or locations. If the data does not answer the question, say
  so plainly and tell them to ask the Command Post (Puesto de Mando).
- Operational guidance for trained responders only. NEVER give medical
  diagnosis or treatment ("give the patient X" is forbidden) — for medical
  questions cite the triage protocol steps and defer to the coordinator.
- You cannot dispatch, confirm or change anything — only the human
  coordinator at the Command Post can. Say so if asked to act.
- Answer in ${languageName}. Be brief: 1-4 short sentences, or up to 4 short
  numbered steps. Plain text, no markdown.

Output JSON only.`;
}

// Compact projections — same philosophy as the pipeline digests: the model
// sees a curated, minimal slice, not raw rows.
function incidentDigest(i) {
  return {
    id: i.id,
    category: i.category,
    urgency: i.urgency,
    status: i.status,
    location: i.location ?? null,
    people_count: i.people_count ?? null,
    summary: i.summary ?? null,
  };
}

function resourceDigest(r) {
  return {
    id: r.id,
    type: r.type,
    label: r.label,
    location: r.location ?? null,
    status: r.status,
    field_status: r.field_status ?? "idle",
  };
}

function dispatchDigest(d) {
  return {
    incident_id: d.incident_id,
    resource_id: d.resource_id,
    state: d.state,
  };
}

function protocolsDigest() {
  if (!KB?.protocols) return [];
  return Object.entries(KB.protocols).map(([type, p]) => ({
    incident_type: type,
    steps: p.steps,
    source: p.source_label,
    cautions: p.cautions ?? [],
  }));
}

function askerDigest(deviceId) {
  if (!deviceId) return null;
  const person = store.getPersonnelByDevice(deviceId);
  if (!person) return null;
  const resource = person.resource_id ? store.getResource(person.resource_id) : null;
  const dispatch = resource
    ? store
        .listDispatches()
        .filter((d) => d.resource_id === resource.id && (d.state === "confirmed" || d.state === "proposed"))
        .at(-1) ?? null
    : null;
  return {
    name: person.name,
    role: person.role,
    skill: person.skill ?? null,
    field_status: resource?.field_status ?? null,
    assigned_incident: dispatch?.state === "confirmed" ? store.getIncident(dispatch.incident_id)?.summary ?? null : null,
  };
}

function envelope(res, { data = null, error = null, status = 200 } = {}) {
  res.status(status).json({ success: error === null, data, error });
}

export const askRouter = express.Router();

askRouter.post("/api/ask", async (req, res) => {
  const parsed = AskRequest.safeParse(req.body);
  if (!parsed.success) {
    return envelope(res, {
      status: 400,
      error: 'body must be {"question": "<1-600 chars>", "device_id"?, "lang"?}',
    });
  }
  const { question, device_id = null, lang = null } = parsed.data;
  const languageName = LANGUAGE_NAME[(lang ?? "es").slice(0, 2)] ?? "Spanish";

  const grounding = {
    you: askerDigest(device_id),
    board: {
      incidents: store.listIncidents().filter((i) => i.status !== "resolved").map(incidentDigest),
      resources: store.listResources().map(resourceDigest),
      dispatches: store.listDispatches().map(dispatchDigest),
    },
    protocols: protocolsDigest(),
  };

  try {
    const { answer } = await generateValidated({
      step: "ask",
      systemPrompt: askPrompt(languageName),
      userText:
        `QUESTION:\n${question}\n\n` +
        `YOU:\n${JSON.stringify(grounding.you)}\n\n` +
        `BOARD:\n${JSON.stringify(grounding.board)}\n\n` +
        `PROTOCOLS:\n${JSON.stringify(grounding.protocols)}`,
      jsonSchema: askJsonSchema(),
      validator: AskAnswer,
    });
    logger.info(`[ask] answered (${languageName}) for device ${device_id ?? "anonymous"}`);
    return envelope(res, { data: { answer, asked_at: new Date().toISOString() } });
  } catch (err) {
    if (!(err instanceof PipelineModelError)) throw err;
    logger.warn(`[ask] model unavailable (${err.message})`);
    return envelope(res, {
      status: 503,
      error: "asistente no disponible — el modelo no respondió; consulta al Puesto de Mando",
    });
  }
});

export default askRouter;
