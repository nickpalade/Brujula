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
