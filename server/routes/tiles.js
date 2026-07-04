import express from "express";

import { TilesError } from "../tiles.js";

// Offline map tiles REST surface (Settings → Offline maps). A factory rather
// than a singleton router so tests can mount it over a temp dir with a fake
// fetch — main.js passes the real service bound to data/tiles/.
//
//   GET    /api/tiles/status        → zooms, cap, regions list, totals, in-flight download
//   GET    /api/tiles/connectivity  → { online } — can the HUB reach the tile CDN?
//   POST   /api/tiles/download      → { bbox:[minLat,minLon,maxLat,maxLon], name? }
//                                     400 bad bbox / over the tile cap, 409 already running
//   DELETE /api/tiles               → wipe all downloaded tiles + the areas registry
//                                     409 while a download runs

function envelope(res, { data = null, error = null, status = 200 } = {}) {
  res.status(status).json({ success: error === null, data, error });
}

export function createTilesRouter(service) {
  const router = express.Router();

  router.get("/api/tiles/status", (req, res) => {
    envelope(res, { data: service.getStatus() });
  });

  router.get("/api/tiles/connectivity", async (req, res) => {
    envelope(res, { data: await service.checkConnectivity() });
  });

  router.post("/api/tiles/download", (req, res) => {
    const { bbox, name } = req.body ?? {};
    try {
      envelope(res, { data: { download: service.startDownload(bbox, name) } });
    } catch (err) {
      if (err instanceof TilesError) {
        return envelope(res, { error: err.message, status: err.status });
      }
      throw err;
    }
  });

  router.delete("/api/tiles", (req, res) => {
    try {
      envelope(res, { data: service.clearAll() });
    } catch (err) {
      if (err instanceof TilesError) {
        return envelope(res, { error: err.message, status: err.status });
      }
      throw err;
    }
  });

  return router;
}
