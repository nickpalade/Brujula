import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_SUMMARY_LANGUAGE, SUPPORTED_LANGUAGES } from "./config.js";
import { logger } from "./logger.js";

const CONFIG_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "brujula_config.json",
);

export const COMPUTE_MODES = ["gpu", "cpu"];

function read() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
  } catch (err) {
    if (err.code !== "ENOENT") {
      logger.warn(`Could not read ${CONFIG_FILE}: ${err.message}`);
    }
    return {};
  }
}

function write(updates) {
  const merged = { ...read(), ...updates };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), "utf-8");
}

export function getSelectedModel() {
  return read().model ?? null;
}

export function saveSelectedModel(name) {
  write({ model: name });
}

export function getComputeMode() {
  const mode = read().compute ?? "gpu";
  return COMPUTE_MODES.includes(mode) ? mode : "gpu";
}

export function saveComputeMode(mode) {
  if (!COMPUTE_MODES.includes(mode)) {
    throw new Error(`compute mode must be one of ${COMPUTE_MODES.join(", ")}`);
  }
  write({ compute: mode });
}

export function getSummaryLanguage() {
  const code = read().language ?? DEFAULT_SUMMARY_LANGUAGE;
  return SUPPORTED_LANGUAGES.some((l) => l.code === code) ? code : "en";
}

export function saveSummaryLanguage(code) {
  if (!SUPPORTED_LANGUAGES.some((l) => l.code === code)) {
    const codes = SUPPORTED_LANGUAGES.map((l) => l.code).join(", ");
    throw new Error(`language must be one of ${codes}`);
  }
  write({ language: code });
}
