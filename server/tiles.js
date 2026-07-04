// Offline tile prefetch service — the backend of Settings → Offline maps.
//
// Same tile source and slippy-map math as scripts/fetch-tiles.mjs (CARTO
// Voyager — NOT tile.openstreetmap.org, whose usage policy forbids bulk
// downloads), wrapped as an in-process download manager so the Command Post
// can pull new areas on demand during demo prep (the one moment the laptop
// has internet) and list/clear what is already on disk.
//
// Design decisions (locked with the team):
//  - Tiles live on the hub laptop only (data/tiles/); phones consume them
//    over the hotspot at /tiles/{z}/{x}/{y}.png. No per-phone storage.
//  - Zoom depth is fixed at the incident map's detail levels (11–16).
//  - Areas above MAX_TILES are refused with a 400 so nobody accidentally
//    downloads half of Venezuela and gets blocked by the tile CDN.
//  - Downloaded areas are kept as a list in data/tiles/areas.json (bbox,
//    tile count, real bytes, timestamp) so the registry survives restarts.
//    Clear-all wipes tiles + registry together.
//
// One download at a time; already-present tiles are skipped, so re-running
// an area just fills the gaps (same resumability as the CLI script).

import fs from "node:fs";
import path from "node:path";

import { logger } from "./logger.js";

export const TILE_URL = "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png";
export const ZOOM_MIN = 11;
export const ZOOM_MAX = 16;
export const MAX_TILES = 10_000;
// Estimate basis for the client's "~Y MB" preview: ~12 KB/tile is a safe
// average for CARTO Voyager over mixed urban areas (sparse coastal regions
// come in far smaller — the seeded Vargas set is ~1.4 KB/tile). The areas
// registry stores REAL on-disk bytes after each download.
export const EST_TILE_BYTES = 12 * 1024;

const USER_AGENT = "brujula-offline-demo/1.0 (hackathon; regional prefetch)";
const CONCURRENCY = 4;
const DELAY_MS = 60; // per worker, between downloads — stay polite to the CDN
const REGISTRY_FILE = "areas.json";
// Web-Mercator latitude limit — beyond this there are no tiles.
const LAT_LIMIT = 85.0511;

// ---------------------------------------------------------------------------
// Slippy-map tile math (Web Mercator) — mirrors scripts/fetch-tiles.mjs.
// ---------------------------------------------------------------------------

export function lonToX(lon, z) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

export function latToY(lat, z) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * 2 ** z);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// bbox wire format is [minLat, minLon, maxLat, maxLon] (see app/src/shared/api.js).
// Returns a normalized object, or null when the input is not a usable bbox.
export function normalizeBbox(raw) {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const [minLat, minLon, maxLat, maxLon] = raw.map(Number);
  if (![minLat, minLon, maxLat, maxLon].every(Number.isFinite)) return null;
  if (minLat >= maxLat || minLon >= maxLon) return null;
  if (minLat < -LAT_LIMIT || maxLat > LAT_LIMIT) return null;
  if (minLon < -180 || maxLon > 180) return null;
  return { minLat, minLon, maxLat, maxLon };
}

function tileRange(bbox, z) {
  const n = 2 ** z;
  return {
    x0: clamp(lonToX(bbox.minLon, z), 0, n - 1),
    x1: clamp(lonToX(bbox.maxLon, z), 0, n - 1),
    y0: clamp(latToY(bbox.maxLat, z), 0, n - 1), // y grows southward
    y1: clamp(latToY(bbox.minLat, z), 0, n - 1),
  };
}

export function countTiles(bbox, zMin = ZOOM_MIN, zMax = ZOOM_MAX) {
  let total = 0;
  for (let z = zMin; z <= zMax; z += 1) {
    const { x0, x1, y0, y1 } = tileRange(bbox, z);
    total += (x1 - x0 + 1) * (y1 - y0 + 1);
  }
  return total;
}

export function tileList(bbox, zMin = ZOOM_MIN, zMax = ZOOM_MAX) {
  const tiles = [];
  for (let z = zMin; z <= zMax; z += 1) {
    const { x0, x1, y0, y1 } = tileRange(bbox, z);
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) tiles.push({ z, x, y });
    }
  }
  return tiles;
}

// ---------------------------------------------------------------------------
// Download manager + areas registry
// ---------------------------------------------------------------------------

export class TilesError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let idSeq = 0;

