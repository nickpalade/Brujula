// Settings → Offline maps — pre-download map areas onto the hub laptop while
// it still has internet, Google-Maps-offline-areas style: a FIXED box sits on
// screen, you pan/zoom the map underneath it, and whatever is inside the box
// gets downloaded (zooms 11–16, same detail as the incident map).
//
// Demo-prep tooling, not the pitch: the coordinator downloads their region
// BEFORE going out to the disaster; in the field the hub serves those tiles at
// /tiles/{z}/{x}/{y}.png with zero network. Decisions locked with the team:
// laptop-only storage, fixed centered box, fixed zoom depth 11–16, live
// tile/MB estimate, 10k-tile safety cap (client disable + server 400),
// multiple areas kept as a list, Clear all (no per-area delete), and the
// Download button goes dark with a "needs internet" note when the hub can't
// reach the tile CDN.

import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import Button from '../shared/Button.jsx';
import Icon from '../shared/Icon.jsx';
import Badge from '../shared/Badge.jsx';
import {
  getTilesStatus,
  getTilesConnectivity,
  startTilesDownload,
  clearTiles,
} from './dataSource.js';

// Same defaults as the incident map / fetch-tiles script.
const DEFAULT_CENTER = [10.6, -66.93];
const DEFAULT_ZOOM = 12;
const ZOOM_MIN = 11; // download depth (fixed) — also the picker's floor
const ZOOM_MAX = 16;
const FALLBACK_MAX_TILES = 10_000;
const FALLBACK_EST_TILE_BYTES = 12 * 1024;
const POLL_MS = 1000;

