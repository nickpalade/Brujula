import { z } from "zod";

// The v1 Incident vocabulary (CONTRACTS.md §2). Deliberately DIFFERENT from the
// legacy /parse-report schema (server/schemas.js), which uses
// type/people_estimate/severity — do not confuse the two.
export const KINDS = ["need", "resource", "status"];
export const CATEGORIES = [
  "rescue",
  "medical",
  "water",
  "shelter",
  "food",
  "machinery",
  "hazard",
  "status",
];
export const URGENCIES = ["critical", "high", "medium", "low"];

// -------------------------------------------------------------- 1. PARSE
// Emits the CONTRACTS.md parseReport shape: {kind, category, location,
// people_count, urgency, summary}. resource_label is a harmless superset field
// HUB may use to label a Resource — callers relying on the 6 contract fields
// are unaffected. persons is a superset field for missing-persons registry.
const PersonRecord = z.object({
  name: z.string().min(1).max(120),
  status: z.enum(["missing", "found", "safe"]),
  detail: z.string().nullable(),
});

export const ParsePipeline = z.object({
  kind: z
    .enum(KINDS)
    .describe("need = help required; resource = help/equipment available; status = info only."),
  category: z.enum(CATEGORIES),
  location: z
    .string()
    .nullable()
    .describe("Place named in the report, verbatim. null if none given."),
  people_count: z
    .number()
    .int()
    .nullable()
    .describe("People affected (needs) or capacity (resources). null if unstated."),
  urgency: z.enum(URGENCIES),
  resource_label: z
    .string()
    .nullable()
    .describe("Short label of what is offered, only when kind=resource. Otherwise null."),
  summary: z.string().describe("One short board line in the requested summary language."),
  persons: z
    .array(PersonRecord)
    .default([])
    .describe("Named individuals mentioned: missing/found/safe status."),
});

export function parsePipelineJsonSchema() {
  return z.toJSONSchema(ParsePipeline);
}

// -------------------------------------------------------------- 2. DEDUP
// The model returns matching_incident_id (constrained to real board ids) +
// a confidence + reason. is_duplicate is DERIVED server-side from those.
export const DedupModel = z.object({
  matching_incident_id: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

// Hand-built JSON schema so matching_incident_id can only be an id actually on
// the board (the model cannot hallucinate one). Mirrors the pattern in
// server/agent/schemas.js dedupJsonSchema.
export function dedupJsonSchema(openIncidentIds) {
  return {
    type: "object",
    properties: {
      matching_incident_id:
        openIncidentIds.length > 0
          ? { anyOf: [{ type: "string", enum: openIncidentIds }, { type: "null" }] }
          : { type: "null" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      reason: { type: "string" },
    },
    required: ["matching_incident_id", "confidence", "reason"],
    additionalProperties: false,
  };
}

// -------------------------------------------------------------- 4. MATCH
export const MatchModel = z.object({
  resource_id: z.string().nullable(),
  rationale: z.string(),
  distance_note: z.string(),
});

export function matchJsonSchema(candidateIds) {
  return {
    type: "object",
    properties: {
      resource_id:
        candidateIds.length > 0
          ? { anyOf: [{ type: "string", enum: candidateIds }, { type: "null" }] }
          : { type: "null" },
      rationale: { type: "string" },
      distance_note: { type: "string" },
    },
    required: ["resource_id", "rationale", "distance_note"],
    additionalProperties: false,
  };
}

// -------------------------------------------------------------- 6. SITREP
export const SitrepModel = z.object({
  sitrep: z.string().describe("Plain-language situation report, a few short lines."),
});

export function sitrepJsonSchema() {
  return z.toJSONSchema(SitrepModel);
}
