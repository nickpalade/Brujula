<img src="design/logo-animated.svg" width="96" align="right" alt="Brújula logo">

# Brújula — offline disaster-response coordination

**RAISE Summit Hackathon 2026 · Google DeepMind Remote (Edge / On-Device Gemma)**  
**Repo:** [github.com/nickpalade/Brujula](https://github.com/nickpalade/Brujula) (public, built during the event)  
**Team (remote, 4):** Pepe / José María (AI agent + integration), Ceco (hub backend + offline sync), Nick (shared React frontend — laptop + mobile), Rares (offline protocol knowledge base)

Grounded in the June 2026 Venezuela earthquakes (M7.2 + M7.5, La Guaira / Caracas corridor). When the network is down, cloud AI is unreachable — Brújula is the **coordinator's brain on local hardware**: messy field reports in, structured incidents and dispatch proposals out, with a human confirming every action.

---

## Submission at a glance

| Requirement | How Brújula meets it |
|---|---|
| **Track** | Google DeepMind **Remote** — Gemma runs **locally on the command-post laptop** via Ollama (`gemma3n:e4b` default). Offline, privacy-first inference is load-bearing, not optional. |
| **Open source** | Public repo, Apache-2.0 Gemma models. |
| **New work only** | Built Sat 11:30 → Sun 12:00. No pre-existing product repackaged. |
| **Not a banned category** | Not basic RAG, Streamlit, medical-advice bot, or "dashboard as the product." A **multi-step Gemma agent** plans, retrieves context, calls tools, and proposes outcomes; views (feed, graph, map) are **windows onto agent output**. |
| **Demo video** | ≤1 min total for judges. Structure below. |
| **What judges should see as ours** | Gemma pipeline (parse → dedup → prioritize → match → advise → emit), offline LAN sync, field store-and-forward, human confirm/override, protocol KB integration, command graph with Gemma as the central brain node, contextual chat that proposes board changes. |

**Submit:** [Cerebral Valley submission form](https://cerebralvalley.ai/e/raise-summit-hackathon/hackathon/submit) — demo video (YouTube/Loom) + this repo + short description.

---

## Why Gemma is the brain (track argument)

Brújula is not "a form with AI sprinkled on top." **Gemma is the reasoning core** — every messy report passes through a multi-step workflow before a human ever sees a dispatch card.

1. **Offline is mandatory.** In the disaster zone, connectivity is down or saturated. A cloud model fails exactly when the tool matters. Gemma on the command-post laptop produces outputs regardless of network status.
2. **Privacy is mandatory.** Reports contain missing-person identities, medical status, and locations of vulnerable people. Routing that through a foreign cloud is unacceptable. On-device inference keeps sensitive data in the command post.
3. **Structured agency, not one-shot RAG.** The pipeline **plans** (parse → compare board → rank → match), **retrieves** when needed (open incidents for dedup, resource inventory for match, protocol KB for advise), **calls tools** (geocoder, KB HTTP, board store), and **emits** proposals the coordinator confirms. That is an agent workflow, not retrieve-then-answer.

In the **command graph** (`/command/graph`), Gemma is literally the central **brain node**: reports connect in, incidents and dispatches connect out. The operator inspects any node, asks Gemma contextual questions, and applies one-click graph mutations Gemma proposes — always with human review.

**Model:** `gemma3n:e4b` (QAT, multimodal text + vision) via **Ollama** on the hub laptop. Research brief: [GEMMA.md](GEMMA.md). Product spec: [PRD-Brujula.md](PRD-Brujula.md).

---

## Gemma agent workflow

Each `POST /api/reports` triggers the pipeline in `server/pipeline/`. Steps 1–4 run on ingest; advise and sitrep are on demand.

```
raw report (voice/text/photo, any language)
   │
   1. PARSE ─────► structured record + persons registry
   │              (Gemma extraction; JSON schema enforced)
   2. DEDUP ─────► same incident as an existing one? merge if so
   │              (Gemma compares digests; ids enum-locked to real board)
   3. PRIORITIZE ► deterministic rank (urgency × people × age)
   │              (0 model calls — fast, explainable, never throws)
   4. MATCH ──────► best available resource for a need
   │              (Gemma reasons over inventory + distance; proposal only)
   5. ADVISE ─────► protocol steps for incident type
   │              (local KB or Rares' knowledge-service — retrieval as ONE tool)
   6. EMIT ───────► dispatch card + graph nodes for CONFIRM / OVERRIDE
```

**Human in command:** nothing dispatches until the coordinator confirms or overrides. Proposed dispatches show a gold accent on the graph; an approval bar surfaces pending items without hunting the board.

**Graceful degradation:** if Gemma fails mid-pipeline (except parse), the hub stores the report and keeps the board working — no 5xx to field phones. Parse failures mark the report `pending` for retry.

**Chat brain (command post):** `POST /api/chat` grounds answers in the live board + offline KB. On the command station, Gemma may attach `proposed_actions` (edit incident, create alert, update resource) — each re-validated server-side and applied only when the operator clicks **Apply**.

**Field assistant:** `POST /api/ask` — grounded Q&A for responders; cannot dispatch or mutate the board.

---

## JSON schemas (Gemma structured output)

All pipeline steps use Ollama `format: <json_schema>` plus server-side Zod re-validation. Malformed output retries once, then falls back — never crashes the hub.

### 1. PARSE (`server/pipeline/schemas.js`)

```json
{
  "kind": "need | resource | status",
  "category": "rescue | medical | water | shelter | food | machinery | hazard | status",
  "location": "string | null",
  "people_count": "integer | null",
  "urgency": "critical | high | medium | low",
  "resource_label": "string | null",
  "summary": "one board line in configured language",
  "persons": [{ "name": "string", "status": "missing|found|safe", "detail": "string|null" }]
}
```

Multimodal: optional `image_base64` on the report; image goes to parse only — **never persisted**.

### 2. DEDUP

```json
{
  "matching_incident_id": "<enum: open incident ids> | null",
  "confidence": 0.0–1.0,
  "reason": "string"
}
```

`matching_incident_id` is **enum-locked** to real board ids (model cannot hallucinate). Server derives `is_duplicate` and applies a **category-compatibility backstop** (e.g. rescue ↔ machinery merges allowed; unrelated categories blocked).

### 3. MATCH

```json
{
  "resource_id": "<enum: candidate resource ids> | null",
  "rationale": "string",
  "distance_note": "string"
}
```

`resource_id` enum-locked to matchable resources (available, not engaged on mission).

### 4. SITREP

```json
{ "sitrep": "plain-language situation report, few short lines" }
```

### 5. CHAT — command station (`POST /api/chat`)

```json
{
  "answer": "string",
  "sources": [{ "label": "string", "type": "string" }],
  "proposed_actions": [{
    "type": "update_incident | create_incident | create_alert | update_resource",
    "reason": "string",
    "incident_id": "string (exact from context)",
    "resource_id": "string (exact from context)",
    "category": "...", "urgency": "...", "summary": "...", "location": "...",
    "people_count": 0, "status": "...", "message": "...", "severity": "...",
    "zone": "...", "quantity": 0, "unit": "..."
  }]
}
```

Field station chat omits `proposed_actions` — ask only, never edit.

---

## Privacy & data handling

| Data | Where it lives | Leaves the LAN? |
|---|---|---|
| Field reports (text) | SQLite `data/hub.db` on hub laptop | **No** during operation |
| Voice audio | Phone → hub for local STT only; not stored as audio | **No** |
| Photos | Base64 to Gemma parse step only; stored as `has_image: true` flag, not the bytes | **No** |
| Gemma inference | `localhost:11434` (embedded Ollama child process) | **No** |
| Protocol advisories | Local `server/kb/protocols.json` or Rares' service on `localhost:8100` | **No** |
| Missing-person names | Parsed into `persons[]` on incidents; visible to coordinator only | **No** |
| Map tiles | Downloaded once to `data/tiles/` on laptop; phones fetch via hotspot | **No** after prefetch |
| Cloud fallback | Only if `CLOUD_API_KEY` is set (Anthropic) — **leave unset in the field** | Yes — dev convenience only |

**Operational boundaries (DQ compliance):**
- Advisory content is **humanitarian protocol for trained responders** (INSARAG, START triage, Sphere WASH, PAHO shelter guidance) — not patient diagnosis.
- Coordinator confirms every dispatch; Gemma proposes, humans decide.
- Field outbox is store-and-forward: reports save on the phone first, sync when the hub is reachable — radio can drop without data loss.

---

## What we built vs the PRD (honest delta)

| PRD plan | What shipped |
|---|---|
| FastAPI hub (Python) | **Node.js Express** hub — same contracts, faster integration with the React app and Ollama |
| `/agent` + `/api` two stacks | **Single `/api` pipeline** — `server/agent/*` deleted; see [CONSOLIDATION.md](CONSOLIDATION.md) |
| Prioritized action feed (MVP) | Feed **+ command graph** — React Flow board with Gemma brain node, SmartEdge routing, Organise layout, inspector sidebar, filters, drag/zoom |
| Dedup (V2) | **Shipped** — enum-locked ids + category backstop |
| Protocol advisory (Rares) | **Shipped** — proxy to `knowledge-service/` with local fallback |
| Voice field reporting | **Shipped** — phone records → hub local STT (`BRUJULA_TRANSCRIBE_COMMAND`) → editable confirmation |
| Photo triage (stretch) | **Shipped** — multimodal parse; compressed on-device before outbox |
| Sitrep (V2) | **Shipped** — one-click from Command Post |
| Map as stretch view | **Shipped** — offline Leaflet + pre-download UI (Settings → Offline maps) |
| Gemma 3n on phone (stretch) | Not in MVP — hub-laptop Gemma is the edge device for the demo |
| Gradium STT | Optional; local Whisper path is default for privacy |

**Banned-list check (still true):** not basic RAG, not Streamlit, not a medical bot, not "dashboard as main feature" — the **agent reasoning and human-confirm loop** are what we demo; graph/map/feed visualize Gemma's decisions.

---

## Architecture

```
   [ Field phone ]  [ Field phone ]  [ Field phone ]
          \              |              /
           \             |             /     local WiFi (laptop hotspot)
            \            |            /      NO internet in the field
             ▼           ▼           ▼
        ┌──────────────────────────────────────────────┐
        │   COMMAND POST (laptop)                       │
        │   • Express :8000 + SQLite (data/hub.db)      │
        │   • Ollama + Gemma3n:e4b (the brain)          │
        │   • React: /command, /command/graph, /field   │
        └──────────────────────────────────────────────┘
                              │ optional
                              ▼
               knowledge-service :8100 (Rares' protocol matcher)
```

- **`/command`** — prioritized feed, map, dispatch confirm/override, SITREP, settings.
- **`/command/graph`** — relationship graph: reports → **Gemma brain** → incidents → dispatches → resources; contextual chat; approval queue for proposed dispatches.
- **`/field`** — PWA field client: role signup, voice/photo reports, store-and-forward outbox, assignments inbox, crew status.

Phones install from the hub URL (Add to Home Screen). One LAN address for everything.

---

## Features (full inventory)

Everything below was built during the hackathon. Views (feed, graph, map) are **windows onto Gemma's agent output** — the product is the reasoning + confirm loop, not a static dashboard.

### Gemma agent & pipeline

| Feature | What it does |
|---|---|
| **Multi-step agent** | Parse → dedup → prioritize → match on every report; advise + sitrep on demand |
| **Structured JSON** | Every Gemma step uses Ollama `format` + server-side Zod validation; enum-locked ids for dedup/match |
| **Multimodal parse** | Text, voice transcript, and/or photo — Gemma reads damage, hazards, people from images |
| **Photo privacy** | Image goes to parse only; hub stores `has_image: true`, never the bytes |
| **Persons registry** | Named individuals extracted as `{name, status, detail}` — missing / found / safe |
| **Dedup merge** | Two reports of the same event → one incident; merged report ids kept as evidence |
| **Explicit correction** | Reports like *"not 180 people, actually 60"* merge to the right incident and update headcount |
| **Cross-kind guard** | Resource offers cannot dedup-merge into need incidents (server backstop) |
| **Category backstop** | Rescue ↔ machinery merges allowed; unrelated categories blocked even if Gemma guesses wrong |
| **Deterministic prioritize** | Urgency × people × age — 0 model calls, always explainable |
| **Capability-aware match** | Gemma picks resources by fit + distance, not just proximity (e.g. rejects water truck for collapse) |
| **Late-resource matching** | Crew registers after a need exists → hub auto-proposes dispatches for unmatched open incidents |
| **Rematch** | Coordinator can re-run match on an incident (`POST /api/incidents/:id/rematch`) |
| **Graceful degradation** | Model failure mid-pipeline → report stored, board keeps working; no 5xx to phones |
| **Fast ack** | Hub accepts report in ≤20 s; slow parse finishes in background |
| **20+ summary languages** | Reports in any language; one-line board summary in configurable output language |

### Location & maps (GPS + offline geocoding)

| Feature | What it does |
|---|---|
| **Phone GPS** | Field app requests `lat` / `lon` / `accuracy` on compose; chip shows *"Ubicación GPS adjunta"* when granted |
| **Best-effort, silent fallback** | Browsers often deny geolocation on plain-HTTP LAN — failure is silent; report still sends |
| **Offline gazetteer** | `fixtures/gazetteer.json` — ~17 Vargas-coast place names matched from parsed `location` text (accent-insensitive, longest match wins) |
| **Pin resolution order** | Phone GPS → gazetteer label → no pin (incident still on board, counted as *"sin ubicación"*) |
| **Dedup pin stability** | Merging reports never moves an existing incident's coordinates |
| **Offline incident map** | Leaflet map on Command Post — urgency-colored pins, click → incident drawer |
| **Offline map tiles** | Pre-download areas (Settings → Offline maps or `npm run fetch:tiles`); hub serves `/tiles/*` to phones over hotspot |
| **Map panel** | Compact map overlay from graph/command topbar |
| **GPS in graph inspector** | Report nodes show coordinates when present; inspector displays `GPS lat, lon` |

### Field client (mobile PWA)

| Feature | What it does |
|---|---|
| **Installable PWA** | Add to Home Screen from hub URL — fullscreen, compass icon |
| **Role onboarding** | Reporter / volunteer / specialized crew (rescue, medical, water, shelter, food, machinery) |
| **Crew → resource** | Volunteers and crews register on hub and become dispatchable inventory |
| **Store-and-forward outbox** | Reports saved locally first (QUEUED) → sync (SYNCED) → pipeline (PARSED); survives radio drops |
| **Idempotent sync** | `client_ref` prevents duplicate reports on flaky reconnect |
| **Voice reporting** | Record on phone → hub **local STT** (`POST /api/transcribe`) → editable text before send |
| **Photo reporting** | Camera/gallery → compressed on-device (~100–250 KB) → rides outbox; photo-only reports allowed |
| **Category chips** | Quick-tap incident category on compose screen |
| **People count + location** | Optional fields on report form |
| **Assignment inbox** | Confirmed dispatches appear on phone; acknowledge when seen |
| **Crew mission status** | One-tap Disponible / En camino / En el sitio / Regresando — engaged crews excluded from matching |
| **Field assistant** | Ask tab — grounded Q&A from live board + KB (`POST /api/ask`); cannot dispatch |
| **Alert banner** | Hub broadcast alerts surface on field client |
| **20-language UI** | Full field interface translated (language picker) |
| **Interactive DotGrid** | Same pixel-dot backdrop as command graph |
| **Demo test modal** | Built-in sample reports for rehearsal without typing |
| **Connection indicator** | Hub conectado / offline pills |

### Command Post (laptop)

| Feature | What it does |
|---|---|
| **Prioritized action feed** | Incidents ranked by agent prioritize step |
| **Incident drawer** | Full detail, dedup evidence, protocol advisory, edit/resolve, dispatch confirm/override |
| **Human corrections** | PATCH incidents/resources — `corrected_by_human` badge on coordinator edits |
| **Dispatch lifecycle** | proposed → confirmed → accepted → en_route → on_site → done (with outcome notes) |
| **SITREP** | One-click plain-language situation report + structured briefing modal |
| **Protocol advisory** | INSARAG, START triage, Sphere WASH, PAHO shelter — local KB or Rares' service |
| **Broadcast alerts** | Compose critical/warning/info alerts with optional zone |
| **Escalation watchdog** | Unattended critical (10 min) / high (30 min) incidents flagged automatically |
| **Trends** | Board trend summary endpoint for situational awareness |
| **Persons list** | Missing-persons registry across incidents |
| **Connect phone** | QR code + copyable link to field URL (uses hub LAN address) |
| **Command settings** | Display density (compact), sync now, offline maps, fullscreen |
| **LAN access control** | Command Post / graph blocked from remote phones — coordinator station only |
| **Intro splash** | Animated compass + BRÚJULA wordmark on first load |
| **BorderGlow** | Pointer-reactive edge lighting on panels, graph nodes, inspector |

### Command graph (`/command/graph`)

| Feature | What it does |
|---|---|
| **Gemma brain node** | Central node — reports flow in, incidents and dispatches flow out |
| **All entity types** | Reports, persons, incidents, dispatches (all states), resources, alerts, section labels |
| **SmartEdge routing** | Bezier edges route around cards they would otherwise cross |
| **Organise layout** | One-click column restack using real card heights + crossing minimisation |
| **Approval queue** | Pending dispatches surfaced in top bar — approve or review without hunting the graph |
| **Graph inspector** | Click any node → full relationship context, actions, GPS, merged reports |
| **Filters** | All / Critical / Open / Dispatch / People / Reports + edge legend |
| **Drag + zoom** | Hand-arrange nodes; positions survive 4 s poll; Reset layout chip |
| **Ask Gemma chat** | Contextual Q&A; proposes board edits (`proposed_actions`) you Apply with one click |
| **Report titles** | Nodes show `category · location` instead of raw device id |
| **Proposed dispatch accent** | Gold border on dispatch nodes awaiting human confirm |
| **Keyboard a11y** | Tab to nodes, Enter/Space inspect, Escape closes topmost overlay |
| **Map / SITREP / alerts** | Same topbar actions as feed view, inside graph context |

### Hub infrastructure

| Feature | What it does |
|---|---|
| **Single Express server** | API + built React app + tile server + model mgmt on `:8000` |
| **SQLite store** | `data/hub.db` — survives restart; `npm run seed` resets demo board |
| **Delta sync** | `GET /api/sync?since=<seq>` — monotonic seq, phones poll for updates |
| **Embedded Ollama** | Hub spawns headless `ollama serve`; no desktop app needed |
| **Model manager** | Web console: install, switch, pull progress; `POST /warmup` pre-loads model |
| **GPU / CPU toggle** | Persisted compute mode; `/health` reports actual `gpu_in_use` |
| **Mock provider** | `BRUJULA_PROVIDER=mock` for UI/tests without Gemma |
| **Verify harness** | `npm run verify:hub` — 15-check end-to-end demo replay |

### Protocol knowledge base (Rares)

| Feature | What it does |
|---|---|
| **Offline matcher** | `knowledge-service/` — keyword + incident-type routing to protocol steps |
| **Proxy + fallback** | `RARES_KB_URL` set → proxy; unreachable → built-in `server/kb/protocols.json` |
| **Sourced guidance** | Steps cite INSARAG / Sphere / PAHO / START — operational, not patient diagnosis |

---

## Quick start

### Bootstrap (once, needs internet)

Installs Ollama, pulls `gemma3n:e4b`, verifies Node ≥ 22.5.

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File bootstrap.ps1
```

```bash
# macOS / Linux
bash bootstrap.sh
npm install && npm run build
```

Pre-download map tiles: Command Post → **Settings → Offline maps**, or `npm run fetch:tiles`.

### Run (offline-capable after bootstrap)

```bash
npm start
# Optional: Rares' protocol service
cd knowledge-service && py -m uvicorn app:app --port 8100
```

Point phones at the printed LAN URL (e.g. `http://192.168.137.1:8000/field`). Warm the model before demo: `curl -X POST http://localhost:8000/warmup`.

### Verify

```bash
npm run verify:hub    # 15-check end-to-end demo flow
npm run verify        # quick parse smoke test
npm test              # 18 hub contract tests (no model)
cd app && npx playwright test graph.spec.js   # graph UI tests
```

---

## Hub API (summary)

Full table in previous docs; key routes the demo touches:

| Endpoint | Role |
|---|---|
| `POST /api/reports` | Ingest report → Gemma pipeline → incident + dispatch proposal |
| `POST /api/incidents/:id/dispatch` | Human **confirm** or **override** |
| `GET /api/sync?since=` | Field phone delta sync |
| `POST /api/chat` | Command/field contextual Q&A; command may return `proposed_actions` |
| `POST /api/ask` | Field assistant (read-only grounding) |
| `GET /api/sitrep` | Generated situation report |
| `POST /api/advise` | Protocol steps (local KB or knowledge-service) |
| `POST /api/transcribe` | Local STT on hub (audio never stored) |

Responses: `{"success": bool, "data": ..., "error": ...}`.

---

## Layout

```
PRD-Brujula.md          product spec + demo narrative
DEMO.md                 1-minute rehearsal runbook
GEMMA.md                Gemma 4 research brief for the track pitch
CONSOLIDATION.md        why /api is the single pipeline
app/                    React — /command, /command/graph, /field
server/pipeline/        Gemma steps: parse, dedup, match, sitrep
server/routes/hub.js    /api/* hub + chat proposed_actions
server/store.js         SQLite board store
knowledge-service/      Rares' offline protocol matcher
fixtures/               demo seed data (npm run seed)
verify-hub.js           acceptance test (npm run verify:hub)
```

---

## Offline audit

| Component | Internet? |
|---|---|
| Bootstrap + model pull | **Once** |
| npm install + tile prefetch | **Once** |
| Gemma inference (Ollama) | **No** |
| Hub + field sync | **No** — LAN only |
| Protocol KB | **No** |
| `CLOUD_API_KEY` cloud provider | **Yes — dev only; unset in field** |

---

## Team & acknowledgements

Built for **RAISE Summit Hackathon 2026**, Google DeepMind Remote track. Thanks to the organizers and Gemma team for the edge/on-device brief — it maps directly onto a scenario where cloud AI is literally unavailable.

Questions during judging: see [DEMO.md](DEMO.md) cut-beats (dedup, advisory, sitrep, photo triage, crew roles).
