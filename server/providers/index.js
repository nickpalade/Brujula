import { CLOUD_API_KEY } from "../config.js";
import { CloudProvider } from "./cloud-provider.js";
import { OllamaProvider } from "./ollama-provider.js";

export function getProvider() {
  if (CLOUD_API_KEY) return new CloudProvider();
  return new OllamaProvider();
}
