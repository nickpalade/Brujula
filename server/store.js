import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { logger } from "./logger.js";

// Hub data layer — SQLite-backed (CONTRACTS §2), via Node's built-in
// node:sqlite. No native module to compile: npm install stays offline-safe
// (the same "no better-sqlite3" guarantee, without staying on a JSON file).
//
// Each record is stored as a JSON blob in its row (`data`), which is exactly
// what callers get back — addX/updateX accept arbitrary fields, so a fixed
// column-per-field schema would silently drop anything not anticipated here.
// `status` and `seq` are pulled out into real columns purely so SQL can
// filter/sort on them; row insertion order (rowid) gives list ordering,
// independent from `seq`, which bumps on every write including updates.
//
// A single monotonic `seq` counter is bumped on EVERY write. Each record
// carries an internal `_seq` = the seq at its last write, so
// GET /api/sync?since=<seq> can return only the records that changed.
// `_seq` (and any other `_`-prefixed field) is stripped from public output.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(HERE, "..", "data");
const DB_FILE = path.join(DATA_DIR, "hub.db");
const FIXTURES_DIR = path.join(HERE, "..", "fixtures");
const SEED_INCIDENTS = path.join(FIXTURES_DIR, "seed_incidents.json");
const SEED_RESOURCES = path.join(FIXTURES_DIR, "seed_resources.json");

fs.mkdirSync(DATA_DIR, { recursive: true });
// A file that doesn't exist yet means a true first boot — seed it below.
// (An existing-but-empty board, e.g. after manual cleanup, is left alone;
// only reset() re-seeds that case.)
const isFirstBoot = !fs.existsSync(DB_FILE);

const db = new DatabaseSync(DB_FILE);
db.exec("PRAGMA journal_mode = WAL;");
db.exec(`
  CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK (id = 1), seq INTEGER NOT NULL DEFAULT 0);
  INSERT OR IGNORE INTO meta (id, seq) VALUES (1, 0);

  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    seq INTEGER NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY,
    seq INTEGER NOT NULL,
    status TEXT NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS resources (
    id TEXT PRIMARY KEY,
    seq INTEGER NOT NULL,
    status TEXT NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS dispatches (
    id TEXT PRIMARY KEY,
    seq INTEGER NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS personnel (
    id TEXT PRIMARY KEY,
    seq INTEGER NOT NULL,
    data TEXT NOT NULL
  );
`);

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

function bump() {
  const seq = db.prepare("SELECT seq FROM meta WHERE id = 1").get().seq + 1;
  db.prepare("UPDATE meta SET seq = ? WHERE id = 1").run(seq);
  return seq;
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

function rowsEmpty() {
  const tables = ["reports", "incidents", "resources", "dispatches"];
  return tables.every((t) => db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c === 0);
}

function insertIncidentRow(incident) {
  db.prepare("INSERT INTO incidents (id, seq, status, data) VALUES (?, ?, ?, ?)").run(
    incident.id,
    incident._seq,
    incident.status,
    JSON.stringify(incident),
  );
}

function insertResourceRow(resource) {
  db.prepare("INSERT INTO resources (id, seq, status, data) VALUES (?, ?, ?, ?)").run(
    resource.id,
    resource._seq,
    resource.status,
    JSON.stringify(resource),
  );
}

// On first boot (store empty), load the fixtures so the board is never blank.
function seedIfEmpty() {
  if (!rowsEmpty()) return;

  const incidents = readJsonArray(SEED_INCIDENTS);
  const resources = readJsonArray(SEED_RESOURCES);
  if (incidents.length === 0 && resources.length === 0) return;

  for (const inc of incidents) {
    insertIncidentRow({
      merged_report_ids: [],
      proposed_dispatch_id: null,
      ...inc,
      _seq: bump(),
    });
  }
  for (const res of resources) {
    insertResourceRow({ ...res, _seq: bump() });
  }
  logger.info(
    `[store] seeded from fixtures: ${incidents.length} incidents, ${resources.length} resources`,
  );
}

if (isFirstBoot) seedIfEmpty();

// ---- reads -----------------------------------------------------------------

export function currentSeq() {
  return db.prepare("SELECT seq FROM meta WHERE id = 1").get().seq;
}

function listAll(table) {
  return db
    .prepare(`SELECT data FROM ${table} ORDER BY rowid ASC`)
    .all()
    .map((r) => publicView(JSON.parse(r.data)));
}

export function listReports() {
  return listAll("reports");
}

export function listIncidents() {
  return listAll("incidents");
}

export function listResources() {
  return listAll("resources");
}

export function listDispatches() {
  return listAll("dispatches");
}

function getOne(table, id) {
  const row = db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id);
  return row ? publicView(JSON.parse(row.data)) : null;
}

export function getIncident(id) {
  return getOne("incidents", id);
}

export function getResource(id) {
  return getOne("resources", id);
}

export function getDispatch(id) {
  return getOne("dispatches", id);
}

export function getReport(id) {
  return getOne("reports", id);
}

export function openIncidents() {
  return db
    .prepare("SELECT data FROM incidents WHERE status = 'open' ORDER BY rowid ASC")
    .all()
    .map((r) => publicView(JSON.parse(r.data)));
}

export function availableResources() {
  return db
    .prepare("SELECT data FROM resources WHERE status = 'available' ORDER BY rowid ASC")
    .all()
    .map((r) => publicView(JSON.parse(r.data)));
}

