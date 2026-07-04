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
