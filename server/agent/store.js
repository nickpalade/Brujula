import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { logger } from "../logger.js";

// Incident board persisted as one JSON file, same pattern as model-config.
// Ceco's SQLite hub can replace this module behind the same functions.
const BOARD_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "brujula_board.json",
);

function emptyBoard() {
  return {
    counters: { report: 0, incident: 0, resource: 0, dispatch: 0 },
    reports: [],
    incidents: [],
    resources: [],
    dispatches: [],
  };
}

function read() {
  try {
    return JSON.parse(fs.readFileSync(BOARD_FILE, "utf-8"));
  } catch (err) {
    if (err.code !== "ENOENT") {
      logger.warn(`Could not read ${BOARD_FILE}: ${err.message}`);
    }
    return emptyBoard();
  }
}

function write(board) {
  fs.writeFileSync(BOARD_FILE, JSON.stringify(board, null, 2), "utf-8");
}

function nextId(board, kind) {
  board.counters[kind] += 1;
  const prefix = { report: "RPT", incident: "INC", resource: "RES", dispatch: "DSP" }[kind];
  return `${prefix}-${String(board.counters[kind]).padStart(3, "0")}`;
}

function now() {
  return new Date().toISOString();
}

export function getBoard() {
  return read();
}

export function reset() {
  write(emptyBoard());
}

export function addReport({ rawText, sourceDevice, parsed }) {
  const board = read();
  const report = {
    id: nextId(board, "report"),
    raw_text: rawText,
    source_device: sourceDevice ?? "unknown",
    parsed,
    created_at: now(),
  };
  board.reports.push(report);
  write(board);
  return report;
}

export function addIncident({ category, location, peopleEstimate, urgency, summary, reportId }) {
  const board = read();
  const incident = {
    id: nextId(board, "incident"),
    category,
    location,
    people_estimate: peopleEstimate,
    urgency,
    summary,
    status: "open",
    merged_report_ids: reportId ? [reportId] : [],
    created_at: now(),
    updated_at: now(),
  };
  board.incidents.push(incident);
  write(board);
  return incident;
}

const URGENCY_RANK = { critical: 3, high: 2, medium: 1, low: 0 };

export function mergeIntoIncident(incidentId, { reportId, parsed }) {
  const board = read();
  const incident = board.incidents.find((i) => i.id === incidentId);
  if (!incident) return null;
  if (reportId) incident.merged_report_ids.push(reportId);
  // A merged report can only raise what we know: take the max urgency and
  // the max people estimate across reports of the same incident.
  if (URGENCY_RANK[parsed.urgency] > URGENCY_RANK[incident.urgency]) {
    incident.urgency = parsed.urgency;
  }
  if (
    parsed.people_estimate !== null &&
    (incident.people_estimate === null || parsed.people_estimate > incident.people_estimate)
  ) {
    incident.people_estimate = parsed.people_estimate;
  }
  if (incident.location === null && parsed.location !== null) {
    incident.location = parsed.location;
  }
  incident.updated_at = now();
  write(board);
  return incident;
}

export function setIncidentStatus(incidentId, status) {
  const board = read();
  const incident = board.incidents.find((i) => i.id === incidentId);
  if (!incident) return null;
  incident.status = status;
  incident.updated_at = now();
  write(board);
  return incident;
}

export function getIncident(incidentId) {
  const board = read();
  const incident = board.incidents.find((i) => i.id === incidentId) ?? null;
  if (!incident) return null;
  const reports = board.reports.filter((r) => incident.merged_report_ids.includes(r.id));
  const dispatches = board.dispatches.filter((d) => d.incident_id === incidentId);
  return { incident, reports, dispatches };
}

export function openIncidents() {
  return read().incidents.filter((i) => i.status === "open");
}

export function addResource({ category, label, location, capacity, reportId }) {
  const board = read();
  const resource = {
    id: nextId(board, "resource"),
    category,
    label,
    location,
    capacity,
    status: "available",
    source_report_id: reportId ?? null,
    created_at: now(),
  };
  board.resources.push(resource);
  write(board);
  return resource;
}

export function setResourceStatus(resourceId, status) {
  const board = read();
  const resource = board.resources.find((r) => r.id === resourceId);
  if (!resource) return null;
  resource.status = status;
  write(board);
  return resource;
}

export function availableResources() {
  return read().resources.filter((r) => r.status === "available");
}

export function addDispatch({ incidentId, resourceId, reason }) {
  const board = read();
  const dispatch = {
    id: nextId(board, "dispatch"),
    incident_id: incidentId,
    resource_id: resourceId,
    reason,
    state: "proposed",
    proposed_by_ai: true,
    created_at: now(),
    confirmed_by_human_at: null,
  };
  board.dispatches.push(dispatch);
  write(board);
  return dispatch;
}

export function getDispatch(dispatchId) {
  return read().dispatches.find((d) => d.id === dispatchId) ?? null;
}

export function setDispatchState(dispatchId, state) {
  const board = read();
  const dispatch = board.dispatches.find((d) => d.id === dispatchId);
  if (!dispatch) return null;
  dispatch.state = state;
  if (state === "confirmed") dispatch.confirmed_by_human_at = now();
  write(board);
  return dispatch;
}

// Incidents ranked for the action feed: urgency first, then people affected,
// then longest-waiting. Deterministic and explainable on purpose — the model
// assigns urgency, code does the arithmetic.
export function prioritizedIncidents() {
  const incidents = [...read().incidents];
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
  const board = read();
  const created = { incidents: [], resources: [] };
  for (const i of incidents) {
    const incident = {
      id: nextId(board, "incident"),
      category: i.category,
      location: i.location ?? null,
      people_estimate: i.people_estimate ?? null,
      urgency: i.urgency,
      summary: i.summary,
      status: "open",
      merged_report_ids: [],
      created_at: now(),
      updated_at: now(),
    };
    board.incidents.push(incident);
    created.incidents.push(incident);
  }
  for (const r of resources) {
    const resource = {
      id: nextId(board, "resource"),
      category: r.category,
      label: r.label,
      location: r.location ?? null,
      capacity: r.capacity ?? null,
      status: "available",
      source_report_id: null,
      created_at: now(),
    };
    board.resources.push(resource);
    created.resources.push(resource);
  }
  write(board);
  return created;
}
