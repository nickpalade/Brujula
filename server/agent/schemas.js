import { z } from "zod";

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

export const AgentParse = z.object({
  kind: z
    .enum(KINDS)
    .describe("need = help required; resource = help available; status = info only."),
  category: z.enum(CATEGORIES),
  location: z
    .string()
    .nullable()
    .describe("Place mentioned in the report, as written. null if none."),
  people_estimate: z
    .number()
    .int()
    .nullable()
    .describe("People affected (needs) or capacity (resources). null if not stated."),
  urgency: z.enum(URGENCIES),
  resource_label: z
    .string()
    .nullable()
    .describe("Short label for what is offered (e.g. 'excavadora + equipo'). null unless kind=resource."),
  summary: z.string().describe("One short sentence in the requested summary language."),
});

export function agentParseJsonSchema() {
  return z.toJSONSchema(AgentParse);
}

export const IngestRequest = z
  .object({
    text: z.string().max(8000).optional(),
    image_base64: z
      .string()
      .max(15_000_000)
      .optional()
      .describe("Optional photo (damage, rubble, site) as raw base64, no data: prefix."),
    image_mime: z.string().optional(),
    source_device: z.string().max(200).optional(),
  })
  .refine((r) => (r.text && r.text.trim().length > 0) || r.image_base64, {
    message: "text or image_base64 required",
  });

export const DedupDecision = z.object({
  duplicate_of: z.string().nullable(),
  reason: z.string(),
});

// Hand-built so duplicate_of is constrained to the ids actually on the board.
export function dedupJsonSchema(openIncidentIds) {
  return {
    type: "object",
    properties: {
      duplicate_of:
        openIncidentIds.length > 0
          ? { anyOf: [{ type: "string", enum: openIncidentIds }, { type: "null" }] }
          : { type: "null" },
      reason: { type: "string" },
    },
    required: ["duplicate_of", "reason"],
    additionalProperties: false,
  };
}

export const MatchDecision = z.object({
  chosen_id: z.string().nullable(),
  reason: z.string(),
});

export function matchJsonSchema(candidateIds) {
  return {
    type: "object",
    properties: {
      chosen_id:
        candidateIds.length > 0
          ? { anyOf: [{ type: "string", enum: candidateIds }, { type: "null" }] }
          : { type: "null" },
      reason: { type: "string" },
    },
    required: ["chosen_id", "reason"],
    additionalProperties: false,
  };
}

export const SitrepOutput = z.object({
  sitrep: z.string().describe("Plain-language situation report, a few short paragraphs."),
});

export function sitrepJsonSchema() {
  return z.toJSONSchema(SitrepOutput);
}
