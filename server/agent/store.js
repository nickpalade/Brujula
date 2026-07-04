import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

// Incident board persisted in SQLite (hub.db, repo root) via Node's built-in
// node:sqlite — no native module to compile, nothing extra to install. Same
// exported functions/shapes as the old JSON-file store — routes.js and
// pipeline.js are unaffected by this swap.
const DB_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "hub.db",
);

const db = new DatabaseSync(DB_FILE);
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
  CREATE TABLE IF NOT EXISTS counters (
    kind TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    raw_text TEXT NOT NULL,
    source_device TEXT,
    parsed TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    location TEXT,
    people_estimate INTEGER,
    urgency TEXT NOT NULL,
    summary TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS incident_reports (
    incident_id TEXT NOT NULL REFERENCES incidents(id),
    report_id TEXT NOT NULL REFERENCES reports(id),
    PRIMARY KEY (incident_id, report_id)
  );

  CREATE TABLE IF NOT EXISTS resources (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    label TEXT,
    location TEXT,
    capacity INTEGER,
    status TEXT NOT NULL DEFAULT 'available',
    source_report_id TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS dispatches (
    id TEXT PRIMARY KEY,
    incident_id TEXT NOT NULL REFERENCES incidents(id),
    resource_id TEXT NOT NULL REFERENCES resources(id),
    reason TEXT,
    state TEXT NOT NULL DEFAULT 'proposed',
    proposed_by_ai INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    confirmed_by_human_at TEXT
  );
`);

const PREFIX = { report: "RPT", incident: "INC", resource: "RES", dispatch: "DSP" };

function nextId(kind) {
  const row = db.prepare("SELECT value FROM counters WHERE kind = ?").get(kind);
  const value = (row?.value ?? 0) + 1;
  if (row) {
    db.prepare("UPDATE counters SET value = ? WHERE kind = ?").run(value, kind);
  } else {
    db.prepare("INSERT INTO counters (kind, value) VALUES (?, ?)").run(kind, value);
  }
  return `${PREFIX[kind]}-${String(value).padStart(3, "0")}`;
}

function now() {
  return new Date().toISOString();
}

const URGENCY_RANK = { critical: 3, high: 2, medium: 1, low: 0 };

function toIncident(row) {
  if (!row) return null;
  const reportIds = db
    .prepare("SELECT report_id FROM incident_reports WHERE incident_id = ?")
    .all(row.id)
    .map((r) => r.report_id);
  return { ...row, merged_report_ids: reportIds };
}

function toReport(row) {
  if (!row) return null;
  return { ...row, parsed: row.parsed ? JSON.parse(row.parsed) : null };
}

function toDispatch(row) {
  if (!row) return null;
  return { ...row, proposed_by_ai: Boolean(row.proposed_by_ai) };
}

export function getBoard() {
  return {
    reports: db.prepare("SELECT * FROM reports").all().map(toReport),
    incidents: db.prepare("SELECT * FROM incidents").all().map(toIncident),
    resources: db.prepare("SELECT * FROM resources").all(),
    dispatches: db.prepare("SELECT * FROM dispatches").all().map(toDispatch),
  };
}

export function reset() {
  db.exec(`
    DELETE FROM dispatches;
    DELETE FROM incident_reports;
    DELETE FROM resources;
    DELETE FROM incidents;
    DELETE FROM reports;
    DELETE FROM counters;
  `);
}

export function addReport({ rawText, sourceDevice, parsed }) {
  const id = nextId("report");
  const created_at = now();
  const source_device = sourceDevice ?? "unknown";
  db.prepare(
    "INSERT INTO reports (id, raw_text, source_device, parsed, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, rawText, source_device, parsed ? JSON.stringify(parsed) : null, created_at);
  return { id, raw_text: rawText, source_device, parsed: parsed ?? null, created_at };
}

export function addIncident({ category, location, peopleEstimate, urgency, summary, reportId }) {
  const id = nextId("incident");
  const ts = now();
  db.prepare(
    `INSERT INTO incidents (id, category, location, people_estimate, urgency, summary, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
  ).run(id, category, location ?? null, peopleEstimate ?? null, urgency, summary ?? null, ts, ts);
  if (reportId) {
    db.prepare("INSERT INTO incident_reports (incident_id, report_id) VALUES (?, ?)").run(id, reportId);
  }
  return toIncident(db.prepare("SELECT * FROM incidents WHERE id = ?").get(id));
}

export function mergeIntoIncident(incidentId, { reportId, parsed }) {
  const incident = db.prepare("SELECT * FROM incidents WHERE id = ?").get(incidentId);
  if (!incident) return null;
  if (reportId) {
    db.prepare(
      "INSERT OR IGNORE INTO incident_reports (incident_id, report_id) VALUES (?, ?)",
    ).run(incidentId, reportId);
  }
  // A merged report can only raise what we know: take the max urgency and
  // the max people estimate across reports of the same incident.
  let urgency = incident.urgency;
  if (URGENCY_RANK[parsed.urgency] > URGENCY_RANK[urgency]) urgency = parsed.urgency;
  let peopleEstimate = incident.people_estimate;
  if (
    parsed.people_estimate !== null &&
    (peopleEstimate === null || parsed.people_estimate > peopleEstimate)
  ) {
    peopleEstimate = parsed.people_estimate;
  }
  let location = incident.location;
  if (location === null && parsed.location !== null) location = parsed.location;
  const updated_at = now();
  db.prepare(
    "UPDATE incidents SET urgency = ?, people_estimate = ?, location = ?, updated_at = ? WHERE id = ?",
  ).run(urgency, peopleEstimate, location, updated_at, incidentId);
  return toIncident(db.prepare("SELECT * FROM incidents WHERE id = ?").get(incidentId));
}

export function setIncidentStatus(incidentId, status) {
  const exists = db.prepare("SELECT id FROM incidents WHERE id = ?").get(incidentId);
  if (!exists) return null;
  db.prepare("UPDATE incidents SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), incidentId);
  return toIncident(db.prepare("SELECT * FROM incidents WHERE id = ?").get(incidentId));
}

export function getIncident(incidentId) {
  const incident = toIncident(db.prepare("SELECT * FROM incidents WHERE id = ?").get(incidentId));
  if (!incident) return null;
  const reports = incident.merged_report_ids.length
    ? db
        .prepare(
          `SELECT * FROM reports WHERE id IN (${incident.merged_report_ids.map(() => "?").join(",")})`,
        )
        .all(...incident.merged_report_ids)
        .map(toReport)
    : [];
  const dispatches = db
    .prepare("SELECT * FROM dispatches WHERE incident_id = ?")
    .all(incidentId)
    .map(toDispatch);
  return { incident, reports, dispatches };
}

export function openIncidents() {
  return db.prepare("SELECT * FROM incidents WHERE status = 'open'").all().map(toIncident);
}

export function addResource({ category, label, location, capacity, reportId }) {
  const id = nextId("resource");
  const created_at = now();
  db.prepare(
    `INSERT INTO resources (id, category, label, location, capacity, status, source_report_id, created_at)
     VALUES (?, ?, ?, ?, ?, 'available', ?, ?)`,
  ).run(id, category, label ?? null, location ?? null, capacity ?? null, reportId ?? null, created_at);
  return db.prepare("SELECT * FROM resources WHERE id = ?").get(id);
}

export function setResourceStatus(resourceId, status) {
  const exists = db.prepare("SELECT id FROM resources WHERE id = ?").get(resourceId);
  if (!exists) return null;
  db.prepare("UPDATE resources SET status = ? WHERE id = ?").run(status, resourceId);
  return db.prepare("SELECT * FROM resources WHERE id = ?").get(resourceId);
}

export function availableResources() {
  return db.prepare("SELECT * FROM resources WHERE status = 'available'").all();
}

export function addDispatch({ incidentId, resourceId, reason }) {
  const id = nextId("dispatch");
  const created_at = now();
  db.prepare(
    `INSERT INTO dispatches (id, incident_id, resource_id, reason, state, proposed_by_ai, created_at, confirmed_by_human_at)
     VALUES (?, ?, ?, ?, 'proposed', 1, ?, NULL)`,
  ).run(id, incidentId, resourceId, reason ?? null, created_at);
  return toDispatch(db.prepare("SELECT * FROM dispatches WHERE id = ?").get(id));
}

export function getDispatch(dispatchId) {
  return toDispatch(db.prepare("SELECT * FROM dispatches WHERE id = ?").get(dispatchId));
}

export function setDispatchState(dispatchId, state) {
  const exists = db.prepare("SELECT id FROM dispatches WHERE id = ?").get(dispatchId);
  if (!exists) return null;
  if (state === "confirmed") {
    db.prepare("UPDATE dispatches SET state = ?, confirmed_by_human_at = ? WHERE id = ?").run(
      state,
      now(),
      dispatchId,
    );
  } else {
    db.prepare("UPDATE dispatches SET state = ? WHERE id = ?").run(state, dispatchId);
  }
  return getDispatch(dispatchId);
}

// Incidents ranked for the action feed: urgency first, then people affected,
// then longest-waiting. Deterministic and explainable on purpose — the model
// assigns urgency, code does the arithmetic.
export function prioritizedIncidents() {
  const incidents = db.prepare("SELECT * FROM incidents").all().map(toIncident);
  incidents.sort((a, b) => {
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    const urgency = URGENCY_RANK[b.urgency] - URGENCY_RANK[a.urgency];
    if (urgency !== 0) return urgency;
    const people = (b.people_estimate ?? 0) - (a.people_estimate ?? 0);
    if (people !== 0) return people;
    return a.created_at < b.created_at ? -1 : 1;
  });
  return incidents.map((incident, index) => ({ ...incident, priority: index + 1 }));
}

export function seed({ incidents = [], resources = [] }) {
  const created = { incidents: [], resources: [] };
  for (const i of incidents) {
    created.incidents.push(
      addIncident({
        category: i.category,
        location: i.location ?? null,
        peopleEstimate: i.people_estimate ?? null,
        urgency: i.urgency,
        summary: i.summary,
      }),
    );
  }
  for (const r of resources) {
    created.resources.push(
      addResource({
        category: r.category,
        label: r.label,
        location: r.location ?? null,
        capacity: r.capacity ?? null,
      }),
    );
  }
  return created;
}
