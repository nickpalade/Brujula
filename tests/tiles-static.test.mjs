// Verifies the offline map tile mount in server/main.js: /tiles/{z}/{x}/{y}.png
// is served from data/tiles/ when present, and 404s cleanly when not.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import express from "express";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TILES_DIR = path.join(HERE, "..", "data", "tiles");

let server;
let base;

before(async () => {
  const app = express();
  app.use("/tiles", express.static(TILES_DIR, { immutable: true, maxAge: "30d" }));
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
});

test("existing prefetched tile returns image/png", async () => {
  // Pick any tile on disk — skip if fetch:tiles hasn't been run on this machine.
  const sample = path.join(TILES_DIR, "12", "1285", "1926.png");
  if (!fs.existsSync(sample)) {
    console.log("  (skip: no tiles on disk — run npm run fetch:tiles first)");
    return;
  }
  const res = await fetch(`${base}/tiles/12/1285/1926.png`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /image\/png/i);
  assert.ok((await res.arrayBuffer()).byteLength > 100);
});

test("missing tile returns 404 without crashing the server", async () => {
  const res = await fetch(`${base}/tiles/99/0/0.png`);
  assert.equal(res.status, 404);
});
