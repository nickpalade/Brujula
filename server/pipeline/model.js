import { SUPPORTED_LANGUAGES } from "../config.js";
import { logger } from "../logger.js";
import * as modelConfig from "../model-config.js";
import { getProvider } from "../providers/index.js";

// retry ONCE on invalid JSON (2 attempts total) — kept tight for latency
// (CONTRACTS §4 + task item 2/4). The legacy /parse-report uses 3; the pipeline
// runs several steps per report, so we trade one retry for speed.
const MAX_ATTEMPTS = 2;

export class PipelineModelError extends Error {}

export function summaryLanguageName() {
  const code = modelConfig.getSummaryLanguage();
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)?.name ?? "English";
}

/**
 * One structured Gemma call, validated + retried once, fully logged.
 * Reuses the exact Ollama structured-output pattern from server/main.js
 * /parse-report and server/providers/ollama-provider.js (zod JSON schema passed
 * as `format`, re-validated server-side).
 *
 * Throws PipelineModelError only after all attempts fail — callers wrap this in
 * a deterministic fallback so the hub NEVER sees a throw (except parseReport,
 * which is allowed to bubble up per CONTRACTS §4).
 */
export async function generateValidated({ step, systemPrompt, userText, jsonSchema, validator, images }) {
  const provider = getProvider();
  const started = Date.now();
  let lastError = "unknown";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let raw;
    try {
      raw = await provider.generateStructured({ systemPrompt, userText, jsonSchema, images });
    } catch (err) {
      // Provider/transport failure (Ollama down, timeout). Not retryable here —
      // surface immediately so the caller's fallback kicks in.
      const ms = Date.now() - started;
      logger.error(`[pipeline:${step}] provider failure after ${ms}ms: ${err.message}`);
      throw new PipelineModelError(`${step}: provider failure: ${err.message}`);
    }

    try {
      const value = validator.parse(JSON.parse(raw));
      const ms = Date.now() - started;
      logger.info(`[pipeline:${step}] ok in ${ms}ms (attempt ${attempt}/${MAX_ATTEMPTS})`);
      return value;
    } catch (err) {
      lastError = err.message;
      logger.warn(
        `[pipeline:${step}] malformed output (attempt ${attempt}/${MAX_ATTEMPTS}): ` +
          `${err.message} | raw=${JSON.stringify(String(raw).slice(0, 300))}`,
      );
    }
  }

  const ms = Date.now() - started;
  logger.error(`[pipeline:${step}] all ${MAX_ATTEMPTS} attempts malformed in ${ms}ms: ${lastError}`);
  throw new PipelineModelError(`${step}: model returned malformed output: ${lastError}`);
}
