# Brújula — Demo Runbook

The PRD §7 script mapped to exact commands. Target: 3 minutes, one take.
Everything below works with **zero internet** after setup.

## Before the demo (T-30 min, do in this order)

1. **Start the knowledge service** (terminal 1):
   ```bash
   cd knowledge-service && uvicorn app:app --port 8100
   ```
2. **Start the hub** (terminal 2, laptop that will run the demo):
   ```bash
   set PROTOCOL_KB_URL=http://localhost:8100     # PowerShell: $env:PROTOCOL_KB_URL="http://localhost:8100"
   npm start
   ```
   Note the LAN URL it prints (e.g. `http://192.168.137.1:8000`).
3. **Warm the model** — do NOT skip; a cold model stalls the first report for minutes:
   ```bash
   curl -X POST http://localhost:8000/warmup
   ```
   Wait for `"warmed": true`. Calls now keep the model resident for 60 min,
   but re-warm if the machine reboots or the model is switched.
4. **Reset + seed the board**:
   ```bash
   curl -X POST http://localhost:8000/board/reset
   curl -X POST http://localhost:8000/board/seed
   ```
   Seeds (from `fixtures/seed_board.json`): water-less shelter in Macuto
   (~300 people), 45 people outdoors in Caraballeda, idle excavator crew in
   Caraballeda, mobile clinic in Maiquetía, 10,000 L water truck in Catia La Mar.
5. **Join the phone to the laptop hotspot**, open the LAN URL in its browser.
6. **Airplane mode both devices** (hotspot stays on). Verify `GET /health` still ok.
7. **Dry-run once end-to-end**, then reset + reseed (step 4 again).

## The script (3:00)

**0:00–0:15 — Offline proof.** Show both devices in airplane mode. "The network
in La Guaira is down. Cloud AI is dead. Everything you'll see runs on this
laptop."

**0:15–0:45 — Field report arrives.** On the phone, submit (voice via the app,
or paste in the test console):

> *urgente, edificio de 4 pisos colapsado en Playa Grande, Catia La Mar.
> escuchamos voces bajo los escombros, calculamos unas 20 personas atrapadas.
> necesitamos maquinaria pesada YA*

**0:45–1:05 — Gemma parses it live.** Show the action card: `need · machinery ·
Playa Grande, Catia La Mar · ~20 people · CRITICAL` — messy Spanish speech →
structured incident, ranked **priority 1** above everything on the board.

**1:05–1:25 — The proposal.** Same card: the agent proposes the **idle
excavator crew from Caraballeda** — point at the reasoning: it *rejected the
closer water truck because capability beats distance*.

**1:25–1:45 — Dedup.** Submit the second report (different words, same event):

> *confirmado derrumbe total de un edificio residencial en playa grande.
> vecinos dicen que hay gente viva adentro, quizas 15 o mas. no hay equipos
> trabajando en el sitio todavia*

The agent merges it into the same incident — board still shows ONE collapse,
no second team dispatched. "This is the duplicate-dispatch failure that costs
lives — solved."

**1:45–2:10 — Human in command.** Coordinator taps **Confirm** on the dispatch
(`POST /dispatches/DSP-001/confirm`). Resource → committed. "The agent
proposes; the human decides. Always."

**2:10–2:30 — Protocol advisory.** Open the collapse incident
(`GET /incidents/INC-003`): INSARAG steps — silence periods to locate live
victims, shore before entry. Open the water shelter (`INC-001`): Sphere —
15 L/person/day, chlorination, latrine spacing. All from the local knowledge
base, offline.

**2:30–2:45 — Sitrep.** `GET /sitrep` → plain-language situation report for
the next shift, generated on the spot.

**2:45–3:00 — Close.** "Messy reports in, coordinated action out. No
connectivity. Nothing left this laptop. Brújula is the tool that works when
everything else has failed."

## Fallbacks

| If | Then |
|---|---|
| Model reply feels slow | You forgot warmup, or GPU toggle is off — check `GET /health` → `gpu_in_use` |
| Dedup or match makes a weird call | Reset + reseed (10 s) and rerun — decisions are temperature-0 but input-order dependent |
| Knowledge service down | Advisory falls back to the built-in KB automatically — demo continues, nobody notices |
| Phone won't reach hub | Use the laptop's own browser at `localhost:8000` — the story survives, offline claim intact |
| Everything on fire | `npm run verify:agent` is the whole demo as one command with PASS lines — screen-record ahead of time as backup footage |

## Rehearsal checklist

- [ ] Full run under 3:00, timed
- [ ] Warmup done < 60 min before going live
- [ ] Board reseeded after every rehearsal
- [ ] Backup screen recording of `verify:agent` on the GPU laptop
- [ ] Airplane-mode toggle visible in frame at 0:00
