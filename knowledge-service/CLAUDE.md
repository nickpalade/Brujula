# CLAUDE.md — Knowledge Service (`/knowledge-service`)

> **Read this first, then `PRD-Brujula.md` for background.** This file is your marching orders. The PRD is the whole team's plan; **you only build the module described here.**

---

## What this module is

The **offline protocol knowledge base** for Brújula, an offline disaster-response coordinator (Venezuela earthquake scenario). The main app reads messy field reports and matches needs to resources. **This service is the "field-manual brain":** given a situation, it returns the correct humanitarian response procedure (search-and-rescue, casualty triage, water/sanitation, disease control).

It is a **standalone HTTP service** with **zero shared code** with the rest of the project. It must be **fully offline** and **non-blocking**: if it is late or broken, the core demo still works.

**Owner:** Rares (remote). **Build window:** Sat → Sun.

---

## Hard rules (do not violate)

1. **Offline only.** No network calls at runtime. All knowledge is baked into local files. It must run in airplane mode.
2. **Stay in your lane.** Only create/edit files inside `/knowledge-service`. Never touch `/agent`, `/browser`, `/ui`, or any other folder.
3. **Operational guidance only — never patient diagnosis or treatment.** Content is procedural guidance for *trained responders*, sourced from humanitarian standards. No "give the patient X" advice. This keeps the project clear of the banned "medical advice bot" category.
4. **Paraphrase sources; do not paste copyrighted handbook text.** Summarize protocols in our own words and cite the standard by name (e.g. "INSARAG", "Sphere Handbook", "WHO/PAHO"). No long verbatim excerpts.
5. **Keep it simple.** Plain JSON files + FastAPI. No database server, no graph DB, no heavy frameworks. Deterministic retrieval, not model inference.
6. **Mock first.** Ship the mock (see below) before the real logic, so the integration lead (Pepe) is never blocked.

---

## The interface contract (keep this stable)

This is the only thing the rest of the team depends on. If it must change, flag it to Pepe immediately.

### `POST /advise`

**Request:**
```json
{
  "incident_type": "structural_collapse",
  "needs": ["heavy_lifting", "medical"],
  "context": {
    "signs_of_life": true,
    "casualty_count": 6,
    "hazards": ["gas_leak_suspected"],
    "location_label": "Calle Sucre blue building",
    "notes": "knocking heard inside"
  }
}
```
- `incident_type` — one of: `structural_collapse`, `casualty_triage`, `water_sanitation`, `shelter_disease`, `flood`, `fire`, `other`.
- `needs`, `context` — best-effort tags/fields. **Matching must be forgiving:** if `incident_type` is unknown or missing, fall back to keyword-matching on `needs`/`notes`, and if nothing matches, return `incident_type: "other"` with general size-up guidance rather than an error.

**Response:**
```json
{
  "incident_type": "structural_collapse",
  "guidance": [
    {
      "step": 1,
      "action": "Establish a safe perimeter; assess structural stability before any entry.",
      "priority": "critical",
      "rationale": "Size-up precedes entry to prevent responder casualties.",
      "source": "INSARAG USAR"
    }
  ],
  "safety_flags": ["Do not enter unshored voids", "Isolate suspected gas before powered tools"],
  "disclaimer": "Operational guidance for trained responders. Not medical diagnosis or treatment advice.",
  "source_standards": ["INSARAG", "Sphere Handbook", "WHO/PAHO"]
}
```
- `priority` — one of: `critical`, `high`, `routine`.
- `disclaimer` — always present, always this line.

### `GET /health`
Returns `{"status": "ok"}`. Used to prove the service is up.

### `GET /protocols` (optional, nice-to-have)
Lists which `incident_type`s are covered, so the team can see coverage at a glance.

---

## Knowledge content to author

Four domains, each stored as its own JSON file under `data/`, loaded at startup. Each entry: a short, ordered list of operational steps with `priority`, `rationale`, and `source`. Keep entries concise and action-first.

