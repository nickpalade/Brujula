# PRD — "BRÚJULA" · Offline Disaster-Response Coordinator

*Working name: Brújula ("compass" in Spanish) — the thing that still points you the right way when everything else is down.*

**Track:** Google DeepMind — Remote (Edge / On-Device: an app running **Gemma locally** for offline, privacy-first inference)
**Event:** RAISE Summit Hackathon 2026 — Remote
**Team (4):** Pepe (AI agent core + integration lead), Ceco (backend + offline sync), Nick (shared frontend — laptop + mobile), Rares (offline protocol knowledge base — decoupled, remote)
**Build window:** Sat 11:30 → Sun 12:00
**Grounding event:** 2026 Venezuela earthquakes (M7.2 + M7.5 doublet, June 24, La Guaira / Caracas corridor)

---

## 0. Why this, why now

On June 24, 2026, twin earthquakes (M7.2 and M7.5, 39 seconds apart) struck northwestern Venezuela — the strongest since 1900. As of July 3: ~2,595 dead, ~12,400 injured, **~50,000 unaccounted for**, up to **6.8 million people affected**, ~58,870 buildings damaged, 862+ aftershocks. The hardest-hit corridor is La Guaira state (Catia La Mar, Caraballeda, Playa Grande).

The on-the-ground reality, from humanitarian reporting:
- **Comms and power are down or oversubscribed** in the disaster zone — the classic condition where cloud tools fail exactly when needed.
- **Water systems have failed**; survivors lack safe drinking water (IRC).
- **Hospitals collapsed**; care is running out of improvised clinics (a converted McDonald's treating ~200/day).
- **Disease-outbreak risk** (measles) rising in overcrowded shelters with low vaccination and unsafe water (WHO/PAHO).
- **Dozens of actors** operating in parallel — Venezuelan agencies, international USAR teams (El Salvador, LA County, Jordan, Argentina, China), volunteer doctors, relatives, and trapped survivors relaying messages.

**The coordination failure this tool attacks** (from disaster-response literature): needs and available resources both *exist* but go *unmatched*, because information is scattered, noisy, and overwhelming; the result is duplication (multiple teams sent to one collapse while other sites wait), resource mismanagement, and lost lives. Responders fall back to whiteboards and radios because the digital tools need connectivity they don't have.

**Brújula is the coordinator's brain when the network is dead.** It ingests the flood of messy field reports, understands them, matches needs to resources, flags duplicates, tells responders what to do per established protocol, and produces situation reports — entirely on local hardware, entirely offline, with a human in command of every decision.

---

## 1. Why on-device Gemma is load-bearing (the track-winning argument)

This is not "we chose local." Local is the *only* thing that works here, on two independent axes:

1. **Offline is mandatory, not preferred.** In the disaster zone the network is down or saturated. A cloud model is unreachable precisely when the tool matters most. Brújula runs Gemma on the coordinator's own laptop at the edge — it produces outputs regardless of network status. Rip out "local + offline" and the product cannot exist in the scenario it's built for.
2. **The data is sensitive and the context is political.** Reports contain missing-persons identities, medical status, and the locations of vulnerable people, in a politically charged setting. Routing that through a foreign cloud is unacceptable. On-device keeps it in the command post.

Test the brief demands — "the primitive is the thing the task can't work without": **passed twice over.** This is arguably the *most* naturally on-device idea in the track: a tool whose entire premise is functioning when the cloud is gone.

---

## 2. Users & roles

One app, two modes, same design system (satisfies "laptop + mobile, same frontend"):

- **Command Post (laptop):** the coordinator's station. Runs the Gemma hub (Ollama) + the local sync server. Sees the full picture: prioritized action feed, incident map, need↔resource matches, protocol advisories, sitrep generator. This is where decisions are made and confirmed.
- **Field client (mobile):** a responder in the field. Submits reports (voice in Spanish, text, or photo) and receives assignments. Works even when temporarily out of hub range (store-and-forward). Same React app, responsive layout, same visual language.

Devices connect over a **local network with no internet** — the laptop's hotspot or a field router. The laptop is the edge; the phones are spokes.

---

## 3. Scope — ruthless prioritization

### MVP (must exist for the demo)
1. **Report ingestion** — a field client submits a report (text + voice-to-text in Spanish) that reaches the hub over local network, offline.
2. **Gemma parsing** — the agent turns a messy report into structure: `{kind: need|resource|status, category, location, people_count, urgency, raw_text}`.
3. **Prioritized action feed** — reports ranked by urgency on the Command Post, live-victim rescues at top.
4. **Need↔resource matching** — the agent proposes "dispatch resource X to need Y," coordinator confirms/overrides.
5. **Runs fully offline**, Gemma on the laptop, both devices in airplane mode.

### V2 (strong additions)
- **Deduplication** — the agent recognizes multiple reports describing the same incident and merges them (kills the duplicate-dispatch failure).
- **Protocol advisory** (Rares' module) — given an incident type, return established action steps (USAR, triage, water/sanitation, disease control) from a local knowledge base.
- **Voice-first field reporting** — Gradium STT (or on-device) so a responder speaks rather than types.
- **Sitrep generation** — one tap produces a plain-language situation report for handoff up the chain.

### Stretch
- **Gemma 3n on-device on the phone** — so a lone field device works standalone with no hub at all (the purest edge story).
- **Photo triage** — Gemma multimodal reads a photo of damage/rubble to enrich the report.
- **Map view** of incidents and resources (kept as a *view*, not the product — see §9 compliance).

### Explicitly OUT
- Real inter-agency data-standard integration (HXL, EDXL) — represent it, don't implement it.
- Anything resembling patient diagnosis (see §9).

---

## 4. Architecture

### 4.1 The offline-first topology (the hard part — read this twice)

The central design challenge: **how do reports flow and sync across devices with no internet?** Answer — a local hub-and-spoke over a LAN, with store-and-forward:

```
   [ Field phone ]  [ Field phone ]  [ Field phone ]
          \              |              /
           \             |             /     (local WiFi — laptop hotspot
            \            |            /        or field router; NO internet)
             ▼           ▼           ▼
        ┌──────────────────────────────────┐
        │   COMMAND POST (laptop)           │
        │   • FastAPI local server          │
        │   • SQLite (offline store)        │
        │   • Ollama + Gemma (the agent)    │
        │   • Coordinator React UI          │
        └──────────────────────────────────┘
```

- The **laptop hub** hosts everything: the model, the datastore, the server, the coordinator UI. It never needs the internet.
- **Phones** connect to the hub's local network and POST reports / poll for assignments. When a phone drops out of range, it **queues reports locally and syncs when back in range** (store-and-forward). This is how real field command posts degrade gracefully.
- **Why model-on-laptop, not model-on-phone (for MVP):** running Gemma on the laptop via Ollama is dramatically simpler and more reliable in 18 hours, and the laptop is legitimately "the edge device running Gemma locally, offline." On-device Gemma 3n on the phone is the stretch for standalone operation.

### 4.2 The agent pipeline (Pepe's core)

Each incoming report runs through a multi-step Gemma pipeline — this is what makes it an **agent**, not a form or a basic RAG bot:

```
raw report (voice/text, Spanish)
   │
   1. PARSE ─────► structured record {kind, category, location, people, urgency}
   │              (Gemma extraction; Spanish-native)
   2. DEDUP ─────► is this the same incident as an existing one? merge if so
   │              (Gemma compares against open incidents)
   3. PRIORITIZE ► rank against the current board by urgency + time-sensitivity
   │              (live victims > water > shelter, decayed by age)
   4. MATCH ──────► for a need, find the best available resource; propose dispatch
   │              (Gemma reasons over current resource inventory + distance)
   5. ADVISE ─────► attach protocol steps for this incident type
   │              (calls Rares' local KB — retrieval as ONE tool, not the app)
   6. EMIT ───────► action card for the coordinator to CONFIRM / OVERRIDE
```

Every output is a recommendation a human confirms — the coordinator is always in command (good design, and the trust/override pattern judges reward).

### 4.3 Tech stack

- **Model:** Gemma via **Ollama** on the laptop. Start `gemma3:4b` (fast, multimodal, ~3.3 GB, runs on a laptop without a GPU); size up to `gemma3:12b` / `gemma3n:e4b` if the hardware allows. Ollama exposes a local REST API on `localhost:11434` — fully offline after the one-time model pull.
- **Hub server:** FastAPI (Python), SQLite for the offline store.
- **Sync:** phones ↔ hub over local WiFi (laptop hotspot / field router); store-and-forward queue on the client.
- **Frontend:** React, responsive, one codebase for laptop + mobile, shared design system. **Not Streamlit (banned).**
- **Voice:** Gradium STT for Spanish field reports (45k free credits + coupon `RAISE-2026`); on-device STT as fallback.
- **Protocol KB:** local document store + retrieval (Rares) — see §5.

---

## 5. Team split & interface contracts

Four top-level folders → no merge conflicts: `/agent`, `/hub`, `/app`, `/protocol-kb`. In-person three (Pepe/Ceco/Nick) couple tightly and pair in the room; **Rares (remote) owns the cleanest, non-blocking boundary.**

### A — Pepe: AI agent core + integration lead — `/agent`
- The 6-step Gemma pipeline (parse → dedup → prioritize → match → advise → emit), prompt engineering, Ollama integration.
- Spanish-native extraction; structured-output discipline (Gemma returns strict JSON).
- Owns integration — stitches hub, app, and protocol-KB together.
- Consumes Ceco's hub API (in-process/HTTP) and Rares' KB API (HTTP).

### B — Ceco: Hub backend + offline sync — `/hub`
- FastAPI local server, SQLite offline store, the need/resource/incident data model.
- The LAN sync layer: phones ↔ hub, store-and-forward queue, conflict handling (last-write-wins is fine).
- Exposes to A:
  - `POST /reports` (ingest raw report) → record id
  - `GET /incidents` (current board), `GET /resources` (inventory)
  - `POST /incidents/{id}/dispatch` (confirmed assignment)
  - `GET /sync?since=…` (client polling)
- Owns the "it works offline across devices" guarantee.

### C — Nick: Shared frontend, laptop + mobile — `/app`
- One responsive React app + design system, runs as Command Post (laptop) and Field client (mobile).
- Field: report submission (voice/text/photo), assignment inbox.
- Command Post: prioritized action feed, incident detail, dispatch cards (confirm/override), protocol advisory panel, sitrep view, (stretch) map.
- Voice capture UI (wires to Gradium STT).
- The "laptop + mobile, same design" deliverable is his.

### D — Rares: Offline protocol knowledge base + advisory — `/protocol-kb` — DECOUPLED, NON-BLOCKING
- Build a **local, offline knowledge base of disaster-response protocols** and a retrieval+advisory function over it. Representative content sourced from established humanitarian standards, condensed into structured steps:
  - **Structural collapse / USAR** — hailing/silence periods to locate live victims, shoring before entry, extrication safety.
  - **Mass-casualty triage** — START method, prioritizing crush injuries.
  - **Water & sanitation** — Sphere minimums (e.g., ~15 L/person/day), chlorination targets, latrine spacing.
  - **Disease control in shelters** — PAHO/WHO guidance on measles/cholera risk, vaccination priority, crowding.
- Standalone: **own repo, own store, HTTP-only, zero shared code** with A/B/C. Fully mockable — Pepe integrates against a mock `advise()` until it's live.
- Interface: `POST /advise {incident_type, context} → {steps: [...], source_label, cautions: [...]}`
- **Non-blocking:** if it's late, the matching core still demos; advisory is an additive panel. This is why the coordination-risk person owns it — and it's content-heavy solo work with no merge surface, which suits remote.

---

## 6. Data model (Ceco owns, everyone reads)

```
Report      { id, raw_text, source_device, lang, created_at, parsed_into }
Incident    { id, category, location, people_count, urgency, status,
              merged_report_ids[], created_at, updated_at }
Resource    { id, type, label, location, capacity, status(available|committed) }
Dispatch    { id, incident_id, resource_id, state(proposed|confirmed|done),
              proposed_by_ai, confirmed_by_human_at }
Advisory    { incident_type, steps[], source_label, cautions[] }   # from Rares
```

Categories: `rescue | medical | water | shelter | food | machinery | hazard | status`.
Urgency: `critical | high | medium | low` (live victims → critical).

---

## 7. Demo workflow (the thing that wins — 2–3 min, grounded, respectful)

> Framing note: this is a real, ongoing tragedy. The demo is purposeful and respectful — a tool to help responders, not spectacle. Use realistic but not gratuitous detail.

**Setup:** Laptop labeled "Command Post — La Guaira" running the Gemma hub. One phone as a field responder. **Both devices visibly in airplane mode.**

1. **Offline proof (0:00–0:15).** Show both devices with no connectivity. "Everything here runs with zero internet — Gemma on this laptop. In La Guaira right now, the network is down. Cloud AI is dead. This isn't."
2. **A report comes in, by voice, in Spanish (0:15–0:45).** On the phone, a responder speaks: *"Edificio colapsado en Playa Grande, Catia La Mar. Escuchamos voces, unas 20 personas atrapadas. Necesitamos maquinaria pesada."* It syncs to the hub over local WiFi.
3. **Gemma parses it live (0:45–1:05).** The agent extracts, on screen: `RESCUE + MACHINERY need · Playa Grande, Catia La Mar · ~20 trapped · CRITICAL (voices heard → live victims)`. Messy speech → structured incident.
4. **The board fills (pre-seeded, realistic) (1:05–1:25).** A shelter reporting no drinking water; a clinic reporting spare capacity; a team reporting "idle excavator near Caraballeda"; and a **second, differently-worded report of the same Playa Grande collapse.**
5. **Dedup + prioritize (1:25–1:45).** The agent recognizes the two Playa Grande reports are one incident and merges them; the action feed re-ranks with the live-victim rescue on top.
6. **Match need → resource (1:45–2:10).** The agent proposes: *"Idle excavator team, Caraballeda (~3 km) → dispatch to Playa Grande collapse (20 trapped, machinery needed)."* Coordinator taps **Confirm.** The duplicate-dispatch failure — solved.
7. **Advise (2:10–2:30).** Coordinator opens the collapse → protocol panel (Rares): *"USAR: enforce silence periods to locate live victims; shore before entry; triage extricated casualties (START)."* Opens the shelter → *"Sphere: ≥15 L/person/day; chlorinate to residual; PAHO — measles risk in crowding, prioritize vaccination."* All from the local KB, offline.
8. **Sitrep (2:30–2:45).** One tap → a plain-language situation report summarizing open incidents, unmet needs, and confirmed deployments — ready to hand to the next shift.
9. **The close (2:45–3:00).** "Messy reports in, coordinated action out — no connectivity, nothing leaves the laptop. The tool that works when everything else has failed."

---

## 8. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **Looks like a dashboard** (banned as a main feature) | DQ risk | Make the **agent reasoning** the star — show parse/dedup/match/advise happening. Map/feed are *views of agent output*, never the headline. Pitch it as "an agent that coordinates," not "a dashboard." |
| Offline LAN sync is fiddly | Core demo breaks | Simplest path: laptop hotspot, phones POST to hub; store-and-forward queue. **Spike this in hour 1** — one phone → hub → parsed on screen, all offline. |
| Gemma JSON parsing flaky on messy Spanish input | Pipeline stalls | Strict prompt + schema, few-shot Spanish examples, retry-on-invalid-JSON. Test with real report phrasings early. |
| Model too slow on a laptop | Demo lags | Start `gemma3:4b`; keep prompts tight; pre-warm the model before demo. Size down if needed — a snappy small model beats a laggy big one. |
| Medical content drifts toward "advice bot" (banned) | DQ / harm | Advisory is **operational protocol for trained responders**, sourced from humanitarian standards — never patient diagnosis. Keep the boundary explicit in UI copy. |
| Rares' KB late/unreachable | Advisory missing | Non-blocking by design + mock. Matching core demos without it. |
| Real ongoing tragedy — tone | Reputational | Respectful framing, realistic-not-gratuitous demo, clear "built to help responders" purpose. |

---

## 9. Banned-list compliance check

- ✅ **Not** basic RAG — a 6-step agent (parse → dedup → prioritize → match → advise → emit); retrieval is one tool inside it.
- ✅ **Not** Streamlit — React + FastAPI.
- ✅ **Not** "a dashboard as the main feature" — the agent's reasoning and actions are the product; views are secondary (actively managed, see §8).
- ✅ **Not** a medical-advice bot — operational coordination + responder protocols, not patient diagnosis.
- ✅ New work, built during the event; public repo.
- ✅ Gemma running locally, offline, privacy-first — the core of the design.

---

## 10. Timeline (Sat 11:30 → Sun 12:00)

- **Sat 11:30–13:00 — Setup + hour-1 spike.** Four repos scaffolded; Ollama + `gemma3:4b` pulled on the hub; Gradium key. **Critical spike:** one phone submits a report → reaches the laptop hub over its hotspot (offline) → Gemma returns structured JSON on screen. De-risk sync + model together before building features.
- **Sat 13:00–18:00 — Core.** Pipeline parse→prioritize→match (A); hub + data model + sync (B); Command Post feed + field report UI (C); protocol KB skeleton + mock (D).
- **Sat 18:00–22:00 — End-to-end.** Full offline flow on seeded Venezuela data; voice-in; dedup; wire Rares' mock.
- **Sun 00:00–07:00 — Sleep in shifts / buffer.**
- **Sun 07:00–10:00 — Harden + V2.** Real protocol advisories, sitrep generation, polish the shared design, dedup edge cases.
- **Sun 10:00–11:30 — Rehearse + record the 60s demo video.** Freeze.
- **Sun 12:00 — Submit** (public repo + demo video).

---

## 11. Open decisions to lock in the first hour

1. Model on laptop-hub only (MVP) vs also on-device Gemma 3n on phone (stretch) — recommend hub-only for MVP, decide stretch Sunday.
2. Voice: Gradium STT vs on-device — recommend Gradium for quality, on-device as fallback.
3. Demo device count — one phone + laptop is enough; a second phone makes dedup more vivid if time allows.
4. Map view in or out for the video — only if it reads as a *view of agent output*, not the centerpiece.
