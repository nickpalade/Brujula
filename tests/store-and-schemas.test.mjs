import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, test } from "node:test";

process.env.BRUJULA_DATA_DIR = path.join(tmpdir(), `brujula-store-schemas-${process.pid}`);

const store = await import("../server/store.js");
const schemas = await import("../server/schemas.js");

beforeEach(() => {
  store.reset();
});

test("store reset seeds the board and sync deltas hide internal sequence fields", () => {
  const board = store.board();
  assert.ok(board.incidents.length > 0, "seed incidents should load");
  assert.ok(board.resources.length > 0, "seed resources should load");

  const sinceSeed = store.currentSeq();
  const report = store.addReport({
    raw_text: "Water needed at the school",
    source_device: "field-2",
    lang: "en",
    client_ref: "delta-report",
  });
  const incident = store.addIncident({
    category: "water",
    location: "Escuela Simon Bolivar",
    urgency: "high",
    summary: "Shelter needs drinking water.",
    merged_report_ids: [report.id],
  });
  store.updateReport(report.id, { parsed_into: incident.id });

  const delta = store.syncSince(sinceSeed);
  assert.equal(delta.reports, undefined);
  assert.ok(delta.incidents.some((item) => item.id === incident.id));
  assert.equal(Object.hasOwn(delta.incidents[0], "_seq"), false);
});

test("matchable resources include returning crews but exclude engaged crews", () => {
  const idle = store.addResource({
    type: "medical",
    label: "Clinic team",
    status: "available",
    field_status: "idle",
  });
  const traveling = store.addResource({
    type: "rescue",
    label: "Rescue team traveling",
    status: "committed",
    field_status: "traveling",
  });
  const returning = store.addResource({
    type: "water",
    label: "Water crew returning",
    status: "committed",
    field_status: "returning",
  });

  const ids = new Set(store.matchableResources().map((resource) => resource.id));
  assert.equal(ids.has(idle.id), true);
  assert.equal(ids.has(traveling.id), false);
  assert.equal(ids.has(returning.id), true);
});

test("person registry updates status without exposing private fields", () => {
  const missing = store.addPerson({
    name: "Maria Lopez",
    name_key: "maria lopez",
    status: "missing",
    detail: "Last seen near Playa Grande.",
    report_id: "rep-a",
    incident_id: "inc-a",
  });

  const safe = store.updatePerson(missing.id, {
    status: "safe",
    matched: true,
    detail: "Safe at Refugio San Jose.",
  });

  assert.equal(safe.status, "safe");
  assert.equal(safe.matched, true);
  assert.equal(Object.hasOwn(safe, "_seq"), false);
  assert.equal(store.findPersonByNameKey("maria lopez").id, missing.id);
});

test("schemas accept life-critical partial data but reject malformed commands", () => {
  const report = schemas.HubReportRequest.parse({
    text: "Need water now",
    lat: 999,
    lon: "bad",
  });
  assert.equal(report.lat, null);
  assert.equal(report.lon, null);

  assert.equal(
    schemas.HubReportRequest.safeParse({ text: "   " }).success,
    false,
  );
  assert.equal(
    schemas.DispatchActionRequest.safeParse({ dispatch_id: "dsp-1", action: "override" }).success,
    false,
  );
  assert.equal(
    schemas.ResourcePatchRequest.safeParse({ quantity: 0, unit: null }).success,
    true,
  );
});
