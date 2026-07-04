# Brújula — Knowledge Service (`/knowledge-service`)

The **offline protocol knowledge base** for Brújula. Given a disaster situation,
it returns the correct humanitarian **response procedure** (search-and-rescue,
casualty triage, water/sanitation, disease control) as structured, ordered
steps. Standalone HTTP service, **fully offline**, **non-blocking** — zero shared
code with the rest of the project.

> **Status: MOCK.** `POST /advise` currently serves canned responses from
> `mock/advise_examples.json`. Real retrieval (from `data/*.json`) is not built
> yet. See **CLAUDE.md → "Current state — start here tomorrow"** for what's done
> and what's next. Read `CLAUDE.md` first, then `PRD-Brujula.md` for background.

## Quickstart

```bash
pip install -r requirements.txt
uvicorn app:app --port 8100          # run from inside /knowledge-service
```

Everything runs on `localhost` with **no network calls at runtime** — you can
turn wifi off after installing and it still answers (that's the acceptance test).

## Endpoints

| Method | Path         | Purpose                                                        |
|--------|--------------|----------------------------------------------------------------|
| GET    | `/health`    | Liveness — returns `{"status":"ok"}`.                          |
| POST   | `/advise`    | Situation → guidance. Mock lookup by `incident_type` for now.  |
| GET    | `/protocols` | Which `incident_type`s are currently covered.                  |

Interactive API docs while running: `http://localhost:8100/docs`.

## Try it

Health check:

```bash
curl http://localhost:8100/health
```

Advice for a collapsed building (matches a canned response):

```bash
curl -X POST http://localhost:8100/advise \
  -H "Content-Type: application/json" \
  -d '{"incident_type":"structural_collapse","needs":["heavy_lifting"],"context":{"signs_of_life":true,"notes":"knocking heard inside"}}'
```

Unknown/missing `incident_type` degrades to a generic `"other"` size-up response
rather than erroring (the matcher is forgiving by design):

```bash
curl -X POST http://localhost:8100/advise \
  -H "Content-Type: application/json" \
  -d '{"needs":["water"]}'
```

**PowerShell** (Windows) — `curl` is an alias for `Invoke-WebRequest`, so use the
real binary `curl.exe`, or `Invoke-RestMethod`:

```powershell
curl.exe -X POST http://localhost:8100/advise -H "Content-Type: application/json" -d '{\"incident_type\":\"structural_collapse\"}'
```

## Tests

```bash
pytest -q            # from /knowledge-service
```

Current tests are **smoke tests for the mock** (health, protocols, canned
lookups, `other` fallback). Real protocol-content tests are TODO.

## Layout

```
/knowledge-service
  CLAUDE.md                  marching orders (read first)
  PRD-Brujula.md             team background
  README.md                  this file
  app.py                     FastAPI: /advise, /health, /protocols  (MOCK)
  matcher.py                 situation -> guidance lookup            (STUB — not built)
  data/                      usar / triage / wash / disease .json    (to author)
  mock/advise_examples.json  4 canned request->response pairs        (delivered to Pepe)
  tests/test_advise.py       smoke tests for the mock
  requirements.txt
```

## Non-negotiables (from CLAUDE.md)

- **Offline only** — no runtime network calls; runs in airplane mode.
- **Stay in your lane** — only files under `/knowledge-service`.
- **Operational guidance for trained responders** — never patient diagnosis or
  treatment. A disclaimer to that effect is on every `/advise` response.
- **Paraphrase** humanitarian standards (INSARAG, Sphere, WHO/PAHO, START/SALT)
  and cite them by name; no verbatim handbook text.
