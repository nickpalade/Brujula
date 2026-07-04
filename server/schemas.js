import { z } from "zod";

export const ParsedReport = z.object({
  type: z.enum(["rescue", "medical", "shelter", "supply", "other"]),
  location: z
    .string()
    .nullable()
    .describe("Place mentioned in the report, as written. null if none."),
  people_estimate: z
    .number()
    .int()
    .nullable()
    .describe("Integer count of people affected. null if not stated."),
  severity: z.enum(["critical", "high", "medium", "low"]),
  summary: z.string().describe("One short sentence in the requested summary language."),
});

export const ReportRequest = z.object({
  text: z
    .string()
    .min(1)
    .max(8000)
    .describe("Raw field report, messy natural language, any language."),
});

export const VoiceTranscriptionRequest = z.object({
  audio_base64: z.string().min(1),
  audio_mime: z.string().max(100).nullish(),
  lang: z.string().max(20).default("es"),
});

export function parsedReportJsonSchema() {
  return z.toJSONSchema(ParsedReport);
}

// ---- Hub API request schemas (agent HUB, CONTRACTS §3) ---------------------

// POST /api/reports — text and/or photo; at least one of the two.
// Photo triage: image goes to the parse step only (multimodal Gemma), the
// base64 is never persisted to the store.
export const HubReportRequest = z
  .object({
    text: z.string().max(8000).nullish(),
    image_base64: z.string().nullish(),
    image_mime: z.string().max(100).nullish(),
    source_device: z.string().max(200).nullish(),
    lang: z.string().max(20).nullish(),
    // Idempotency key from the field outbox: retries carry the same client_ref
    // so a slow pipeline + client timeout can never duplicate a report.
    client_ref: z.string().max(120).nullish(),
    // Who reported (from the device profile): "Name · rol". Stored on the report.
    reported_by: z.string().max(200).nullish(),
    // When the report was actually composed/sent on the phone (ISO string) —
    // distinct from the hub's own receipt time, since a queued report can sit
    // offline for a while before this request ever reaches the server.
    // Accepted loosely (no .datetime() enum) and re-validated server-side —
    // an unparseable value just falls back to the hub's receipt time.
    date: z.string().max(40).nullish(),
    // Best-effort phone GPS at report time (additive, CONTRACTS-safe). The
    // browser geolocation API needs a secure origin, so most field phones
    // won't send these — the gazetteer fallback covers them. FORGIVING:
    // an out-of-range or type-mangled coordinate becomes null (`.catch`)
    // instead of 400-ing away a possibly life-critical report.
    lat: z.number().min(-90).max(90).nullish().catch(null),
    lon: z.number().min(-180).max(180).nullish().catch(null),
    accuracy: z.number().min(0).nullish().catch(null),
  })
  .refine((v) => (v.text ?? "").trim().length > 0 || !!v.image_base64, {
    message: "text or image_base64 is required",
    path: ["text"],
  });

// POST /api/register — a field device signs up as reporter / volunteer / crew.
// Upsert keyed on device_id: re-registering updates the profile. Volunteers
// and crews also become available resources so the match step can dispatch
// them; reporters only attach identity to their reports.
export const RegisterRequest = z.object({
  role: z.enum(["reporter", "volunteer", "crew"]),
  name: z.string().min(1).max(120),
  // crew specialty — what the team can actually do (matcher vocabulary).
  skill: z.enum(["rescue", "medical", "water", "shelter", "food", "machinery"]).nullish(),
  location: z.string().max(200).nullish(),
  team_size: z.number().int().min(1).max(500).nullish(),
  device_id: z.string().min(1).max(120),
});

// POST /api/crew-status — a registered volunteer/crew updates where they are
// in the mission loop. idle = at base, ready; traveling/on_site = engaged
// (excluded from matching); returning = heading back, re-taskable.
export const CrewStatusRequest = z.object({
  device_id: z.string().min(1).max(120),
  field_status: z.enum(["idle", "traveling", "on_site", "returning"]),
});

// POST /api/incidents/:id/dispatch — confirm or override a proposed dispatch.
// `resource_id` is required iff action === "override".
export const DispatchActionRequest = z
  .object({
    dispatch_id: z.string().min(1),
    action: z.enum(["confirm", "override"]),
    resource_id: z.string().min(1).nullish(),
  })
  .refine((v) => v.action !== "override" || !!v.resource_id, {
    message: "resource_id is required when action is \"override\"",
    path: ["resource_id"],
  });

// POST /api/alerts — broadcast an alert to all clients.
export const AlertRequest = z.object({
  message: z.string().min(1).max(500),
  severity: z.enum(["info", "warning", "critical"]),
  zone: z.string().max(200).nullish(),
});

// PATCH /api/incidents/:id — human correction of incident fields.
// At least one key must be present.
export const IncidentPatchRequest = z
  .object({
    category: z.enum(["rescue", "medical", "water", "shelter", "food", "machinery", "hazard", "status"]).nullish(),
    location: z.string().max(200).nullable().nullish(),
    people_count: z.number().int().min(0).nullable().nullish(),
    urgency: z.enum(["critical", "high", "medium", "low"]).nullish(),
    summary: z.string().max(500).nullish(),
    status: z.enum(["open", "dispatched", "resolved"]).nullish(),
  })
  .refine(
    (v) => Object.values(v).some((val) => val !== undefined),
    { message: "at least one field must be present" }
  );

// POST /api/dispatches/:id/status — update dispatch state through lifecycle.
export const DispatchStatusRequest = z.object({
  state: z.enum(["accepted", "en_route", "on_site", "done"]),
  outcome: z.string().max(1000).nullish(),
});

// PATCH /api/resources/:id — update resource quantity/unit/status.
// At least one key must be present.
export const ResourcePatchRequest = z
  .object({
    quantity: z.number().int().min(0).nullable().nullish(),
    unit: z.string().max(40).nullish(),
    status: z.enum(["available", "committed"]).nullish(),
  })
  .refine(
    (v) => Object.values(v).some((val) => val !== undefined),
    { message: "at least one field must be present" }
  );
