import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";

import express from "express";

process.env.BRUJULA_DATA_DIR = path.join(tmpdir(), `brujula-db-admin-${process.pid}`);
process.env.BRUJULA_PROVIDER = "mock";
process.env.BRUJULA_CHAT_PROVIDER = "mock";

const store = await import("../server/store.js");
const { hubRouter } = await import("../server/routes/hub.js");

let server;
let base;

before(async () => {
  const app = express();
  app.use(express.json({ limit: "25mb" }));
  app.use(hubRouter);
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  store.reset();
});

after(() => {
  server?.close();
});

async function exportSnapshot() {
  const response = await fetch(`${base}/api/admin/db/export`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition") ?? "", /brujula-hub-.*\.db/);
  return Buffer.from(await response.arrayBuffer());
}

async function importSnapshot(body, contentType = "application/octet-stream") {
  const response = await fetch(`${base}/api/admin/db/import`, {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
  return { status: response.status, payload: await response.json() };
}

test("export returns a valid SQLite snapshot of the live board", async () => {
  const snapshot = await exportSnapshot();
  assert.ok(snapshot.length >= 16, "snapshot should not be empty");
  assert.equal(
    snapshot.subarray(0, 16).toString("latin1"),
    "SQLite format 3\0",
    "download must start with the SQLite magic header",
  );
});

test("export → mutate → import restores the exported situation exactly", async () => {
  const marker = store.addIncident({
    summary: "snapshot marker incident",
    category: "rescue",
    urgency: "critical",
  });
  const seqAtExport = store.currentSeq();
  const snapshot = await exportSnapshot();

  // Diverge from the snapshot: wipe + reseed drops the marker incident.
  store.reset();
  assert.equal(store.getIncident(marker.id), null);

  const result = await importSnapshot(snapshot);
  assert.equal(result.status, 200);
  assert.equal(result.payload.success, true);
  assert.equal(result.payload.data.imported, true);

  const restored = store.getIncident(marker.id);
  assert.ok(restored, "marker incident should be back after import");
  assert.equal(restored.summary, "snapshot marker incident");
  assert.equal(store.currentSeq(), seqAtExport, "seq counter must follow the snapshot");
});

test("store keeps working after an import (writes, sync, re-export)", async () => {
  const snapshot = await exportSnapshot();
  await importSnapshot(snapshot);

  const incident = store.addIncident({ summary: "post-import write", category: "medical", urgency: "medium" });
  assert.ok(store.getIncident(incident.id));

  const sync = store.syncSince(0);
  assert.equal(sync.seq, store.currentSeq());
  assert.ok(sync.incidents.some((item) => item.id === incident.id));

  await exportSnapshot(); // WAL checkpoint again — must not throw
});

test("import rejects non-SQLite bodies without touching the board", async () => {
  const before = store.board();
  const result = await importSnapshot(Buffer.from("definitely not a database"));
  assert.equal(result.status, 400);
  assert.equal(result.payload.success, false);
  assert.match(result.payload.error, /not a SQLite database/);
  assert.deepEqual(store.board(), before, "failed import must leave the board unchanged");
});

test("import rejects a SQLite file that is not a hub snapshot", async () => {
  // Minimal foreign SQLite db built through a throwaway connection.
  const { DatabaseSync } = await import("node:sqlite");
  const fs = await import("node:fs");
  const foreignPath = path.join(process.env.BRUJULA_DATA_DIR, "foreign.db");
  const foreign = new DatabaseSync(foreignPath);
  foreign.exec("CREATE TABLE foo (x INTEGER)");
  foreign.close();
  const bytes = fs.readFileSync(foreignPath);
  fs.unlinkSync(foreignPath);

  const result = await importSnapshot(bytes);
  assert.equal(result.status, 400);
  assert.match(result.payload.error, /missing tables/);
});

test("import rejects empty or wrongly typed bodies", async () => {
  const empty = await importSnapshot(Buffer.alloc(0));
  assert.equal(empty.status, 400);

  const wrongType = await importSnapshot(JSON.stringify({ nope: true }), "application/json");
  assert.equal(wrongType.status, 400);
  assert.match(wrongType.payload.error, /octet-stream/);
});

test("wipe deletes everything and leaves a truly empty board", async () => {
  store.addIncident({ summary: "doomed incident", category: "water", urgency: "high" });
  store.addResource({ type: "medical", label: "doomed resource" });

  const response = await fetch(`${base}/api/admin/db/wipe`, { method: "POST" });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.equal(payload.data.wiped, true);

  const brd = store.board();
  assert.equal(brd.incidents.length, 0, "no seed data after wipe");
  assert.equal(brd.resources.length, 0);
  assert.equal(brd.dispatches.length, 0);
  assert.equal(store.listReports().length, 0);
  assert.equal(store.listPersons().length, 0);
  assert.equal(store.currentSeq(), 0, "seq restarts from zero");

  // Board still writable after wipe.
  const fresh = store.addIncident({ summary: "first incident of the new situation", category: "rescue", urgency: "high" });
  assert.ok(store.getIncident(fresh.id));
});

test("reset wipes the board and reloads the seed fixtures", async () => {
  const extra = store.addIncident({ summary: "doomed incident", category: "water", urgency: "high" });

  const response = await fetch(`${base}/api/admin/db/reset`, { method: "POST" });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.equal(payload.data.reset, true);

  assert.equal(store.getIncident(extra.id), null, "reset must drop non-seed records");
  assert.equal(store.listIncidents().length, payload.data.incidents);
  assert.ok(payload.data.incidents > 0, "seed fixtures should repopulate the board");
});
