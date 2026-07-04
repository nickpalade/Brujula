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
- [ ] `POST /advise` returns correct structured guidance for all four `incident_type`s, with a forgiving fallback to `other`.
- [ ] Runs in **airplane mode** — zero network calls.
- [ ] All four domains covered in `data/`, paraphrased with named sources.
- [ ] Mock JSON delivered to Pepe.
- [ ] Safety disclaimer on every response; no diagnosis/treatment content anywhere.
- [ ] `GET /health` works.

---

## Current state — start here tomorrow

_End of day 1. **Scaffold + mock server are in and verified** — installed, `pytest` green (6/6), and served live over `uvicorn app:app --port 8100` with zero runtime network calls._

### Done
- **Repo skeleton** created per the layout above: `app.py`, `matcher.py`, `data/`, `mock/`, `tests/`, `requirements.txt`, `README.md`.
- **Mock server (`app.py`, FastAPI)** — verified responding on `:8100`:
  - `GET /health` → `{"status":"ok"}`.
  - `POST /advise` → returns the canned response for the request's `incident_type` from `mock/advise_examples.json`; falls back to a generic `other` size-up response when the type is unknown or missing (forgiving — never errors, never 422s).
  - `GET /protocols` → lists covered `incident_type`s (the optional nice-to-have).
- **`mock/advise_examples.json`** — 4 request→response pairs (one per domain: `structural_collapse`, `casualty_triage`, `water_sanitation`, `shelter_disease`), matching the interface contract. **Ready to hand to Pepe now — this unblocks his integration.**
- **Smoke tests** (`tests/test_advise.py`) — health, protocols, all four canned lookups, and the `other` fallback. Green.
- **Runs offline:** `pip install -r requirements.txt`, then `uvicorn app:app --port 8100`. No network calls at runtime.

### Still a mock (real logic not built yet)
- `matcher.py` is a **stub** (raises `NotImplementedError`) and is **not wired in**.
- `data/` is **empty** — no real protocol content authored yet.
- Only exact `incident_type` matching; **no keyword fallback** on `needs`/`notes` yet.
- The mock's guidance text is illustrative, not the authoritative content.

### What's left — ordered checklist
1. **Author the 4 `data/` protocol files** — `usar.json` (INSARAG), `triage.json` (START/SALT), `wash.json` (Sphere), `disease.json` (WHO/PAHO + Sphere). Paraphrase, cite sources by name, operational-only (no diagnosis/treatment).
2. **Build real lookups in `matcher.py`** — load `data/*.json` at startup; implement the forgiving `match()`: exact `incident_type` → keyword match on `needs`/`notes` → `other`.
3. **Wire `app.advise()` to `matcher.match()`** — replace the canned lookup (see the `TODO(Rares)` in `app.py`); make `/protocols` reflect real coverage from `data/`.
4. **Add real tests** — domain-correct steps/sources loaded from `data/`, keyword fallback, and disclaimer + non-empty `safety_flags` on every response.
5. **Acceptance test** — turn wifi off and confirm `/advise` still answers (airplane-mode proof).