// Resources the match step may propose: anything available, plus committed
// crews whose field_status is 'returning' (heading back from a finished
// assignment — re-taskable). Crews traveling to or working a site are engaged
// and never reach the matcher.
export function matchableResources() {
  return listResources().filter((r) => {
    if (r.field_status === "traveling" || r.field_status === "on_site") return false;
    return r.status === "available" || r.field_status === "returning";
  });
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

export function addReport({ raw_text, source_device = null, lang = null, parsed_into = null, has_image = false, client_ref = null, reported_by = null, lat = null, lon = null, accuracy = null }) {
  const report = {
    id: newId("rep"),
    raw_text,
    source_device,
    lang,
    created_at: now(),
    parsed_into,
    has_image,
    client_ref,
    reported_by,
    lat,
    lon,
    accuracy,
    _seq: bump(),
  };
  db.prepare("INSERT INTO reports (id, seq, data) VALUES (?, ?, ?)").run(
    report.id,
    report._seq,
    JSON.stringify(report),
  );
  return publicView(report);
}

export function updateReport(id, patch) {
  const row = db.prepare("SELECT data FROM reports WHERE id = ?").get(id);
  if (!row) return null;
  const report = { ...JSON.parse(row.data), ...patch, _seq: bump() };
  db.prepare("UPDATE reports SET seq = ?, data = ? WHERE id = ?").run(
    report._seq,
    JSON.stringify(report),
    id,
  );
  return publicView(report);
}

export function addIncident(fields) {
  const ts = now();
  const incident = {
    id: newId("inc"),
    kind: "need",
    category: "status",
    location: null,
    lat: null,
    lon: null,
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
  insertIncidentRow(incident);
  return publicView(incident);
}

export function updateIncident(id, patch) {
  const row = db.prepare("SELECT data FROM incidents WHERE id = ?").get(id);
  if (!row) return null;
  const incident = { ...JSON.parse(row.data), ...patch, updated_at: now(), _seq: bump() };
  db.prepare("UPDATE incidents SET seq = ?, status = ?, data = ? WHERE id = ?").run(
    incident._seq,
    incident.status,
    JSON.stringify(incident),
    id,
  );
  return publicView(incident);
}

export function addResource(fields) {
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
  insertResourceRow(resource);
  return publicView(resource);
}

export function updateResource(id, patch) {
  const row = db.prepare("SELECT data FROM resources WHERE id = ?").get(id);
  if (!row) return null;
  const resource = { ...JSON.parse(row.data), ...patch, _seq: bump() };
  db.prepare("UPDATE resources SET seq = ?, status = ?, data = ? WHERE id = ?").run(
    resource._seq,
    resource.status,
    JSON.stringify(resource),
    id,
  );
  return publicView(resource);
}

export function addDispatch(fields) {
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
  db.prepare("INSERT INTO dispatches (id, seq, data) VALUES (?, ?, ?)").run(
    dispatch.id,
    dispatch._seq,
    JSON.stringify(dispatch),
  );
  return publicView(dispatch);
}

export function updateDispatch(id, patch) {
  const row = db.prepare("SELECT data FROM dispatches WHERE id = ?").get(id);
  if (!row) return null;
  const dispatch = { ...JSON.parse(row.data), ...patch, _seq: bump() };
  db.prepare("UPDATE dispatches SET seq = ?, data = ? WHERE id = ?").run(
    dispatch._seq,
    JSON.stringify(dispatch),
    id,
  );
  return publicView(dispatch);
}

// ---- personnel (field registrations: reporter / volunteer / crew) ----------

export function addPersonnel(fields) {
  const person = {
    id: newId("per"),
    role: "reporter",
    name: "",
    skill: null,
    location: null,
    team_size: null,
    device_id: null,
    resource_id: null,
    created_at: now(),
    ...fields,
    _seq: bump(),
  };
  db.prepare("INSERT INTO personnel (id, seq, data) VALUES (?, ?, ?)").run(
    person.id,
    person._seq,
    JSON.stringify(person),
  );
  return publicView(person);
}

export function updatePersonnel(id, patch) {
  const row = db.prepare("SELECT data FROM personnel WHERE id = ?").get(id);
  if (!row) return null;
  const person = { ...JSON.parse(row.data), ...patch, _seq: bump() };
  db.prepare("UPDATE personnel SET seq = ?, data = ? WHERE id = ?").run(
    person._seq,
    JSON.stringify(person),
    id,
  );
  return publicView(person);
}

export function listPersonnel() {
  return listAll("personnel");
}

export function getPersonnelByDevice(deviceId) {
  if (!deviceId) return null;
  return listAll("personnel").find((p) => p.device_id === deviceId) ?? null;
}

// ---- sync ------------------------------------------------------------------

// Records whose _seq > since. `since` omitted/invalid → 0 → full board.
export function syncSince(since) {
  const from = Number.isFinite(since) && since >= 0 ? since : 0;
  const changed = (table) =>
    db
      .prepare(`SELECT data FROM ${table} WHERE seq > ? ORDER BY seq ASC`)
      .all(from)
      .map((r) => publicView(JSON.parse(r.data)));
  return {
    seq: currentSeq(),
    incidents: changed("incidents"),
    dispatches: changed("dispatches"),
    resources: changed("resources"),
  };
}

// ---- lifecycle helpers (used by tests / reseed) ----------------------------

export function reset() {
  db.exec(`
    DELETE FROM dispatches;
    DELETE FROM incidents;
    DELETE FROM resources;
    DELETE FROM reports;
    DELETE FROM personnel;
    UPDATE meta SET seq = 0 WHERE id = 1;
  `);
  seedIfEmpty();
  return board();
}

// Test/diagnostic escape hatch: force a reload from disk (used to prove the
// store survives a process restart). Every read already goes straight to
// hub.db, so there is no in-memory cache to drop — this just proves the file
// handle itself still serves correct data.
export function _reloadFromDisk() {
  return board();
}
