# Brújula — How it works & how to explain it in the video

Presenter guide for the **≤1 minute** RAISE submission demo.  
Pair with [DEMO.md](DEMO.md) for setup/rehearsal and [README.md](README.md) for judges reading the repo.

---

## The one sentence pitch

**Brújula is an offline coordination agent: messy field reports go in, Gemma on the command-post laptop structures them, matches needs to resources, and proposes dispatches — but a human coordinator always confirms before anything moves.**

---

## Video structure (three acts)

| Act | Who / what | Time | Goal |
|---|---|---|---|
| **1. Hook** | Ceco on camera or fast-cut B-roll | **≤10 s** | Stakes only — real disaster, no network, local Gemma |
| **2. Explain** | Voice-over on laptop screen | **~25 s** | Show *how* it works — Gemma as the brain, not a dashboard |
| **3. Live proof** | Phone + Command Post on screen | **~25 s** | One report end-to-end: submit → parse → proposal → confirm |

Total ≤ 60 s. **Demo is 50% of judging** — show the product, not slides.

---

## Act 1 — Ceco hook (≤10 seconds)

**On screen:** Brújula logo → cut to laptop + phone, both with **no internet** (airplane mode or Wi‑Fi off on phone; laptop disconnected from venue uplink but hotspot still on).

**Say something like:**

> *"June 2026 — twin earthquakes hit La Guaira. Comms are down. Cloud AI is unreachable. Brújula runs Gemma locally on the command-post laptop — zero internet, privacy-first."*

**Do not** explain the pipeline yet. Do not tour features. End the hook and cut to the laptop screen.

---

## Act 2 — How everything works (~25 seconds)

**On screen:** Open **`/command/graph`** (Command Post → graph view). Zoom so the **Gemma brain node** is visible in the centre, with seeded incidents/resources around it.

### What to explain (simple version)

Think of Brújula as **three layers**:

```
┌─────────────────────────────────────────────────────────┐
│  FIELD (phone)     Voice / text / photo reports         │
│       │            Saved on phone first (outbox)        │
│       ▼            Syncs over laptop hotspot — no cloud  │
├─────────────────────────────────────────────────────────┤
│  GEMMA (laptop)    The brain — multi-step agent         │
│       │            Parse → Dedup → Rank → Match         │
│       ▼            Structured JSON every step           │
├─────────────────────────────────────────────────────────┤
│  HUMAN (coordinator)  Confirm or override every dispatch│
│       │            Nothing moves without a tap          │
│       ▼                                                 │
│  FIELD (phone)     Assignment appears in inbox          │
└─────────────────────────────────────────────────────────┘
```

### Voice-over script (pick lines that fit ~25 s)

While pointing at the graph:

1. **"Field responders submit messy reports — Spanish voice, text, or a photo."**  
   Gesture toward report nodes on the left.

2. **"Every report hits Gemma on this laptop — not the cloud. Gemma is the brain."**  
   Point at the **Gemma** node in the centre.

3. **"It runs a real agent workflow: parse the report into structure, check if it's a duplicate of something already on the board, rank urgency, then propose which resource to send."**  
   Trace edges: report → Gemma → incident → dispatch → resource.

4. **"Retrieval is one tool inside that workflow — protocol steps from a local knowledge base — not the whole product."**  
   One sentence only; judges care you are not "basic RAG."

5. **"The coordinator always confirms. Gemma proposes — humans decide."**  
   Point at the approval bar or a proposed dispatch with the gold accent.

**Privacy line (one breath):**

> *"Missing-person names, locations, medical status — all inference stays on this machine. Nothing leaves the LAN during operation."*

**Track line (one breath):**

> *"That's why Gemma on-device is load-bearing: in this scenario the network is dead and the data is sensitive."*

### What *not* to say in Act 2

- Do not list every button or settings menu.
- Do not say "dashboard" — say **agent**, **brain**, **workflow**, **confirm loop**.
- Do not claim cloud AI is used in the field (`CLOUD_API_KEY` is dev-only).

---

## Act 3 — Live phone report (~25 seconds)

**On screen:** Split attention — phone in frame for submit; cut to Command Post when the incident lands.

### Before you record

Run the prep checklist from [DEMO.md](DEMO.md): hotspot, `npm start`, warmup, `npm run seed`, refresh Command Post + relaunch field app.

**Current seeded board** (after `npm run seed`):

