/*
 * Command Post data source — the single swap point for INTEGRATION.
 *
 * Right now it's backed by the local mock (mockApi.js) because FIELD-UI's
 * shared/api.js isn't wired to the hub yet. Every component imports data
 * ONLY from here, never from mockApi.js directly.
 *
 * INTEGRATION — to go live, this is the "one-line switch":
 *   1. set USE_MOCKS = false, and
 *   2. ensure ../shared/api.js exports the same function names below
 *      (getSync, getIncidents, getResources, getSitrep, advise,
 *       submitReport, confirmDispatch, getReports).
 *   If names differ, adapt them here only — no component changes needed.
 */
import * as mock from './mockApi.js';
// INTEGRATION (2026-07-04): shared/api.js is live and exports the same names.
import * as api from '../shared/api.js';

// Live by default. Set VITE_USE_MOCKS=true to force the offline mock board back on.
export const USE_MOCKS = api.USE_MOCKS;

const backend = USE_MOCKS ? mock : api;

export const {
  getSync,
  getIncidents,
  getResources,
  getSitrep,
  advise,
  submitReport,
  confirmDispatch,
  getReports,
  getLanguageConfig,
  setLanguageConfig,
  getAlerts,
  createAlert,
  deactivateAlert,
  patchIncident,
  rematchIncident,
  patchResource,
  getPersons,
  setDispatchStatus,
  getTrends,
} = backend;

// Offline map tiles (Settings → Offline maps). These live in shared/api.js
// only — it self-mocks on USE_MOCKS, so they work in both modes without a
// duplicate in mockApi.js.
export const {
  getTilesStatus,
  getTilesConnectivity,
  startTilesDownload,
  clearTiles,
} = api;