export function createTilesService({
  tilesDir,
  fetchImpl = fetch,
  concurrency = CONCURRENCY,
  delayMs = DELAY_MS,
} = {}) {
  const registryPath = path.join(tilesDir, REGISTRY_FILE);
  let download = null; // in-flight download, or the last finished one

  function loadRegistry() {
    try {
      const parsed = JSON.parse(fs.readFileSync(registryPath, "utf8"));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return []; // missing or corrupt file — start empty, never crash
    }
  }

  let regions = loadRegistry();

  function saveRegistry() {
    fs.mkdirSync(tilesDir, { recursive: true });
    fs.writeFileSync(registryPath, JSON.stringify(regions, null, 2));
  }

  const copy = (obj) => (obj ? JSON.parse(JSON.stringify(obj)) : null);

  function getStatus() {
    const totals = regions.reduce(
      (acc, r) => ({ tiles: acc.tiles + (r.tiles ?? 0), bytes: acc.bytes + (r.bytes ?? 0) }),
      { tiles: 0, bytes: 0 },
    );
    return {
      zooms: [ZOOM_MIN, ZOOM_MAX],
      max_tiles: MAX_TILES,
      est_tile_bytes: EST_TILE_BYTES,
      regions: copy(regions),
      totals,
      download: copy(download),
    };
  }

  async function fetchTile({ z, x, y }) {
    const dest = path.join(tilesDir, String(z), String(x), `${y}.png`);
    if (fs.existsSync(dest)) {
      return { result: "skipped", bytes: fs.statSync(dest).size };
    }
    const url = TILE_URL.replace("{z}", z).replace("{x}", x).replace("{y}", y);
    const res = await fetchImpl(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${z}/${x}/${y}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    return { result: "downloaded", bytes: buf.length };
  }

  async function run(dl, tiles) {
    const queue = [...tiles];
    let bytes = 0;

    async function worker() {
      while (queue.length) {
        const tile = queue.shift();
        try {
          const { result, bytes: b } = await fetchTile(tile);
          bytes += b;
          if (result === "downloaded") {
            dl.downloaded += 1;
            await sleep(delayMs);
          } else {
            dl.skipped += 1;
          }
        } catch (err) {
          dl.failed += 1;
          if (dl.failed <= 5) logger.warn(`[tiles] ${tile.z}/${tile.x}/${tile.y}: ${err.message}`);
        }
        dl.done += 1;
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(concurrency, tiles.length) }, worker),
    );

    if (dl.downloaded + dl.skipped === 0) {
      dl.state = "error";
      dl.error = "no tiles could be downloaded — is the laptop online?";
      return;
    }
    dl.state = "done";
    regions.push({
      id: dl.id,
      name: dl.name,
      bbox: [...dl.bbox],
      zooms: [ZOOM_MIN, ZOOM_MAX],
      tiles: dl.downloaded + dl.skipped,
      bytes,
      created_at: new Date().toISOString(),
    });
    saveRegistry();
    logger.info(
      `[tiles] "${dl.name}" done: ${dl.downloaded} new, ${dl.skipped} cached, ${dl.failed} failed`,
    );
  }

  function startDownload(rawBbox, name = null) {
    if (download?.state === "running") {
      throw new TilesError("a download is already running", 409);
    }
    const bbox = normalizeBbox(rawBbox);
    if (!bbox) {
      throw new TilesError(
        "bbox must be [minLat, minLon, maxLat, maxLon] with min < max",
        400,
      );
    }
    const total = countTiles(bbox);
    if (total > MAX_TILES) {
      throw new TilesError(
        `area too large: ~${total} tiles exceeds the ${MAX_TILES}-tile cap — zoom in and pick a smaller area`,
        400,
      );
    }
    idSeq += 1;
    download = {
      id: `dl_${Date.now().toString(36)}_${idSeq}`,
      name: (typeof name === "string" && name.trim()) || `Área ${regions.length + 1}`,
      bbox: [bbox.minLat, bbox.minLon, bbox.maxLat, bbox.maxLon],
      zooms: [ZOOM_MIN, ZOOM_MAX],
      total,
      done: 0,
      downloaded: 0,
      skipped: 0,
      failed: 0,
      state: "running",
      error: null,
      started_at: new Date().toISOString(),
    };
    const dl = download;
    void run(dl, tileList(bbox)).catch((err) => {
      dl.state = "error";
      dl.error = err.message;
      logger.error(`[tiles] download crashed: ${err.message}`);
    });
    return copy(download);
  }

  function clearAll() {
    if (download?.state === "running") {
      throw new TilesError("cannot clear while a download is running", 409);
    }
    if (fs.existsSync(tilesDir)) {
      for (const entry of fs.readdirSync(tilesDir)) {
        fs.rmSync(path.join(tilesDir, entry), { recursive: true, force: true });
      }
    }
    regions = [];
    download = null;
    return { cleared: true };
  }

  // Whether the HUB can reach the tile CDN — authoritative for the client's
  // "needs internet" gate (the browser being online proves nothing about the
  // laptop that actually does the downloading).
  async function checkConnectivity() {
    try {
      const url = TILE_URL.replace("{z}", "1").replace("{x}", "0").replace("{y}", "0");
      const res = await fetchImpl(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(4_000),
      });
      return { online: res.ok };
    } catch {
      return { online: false };
    }
  }

  return { getStatus, startDownload, clearAll, checkConnectivity };
}