| Already on the board | |
|---|---|
| HIGH · water | Shelter in Catia La Mar, ~60 people, no drinking water |
| MEDIUM · medical | Insulin/fever case at Refugio San José |
| Resources | Water tanker (La Guaira), improvised clinic (Catia La Mar) |

Rehearse once so you know **which resource Gemma proposes** for the collapse report (depends on live match). Narrate the rationale you actually see — do not read a script that assumes an excavator unless your board has one.

### Live script

**Step 1 — Submit (phone, ~8 s)**  
Show phone on hotspot, no internet. Open the field app (Brújula home-screen icon).

Tap the mic or type, then **ENVIAR REPORTE**:

> *"Urgente — edificio de cuatro pisos colapsado en Playa Grande, Catia La Mar. Escuchamos voces bajo los escombros, unas veinte personas atrapadas. Necesitamos maquinaria pesada ya."*

**Say while sending:**

> *"Saved on the phone first — if the radio drops, nothing is lost."*  
> (Point at outbox: QUEUED → SYNCED.)

**Step 2 — Incident lands (Command Post, ~8 s)**  
Cut to `/command` feed or graph. Wait for the new card (GPU: ~10–15 s; **keep talking**, never silent):

> *"Gemma parsed that messy Spanish into a structured incident — rescue, critical, location, headcount."*

Point at: **category · location · people · urgency · priority rank**.

**Step 3 — Confirm (Command Post → phone, ~9 s)**  
Show the **proposed dispatch** — graph approval bar, feed card, or inspector:

> *"The agent matched a resource and explained why — capability and distance, not just the closest pin."*

Tap **Confirm** (or **Approve** in the graph approval bar).

Cut to phone **Asignaciones**:

> *"Assignment on the phone. Agent proposes — coordinator confirms."*

**Close line (last 3 seconds):**

> *"No connectivity. Nothing left this laptop. Brújula works when everything else has failed."*

---

## How the system works (reference — for you, not the whole video)

Use this section to answer judge questions or if Act 2 runs long.

### 1. Field client (phone)

| Piece | What it does |
|---|---|
| **PWA** | Install from `http://<hub-ip>:8000/field` → Add to Home Screen |
| **Role signup** | Reporter, volunteer, or crew — crews become dispatchable resources |
| **Outbox** | Report saved locally (QUEUED) → syncs to hub (SYNCED) → pipeline marks PARSED |
| **Voice** | Phone records → hub runs **local STT** → editable text before send |
| **Photo** | Compressed on-device (~100–250 KB) → multimodal Gemma reads damage/hazards |
| **GPS** | Attached when granted; otherwise offline gazetteer places the pin |
| **Assignments** | Confirmed dispatches show in the inbox after coordinator confirms |

### 2. Hub (laptop)

| Piece | What it does |
|---|---|
| **Express + SQLite** | One server at `:8000` — API, static React app, tile server |
| **Hotspot** | Phones join laptop Wi‑Fi; no internet required in the field |
| **Embedded Ollama** | Server spawns `ollama serve`; Gemma at `localhost:11434` |
| **Fast ack** | Hub accepts report in ≤20 s; slow parse finishes in background |
| **Delta sync** | `GET /api/sync?since=` — phones poll for board updates |

### 3. Gemma agent pipeline (the brain)

Triggered on every `POST /api/reports`:

| Step | Model? | Output |
|---|---|---|
| **PARSE** | Gemma | `{kind, category, location, people_count, urgency, summary, persons[]}` |
| **DEDUP** | Gemma | Match to existing incident id (enum-locked) or new incident |
| **PRIORITIZE** | Code only | Ranked board — urgency × people × age |
| **MATCH** | Gemma | Proposed `resource_id` + rationale (enum-locked candidates) |
| **ADVISE** | KB retrieval | Protocol steps on demand (`POST /api/advise`) |
| **EMIT** | Code | Dispatch card `proposed` until human confirms |

**Why this is an agent, not RAG:** multiple steps, conditional logic (dedup only if open incidents exist), tool calls (KB, geocoder, store), structured decisions, human-gated actions.

### 4. Command Post (coordinator UI)

| Surface | What it shows |
|---|---|
| **`/command`** | Prioritized feed, map, incident drawer, SITREP, settings |
| **`/command/graph`** | Relationship graph — **Gemma brain** centre node, SmartEdge routes, Organise layout, inspector sidebar |
| **Approval bar** | Pending dispatches surfaced at top — no hunting the board |
| **Ask Gemma** | Context chat — answers from live board + KB; can propose graph edits you **Apply** manually |
| **Confirm / Override** | Human-in-command — every dispatch |

