# Consolidation — one brain, not two (proposal, Pepe)

**TL;DR recommendation: the `/api/*` stack (server/pipeline/* + routes/hub.js +
routes/advise.js) becomes the single canonical pipeline. The `server/agent/*`
stack stays until Sunday morning as a fallback, then gets deleted.** I've
already ported the one capability it had that `/api` lacked (photo triage) —
see "What I changed" below.

## Why we have two brains

Commit `0afbe76` added the React app **plus** a second agent stack under
`/api/*`, parallel to the original `server/agent/*` stack behind `POST
/reports`. Both run the same conceptual pipeline (parse → dedup → prioritize →
match → advise → sitrep) against Gemma, but with separate stores (`hub.db` at
repo root vs `data/hub.db`), separate schemas, and separate KB adapters. Both
are mounted in `server/main.js` today; they don't conflict, but every fix has
to land twice and the demo must not depend on which one answered.

## Comparison

| | `server/agent/*` (`/reports`, `/board`, …) | `/api/*` (hub + pipeline) |
|---|---|---|
| Consumed by | `verify-agent.js` only | **the React app** (Command Post + Field client) |
| Delta sync for phones | ✗ (full board only) | ✓ `GET /api/sync?since=<seq>` — the field outbox/inbox depend on it |
| Dispatch actions | confirm / reject | confirm / **override with another resource** |
| Dedup evidence | merged ids only | ✓ `GET /api/reports?ids=` feeds the Command drawer |
| Model-failure behavior | 502 to the caller | **graceful**: report stored `pending`, board keeps working |
| Prioritize step | model-assisted | **deterministic, 0 ms, never throws** (big win on CPU) |
| Dedup guardrail | enum-locked ids | enum-locked ids **+ category-compatibility backstop** |
| Photo triage (multimodal) | ✓ | ✓ **(ported today — was ✗)** |
| KB adapter to Rares | `agent/advisory.js`, verified live vs branch `rares` | `routes/advise.js` (same logic, ported from advisory.js) |
| Acceptance test | `npm run verify:agent` (13 checks, passed) | `npm run verify:hub` (15 checks — promoted from the temp e2e) |

The `/api` stack wins on the things the demo actually exercises: it's what the
UI calls, it degrades instead of 5xx-ing when the model hiccups, and its
prioritize costs zero model calls. Everything my stack uniquely had is now
ported. There is no remaining reason to route anything through
`server/agent/*` except that `verify-agent.js` targets it.

## What I changed (this commit — additive, no breaking changes)

1. **Photo triage on `/api/reports`**: accepts `image_base64` + `image_mime`
   (text becomes optional — photo-only reports parse too). The image goes to
   the parse step only; base64 is never persisted; the stored report carries
   `has_image: true`. The provider layer already supported images end-to-end,
   so this touched only the request schema, the parse prompt, `parseReport`'s
   signature (backward-compatible third param), and the hub route.
2. **`npm run verify:hub`**: `server/_integration-e2e.mjs` (marked "delete
   after use") is now the permanent `/api` acceptance test at
   `verify-hub.js` — same 15 checks covering the full demo flow.

## Still needs a team decision (not done on purpose)

- **Delete `server/agent/*` + `verify-agent.js`** once someone runs
  `verify:hub` green on the GPU laptop (I can't run model steps at speed on my
  CPU-only box). Deleting also retires the root `hub.db` (the second SQLite
  file) — `data/hub.db` becomes the only store.
- **Merge branch `rares`** (real matcher, e9c6277, 31 tests green) into main,
  then set `RARES_KB_URL`/`PROTOCOL_KB_URL` on the demo laptop. Both advise
  adapters already fall back locally if his service is down.
- **Field client photo capture**: the server side is ready; the Field UI has
  no camera/photo input yet. Nick's call whether it fits before Sunday —
  photo-only reports can also be demoed with curl if UI time runs out.
