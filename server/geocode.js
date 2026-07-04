import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

import { logger } from "./logger.js";

// Offline gazetteer geocoding — the fallback that puts incidents on the map
// when a report arrives without phone GPS (the common case: browsers deny
// geolocation on the hub's plain-HTTP origin).
//
// fixtures/gazetteer.json maps known demo-region place names to coordinates.
// Matching is deterministic and forgiving (accent-stripped, case-insensitive
// substring), in the same spirit as the knowledge-service matcher: Gemma's
// parsed `location` label is free text like "Refugio San José, La Guaira",
// so we look for any gazetteer name inside it and prefer the LONGEST match
// ("Playa Grande, Catia La Mar" should pin to Playa Grande, not Catia La Mar).
// No model calls, no network — a plain lookup loaded once at startup.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAZETTEER_FILE = path.join(HERE, "..", "fixtures", "gazetteer.json");

function normalize(text) {
  return String(text)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[-_]/g, " ");
}

let GAZETTEER = [];
try {
  const entries = JSON.parse(fs.readFileSync(GAZETTEER_FILE, "utf-8"));
  GAZETTEER = entries
    .filter((e) => e && typeof e.name === "string" && Number.isFinite(e.lat) && Number.isFinite(e.lon))
    .map((e) => {
      const normalized = normalize(e.name);
      return {
        ...e,
        _normalized: normalized,
        // Whole-word match ("macutos" must not pin to Macuto): the entry may
        // not be flanked by letters/digits. \b alone misfires next to
        // accents-stripped text, so use explicit lookarounds.
        _pattern: new RegExp(`(?<![\\p{L}\\d])${escapeRegExp(normalized)}(?![\\p{L}\\d])`, "u"),
      };
    })
    // Longest names first so the most specific place wins ties by order.
    .sort((a, b) => b._normalized.length - a._normalized.length);
} catch (err) {
  logger.warn(`[geocode] could not load ${GAZETTEER_FILE} (${err.message}); location labels won't map to coordinates.`);
}

// Free-text location label → {lat, lon, place} | null. Never throws.
// Longest matching name wins; equal lengths break by position in the label
// ("Playa Grande, Catia La Mar" pins to Playa Grande — the place named first).
export function geocodeLabel(label) {
  if (typeof label !== "string" || label.trim() === "") return null;
  const haystack = normalize(label);
  let best = null;
  let bestAt = Infinity;
  for (const entry of GAZETTEER) {
    const at = haystack.search(entry._pattern);
    if (at === -1) continue;
    // GAZETTEER is sorted longest-first, so the first length tier that
    // matches is final — within it, the earliest occurrence wins.
    if (best && entry._normalized.length < best._normalized.length) break;
    if (at < bestAt) {
      best = entry;
      bestAt = at;
    }
  }
  return best ? { lat: best.lat, lon: best.lon, place: best.name } : null;
}