1. **`data/usar.json` — Urban Search & Rescue** (`structural_collapse`): size-up before entry, hazard isolation (gas/electric), void search, extrication priority by signs of life, structure marking. *Source: INSARAG.*
2. **`data/triage.json` — Casualty triage** (`casualty_triage`): START/SALT sorting into immediate / delayed / minor / expectant. **Sorting only — no treatment steps.** *Source: START / SALT.*
3. **`data/wash.json` — Water & sanitation** (`water_sanitation`): minimum safe water quantity per person/day, making water potable (boiling / chlorination ratios), latrine siting distance from water sources. *Source: Sphere Handbook.*
4. **`data/disease.json` — Shelter & disease control** (`shelter_disease`): crowding thresholds, measles vaccination priority in shelters, diarrhoeal/cholera prevention, basic isolation. *Source: WHO/PAHO, Sphere.*

---

## Mock-first workflow (do this before real logic)

1. Create `mock/advise_examples.json` — 4 canned `POST /advise` responses (one per domain) that exactly match the contract above.
2. Make sure a static/mocked version of `/advise` can return these immediately.
3. **Hand this file to Pepe first thing** so he can integrate against it while you build the real service.

---

## Suggested repo layout

```
/knowledge-service
  CLAUDE.md              (this file)
  PRD-Brujula.md         (background)
  README.md              (how to run)
  app.py                 (FastAPI: /advise, /health, /protocols)
  matcher.py             (situation -> guidance lookup)
  data/                  (usar / triage / wash / disease .json)
  mock/advise_examples.json
  tests/test_advise.py
  requirements.txt
```

## Tech stack
- Python 3.11+, FastAPI, uvicorn. Data as local JSON loaded at startup. No runtime network calls. (Gemma is the **main app's** job, not this module — keep retrieval deterministic so it's fast and reliable.)

## How to run / test
- `pip install -r requirements.txt`
- `uvicorn app:app --port 8100`
- Smoke test: `curl -X POST localhost:8100/advise -H "Content-Type: application/json" -d @mock/advise_examples.json`
- **Then turn wifi off and confirm it still answers.** That's the acceptance test.

---

## Definition of done
- [x] `POST /advise` returns correct structured guidance for all four `incident_type`s, with a forgiving fallback to `other`.
- [x] Runs in **airplane mode** — zero network calls (verified statically + over loopback; the literal wifi-off run is the one manual step left — see below).
- [x] All four domains covered in `data/`, paraphrased with named sources.
- [x] Mock JSON delivered to Pepe (committed to the shared repo day 1; kept as his integration fixture).
- [x] Safety disclaimer on every response; no diagnosis/treatment content anywhere (enforced by a test).
- [x] `GET /health` works.

---

## Current state

_**The real service is built, verified, AND merged to `main`.** All five day-1 checklist items done. `pytest` green (31/31), served live on `:8100`, zero runtime network calls. Merged into `main` via a `rares → main` merge (add/add conflicts resolved in favour of the real version; merge touched `knowledge-service/` only). This module is effectively **done** — see "Wider repo & integration (session handoff)" at the bottom for how it plugs into the rest of Brújula._

### Done (day 2)
- **`data/` protocol content authored** — all four domains, paraphrased with per-step named sources, operational-only:
  - `usar.json` (`structural_collapse`, INSARAG): size-up, utility isolation, occupant intel, hail/silence search, shoring, extrication priority, worksite marking.
  - `triage.json` (`casualty_triage`, START/SALT): global sort, wave sort, RPM assessment, category tagging, expectant policy, continuous re-triage. **Sorting only — zero treatment steps** (enforced by a test).
  - `wash.json` (`water_sanitation`, Sphere/WHO): 15 L/p/d, boiling/chlorination + turbidity caveat, latrine siting (30 m / 1.5 m / downhill), latrine ratios, handwashing, safe storage.
  - `disease.json` (`shelter_disease`, WHO/PAHO + Sphere): measles vaccination priority, crowding (≥3.5 m²/person), cohort isolation, faecal-oral barriers, daily surveillance tally, dignified dead-body management (anti-myth).
  - Each file also carries a `keywords` list (English + Spanish) powering the fallback matcher.
