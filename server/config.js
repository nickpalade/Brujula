export const DEFAULT_MODEL = process.env.BRUJULA_MODEL || "gemma3n:e4b";

export const HOST = process.env.BRUJULA_HOST || "0.0.0.0";
export const PORT = Number.parseInt(process.env.BRUJULA_PORT || "8000", 10);

export const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";

export const CLOUD_API_KEY = process.env.CLOUD_API_KEY || "";
export const CLOUD_MODEL = process.env.CLOUD_MODEL || "claude-haiku-4-5-20251001";
export const CLOUD_API_URL =
  process.env.CLOUD_API_URL || "https://api.anthropic.com/v1/messages";

export const RECOMMENDED_MODELS = [
  { name: "gemma3n:e4b", size: "7.5 GB", note: "default — the demo model, text + vision" },
  { name: "gemma3:1b", size: "815 MB", note: "fastest, lowest RAM" },
  { name: "gemma3:4b", size: "3.3 GB", note: "small — text + vision" },
  { name: "gemma3:12b", size: "8.1 GB", note: "16 GB+ RAM" },
  { name: "llama3.2:3b", size: "2.0 GB", note: "non-Gemma alternative" },
];

export const SUPPORTED_LANGUAGES = [
  { code: "es", name: "Spanish" },
  { code: "en", name: "English" },
];

export const DEFAULT_SUMMARY_LANGUAGE = process.env.BRUJULA_LANG || "es";

export const TAGS_TIMEOUT_MS = 5_000;
export const GENERATE_TIMEOUT_MS = 180_000;
