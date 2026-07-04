import { CLOUD_API_KEY } from "../config.js";
import { CloudProvider } from "./cloud-provider.js";
import { MockProvider } from "./mock-provider.js";
import { OllamaProvider } from "./ollama-provider.js";

export function getProvider() {
  if (process.env.BRUJULA_PROVIDER === "mock") return new MockProvider();
  if (CLOUD_API_KEY) return new CloudProvider();
  return new OllamaProvider();
}

export function getChatProvider() {
  if (process.env.BRUJULA_CHAT_PROVIDER === "mock") return new MockProvider();
  return new OllamaProvider({ requireGemma: true });
}