// Live CARTO source for previewing areas we haven't downloaded yet (only
// reachable when the laptop is online — exactly when downloading works too).
// Offline, fall back to the hub's local tiles so the modal still shows
// something meaningful for already-downloaded areas.
const REMOTE_TILE_URL = 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png';
const LOCAL_TILE_URL = '/tiles/{z}/{x}/{y}.png';
const FALLBACK_TILE_URL = `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" fill="#121a16"/>
  <path d="M0 64H256M0 128H256M0 192H256M64 0V256M128 0V256M192 0V256" stroke="#26342d" stroke-width="1"/>
  <path d="M18 170C52 139 81 150 105 119C132 85 163 92 193 54M38 216C78 198 110 210 143 184C174 160 195 165 226 142" fill="none" stroke="#315443" stroke-width="7" stroke-linecap="round" opacity="0.65"/>
  <circle cx="105" cy="119" r="7" fill="#4ee0a2"/>
  <circle cx="193" cy="54" r="6" fill="#4ee0a2"/>
  <text x="128" y="132" text-anchor="middle" fill="#91a79b" font-family="Arial, sans-serif" font-size="13" font-weight="700">MAP PREVIEW</text>
  <text x="128" y="150" text-anchor="middle" fill="#72877b" font-family="Arial, sans-serif" font-size="11">tile unavailable</text>
</svg>
`)}`;

// Client-side slippy-map tile math for the live estimate (mirrors
// server/tiles.js — worth the ~10 duplicated lines to keep the preview
// instant instead of debouncing an estimate endpoint).
function lonToX(lon, z) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
function latToY(lat, z) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * 2 ** z);
}
function countTiles(bbox) {
  let total = 0;
  for (let z = ZOOM_MIN; z <= ZOOM_MAX; z += 1) {
    const n = 2 ** z;
    const clampT = (v) => Math.min(n - 1, Math.max(0, v));
    const x0 = clampT(lonToX(bbox[1], z));
    const x1 = clampT(lonToX(bbox[3], z));
    const y0 = clampT(latToY(bbox[2], z));
    const y1 = clampT(latToY(bbox[0], z));
    total += (x1 - x0 + 1) * (y1 - y0 + 1);
  }
  return total;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso ?? '';
  }
}

function OfflineMapsModal({ open, onClose }) {
  const containerRef = useRef(null);
  const boxRef = useRef(null);
  const mapRef = useRef(null);

  const [status, setStatus] = useState(null); // GET /api/tiles/status payload
  const [statusError, setStatusError] = useState(null);
  const [online, setOnline] = useState(null); // null = still checking
  const [estimate, setEstimate] = useState(null); // { bbox, tiles, bytes }
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);

  const maxTiles = status?.max_tiles ?? FALLBACK_MAX_TILES;
  const estTileBytes = status?.est_tile_bytes ?? FALLBACK_EST_TILE_BYTES;
  const download = status?.download;
  const downloading = download?.state === 'running';

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await getTilesStatus());
      setStatusError(null);
    } catch (e) {
      // No hub (mock-only dev or the server is down) — degrade to a readable
      // message; never crash the settings flow.
      setStatusError(e.message || 'offline maps unavailable');
    }
  }, []);

  // The estimate reads the fixed box's pixel corners and asks Leaflet what
  // lat/lon they sit over — whatever the user panned/zoomed to underneath.
  const recomputeEstimate = useCallback(() => {
    const map = mapRef.current;
    const boxEl = boxRef.current;
    const mapEl = containerRef.current;
    if (!map || !boxEl || !mapEl) return;
    const boxRect = boxEl.getBoundingClientRect();
    const mapRect = mapEl.getBoundingClientRect();
    const nw = map.containerPointToLatLng([boxRect.left - mapRect.left, boxRect.top - mapRect.top]);
    const se = map.containerPointToLatLng([boxRect.right - mapRect.left, boxRect.bottom - mapRect.top]);
    const bbox = [se.lat, nw.lng, nw.lat, se.lng]; // [minLat, minLon, maxLat, maxLon]
    const tiles = countTiles(bbox);
    setEstimate({ bbox, tiles, bytes: tiles * estTileBytes });
  }, [estTileBytes]);

  // Open → load status + connectivity, then build the picker map.
  useEffect(() => {
    if (!open) return undefined;
    setActionError(null);
    setOnline(null);
    setPreviewFailed(false);
    refreshStatus();

    let cancelled = false;
    (async () => {
      // navigator.onLine catches the obvious airplane-mode case instantly;
      // the hub's CDN probe is authoritative when reachable.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (!cancelled) setOnline(false);
        return;
      }
      try {
        const { online: hubOnline } = await getTilesConnectivity();
        if (!cancelled) setOnline(Boolean(hubOnline));
      } catch {
        if (!cancelled) setOnline(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, refreshStatus]);

  // Leaflet lifecycle — one map per open.
  useEffect(() => {
    if (!open || !containerRef.current || mapRef.current) return undefined;
    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      minZoom: 3, // roam anywhere to pick a new region…
      maxZoom: ZOOM_MAX, // …but never beyond the downloaded detail depth
      zoomControl: true,
      attributionControl: false,
    });
    map.on('moveend zoomend', recomputeEstimate);
    mapRef.current = map;
    // The modal has just laid out — Leaflet needs a size pass, then a first estimate.
    setTimeout(() => {
      map.invalidateSize();
      recomputeEstimate();
    }, 0);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [open, recomputeEstimate]);

  // Swap the base layer once we know whether the laptop can reach the CDN.
  // If tile images fail, Leaflet paints a local placeholder tile instead of a
  // white panel, so the fixed download box remains understandable.
  useEffect(() => {
    const map = mapRef.current;
    if (!open || !map || online === null) return undefined;
    setPreviewFailed(false);
    const tileUrl = online ? REMOTE_TILE_URL : LOCAL_TILE_URL;
    const layer = L.tileLayer(tileUrl, {
      minZoom: 3,
      maxZoom: ZOOM_MAX,
      errorTileUrl: FALLBACK_TILE_URL,
      crossOrigin: tileUrl.startsWith('https://') ? true : false,
    });
    const markFailed = () => setPreviewFailed(true);
    layer.on('tileerror', markFailed);
    layer.addTo(map);
    return () => {
      layer.off('tileerror', markFailed);
      layer.remove();
    };
  }, [open, online]);

  // While a download runs, poll status so the progress bar moves.
  useEffect(() => {
    if (!open || !downloading) return undefined;
    const id = setInterval(refreshStatus, POLL_MS);
    return () => clearInterval(id);
  }, [open, downloading, refreshStatus]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const overCap = estimate ? estimate.tiles > maxTiles : false;
  const canDownload = Boolean(online) && !downloading && estimate && !overCap && !busy && !statusError;

  const handleDownload = async () => {
    if (!estimate) return;
    setBusy(true);
    setActionError(null);
    try {
      await startTilesDownload(estimate.bbox.map((v) => Number(v.toFixed(5))));
      await refreshStatus();
    } catch (e) {
      setActionError(e.message || 'download failed');
    } finally {
      setBusy(false);
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm('Delete ALL downloaded map areas from this laptop?')) return;
    setBusy(true);
    setActionError(null);
    try {
      await clearTiles();
      await refreshStatus();
    } catch (e) {
      setActionError(e.message || 'clear failed');
    } finally {
      setBusy(false);
    }
  };

  const regions = status?.regions ?? [];
  const totals = status?.totals ?? { tiles: 0, bytes: 0 };

  return (
    <div className="cmd-modal-scrim" onClick={onClose}>
      <div
        className="cmd-modal cmd-offline"
        role="dialog"
        aria-modal="true"
        aria-label="Offline maps"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="cmd-modal__head">
          <span className="bru-panel__title">
            <Icon name="map" />
            Offline maps
          </span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <Icon name="close" />
            Close
          </Button>
        </header>

        <div className="cmd-modal__body cmd-offline__body">
          <p className="cmd-offline__lead">
            Download the map of your operating area <strong>before going out to the disaster</strong>.
            Pan and zoom until the box covers the area — everything inside it is saved on this
            laptop (zoom {ZOOM_MIN}–{ZOOM_MAX}) and served to phones with zero internet.
          </p>

          {online === false && (
            <div className="cmd-offline__warn" data-testid="offline-warning">
              <strong>Needs internet.</strong> The hub can't reach the map tile server right now,
              so new areas can't be downloaded. Already-downloaded areas below keep working offline.
            </div>
          )}

          <div className="cmd-offline__picker">
            <div ref={containerRef} className="cmd-offline__canvas" />
            {previewFailed && (
              <div className="cmd-offline__preview-note" data-testid="offline-map-preview-fallback">
                Map preview is using placeholder tiles. Check internet before downloading.
              </div>
            )}
            <div ref={boxRef} className="cmd-offline__box" aria-hidden="true">
              <span className="cmd-offline__box-tag">DOWNLOAD AREA</span>
            </div>
          </div>

          <div className="cmd-offline__estimate">
            {estimate && (
              <span className={overCap ? 'cmd-offline__est-over' : ''}>
                ~{estimate.tiles.toLocaleString()} tiles · ~{formatBytes(estimate.bytes)}
                {overCap && (
                  <em>
                    {' '}
                    — over the {maxTiles.toLocaleString()}-tile cap, zoom in to a smaller area
                  </em>
                )}
              </span>
            )}
            <Button
              variant="primary"
              size="sm"
              disabled={!canDownload}
              onClick={handleDownload}
              title={
                online === false
                  ? 'Needs internet'
                  : overCap
                    ? 'Area too large'
                    : 'Download the boxed area to this laptop'
              }
            >
              <Icon name="download" />
              {downloading ? 'Downloading…' : 'Download this area'}
            </Button>
          </div>

          {downloading && (
            <div className="cmd-offline__progress" data-testid="tiles-progress">
              <div className="cmd-offline__progress-track">
                <div
                  className="cmd-offline__progress-fill"
                  style={{ width: `${Math.round((download.done / Math.max(1, download.total)) * 100)}%` }}
                />
              </div>
              <span>
                {download.done.toLocaleString()} / {download.total.toLocaleString()} tiles
              </span>
            </div>
          )}
          {download?.state === 'error' && (
            <div className="cmd-offline__warn">Download failed: {download.error}</div>
          )}
          {actionError && <div className="cmd-offline__warn">{actionError}</div>}

          <div className="cmd-offline__areas">
            <div className="cmd-offline__areas-head">
              <span className="cmd-settings__section-title">Downloaded areas</span>
              {regions.length > 0 && (
                <Badge variant="muted">
                  {totals.tiles.toLocaleString()} tiles · {formatBytes(totals.bytes)}
                </Badge>
              )}
            </div>

            {statusError ? (
              <div className="bru-empty">
                <span>Offline maps status unavailable ({statusError}).</span>
              </div>
            ) : regions.length === 0 ? (
              <div className="bru-empty">
                <span>No areas downloaded yet. The incident map only shows downloaded areas.</span>
              </div>
            ) : (
              <ul className="cmd-offline__list">
                {regions.map((r) => (
                  <li key={r.id} className="cmd-offline__area">
                    <div className="cmd-offline__area-main">
                      <span className="cmd-offline__area-name">{r.name}</span>
                      <span className="bru-meta">
                        {(r.tiles ?? 0).toLocaleString()} tiles · {formatBytes(r.bytes)} ·{' '}
                        {formatDate(r.created_at)}
                      </span>
                    </div>
                    <Badge variant="ok" dot>
                      on disk
                    </Badge>
                  </li>
                ))}
              </ul>
            )}

            {regions.length > 0 && (
              <Button
                variant="danger"
                size="sm"
                disabled={busy || downloading}
                onClick={handleClearAll}
              >
                <Icon name="trash" />
                Clear all downloaded maps
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default OfflineMapsModal;
