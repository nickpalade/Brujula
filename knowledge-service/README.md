# Brújula — Knowledge Service (`/knowledge-service`)

The **offline protocol knowledge base** for Brújula. Given a disaster situation,
it returns the correct humanitarian **response procedure** (search-and-rescue,
casualty triage, water/sanitation, disease control) as structured, ordered
steps. Standalone HTTP service, **fully offline**, **non-blocking** — zero shared
code with the rest of the project.

> **Status: REAL service.** `POST /advise` resolves requests through
> `matcher.py` against the four protocol files in `data/` (INSARAG, START/SALT,
> Sphere, WHO/PAHO — paraphrased, sources cited per step). The canned responses
> in `mock/advise_examples.json` are no longer served; the file stays as the
> integration fixture originally handed to Pepe. Read `CLAUDE.md` first, then
> `PRD-Brujula.md` for background.

## Quickstart

```bash
# from inside /knowledge-service (a venv is recommended; .venv/ is gitignored)
python -m venv .venv && .venv/Scripts/python -m pip install -r requirements.txt   # Windows
.venv/Scripts/python -m uvicorn app:app --port 8100
```

(or simply `pip install -r requirements.txt && uvicorn app:app --port 8100`
if you manage environments yourself.)

Everything runs on `localhost` with **no network calls at runtime** — you can
turn wifi off after installing and it still answers (that's the acceptance test).

## Endpoints

| Method | Path         | Purpose                                                          |
|--------|--------------|------------------------------------------------------------------|
| GET    | `/health`    | Liveness — returns `{"status":"ok"}`.                            |
| POST   | `/advise`    | Situation → guidance, matched from the real protocol data.       |
| GET    | `/protocols` | Which `incident_type`s are covered (reflects what loaded from `data/`). |

Interactive API docs while running: `http://localhost:8100/docs`.

## How matching works (deterministic, forgiving)

1. **Exact** — a covered `incident_type` (`structural_collapse`,
   `casualty_triage`, `water_sanitation`, `shelter_disease`) returns that
   protocol directly.
2. **Keywords** — otherwise the `needs` tags and `context.notes` free text are
   scored against each protocol's keyword list (case-, accent- and
   underscore-insensitive, so Spanish field notes like *"sarampión"* or
   *"atrapados bajo los escombros"* match). Best score wins; ties break
   life-rescue-first.
3. **Fallback** — if nothing matches, a generic `"other"` size-up response is
   returned. Never an error, never a 422.

Every response carries `matched_by` (`"exact"` / `"keywords"` / `"fallback"`) —
an **additive** debugging aid on top of the contract in `CLAUDE.md`; consumers
can ignore it. The disclaimer and non-empty `safety_flags` are always present.

## Try it

Health check:

```bash
curl http://localhost:8100/health
```

Advice for a collapsed building (exact match):

```bash
curl -X POST http://localhost:8100/advise \
  -H "Content-Type: application/json" \
  -d '{"incident_type":"structural_collapse","needs":["heavy_lifting"],"context":{"signs_of_life":true,"notes":"knocking heard inside"}}'
```

No `incident_type` at all — the keyword fallback routes it (here → WASH):

```bash
curl -X POST http://localhost:8100/advise \
  -H "Content-Type: application/json" \
  -d '{"needs":["water"],"context":{"notes":"latrines overflowing"}}'
```

**PowerShell** (Windows) — `curl` is an alias for `Invoke-WebRequest`, so use the
real binary `curl.exe`, or `Invoke-RestMethod`:

```powershell
curl.exe -X POST http://localhost:8100/advise -H "Content-Type: application/json" -d '{\"incident_type\":\"structural_collapse\"}'
```

> Note: if you send accented text (Spanish notes) from a Windows console,
> encoding can get mangled by the shell, not the service — the service itself
> handles UTF-8 fine (covered by tests). Prefer the `/docs` UI or a script for
> non-ASCII payloads.

## Tests

```bash
.venv/Scripts/python -m pytest -q      # from /knowledge-service (or just: pytest -q)
```

31 tests cover: endpoint liveness, all four domains loading from `data/`,
contract shape per domain (ordered steps, valid priorities, named sources),
keyword fallback (incl. Spanish/accented text and type-mangled payloads),
the `"other"` fallback, disclaimer + non-empty `safety_flags` on every
response, and a guard that no treatment/diagnosis language appears in the
authored content.

## Layout

```
/knowledge-service
  CLAUDE.md                  marching orders (read first)
  PRD-Brujula.md             team background
  README.md                  this file
  app.py                     FastAPI: /advise, /health, /protocols
  matcher.py                 situation -> guidance lookup (exact -> keywords -> other)
  data/                      usar / triage / wash / disease .json  (the real content)
  mock/advise_examples.json  4 canned request->response pairs      (Pepe's fixture; not served)
  tests/test_advise.py       real content + matching + safety tests
  requirements.txt
```

## Non-negotiables (from CLAUDE.md)

- **Offline only** — no runtime network calls; runs in airplane mode.
- **Stay in your lane** — only files under `/knowledge-service`.
- **Operational guidance for trained responders** — never patient diagnosis or
  treatment. A disclaimer to that effect is on every `/advise` response.
- **Paraphrase** humanitarian standards (INSARAG, Sphere, WHO/PAHO, START/SALT)
  and cite them by name; no verbatim handbook text.