### 5. Privacy (say if asked)

- Inference: **localhost only** (Ollama on hub laptop).
- Reports, incidents, persons: **SQLite on hub** — not sent to Google/OpenAI in field config.
- Photos: sent to Gemma for parse only — **not stored as image files**.
- Voice: transcribed on hub — **audio not retained**.
- Map tiles: downloaded once to laptop — served to phones over LAN.
- Cloud provider exists for dev (`CLOUD_API_KEY`) — **leave unset in demo**.

### 6. Protocol knowledge (Rares)

- `knowledge-service/` on `:8100` — INSARAG, START triage, Sphere WASH, PAHO shelter guidance.
- Hub proxies `POST /api/advise` — falls back to built-in JSON if service is down.
- **Operational protocols for trained responders** — not patient diagnosis (DQ boundary).

---

## Gemma JSON in plain English (if a judge asks)

| Step | Gemma returns | Server enforces |
|---|---|---|
| Parse | What kind of report, how urgent, where, how many people | Zod schema; invalid → retry once |
| Dedup | "Same as incident X?" + confidence | `incident_id` must be real id on board |
| Match | "Send resource Y" + why | `resource_id` must be available resource |
| Chat | Answer + optional `proposed_actions` | Actions re-validated; field station cannot propose edits |

---

## Screen layout tips

| Moment | Recommended screen |
|---|---|
| Act 1 hook | Phone settings (no internet) + laptop hotspot on |
| Act 2 explain | `/command/graph` — brain node centred, edges visible |
| Act 3 submit | Phone field app — report form + outbox chip |
| Act 3 result | Command Post feed or graph — new incident + proposal |
| Act 3 confirm | Inspector or approval bar → phone assignments tab |

**Recording:** 1080p landscape for laptop; phone can be picture-in-picture or cut. Keep UI text readable — judges must see **your** UI, not stock footage.

---

## Timing cheatsheet

| If… | Then… |
|---|---|
| Incident slow to appear | Keep narrating the seeded board; Gemma needs ~10–15 s on GPU |
| You're running long | Shorten Act 2; never cut the close line |
| You're running short | Add one graph pan showing report → Gemma → incident edge |
| Match proposes unexpected resource | Say: *"Gemma explains its choice in the rationale — we confirm or override"* |

---

## Q&A ammunition (not in the 1-minute video)

Rehearse each once; one action per answer:

| Judge asks | Show |
|---|---|
| *"Duplicate reports?"* | Send second collapse wording → one incident, two reports in drawer |
| *"Multimodal?"* | 📷 photo on rubble → Gemma reads damage from image |
| *"Is advice safe?"* | Incident drawer → protocol panel, INSARAG sources, offline |
| *"Handoff?"* | SITREP button → plain-language summary |
| *"Who are resources?"* | Second phone registers as crew → appears on board |
| *"Offline proof?"* | `GET /health` + airplane mode still syncing |
| *"Not a dashboard?"* | Graph + narrate agent steps, not charts |

---

## Submission checklist

- [ ] Video ≤ 60 s uploaded (YouTube / Loom)
- [ ] Public repo linked
- [ ] Description mentions: **Google DeepMind Remote**, **local Gemma**, **human confirm loop**
- [ ] Video shows work built during hackathon — pipeline, field sync, confirm, graph
- [ ] Ceco hook ≤ 10 s
- [ ] Live phone report is clearly **your** UI

**Submit:** [Cerebral Valley form](https://cerebralvalley.ai/e/raise-summit-hackathon/hackathon/submit)

---

## Suggested division of labour

| Person | Video role |
|---|---|
| **Ceco** | Act 1 hook (on camera or voice) |
| **Nick / Pepe** | Act 2 voice-over on graph + Act 3 live demo operation |
| **Rares** | Optional Q&A voice for protocol KB if judges ask post-submit |

---

## Lines to memorize

**Hook (Ceco):**  
*"Comms down in La Guaira. Cloud AI is dead. Brújula runs Gemma on the command-post laptop — offline, private, local."*

**Brain (Act 2):**  
*"Gemma is the brain — parse, dedup, rank, match — then the coordinator confirms."*

**Close (Act 3):**  
*"No connectivity. Nothing left this laptop. Brújula works when everything else has failed."*
