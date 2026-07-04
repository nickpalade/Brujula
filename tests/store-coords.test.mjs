// Tests that lat/lon/accuracy persist through the SQLite store and that the
// seeded demo board carries map coordinates. Writes through data/hub.db and
// resets when done (same effect as `npm run seed`).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import * as store from "../server/store.js";

before(() => {
  store.reset();
});

after(() => {
  store.reset();
});

test("addReport persists lat/lon/accuracy and returns them", () => {
  const rep = store.addReport({
    raw_text: "prueba",
    lat: 10.6081,
    lon: -67.0472,
    accuracy: 12.5,
  });
  assert.equal(rep.lat, 10.6081);
  assert.equal(rep.lon, -67.0472);
  assert.equal(rep.accuracy, 12.5);

  const fetched = store.getReport(rep.id);
  assert.equal(fetched.lat, 10.6081);
  assert.equal(fetched.lon, -67.0472);
  assert.equal(fetched.accuracy, 12.5);
});

test("addReport without GPS defaults coords to null", () => {
  const rep = store.addReport({ raw_text: "sin gps" });
  assert.equal(rep.lat, null);
  assert.equal(rep.lon, null);
  assert.equal(rep.accuracy, null);
});

test("addIncident defaults lat/lon to null and accepts explicit coords", () => {
  const bare = store.addIncident({ summary: "no pin" });
  assert.equal(bare.lat, null);
  assert.equal(bare.lon, null);

  const pinned = store.addIncident({ summary: "pinned", lat: 10.6, lon: -66.9 });
  assert.equal(pinned.lat, 10.6);
  assert.equal(pinned.lon, -66.9);
  assert.equal(store.getIncident(pinned.id).lat, 10.6);
});

test("updateIncident can set coords and they survive a round-trip", () => {
  const inc = store.addIncident({ summary: "late pin" });
  store.updateIncident(inc.id, { lat: 10.62, lon: -66.84 });
  const fetched = store.getIncident(inc.id);
  assert.equal(fetched.lat, 10.62);
  assert.equal(fetched.lon, -66.84);
});

test("coords flow through /api/sync's underlying delta query", () => {
  const seqBefore = store.currentSeq();
  const inc = store.addIncident({ summary: "sync pin", lat: 10.63, lon: -66.8 });
  const delta = store.syncSince(seqBefore);
  const found = delta.incidents.find((i) => i.id === inc.id);
  assert.ok(found, "new incident must appear in the delta");
  assert.equal(found.lat, 10.63);
  assert.equal(found.lon, -66.8);
});

test("every seeded incident and resource carries map coordinates", () => {
  store.reset();
  const incidents = store.listIncidents();
  const resources = store.listResources();
  assert.ok(incidents.length >= 4, "seed should load the demo incidents");
  for (const i of incidents) {
    assert.ok(Number.isFinite(i.lat), `incident ${i.id} missing lat`);
    assert.ok(Number.isFinite(i.lon), `incident ${i.id} missing lon`);
  }
  for (const r of resources) {
    assert.ok(Number.isFinite(r.lat), `resource ${r.id} missing lat`);
    assert.ok(Number.isFinite(r.lon), `resource ${r.id} missing lon`);
  }
});
