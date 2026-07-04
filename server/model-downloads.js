import { logger } from "./logger.js";
import { OllamaError, pullModel } from "./ollama-manager.js";

const downloads = new Map();

export function getStatus() {
  return Object.fromEntries(
    [...downloads.entries()].map(([name, state]) => [name, { ...state }]),
  );
}

export function clearFinished(name) {
  const state = downloads.get(name);
  if (state && state.status !== "downloading") downloads.delete(name);
}

async function run(name) {
  try {
    await pullModel(name, {
      onProgress: (pct) =>
        downloads.set(name, { status: "downloading", progress: pct, error: null }),
    });
    downloads.set(name, { status: "complete", progress: 100, error: null });
    logger.info(`Model ${name} downloaded`);
  } catch (err) {
    if (err instanceof OllamaError) {
      downloads.set(name, { status: "error", progress: 0, error: err.message });
      logger.error(`Download failed for ${name}: ${err.message}`);
    } else {
      downloads.set(name, {
        status: "error",
        progress: 0,
        error: `unexpected: ${err.message}`,
      });
      logger.error(`Unexpected download failure for ${name}:`, err);
    }
  }
}

export function start(name) {
  if (downloads.get(name)?.status === "downloading") return false;
  downloads.set(name, { status: "downloading", progress: 0, error: null });
  void run(name);
  return true;
}
