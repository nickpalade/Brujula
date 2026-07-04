// Tests for the coordinate-resolution logic in server/routes/hub.js:
// resolveCoords (GPS → gazetteer → nothing) and mergeReportIntoIncident
// (first pin wins, urgency/people/location raising intact).
//
// mergeReportIntoIncident writes through the real SQLite store (data/hub.db),
// so this file resets the store when it is done — same effect as `npm run seed`.
import assert from "node:assert/strict";
import { after, test } from "node:test";

import { mergeReportIntoIncident, resolveCoords } from "../server/routes/hub.js";
import * as store from "../server/store.js";

after(() => {
  store.reset();
});

// ---- resolveCoords ----------------------------------------------------------

test("phone GPS wins over the location label", () => {
  const out = resolveCoords({ lat: 10.61, lon: -66.85 }, "Catia La Mar");
  assert.deepEqual(out, { lat: 10.61, lon: -66.85 });
});

test("no GPS → gazetteer resolves the label", () => {
  const out = resolveCoords(null, "colapso en Playa Grande");
  assert.equal(out.lat, 10.6081);
  assert.equal(out.lon, -67.0472);
});

test("no GPS and unknown label → empty (incident gets no pin)", () => {
  assert.deepEqual(resolveCoords(null, "un lugar desconocido"), {});
  assert.deepEqual(resolveCoords(null, null), {});
  assert.deepEqual(resolveCoords(undefined, undefined), {});
});

test("half or broken GPS falls back to the label", () => {
  const cases = [
    { lat: 10.61, lon: null },
    { lat: null, lon: -66.85 },
    { lat: "10.61", lon: "-66.85" },
    { lat: NaN, lon: -66.85 },
    { lat: Infinity, lon: -66.85 },
    {},
  ];
  for (const gps of cases) {
    const out = resolveCoords(gps, "Macuto");
    assert.equal(out.lat, 10.6072, `gps=${JSON.stringify(gps)}`);
    assert.equal(out.lon, -66.9014, `gps=${JSON.stringify(gps)}`);
  }
});

test("GPS zero-zero is still a valid fix (no falsy-check bug)", () => {
  assert.deepEqual(resolveCoords({ lat: 0, lon: 0 }, "Macuto"), { lat: 0, lon: 0 });
});

// ---- mergeReportIntoIncident --------------------------------------------------

function freshIncident(fields = {}) {
  return store.addIncident({
    kind: "need",
    category: "rescue",
    location: "Playa Grande",
    urgency: "high",
    people_count: 10,
    summary: "test incident",
    merged_report_ids: ["rep_first"],
    ...fields,
  });
}

test("merge pins an unpinned incident with the new report's coords", () => {
  const inc = freshIncident(); // store default: lat/lon null
  const merged = mergeReportIntoIncident(inc, "rep_second", { urgency: "high" }, { lat: 10.6, lon: -67.0 });
  assert.equal(merged.lat, 10.6);
  assert.equal(merged.lon, -67.0);
  assert.deepEqual(merged.merged_report_ids, ["rep_first", "rep_second"]);
});

test("merge never moves an existing pin (first coords win)", () => {
  const inc = freshIncident({ lat: 10.61, lon: -66.85 });
  const merged = mergeReportIntoIncident(inc, "rep_second", {}, { lat: 1, lon: 1 });
  assert.equal(merged.lat, 10.61);
  assert.equal(merged.lon, -66.85);
});

test("merge without coords leaves the incident unpinned", () => {
  const inc = freshIncident();
  const merged = mergeReportIntoIncident(inc, "rep_second", {}, {});
  assert.equal(merged.lat, null);
  assert.equal(merged.lon, null);
});

test("merge with default (omitted) coords argument does not throw", () => {
  const inc = freshIncident();
  const merged = mergeReportIntoIncident(inc, "rep_second", { urgency: "critical" });
  assert.equal(merged.lat, null);
  assert.equal(merged.urgency, "critical");
});

test("existing merge behavior intact: urgency raises, people max, location fills", () => {
  const inc = freshIncident({ location: null, urgency: "medium", people_count: 5 });
  const merged = mergeReportIntoIncident(
    inc,
    "rep_second",
    { urgency: "critical", people_count: 20, location: "Los Corales" },
    { lat: 10.6142, lon: -66.8433 },
  );
  assert.equal(merged.urgency, "critical");
  assert.equal(merged.people_count, 20);
  assert.equal(merged.location, "Los Corales");
  assert.equal(merged.lat, 10.6142);
});

test("merge does not lower urgency or people_count", () => {
  const inc = freshIncident({ urgency: "critical", people_count: 50 });
  const merged = mergeReportIntoIncident(inc, "rep_second", { urgency: "low", people_count: 3 });
  assert.equal(merged.urgency, "critical");
  assert.equal(merged.people_count, 50);
});
