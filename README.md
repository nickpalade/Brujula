<img src="design/logo-animated.svg" width="96" align="right" alt="Brújula logo">

# Brújula — offline disaster-response coordination

An offline coordination agent for the first hours after a disaster, grounded
in the June 2026 Venezuela earthquakes. A laptop runs Ollama + Gemma + this
Node.js (Express) hub; field phones join the laptop's wifi hotspot and install
the field app straight from it. Reports go in as messy voice/text (any
language) — the agent parses, dedups, prioritizes, matches resources, and
proposes dispatches that a **human coordinator confirms**. Zero internet.

**After bootstrap, nothing touches the internet** (see "Offline audit").
Demo script: [DEMO.md](DEMO.md). Pipeline consolidation notes:
[CONSOLIDATION.md](CONSOLIDATION.md).

## 1. Bootstrap (one time, needs internet)

Installs Ollama, pulls the model (`gemma4:e4b`), starts + verifies the Ollama
server. Fails fast if Node < 22.5 (the store uses the built-in `node:sqlite`).

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File bootstrap.ps1
```

```bash
# macOS / Linux
bash bootstrap.sh          # or: make bootstrap
```

Node deps and the React app (one time):

```bash
npm install
cd app && npm install && npm run build && cd ..
```

## 2. Start the server

```bash
npm start                  # or: make serve
```

Startup prints the LAN URL to point phones at, e.g.:

```
  Point phones at:  http://192.168.137.1:8000
  Provider: ollama   Model: gemma4:e4b
