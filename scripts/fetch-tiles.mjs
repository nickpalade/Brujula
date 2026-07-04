#!/usr/bin/env node
// Brújula offline map tiles — `npm run fetch:tiles`
//
// SETUP-TIME ONLY (needs internet once, like bootstrap's model pull).
// Downloads basemap raster tiles for the demo region into
// data/tiles/{z}/{x}/{y}.png so the Command Post map works with zero network
// at demo time (the Express hub serves them at /tiles/*).
//
// Tile source: CARTO's dark_all basemap (OSM data, © OpenStreetMap © CARTO).
// NOT tile.openstreetmap.org — OSM's usage policy forbids bulk downloading
// and their server starts returning "Access blocked" placeholder tiles
// mid-fetch (verified the hard way). CARTO's dark theme also matches the
// command UI without CSS filters.
//
// Defaults cover the Vargas coast (La Guaira: Catia La Mar → Caraballeda) at
// zooms 11–16 — about 1.5k tiles / a few tens of MB. Resumable: existing
// tiles are skipped, so re-running after an interruption just fills gaps.
//
// Override via env if the scenario moves:
//   TILES_BBOX="10.55,-67.05,10.65,-66.75"  (minLat,minLon,maxLat,maxLon)
//   TILES_ZOOM="11-16"
//   TILES_URL="https://.../{z}/{x}/{y}.png"

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, "..", "data", "tiles");

const TILE_URL = process.env.TILES_URL || "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png";
const USER_AGENT = "brujula-offline-demo/1.0 (hackathon; one-time regional prefetch)";
const CONCURRENCY = 2;
const DELAY_MS = 150; // per worker, between requests

function parseBbox(raw) {
  const [minLat, minLon, maxLat, maxLon] = raw.split(",").map(Number);
  if ([minLat, minLon, maxLat, maxLon].some(Number.isNaN) || minLat >= maxLat || minLon >= maxLon) {
    throw new Error(`bad TILES_BBOX "${raw}" — expected "minLat,minLon,maxLat,maxLon"`);
  }
  return { minLat, minLon, maxLat, maxLon };
}

function parseZoom(raw) {
  const [lo, hi] = raw.split("-").map(Number);
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo > hi || lo < 0 || hi > 19) {
    throw new Error(`bad TILES_ZOOM "${raw}" — expected e.g. "11-16"`);
  }
  return { lo, hi };
}

// Vargas coast demo region: Catia La Mar / Playa Grande west, Caraballeda
// east, with ~5 km margin beyond the map's pan clamp so the coordinator
// never sees a grey un-downloaded edge.
const BBOX = parseBbox(process.env.TILES_BBOX || "10.50,-67.12,10.70,-66.68");
const ZOOM = parseZoom(process.env.TILES_ZOOM || "11-16");

// Standard slippy-map tile math (Web Mercator).
function lonToX(lon, z) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
function latToY(lat, z) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * 2 ** z);
}

function tileList() {
  const tiles = [];
  for (let z = ZOOM.lo; z <= ZOOM.hi; z++) {
    const x0 = lonToX(BBOX.minLon, z);
    const x1 = lonToX(BBOX.maxLon, z);
    const y0 = latToY(BBOX.maxLat, z); // y grows southward
    const y1 = latToY(BBOX.minLat, z);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) tiles.push({ z, x, y });
    }
  }
  return tiles;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchTile({ z, x, y }) {
  const dest = path.join(OUT_DIR, String(z), String(x), `${y}.png`);
  if (fs.existsSync(dest)) return "skipped";

  const url = TILE_URL.replace("{z}", z).replace("{x}", x).replace("{y}", y);
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${z}/${x}/${y}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return "downloaded";
}

async function main() {
  const tiles = tileList();
  console.log("");
  console.log("  Brújula — offline tile prefetch (one-time, needs internet)");
  console.log("  " + "-".repeat(56));
  console.log(`  Region: ${BBOX.minLat},${BBOX.minLon} → ${BBOX.maxLat},${BBOX.maxLon}`);
  console.log(`  Zoom:   ${ZOOM.lo}–${ZOOM.hi}   Tiles: ${tiles.length}`);
  console.log(`  Into:   ${OUT_DIR}`);
  console.log("");

  let done = 0;
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  const queue = [...tiles];

  async function worker() {
    while (queue.length) {
      const tile = queue.shift();
      try {
        const result = await fetchTile(tile);
        if (result === "downloaded") {
          downloaded++;
          await sleep(DELAY_MS);
        } else {
          skipped++;
        }
      } catch (err) {
        failed++;
        console.warn(`  ! ${tile.z}/${tile.x}/${tile.y}: ${err.message}`);
        await sleep(DELAY_MS * 4);
      }
      done++;
      if (done % 100 === 0 || done === tiles.length) {
        process.stdout.write(`  ${done}/${tiles.length} (new ${downloaded}, cached ${skipped}, failed ${failed})\n`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log("  " + "-".repeat(56));
  if (failed > 0) {
    console.log(`  ${failed} tiles failed — re-run to fill the gaps (existing tiles are skipped).`);
    process.exitCode = 1;
  } else {
    console.log("  Complete. Tiles are served offline by the hub at /tiles/{z}/{x}/{y}.png");
  }
  console.log("");
}

main().catch((err) => {
  console.error("fetch-tiles failed:", err.message);
  process.exit(1);
});
