// Settings → Offline maps backend: slippy tile math, the 10k-tile safety cap,
// the download endpoints, and the areas registry (list + clear-all, surviving
// a service restart). Runs the real router over a temp dir with a stub fetch —
// zero network, zero interference with data/tiles/.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import express from "express";

import {
  MAX_TILES,
  countTiles,
  createTilesService,
  latToY,
  lonToX,
  normalizeBbox,
} from "../server/tiles.js";
import { createTilesRouter } from "../server/routes/tiles.js";

// A 1x1 transparent PNG — what our stub CDN hands back for every tile.
const FAKE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const fakeFetch = async () =>
  new Response(FAKE_PNG, { status: 200, headers: { "content-type": "image/png" } });

let tmpDir;
let service;
let server;
let base;

// Vargas-coast-sized area — small and realistic (a few hundred tiles).
const SMALL_BBOX = [10.58, -66.98, 10.62, -66.88];

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "brujula-tiles-"));
  service = createTilesService({ tilesDir: tmpDir, fetchImpl: fakeFetch, delayMs: 0 });
  const app = express();
  app.use(express.json());
  app.use(createTilesRouter(service));
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function req(method, urlPath, body) {
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

async function waitForIdle() {
  for (let i = 0; i < 200; i += 1) {
    const dl = service.getStatus().download;
    if (!dl || dl.state !== "running") return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("download never finished");
}

// ---------------------------------------------------------------------------
// Tile math
// ---------------------------------------------------------------------------

test("slippy math matches the reference tile for the demo region", () => {
  // Same tile the static-serving test uses as its known-good sample.
  assert.equal(lonToX(-67.0472, 12), 1285);
  assert.equal(latToY(10.6081, 12), 1926);
});

test("countTiles counts every zoom 11-16 and grows with area", () => {
  const small = countTiles(normalizeBbox(SMALL_BBOX));
  const bigger = countTiles(normalizeBbox([10.5, -67.1, 10.7, -66.7]));
  assert.ok(small > 0);
  assert.ok(bigger > small);
  // A degenerate-but-valid tiny box still includes >= 1 tile per zoom (6 zooms).
  assert.ok(countTiles(normalizeBbox([10.6, -66.9, 10.6001, -66.8999])) >= 6);
});

test("normalizeBbox rejects garbage and accepts the wire format", () => {
  assert.equal(normalizeBbox(null), null);
  assert.equal(normalizeBbox([1, 2, 3]), null);
  assert.equal(normalizeBbox(["a", "b", "c", "d"]), null);
  assert.equal(normalizeBbox([10.7, -66.9, 10.5, -66.7]), null); // min >= max
  assert.equal(normalizeBbox([89, -66.9, 89.5, -66.7]), null); // beyond Mercator
  const ok = normalizeBbox(SMALL_BBOX);
  assert.deepEqual(
    [ok.minLat, ok.minLon, ok.maxLat, ok.maxLon],
    SMALL_BBOX,
  );
});

// ---------------------------------------------------------------------------
// Endpoints: cap, bad input, download lifecycle
// ---------------------------------------------------------------------------

test("status starts empty and advertises zooms + cap", async () => {
  const { status, body } = await req("GET", "/api/tiles/status");
  assert.equal(status, 200);
  assert.deepEqual(body.data.zooms, [11, 16]);
  assert.equal(body.data.max_tiles, MAX_TILES);
  assert.deepEqual(body.data.regions, []);
  assert.equal(body.data.download, null);
});

test("absurdly huge area is refused with a 400 (the 10k-tile cap)", async () => {
  // Half of Venezuela: way over 10,000 tiles across zooms 11-16.
  const { status, body } = await req("POST", "/api/tiles/download", {
    bbox: [6.0, -70.0, 11.0, -62.0],
  });
  assert.equal(status, 400);
  assert.equal(body.success, false);
  assert.match(body.error, /cap/);
  // Nothing started.
  const s = await req("GET", "/api/tiles/status");
  assert.equal(s.body.data.download, null);
});

test("malformed bbox is a 400, not a crash", async () => {
  for (const bbox of [undefined, "caracas", [1, 2], [10.7, -66.9, 10.5, -66.7]]) {
    const { status, body } = await req("POST", "/api/tiles/download", { bbox });
    assert.equal(status, 400, `bbox=${JSON.stringify(bbox)}`);
    assert.equal(body.success, false);
  }
});

test("download runs to completion and lands in the areas registry", async () => {
  const started = await req("POST", "/api/tiles/download", {
    bbox: SMALL_BBOX,
    name: "Vargas coast",
  });
  assert.equal(started.status, 200);
  assert.equal(started.body.data.download.state, "running");
  const expected = started.body.data.download.total;
  assert.ok(expected > 0 && expected <= MAX_TILES);

  await waitForIdle();

  const { body } = await req("GET", "/api/tiles/status");
  assert.equal(body.data.download.state, "done");
  assert.equal(body.data.regions.length, 1);
  const region = body.data.regions[0];
  assert.equal(region.name, "Vargas coast");
  assert.equal(region.tiles, expected);
  assert.ok(region.bytes > 0);
  assert.ok(region.created_at);
  assert.deepEqual(region.bbox, SMALL_BBOX);
  // Tiles actually landed on disk in the {z}/{x}/{y}.png layout.
  const z11 = path.join(tmpDir, "11");
  assert.ok(fs.existsSync(z11));
});

test("re-downloading the same area skips existing tiles", async () => {
  const started = await req("POST", "/api/tiles/download", { bbox: SMALL_BBOX });
  assert.equal(started.status, 200);
  await waitForIdle();
  const dl = service.getStatus().download;
  assert.equal(dl.state, "done");
  assert.equal(dl.downloaded, 0, "everything was already on disk");
  assert.equal(dl.skipped, dl.total);
});

test("second download while one runs is a 409", async () => {
  // Fetch that never resolves until we let it → keeps the download running.
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const slowService = createTilesService({
    tilesDir: fs.mkdtempSync(path.join(os.tmpdir(), "brujula-tiles-slow-")),
    fetchImpl: async () => {
      await gate;
      return new Response(FAKE_PNG, { status: 200 });
    },
    delayMs: 0,
  });
  slowService.startDownload(SMALL_BBOX);
  assert.throws(() => slowService.startDownload(SMALL_BBOX), /already running/);
  assert.throws(() => slowService.clearAll(), /while a download/);
  release();
});

test("registry survives a service restart (areas.json reload)", async () => {
  // A fresh service over the same dir must see exactly what the live one has
  // (two areas by this point: "Vargas coast" + the re-downloaded "Área 2").
  const live = service.getStatus().regions;
  assert.ok(live.length >= 1);
  assert.equal(live[0].name, "Vargas coast");
  const reloaded = createTilesService({ tilesDir: tmpDir, fetchImpl: fakeFetch });
  assert.deepEqual(reloaded.getStatus().regions, live);
});

test("clear-all wipes tiles and registry via DELETE /api/tiles", async () => {
  const { status, body } = await req("DELETE", "/api/tiles");
  assert.equal(status, 200);
  assert.equal(body.data.cleared, true);

  const after = await req("GET", "/api/tiles/status");
  assert.deepEqual(after.body.data.regions, []);
  assert.equal(after.body.data.totals.tiles, 0);
  // Disk is empty too (no z-dirs, no areas.json).
  assert.deepEqual(fs.readdirSync(tmpDir), []);
  // And a restart stays empty.
  const reloaded = createTilesService({ tilesDir: tmpDir, fetchImpl: fakeFetch });
  assert.equal(reloaded.getStatus().regions.length, 0);
});

test("connectivity probe reports offline when the CDN is unreachable", async () => {
  const offlineService = createTilesService({
    tilesDir: tmpDir,
    fetchImpl: async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    },
  });
  assert.deepEqual(await offlineService.checkConnectivity(), { online: false });
  assert.deepEqual(await service.checkConnectivity(), { online: true });
});
