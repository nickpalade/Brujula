import {
  CLOUD_API_KEY,
  CLOUD_API_URL,
  CLOUD_MODEL,
  GENERATE_TIMEOUT_MS,
} from "../config.js";

export class CloudError extends Error {}

export class CloudProvider {
  name = "cloud";

  async resolveModel() {
    return CLOUD_MODEL;
  }

  async generateStructured({ systemPrompt, userText, jsonSchema, images }) {
    const system =
      `${systemPrompt}\n\n` +
      "Respond with a single JSON object matching this JSON schema, " +
      `and nothing else:\n${JSON.stringify(jsonSchema)}`;
    const content = [
      ...(images ?? []).map((i) => ({
        type: "image",
        source: {
          type: "base64",
          media_type: i.mime ?? "image/jpeg",
          data: i.base64,
        },
      })),
      { type: "text", text: userText },
    ];
    const payload = {
      model: CLOUD_MODEL,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content }],
    };
    let resp;
    try {
      resp = await fetch(CLOUD_API_URL, {
        method: "POST",
        headers: {
          "x-api-key": CLOUD_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
      });
    } catch (err) {
      throw new CloudError(`Cloud API unreachable: ${err.message}`);
    }
    if (!resp.ok) {
      const body = (await resp.text()).slice(0, 300);
      throw new CloudError(`Cloud API error (HTTP ${resp.status}): ${body}`);
    }
    return (await resp.json()).content[0].text;
  }

  async health() {
    return {
      reachable: Boolean(CLOUD_API_KEY),
      model: CLOUD_MODEL,
      detail: "cloud provider configured (liveness not probed)",
    };
  }
}
