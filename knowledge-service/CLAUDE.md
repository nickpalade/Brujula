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

_End of day 2. **The real service is built and verified** — all five items from day 1's checklist are done. `pytest` green (31/31), served live on `:8100`, zero runtime network calls._

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

### Remaining
- **The literal airplane-mode run** — flip wifi off and hit `/advise` once (loopback needs no wifi; expected to just work).
- Optional polish, only if time allows: more Spanish keywords from real field-report samples; a couple of `flood`/`fire`-specific keyword entries if Pepe wants those types routed somewhere other than `other`.