- **`matcher.py` is real** — loads/validates `data/*.json` once at import (malformed file → logged + skipped, service stays up). `match()` is forgiving and never raises: exact `incident_type` (case/accent/separator-insensitive) → keyword score over `needs` + `context.notes` (accent-stripped, word-boundary, ties break life-rescue-first) → `other` size-up fallback. Responses are deep-copied; `matched_by` (`exact`/`keywords`/`fallback`) is an **additive** debug field on top of the contract.
- **`app.py` wired to the matcher** — mock lookup removed; `/protocols` now reflects what actually loaded from `data/`. Request model accepts any shape (loose `Any` fields + `extra="allow"`) so even type-mangled payloads reach the forgiving matcher instead of 422ing. `DISCLAIMER` re-exported from `matcher` for back-compat.
- **Real tests** (`tests/test_advise.py`, 31 green): four-domain contract shape (ordered steps, valid priorities, non-empty action/rationale/source), per-domain named standards, keyword fallback incl. Spanish/accented notes and `needs`-as-string, `other` fallback cases, exact-beats-keywords precedence, disclaimer + non-empty `safety_flags` on every response, and a forbidden-terms sweep (no treatment/diagnosis language in authored content).
- **Verified live** — `uvicorn app:app --port 8100`: `/health`, `/protocols`, exact + keyword (UTF-8 Spanish) + fallback matches all confirmed over the wire. No network libraries imported anywhere in runtime code.
- **Env note:** this machine runs it via a local venv (`py -3.12 -m venv .venv`, gitignored) because the system Python lacks the deps. `mock/advise_examples.json` is unchanged — still Pepe's fixture, just no longer served.

### Remaining (all optional — nothing blocks the demo)
- **The literal airplane-mode run** — flip wifi off and hit `/advise` once (loopback needs no wifi; expected to just work). Ceremonial only; already proven offline statically + over loopback.
- Optional polish, only if time allows: more Spanish keywords from real field-report samples; a couple of `flood`/`fire`-specific keyword entries if the team wants those types routed somewhere other than `other`.

---

## Wider repo & integration (session handoff)

_Written at the end of the merge session so a fresh session (incl. in Cursor) knows exactly where things stand. Everything below is about how this module fits the whole **Brújula** project; the module itself is done._

### Where this service sits in the system
- **Repo:** `github.com/nickpalade/Brujula`. Canonical branch is **`main`** (this service is already merged there). The team pushes straight to `main`; work is fast-moving.
- **This service is the OPTIONAL protocol brain.** The backend already ships its own local copy of the protocols, so the demo never depends on this box being up.
- **Integration point:** the Node backend's **`POST /api/advise`** ([`server/routes/advise.js`](../server/routes/advise.js)) is a **proxy-with-local-fallback**:
  - Env **`RARES_KB_URL`** (alias **`PROTOCOL_KB_URL`**) **set to `http://localhost:8100`** → backend proxies to THIS service and normalizes our `{guidance, safety_flags, disclaimer, source_standards}` into its Advisory shape.
  - **Unset (default)** → backend serves its own local KB (`server/kb/protocols.json`). It also **auto-falls-back to local if this service is unreachable**, so this service can never break the demo.
  - The demo runbook ([`DEMO.md`](../DEMO.md)) sets that env var, i.e. the demo is *intended* to run this real service.
- **Contract still stable:** `POST /advise`, `GET /health`, `GET /protocols` exactly as documented above. `advise.js` depends on the response shape — don't change it without flagging the team.

### How to run / test this module (Windows, PowerShell)
- A local **venv already exists** at `knowledge-service/.venv` (gitignored, created with `py -3.12`). **The system Python is 3.14 and lacks the deps — always use the venv.**
- Serve: `` .venv/Scripts/python -m uvicorn app:app --port 8100 ``
- Test: `` .venv/Scripts/python -m pytest -q `` (expect **31 passed**).
- If the venv is ever gone: `py -3.12 -m venv .venv && .venv/Scripts/python -m pip install -r requirements.txt`.

