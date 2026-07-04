import { DEFAULT_MODEL, GENERATE_TIMEOUT_MS, OLLAMA_HOST } from "../config.js";
import * as modelConfig from "../model-config.js";
import * as ollamaManager from "../ollama-manager.js";
import { OllamaError } from "../ollama-manager.js";

export class OllamaProvider {
  name = "ollama";

  constructor({ requireGemma = false } = {}) {
    this.requireGemma = requireGemma;
  }

  async resolveModel() {
    const models = await ollamaManager.listModels(OLLAMA_HOST);
    if (models.length === 0) {
      throw new OllamaError(
        `No models found on the Ollama server. Pull one with: ollama pull ${DEFAULT_MODEL}`,
      );
    }
    const names = models.map((m) => m.name);
    const selected = modelConfig.getSelectedModel();
    if (selected && names.includes(selected) && (!this.requireGemma || isGemmaModel(selected))) {
      return selected;
    }
    for (const candidate of names) {
      const isDefaultModel = candidate === DEFAULT_MODEL || candidate.split(":")[0] === DEFAULT_MODEL;
      if (isDefaultModel && (!this.requireGemma || isGemmaModel(candidate))) {
        return candidate;
      }
    }
    for (const candidate of names) {
      if (isGemmaModel(candidate)) return candidate;
    }
    if (this.requireGemma) {
      throw new OllamaError(
        `No Gemma models found on the Ollama server. Pull one with: ollama pull ${DEFAULT_MODEL}`,
      );
    }
    return names[0];
  }

  async generateStructured({ systemPrompt, userText, jsonSchema, images }) {
    const model = await this.resolveModel();
    const options = { temperature: 0 };
    if (modelConfig.getComputeMode() === "cpu") options.num_gpu = 0;
    const userMessage = { role: "user", content: userText };
    if (images?.length) userMessage.images = images.map((i) => i.base64);
    const payload = {
      model,
      messages: [{ role: "system", content: systemPrompt }, userMessage],
      stream: false,
      format: jsonSchema,
      options,
      // Keep the model resident between reports — the default 4-minute idle
      // unload would make the first request after any lull pay a full reload.
      keep_alive: "60m",
    };
    let resp;
    try {
      resp = await fetch(`${OLLAMA_HOST}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
      });
    } catch (err) {
      if (err.name === "TimeoutError") {
        throw new OllamaError(
          `Ollama timed out after ${Math.round(GENERATE_TIMEOUT_MS / 1000)}s. ` +
            "First request loads the model into RAM; try again or use a smaller model.",
        );
      }
      throw new OllamaError(`Ollama request failed: ${err.message}`);
    }
    if (!resp.ok) {
      throw new OllamaError(`Ollama request failed: HTTP ${resp.status}`);
    }
    return (await resp.json()).message.content;
  }

  async health() {
    const reachable = await ollamaManager.isReachable(OLLAMA_HOST);
    if (!reachable) {
      return {
        reachable: false,
        model: null,
        detail: `Ollama not reachable at ${OLLAMA_HOST}`,
      };
    }
    try {
      const model = await this.resolveModel();
      return { reachable: true, model, detail: "ok" };
    } catch (err) {
      if (err instanceof OllamaError) {
        return { reachable: true, model: null, detail: err.message };
      }
      throw err;
    }
  }
}

function isGemmaModel(name) {
  return name.toLowerCase().startsWith("gemma");
}
