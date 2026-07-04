// Over-the-wire tests for POST /api/reports with the GPS fields: valid coords
// are stored, mangled coords are forgiven (nulled, never a 400), and the
// idempotent client_ref replay returns the original coords.
//
// The hub router is mounted on a throwaway express app (no server/main.js —
// that would spawn Ollama). The pipeline is expected to be unavailable in the
// test environment, so assertions target the stored report, not the incident
// (which is exactly the hub's graceful-degradation contract). Resets the
// store when done.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import express from "express";

import { hubRouter } from "../server/routes/hub.js";
import * as store from "../server/store.js";

let server;
let base;

before(async () => {
  store.reset();
  const app = express();
  app.use(express.json({ limit: "25mb" }));
  app.use(hubRouter);
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  store.reset();
});

async function postReport(body) {
  const res = await fetch(`${base}/api/reports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test("report with valid GPS stores lat/lon/accuracy", async () => {
  const { status, body } = await postReport({
    text: "arbol caido bloquea la calle",
    lat: 10.6081,
    lon: -67.0472,
    accuracy: 8,
    client_ref: "t-gps-valid",
  });
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.report.lat, 10.6081);
  assert.equal(body.data.report.lon, -67.0472);
  assert.equal(body.data.report.accuracy, 8);
});

test("report without GPS stores null coords (unchanged pre-feature behavior)", async () => {
  const { status, body } = await postReport({ text: "reporte sin gps", client_ref: "t-gps-none" });
  assert.equal(status, 200);
  assert.equal(body.data.report.lat, null);
  assert.equal(body.data.report.lon, null);
  assert.equal(body.data.report.accuracy, null);
});

test("mangled GPS values are forgiven, never a 400", async () => {
  const mangled = [
    { lat: "banana", lon: -67.0 },
    { lat: 200, lon: -67.0 }, // out of range
    { lat: 10.6, lon: -400 },
    { lat: { deg: 10 }, lon: [1] },
    { lat: true, lon: false },
  ];
  for (const [i, gps] of mangled.entries()) {
    const { status, body } = await postReport({
      text: "coordenadas rotas",
      ...gps,
      client_ref: `t-gps-mangled-${i}`,
    });
    assert.equal(status, 200, `case ${JSON.stringify(gps)} must not be rejected`);
    assert.equal(body.data.report.lat, null, `case ${JSON.stringify(gps)}`);
    assert.equal(body.data.report.lon, null, `case ${JSON.stringify(gps)}`);
  }
});

test("half a fix (lat without lon) stores as no fix at all", async () => {
  const { status, body } = await postReport({
    text: "solo latitud",
    lat: 10.6,
    client_ref: "t-gps-half",
  });
  assert.equal(status, 200);
  assert.equal(body.data.report.lat, null);
  assert.equal(body.data.report.lon, null);
});

test("negative accuracy is dropped but the fix is kept", async () => {
  const { status, body } = await postReport({
    text: "precision rara",
    lat: 10.6,
    lon: -66.9,
    accuracy: -5,
    client_ref: "t-gps-badacc",
  });
  assert.equal(status, 200);
  assert.equal(body.data.report.lat, 10.6);
  assert.equal(body.data.report.lon, -66.9);
  assert.equal(body.data.report.accuracy, null);
});

test("client_ref replay returns the original report with its coords", async () => {
  const first = await postReport({
    text: "replay con gps",
    lat: 10.62,
    lon: -66.85,
    client_ref: "t-gps-replay",
  });
  const replay = await postReport({
    text: "replay con gps",
    lat: 10.62,
    lon: -66.85,
    client_ref: "t-gps-replay",
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.report.id, first.body.data.report.id);
  assert.equal(replay.body.data.report.lat, 10.62);
  assert.equal(replay.body.data.report.lon, -66.85);
});

test("GPS-less validation still rejects an empty report", async () => {
  const { status, body } = await postReport({ lat: 10.6, lon: -66.9 });
  assert.equal(status, 400);
  assert.equal(body.success, false);
});