### Rest-of-repo context (so a new session isn't surprised)
- **One canonical backend stack now.** The old duplicate `server/agent/*` stack was **deleted** (see [`CONSOLIDATION.md`](../CONSOLIDATION.md)); the live stack is `/api/*` = `server/routes/hub.js` + `server/store.js` (**SQLite** at `data/hub.db`, via Node's built-in `node:sqlite`) + `server/pipeline/*` (Gemma: parse → dedup → prioritize → match → sitrep).
- **Requires Node ≥ 22.5** (for `node:sqlite`). Model is **`gemma4:e4b`**, served by an embedded Ollama the server spawns itself.
- **Full-system acceptance test is `npm run verify:hub`** (needs the Gemma model loaded → realistically run on the **GPU demo laptop**, not the remote dev machine). Fast model-free backend tests are **`npm test`** (node:test, repo root — covers geocoding/GPS/map data/tiles/tile-downloads; **51** green). This module's own `pytest` is fully runnable anywhere.
- Read [`README.md`](../README.md) + [`CONSOLIDATION.md`](../CONSOLIDATION.md) for the whole picture — both current and accurate (the previously-stale README line about the legacy `agent/` stack has been corrected).
- **Owner context:** Rares (this module) works remote; Ceco owns the SQLite store/backend consolidation, Pepe (José María) leads integration, Nick has the GPU demo laptop.

---

## GPS + offline incident map (built by Rares under a lane exemption, Jul 4 PM)

_The team asked for this via voice note and explicitly cleared working outside `/knowledge-service` for it. It touches `app/`, `server/`, `scripts/`, `fixtures/`, `tests/` — the knowledge-service itself is untouched and still done. Full user-facing docs are in [`README.md`](../README.md) ("Offline incident map"); this section is what the next agent needs._

### What it is
1. **Field app GPS**: composing a report requests phone location (best-effort) and sends additive `lat`/`lon`/`accuracy` on `POST /api/reports`. Browsers block geolocation on plain-HTTP LAN origins, so on demo phones this usually silently no-ops — by design.
2. **Offline gazetteer fallback** ([`server/geocode.js`](../server/geocode.js) + [`fixtures/gazetteer.json`](../fixtures/gazetteer.json)): ~17 Vargas-coast place names → coords. When an incident is created/merged, its pin resolves **report GPS → gazetteer(parsed `location` label) → none**. Matching is accent/case-insensitive, whole-word, longest-name-wins (same forgiving philosophy as this module's matcher). Dedup merges never move an existing pin.
3. **Command Post map** ([`app/src/command/MapPanel.jsx`](../app/src/command/MapPanel.jsx)): plain Leaflet (no react-leaflet), urgency-colored circle markers, popup + click-through to the incident drawer, "N sin ubicación" badge, collapsible, panning clamped to the downloaded region.
4. **Pre-downloaded tiles** ([`scripts/fetch-tiles.mjs`](../scripts/fetch-tiles.mjs), `npm run fetch:tiles`): one-time online step (like the bootstrap model pull) → `data/tiles/{z}/{x}/{y}.png` (gitignored, ~4k tiles / ~6 MB, zooms 11–16), served offline by Express at `/tiles/*`. **Tile source is CARTO's dark basemap — NOT tile.openstreetmap.org** (OSM blocks bulk downloads mid-fetch; learned the hard way). Region/zoom/source overridable via `TILES_BBOX` / `TILES_ZOOM` / `TILES_URL`.
5. **Settings → Offline maps download UI** (added Jul 4 evening, same lane exemption; team feedback: "pre-download button… like Google Maps offline areas"). In the Command Post settings menu (the teammate's `CommandSettings.jsx` panel — it existed on main, so the feature lives there as a "Offline maps" entry opening [`app/src/command/OfflineMapsModal.jsx`](../app/src/command/OfflineMapsModal.jsx)). Locked decisions: **laptop-only storage** (phones consume via hotspot), **fixed centered box** you pan/zoom under (not a draggable rect), **zooms fixed 11–16**, live **~tiles/~MB estimate** before downloading, **10,000-tile cap** enforced client-side (disabled button + message) AND server-side (400), **multiple areas as a list + Clear all** (no per-area delete), and **offline ⇒ Download disabled** with a "needs internet" note (the hub probes the CDN itself via `/api/tiles/connectivity`; `navigator.onLine` is only the fast-path check). Server side: [`server/tiles.js`](../server/tiles.js) (slippy math + download manager, reuses the CLI script's CARTO source/skip-existing/concurrency approach) + [`server/routes/tiles.js`](../server/routes/tiles.js) mounting `GET /api/tiles/status`, `GET /api/tiles/connectivity`, `POST /api/tiles/download` (`{bbox:[minLat,minLon,maxLat,maxLon], name?}`; 400 bad-bbox/over-cap, 409 while running), `DELETE /api/tiles` (wipe tiles + registry; 409 while running). The areas registry persists at `data/tiles/areas.json` (bbox, tile count, real bytes, timestamp) so the list survives restarts. The CLI script still works and shares the same tile tree. Verified Jul 4: lint clean, build green, `npm test` 51/51, Playwright E2E 23/23 (incl. a new offline-maps test that proves the modal degrades gracefully in mock mode).

### Contract changes (flagged, additive only)
- `POST /api/reports` accepts optional `lat`/`lon`/`accuracy`. **Forgiving:** mangled/out-of-range values are `.catch`-ed to null by the zod schema — never a 422/400 for bad GPS; a lone `lat` without `lon` is stored as no fix. Reports and incidents now carry `lat`/`lon` (null when unlocated) through `/api/incidents`, `/api/sync`, `/api/reports`.
- Nothing about THIS module's `/advise` contract changed.

### Data invariants
- `fixtures/seed_incidents.json` + `seed_resources.json` entries all carry `lat`/`lon` (a test enforces it).
- Every gazetteer coordinate must stay inside the tile bbox `10.50,-67.12 → 10.70,-66.68` (a test enforces it). If the scenario region moves: update gazetteer + seeds + `TILES_BBOX` + `REGION_BOUNDS` in `MapPanel.jsx`, then re-run `npm run fetch:tiles`.

### Tests (`npm test`, repo root, no model/Ollama needed — 51 passing)
- `tests/geocode.test.mjs` — gazetteer matching incl. accents, whole-word, specificity, junk inputs.
- `tests/hub-coords.test.mjs` — `resolveCoords` precedence + `mergeReportIntoIncident` (first-pin-wins, urgency/people/location raising intact). These are exported from `hub.js` for tests.
- `tests/store-coords.test.mjs` — SQLite persistence + seeds carry coords.
- `tests/reports-endpoint.test.mjs` — over-the-wire `/api/reports` GPS handling (valid/mangled/half/replay). Endpoint tests assert on the stored **report** (incident stays null without Gemma — that's the hub's graceful degradation, not a failure).
- `tests/tiles-static.test.mjs` — `/tiles/{z}/{x}/{y}.png` serves prefetched PNGs, 404s cleanly when missing.
- `tests/tiles-download.test.mjs` — Settings → Offline maps backend: slippy math against the known-good reference tile, the 10k-tile cap 400, malformed-bbox 400s, full download lifecycle over a temp dir with a stubbed fetch (zero network), skip-existing resume, 409s while running, registry restart survival, clear-all, connectivity probe.
- Tests write through the real `data/hub.db` and reset it (≡ `npm run seed`) — hence `--test-concurrency=1` in the npm script. Don't run them mid-demo.

### Deploy checklist for the demo laptop (delta only)
- Download the operating area once with internet: **Command Post → Settings → Offline maps** (or `npm run fetch:tiles`); `cd app && npm run build` to pick up the map UI. Everything else is unchanged.
