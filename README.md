# Brujula — model-serving layer

Local LLM serving for an offline disaster-coordination hub. A laptop runs
Ollama + this Node.js (Express) service; field phones on the laptop's wifi
hotspot send raw field reports and get structured JSON back. Ollama runtime
over HTTP, model auto-detection, provider abstraction with an optional cloud
fallback.

**After bootstrap, nothing touches the internet** (see "Offline audit").

## 1. Bootstrap (one time, needs internet)

Installs Ollama, pulls the model, starts + verifies the Ollama server.

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File bootstrap.ps1
```

```bash
# macOS / Linux
bash bootstrap.sh          # or: make bootstrap
```

Node deps (express, zod) — requires Node 18.17+:

```bash
npm install
```

## 2. Start the server

```bash
npm start                  # or: make serve
```

Startup prints the LAN URL to point phones at, e.g.:

```
  Point phones at:  http://192.168.137.1:8000
  Provider: ollama   Model: gemma3:4b
```

(On a Windows hotspot the laptop is usually `192.168.137.1`. Phones must be
joined to the laptop's hotspot.)

## 3. Verify end-to-end

With the server running:

```bash
npm run verify             # or: make verify
node verify.js --url http://192.168.137.1:8000   # from the LAN side
```

Sends 3 sample Spanish field reports (in `fixtures/`) to `/parse-report` and
prints the structured JSON. Ends with a single SUCCESS/FAILURE line.

## Embedded Ollama — no Ollama app

Brujula owns the Ollama backend. On startup the server spawns a headless
`ollama serve` child process (and stops it on shutdown). The Ollama desktop
app is never opened; bootstrap removes its autostart shortcut. You only ever
interact with Brujula.

## Test console + model management

Open the LAN URL in any browser (laptop or phone). The page has:
- a field-report test console (sample reports in 10+ languages),
- a **summary language** dropdown (20 languages) controlling the language
  of the generated summary (persisted in `brujula_config.json`),
- a **Models** panel: installed models with sizes, one-tap install of
  recommended models with a live progress bar, delete, custom model pull,
  and active-model switching (persisted in `brujula_config.json`).

## Language options

Reports can be written in **any language** — the model reads them as-is.
The one-sentence `summary` is generated in a configurable language:

- Web console → **summary language** dropdown (20 options: English, Spanish,
  French, Portuguese, Haitian Creole, Arabic, Hindi, Bengali, Urdu,
  Indonesian, Tagalog, Swahili, Chinese, Japanese, Korean, Russian,
  Ukrainian, Turkish, German, Italian), or
- `POST /language-config {"language": "es"}` (persisted in
  `brujula_config.json`), or
- `set BRUJULA_LANG=fr` (env var default when nothing is saved).

Edit `SUPPORTED_LANGUAGES` in `server/config.js` to curate the list.

## CPU / GPU toggle

The status card in the web console has a **GPU | CPU** toggle (also
`POST /compute-config {"mode": "gpu"|"cpu"}`; persisted in
`brujula_config.json`). GPU mode lets Ollama offload all layers that fit in
VRAM (gemma3:4b fits entirely in the RTX 3060's 6 GB — ~3.4s per parse vs
~17s on CPU); CPU mode forces `num_gpu: 0`. Switching evicts the loaded
runner, so the next parse pays a few seconds of reload. `/health` reports
`gpu_in_use` measured from Ollama's `/api/ps` VRAM split — what is actually
happening, not just the setting.

Note: the embedded server strips a stale `OLLAMA_LLM_LIBRARY` env var if one
is set on the machine (it force-disables GPU discovery).

## API

| Endpoint | What it does |
|---|---|
| `GET /` | browser test console + model manager |
| `GET`/`POST /compute-config` | read / set CPU vs GPU mode |
| `GET`/`POST /language-config` | read / set the summary output language |
| `GET /health` | ok + active provider, model, Ollama reachability |
| `POST /warmup` | pre-load the active model into memory (do this before a demo); inference calls keep it resident for 60 min |
| `GET /models` | auto-detected list of models on the Ollama server |
| `GET /models/recommended` | curated install list (edit in `server/config.js`) |
| `POST /models/pull` | `{"name": "gemma3:1b"}` — background download, dedup-guarded |
| `GET /models/pull-status` | progress per model, 0–100 |
| `DELETE /models/{name}` | remove a model |
| `GET`/`POST /model-config` | read / persist the active model |
| `POST /parse-report` | `{"text": "..."}` → `{type, location, people_estimate, severity, summary}` (stateless, kept for the test console) |

### Agent pipeline (the coordinator's brain)

Every report POSTed to `/reports` runs the full agent pipeline —
**parse → dedup → prioritize → match → advise → emit** — against a persistent
incident board (`brujula_board.json`):

1. **Parse**: Gemma extracts `{kind: need|resource|status, category, location, people_estimate, urgency, summary}`. A report may attach a photo (`image_base64`) — Gemma reads damage/hazards/people from it to enrich the record (needs a multimodal model, e.g. any `gemma3`/`gemma4` vision variant).
2. **Dedup**: Gemma compares the new report against open incidents and merges duplicates (`duplicate_of` is schema-constrained to real board ids — the model cannot hallucinate one).
3. **Prioritize**: deterministic ranking — urgency, then people affected, then longest waiting. Explainable on purpose.
4. **Match**: Gemma proposes the best available resource for a need (or, when a resource report arrives, the best waiting need for it).
5. **Advise**: protocol steps per incident type from a local KB (USAR, START triage, Sphere WASH, PAHO shelter disease control). Set `PROTOCOL_KB_URL` to use the remote protocol-kb service; falls back to local.
6. **Emit**: an action card. Nothing is auto-executed — the coordinator confirms or rejects every proposed dispatch.

| Endpoint | What it does |
|---|---|
| `POST /reports` | `{"text"?, "image_base64"?, "image_mime"?, "source_device"?}` (text or photo, or both) → full pipeline → action card |
| `GET /board` | prioritized incidents + resources + dispatches + stats |
| `GET /incidents/{id}` | incident detail + merged reports + protocol advisory |
| `POST /incidents/{id}/resolve` | close an incident |
| `POST /dispatches/{id}/confirm` | coordinator approves an AI-proposed dispatch (commits the resource) |
| `POST /dispatches/{id}/reject` | coordinator overrides the proposal |
| `GET /sitrep` | generated plain-language situation report (in the summary language) |
| `POST /board/seed` | load the demo board from `fixtures/seed_board.json` (or POST your own) |
| `POST /board/reset` | wipe the board |

Verify the whole pipeline end-to-end (seed → collapse report → duplicate
merge → dispatch proposal → confirm → sitrep):

```bash
npm run verify:agent        # or: make verify-agent
```

All responses use the envelope `{"success": bool, "data": ..., "error": ...}`.
JSON output is enforced with Ollama structured outputs (the zod schema is
passed as `format`), then validated again server-side — malformed model
output returns a clean 502, never a crash.

## Switching the model

Easiest: open the web console → Models → **Use** (persists to
`brujula_config.json`). Or download a new one there first (needs internet).

Also works:
- `set BRUJULA_MODEL=gemma3:12b` (env var, no code change), or
- edit `DEFAULT_MODEL` in `server/config.js`, or
- edit `$MODEL` / `MODEL` at the top of the bootstrap scripts (controls what gets pulled).

Resolution order: saved console choice → `BRUJULA_MODEL`/`DEFAULT_MODEL` →
any `gemma*` → first installed model. Missing models never crash the server;
it auto-detects what is actually there.

## Switching to the cloud provider

```bash
set CLOUD_API_KEY=sk-ant-...        # Windows (PowerShell: $env:CLOUD_API_KEY="...")
# optional: set CLOUD_MODEL=claude-haiku-4-5-20251001
npm start
```

That's it — same endpoints, same calling code, provider switches to the
Anthropic API. Unset the var to go back to local Ollama.

## Offline audit

| Component | Internet? |
|---|---|
| bootstrap (Ollama install + model pull) | **Yes, once** |
| Ollama inference (`/api/chat`, `/api/tags`) | No — localhost only |
| Express server + `/parse-report` | No — LAN only |
| `verify.js` | No — talks to local server |
| Cloud provider | **Yes — only if `CLOUD_API_KEY` is set. Leave unset in the field.** |

## Layout

```
bootstrap.ps1 / bootstrap.sh   # install + pull + start + verify Ollama
server/config.js               # model, port, env vars   ← tweak here
server/schemas.js              # report JSON shape       ← tweak here
server/main.js                 # endpoints + parse prompt ← tweak here
server/agent/                  # the agent core: pipeline, board store,
                               #   prompts, advisory KB, routes
server/ollama-manager.js       # tags/pull/retry/CLI-fallback
server/ollama-lifecycle.js     # embedded `ollama serve` child process
server/providers/              # ollama (default) | cloud (env-keyed)
verify.js + fixtures/          # end-to-end check with Spanish samples
verify-agent.js                # full pipeline acceptance test (demo replay)
```
