import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { logger } from "./logger.js";

// Hub data layer — a JSON-file-backed store (CONTRACTS §2).
// No native deps (no better-sqlite3): npm install stays offline-safe.
// The whole store is one JSON file under data/ (gitignored). Reads/writes are
// synchronous and load-modify-write the whole file — fine at hackathon scale
// (a command post, a handful of phones), and it survives a server restart.
//
// A single monotonic `seq` counter is bumped on EVERY write. Each incident /
// resource / dispatch carries an internal `_seq` = the seq at its last write,
// so GET /api/sync?since=<seq> can return only the records that changed.
// `_seq` (and any other `_`-prefixed field) is stripped from public output.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(HERE, "..", "data");
const STORE_FILE = path.join(DATA_DIR, "hub.json");
const FIXTURES_DIR = path.join(HERE, "..", "fixtures");
const SEED_INCIDENTS = path.join(FIXTURES_DIR, "seed_incidents.json");
const SEED_RESOURCES = path.join(FIXTURES_DIR, "seed_resources.json");

function emptyStore() {
  return { seq: 0, reports: [], incidents: [], resources: [], dispatches: [] };
}

function now() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString("hex")}`;
}

// Deep-ish clone that drops internal `_`-prefixed fields, so the API never
// leaks `_seq` (which is not part of the CONTRACTS data model).
function publicView(record) {
  if (record === null || record === undefined) return record;
  const out = {};
  for (const [k, v] of Object.entries(record)) {
    if (k.startsWith("_")) continue;
    out[k] = v;
  }
  return out;
}

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(STORE_FILE, "utf-8"));
    // Backfill shape in case an older/partial file is on disk.
    cache = { ...emptyStore(), ...cache };
  } catch (err) {
    if (err.code !== "ENOENT") {
      logger.warn(`[store] could not read ${STORE_FILE}: ${err.message}`);
    }
    cache = emptyStore();
    seedIfEmpty();
  }
  return cache;
}

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(cache, null, 2), "utf-8");
}

// Bump the global seq and return it — call once per mutation, stamp the
// touched record's `_seq` with the result.
function bump() {
  cache.seq += 1;
  return cache.seq;
}

function readJsonArray(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if (err.code !== "ENOENT") {
      logger.warn(`[store] could not read seed ${file}: ${err.message}`);
    }
    return [];
  }
}

// On first boot (store empty), load the fixtures so the board is never blank.
function seedIfEmpty() {
  const store = cache;
  const isEmpty =
    store.reports.length === 0 &&
    store.incidents.length === 0 &&
    store.resources.length === 0 &&
    store.dispatches.length === 0;
  if (!isEmpty) return;

  const incidents = readJsonArray(SEED_INCIDENTS);
  const resources = readJsonArray(SEED_RESOURCES);
  if (incidents.length === 0 && resources.length === 0) return;

  for (const inc of incidents) {
    store.incidents.push({
      merged_report_ids: [],
      proposed_dispatch_id: null,
      ...inc,
      _seq: bump(),
    });
  }
  for (const res of resources) {
    store.resources.push({ ...res, _seq: bump() });
  }
  persist();
  logger.info(
    `[store] seeded from fixtures: ${incidents.length} incidents, ${resources.length} resources`,
  );
}

// ---- reads -----------------------------------------------------------------

export function currentSeq() {
  return load().seq;
}

export function listReports() {
  return load().reports.map(publicView);
}

export function listIncidents() {
  return load().incidents.map(publicView);
}

export function listResources() {
  return load().resources.map(publicView);
}

export function listDispatches() {
  return load().dispatches.map(publicView);
}

export function getIncident(id) {
  return publicView(load().incidents.find((i) => i.id === id) ?? null);
}

export function getResource(id) {
  return publicView(load().resources.find((r) => r.id === id) ?? null);
}

export function getDispatch(id) {
  return publicView(load().dispatches.find((d) => d.id === id) ?? null);
}

export function getReport(id) {
  return publicView(load().reports.find((r) => r.id === id) ?? null);
}

export function openIncidents() {
  return load()
    .incidents.filter((i) => i.status === "open")
    .map(publicView);
}

export function availableResources() {
  return load()
    .resources.filter((r) => r.status === "available")
    .map(publicView);
}

// Full board snapshot for pipeline sitrep / fallbacks.
export function board() {
  return {
    incidents: listIncidents(),
    resources: listResources(),
    dispatches: listDispatches(),
  };
}

// ---- writes ----------------------------------------------------------------

export function addReport({ raw_text, source_device = null, lang = null, parsed_into = null }) {
  const store = load();
  const report = {
    id: newId("rep"),
    raw_text,
    source_device,
    lang,
    created_at: now(),
    parsed_into,
    _seq: bump(),
  };
  store.reports.push(report);
  persist();
  return publicView(report);
}

export function updateReport(id, patch) {
  const store = load();
  const report = store.reports.find((r) => r.id === id);
  if (!report) return null;
  Object.assign(report, patch, { _seq: bump() });
  persist();
  return publicView(report);
}

export function addIncident(fields) {
  const store = load();
  const ts = now();
  const incident = {
    id: newId("inc"),
    kind: "need",
    category: "status",
    location: null,
    people_count: null,
    urgency: "medium",
    status: "open",
    summary: "",
    merged_report_ids: [],
    proposed_dispatch_id: null,
    created_at: ts,
    updated_at: ts,
    ...fields,
    _seq: bump(),
  };
  store.incidents.push(incident);
  persist();
  return publicView(incident);
}

export function updateIncident(id, patch) {
  const store = load();
  const incident = store.incidents.find((i) => i.id === id);
  if (!incident) return null;
  Object.assign(incident, patch, { updated_at: now(), _seq: bump() });
  persist();
  return publicView(incident);
}

export function addResource(fields) {
  const store = load();
  const resource = {
    id: newId("res"),
    type: "status",
    label: "",
    location: null,
    capacity: null,
    status: "available",
    ...fields,
    _seq: bump(),
  };
  store.resources.push(resource);
  persist();
  return publicView(resource);
}

export function updateResource(id, patch) {
  const store = load();
  const resource = store.resources.find((r) => r.id === id);
  if (!resource) return null;
  Object.assign(resource, patch, { _seq: bump() });
  persist();
  return publicView(resource);
}

export function addDispatch(fields) {
  const store = load();
  const dispatch = {
    id: newId("dsp"),
    incident_id: null,
    resource_id: null,
    state: "proposed",
    rationale: "",
    proposed_by_ai: true,
    confirmed_by_human_at: null,
    ...fields,
    _seq: bump(),
  };
  store.dispatches.push(dispatch);
  persist();
  return publicView(dispatch);
}

export function updateDispatch(id, patch) {
  const store = load();
  const dispatch = store.dispatches.find((d) => d.id === id);
  if (!dispatch) return null;
  Object.assign(dispatch, patch, { _seq: bump() });
  persist();
  return publicView(dispatch);
}

// ---- sync ------------------------------------------------------------------

// Records whose _seq > since. `since` omitted/invalid → 0 → full board.
export function syncSince(since) {
  const store = load();
  const from = Number.isFinite(since) && since >= 0 ? since : 0;
  const changed = (arr) => arr.filter((r) => (r._seq ?? 0) > from).map(publicView);
  return {
    seq: store.seq,
    incidents: changed(store.incidents),
    dispatches: changed(store.dispatches),
    resources: changed(store.resources),
  };
}

// ---- lifecycle helpers (used by tests / reseed) ----------------------------

export function reset() {
  cache = emptyStore();
  persist();
  seedIfEmpty();
  return cache;
}

// Test/diagnostic escape hatch: force a reload from disk (used to prove the
// store survives a process restart).
export function _reloadFromDisk() {
  cache = null;
  return load();
}