```

(On a Windows hotspot the laptop is always `192.168.137.1`. Phones must be
joined to the laptop's hotspot.)

## 3. Verify end-to-end

With the server running (and the model warm — `POST /warmup` first):

```bash
npm run verify:hub         # the demo as 15 PASS/FAIL checks (/api stack)
npm run verify             # 3 sample reports through /parse-report (quick smoke)
npm run seed               # reset + reseed the demo board between runs
```

`verify:hub` replays the full PRD §7 flow: report → parse → dedup merge →
match → human confirm → field sync → advisory → sitrep. It tolerates slow
hardware (the hub acks fast and parses in background; the harness polls).

## The app — Command Post + Field client (the demo)

Everything is served from the one Express server; phones need ONE LAN URL.

```
                 ┌─────────────────── laptop (offline) ───────────────────┐
  field phones   │  Express :8000                                          │
  (hotspot)  ───►│   ├─ /field, /command  → built React app (app/dist)     │
                 │   ├─ /api/*            → hub (store.js + routes/hub.js)  │
                 │   │     POST /api/reports → parse→dedup→prioritize→match │
                 │   │       (server/pipeline/* → Ollama gemma4:e4b)        │
                 │   ├─ /api/advise       → routes/advise.js (proxy+local)  │
                 │   └─ data/hub.db       → SQLite store (survives restart) │
                 └────────────────────────────────────────────────────────┘
                                      │ optional, one env var
                                      ▼
                         Rares' knowledge-service :8100 (RARES_KB_URL)
```

- **`http://<lan-ip>:8000/command`** — Command Post (laptop, judges' screen):
  prioritized action feed, AI dispatch proposals with confirm/override,
  resource inventory, incident drawer with dedup evidence + protocol
  advisory, one-click SITREP.
- **`http://<lan-ip>:8000/field`** — Field client (phones). Installable:
  Safari/Chrome → **Add to Home Screen** → compass icon, opens fullscreen.

### Field app

- **Role signup on first open** — reporter / volunteer / specialized crew
  (rescue, medical, water, shelter, food, machinery). Volunteers and crews
  are registered on the hub (`POST /api/register`) **and become resources on
  the board**, so the matcher can propose dispatching them. Reporters just
  report; their reports carry `reported_by`.
- **Crew mission status** — one-tap Disponible / En camino / En el sitio /
  Regresando (`POST /api/crew-status`). Engaged crews (traveling/on-site) are
  excluded from matching *in code*; returning crews stay re-taskable and
  Gemma weighs them against fresh crews by distance. Location follows the
  mission (site while on-site/returning, base when idle) until phone GPS
  lands.
- **Store-and-forward outbox** — reports save locally first (QUEUED), flush
  when the hub is reachable (SYNCED), and show PARSED when the pipeline
  lands. Retries are idempotent (`client_ref`), so flaky radio can't
  duplicate reports.
- **Voice input** (es-VE speech recognition) and **photo triage** — 📷 Añadir
  foto attaches a camera/gallery photo (compressed on-device to ~100-250 KB so
  it fits the offline outbox; photo-only reports allowed). Multimodal Gemma
  reads damage/hazards/people from it — a photo can raise urgency or fill
  fields the text missed.

### The agent pipeline (the coordinator's brain)

Every `POST /api/reports` runs **parse → dedup → prioritize → match** against
the persistent board; **advise** and **sitrep** are served on demand:

1. **Parse** — Gemma extracts `{kind: need|resource|status, category,
   location, people_count, urgency, summary}` from text and/or photo.
2. **Dedup** — Gemma compares against open incidents and merges duplicates
   (ids are schema-locked to real board ids — it cannot hallucinate one; a
   category-compatibility backstop blocks nonsense merges).
3. **Prioritize** — deterministic ranking: urgency, people affected, waiting
   time. Explainable on purpose; zero model calls.
4. **Match** — Gemma proposes the best matchable resource for a need.
   Proposal only: nothing moves until the coordinator confirms.
5. **Advise** — protocol steps per incident type (INSARAG/USAR, START triage,
   Sphere WASH, PAHO shelter-disease), from Rares' knowledge-service when
   `RARES_KB_URL` is set, local KB otherwise.
6. **Sitrep** — plain-language situation report for shift handoff.

The hub **acks reports fast** (`REPORT_ACK_TIMEOUT_MS`, default 20 s) and
finishes slow parses in the background — phone requests never hang on a cold
CPU; incidents surface through `/api/sync` when ready.

### Hub API (`/api/*` — what the app consumes)

| Endpoint | What it does |
|---|---|
| `POST /api/reports` | `{text?, image_base64?, image_mime?, source_device?, lang?, client_ref?, reported_by?}` → `{report, incident\|null}` (idempotent by `client_ref`) |
| `GET /api/reports?ids=a,b` | report bodies (dedup evidence for the drawer); omit `ids` for all |
| `GET /api/incidents` | priority-ordered board |
| `POST /api/incidents/:id/dispatch` | `{dispatch_id, action: confirm\|override, resource_id?}` — the human-in-command step |
| `GET /api/resources` | inventory (seeded + registered volunteers/crews) |
| `POST /api/register` | field device signs up as reporter/volunteer/crew (upsert by `device_id`) |
| `GET /api/personnel` | the roster of registered devices |
| `POST /api/crew-status` | `{device_id, field_status: idle\|traveling\|on_site\|returning}` |
| `GET /api/sync?since=<seq>` | delta sync — the phones' poll loop |
| `POST /api/advise` | `{incident_type, context?}` → protocol advisory |
| `GET /api/sitrep` | generated situation report |

All responses use the envelope `{"success": bool, "data": ..., "error": ...}`.
JSON output is enforced with Ollama structured outputs (zod schema passed as
`format`), then validated again server-side.

> The legacy first-generation agent stack (`server/agent/*`, `POST /reports`)
> has been deleted; `/api` is the single pipeline. History and rationale:
> [CONSOLIDATION.md](CONSOLIDATION.md).

### The one env-var switch — protocol advisories (Rares' knowledge-service)

`POST /api/advise` is a **proxy-with-local-fallback** to `knowledge-service/`
(FastAPI, in this repo — `py -m uvicorn app:app --port 8100`):

| `RARES_KB_URL` | Behaviour |
|---|---|
| **unset** (default) | Serves the local offline KB (`server/kb/protocols.json`) — full USAR / triage / WASH / shelter-disease content. No internet, no 5xx. |
| `http://localhost:8100` | Proxies to the knowledge-service, normalizes his `{guidance, safety_flags, disclaimer, source_standards}` into our Advisory shape. Falls back to local automatically if unreachable. |

Alias `PROTOCOL_KB_URL` is also honoured. This one flag is the entire switch.

## Embedded Ollama — no Ollama app

Brujula owns the Ollama backend. On startup the server spawns a headless
`ollama serve` child process (and stops it on shutdown). The Ollama desktop
app is never opened; bootstrap removes its autostart shortcut.

## Test console + model management

Open the LAN URL root (`/`) in any browser: field-report test console (10+
languages), summary-language dropdown (20 languages), and a Models panel —
install/delete/switch models with live progress (persisted in
`brujula_config.json`).

## Language options

Reports can be written in **any language** — the model reads them as-is. The
one-sentence `summary` is generated in a configurable language: web console
dropdown, `POST /language-config {"language": "es"}`, or `BRUJULA_LANG=fr`.
Edit `SUPPORTED_LANGUAGES` in `server/config.js` to curate the list.

## CPU / GPU toggle

The status card in the web console has a **GPU | CPU** toggle (also
`POST /compute-config`; persisted). GPU mode lets Ollama offload all layers
that fit in VRAM; CPU mode forces `num_gpu: 0`. Switching evicts the loaded
runner, so the next parse pays a reload. `/health` reports `gpu_in_use`
measured from Ollama's `/api/ps` VRAM split — what is actually happening, not
just the setting. (Reference timings with gemma3:4b on an RTX 3060: ~3.4 s
per parse on GPU vs ~17 s on CPU; the bigger demo model is proportionally
slower.)

## Model-serving API (root endpoints)

| Endpoint | What it does |
|---|---|
| `GET /` | browser test console + model manager |
| `GET /health` | ok + active provider, model, Ollama reachability, `gpu_in_use` |
| `POST /warmup` | pre-load the model (do this before a demo); stays resident 60 min |
| `GET`/`POST /compute-config` | read / set CPU vs GPU mode |
| `GET`/`POST /language-config` | read / set the summary output language |
| `GET /models`, `/models/recommended` | installed / curated model lists |
| `POST /models/pull`, `GET /models/pull-status` | background download + progress |
| `DELETE /models/{name}`, `GET`/`POST /model-config` | remove / switch models |
| `POST /parse-report` | stateless one-shot parse (kept for the test console) |

The real demo pipeline (parse → dedup → prioritize → match → advise → emit)
runs under `/api/*` — see "Brújula app — Command Post + Field client" above
for the endpoint table and `npm run verify:hub` for the end-to-end acceptance
test.

All responses use the envelope `{"success": bool, "data": ..., "error": ...}`.
JSON output is enforced with Ollama structured outputs (the zod schema is
passed as `format`), then validated again server-side — malformed model
output returns a clean 502, never a crash.

## Switching the model

Web console → Models → **Use**, or `BRUJULA_MODEL=gemma3:12b`, or edit
`DEFAULT_MODEL` in `server/config.js` (default: `gemma4:e4b`). Resolution:
saved choice → env/default → any `gemma*` → first installed. Missing models
never crash the server.

## Switching to the cloud provider

```bash
set CLOUD_API_KEY=sk-ant-...        # PowerShell: $env:CLOUD_API_KEY="..."
npm start
```

Same endpoints, provider switches to the Anthropic API. Unset to go back to
local Ollama. **Leave unset in the field.**

## Offline audit

| Component | Internet? |
|---|---|
| bootstrap (Ollama install + model pull) | **Yes, once** |
| npm install (root + app) | **Yes, once** |
| Ollama inference | No — localhost only |
| Express hub + React app + field phones | No — LAN only |
| knowledge-service advisories | No — localhost only |
| verify scripts | No — talk to the local server |
| Cloud provider | **Yes — only if `CLOUD_API_KEY` is set. Leave unset in the field.** |

## Layout

```
bootstrap.ps1 / bootstrap.sh   # install + pull + verify Ollama (+ Node check)
DEMO.md                        # the 1-minute demo runbook (+ Q&A cut beats)
CONSOLIDATION.md               # why there were two stacks; agent/ now deleted
app/                           # React app: /command + /field (Vite → app/dist)
server/main.js                 # Express entry: model mgmt + routers + static
server/routes/hub.js           # /api/* hub (reports, dispatch, register, sync)
server/routes/advise.js        # /api/advise proxy + local KB fallback
server/pipeline/               # Gemma steps: parse/dedup/prioritize/match/sitrep
server/store.js                # SQLite board store (data/hub.db)
server/providers/              # ollama (default) | cloud (env-keyed)
knowledge-service/             # Rares' FastAPI protocol matcher (:8100)
design/                        # brand: tokens, logo SVGs (rings/compass/animated)
fixtures/ + scripts/seed.js    # demo board seeds (npm run seed)
verify-hub.js                  # THE acceptance test (npm run verify:hub)
verify.js                      # legacy /parse-report smoke test
```
