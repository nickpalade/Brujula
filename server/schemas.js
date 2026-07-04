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
  })
  .refine((v) => (v.text ?? "").trim().length > 0 || !!v.image_base64, {
    message: "text or image_base64 is required",
    path: ["text"],
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
