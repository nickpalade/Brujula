# Brújula — Demo Runbook

The PRD §7 flow cut to the slot: **1 minute, one take.** Everything below
works with **zero internet** after setup. The demo runs through the React
app: **Command Post** on the laptop, **field client installed on the phone**
like a native app. One report, start to finish — everything else stays
loaded as Q&A ammunition (see "Cut beats" below).

## Before the demo (T-30 min, do in this order)

1. **Hotspot ON** (demo laptop): Settings → Network & internet → Mobile
   hotspot. If the toggle refuses (Windows quirk), this PowerShell turns it on
   directly:
   ```powershell
   $p = [Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime]::GetInternetConnectionProfile()
   $tm = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime]::CreateFromConnectionProfile($p)
   $tm.StartTetheringAsync() | Out-Null; Start-Sleep 3; $tm.TetheringOperationalState   # → On
   ```
   The laptop's hotspot address is `192.168.137.1`. SSID + password are in the
   hotspot settings page.

2. **Start the knowledge service** (terminal 1):
   ```powershell
   cd knowledge-service; py -m uvicorn app:app --port 8100
   ```

3. **Start the hub** (terminal 2):
   ```powershell
   $env:PROTOCOL_KB_URL = "http://localhost:8100"; npm start
   ```
   The React app must be built once before (`cd app && npm install && npm run
   build`) — the banner logs `serving built React app` when it found it.

4. **Warm the model** — do NOT skip; a cold model stalls the first report for
   minutes:
   ```powershell
   curl.exe -X POST http://localhost:8000/warmup
   ```
   Wait for `"warmed": true`. The model then stays resident for 60 min; re-warm
   after a reboot or model switch.

5. **Reset + seed the board**:
   ```powershell
   npm run seed
   ```
   Seeds (fixtures/): water-less shelter in Catia La Mar (~180 people),
   45 people outdoors in Los Corales, insulin/fever case at Refugio San José,
   blocked coastal road near Maiquetía + excavator crew, clinic, water truck.
   **Then refresh the Command Post page and relaunch the field app** — clients
   remember the old sync cursor and won't repaint until reopened.

6. **Phone setup** (one-time; survives reboots): join the laptop hotspot,
   open `http://192.168.137.1:8000/field` in Safari → Share → **Add to Home
   Screen**. The Brújula compass icon appears and opens fullscreen. First
   open asks for a role — pick **Reportero** for the demo phone (volunteers /
   specialized crews get registered on the board as dispatchable resources;
   a good second-phone beat, and "cambiar" in the header switches role).
   Command laptop: open `http://localhost:8000/command`.

7. **Kill the uplink** (unplug ethernet / disconnect laptop Wi-Fi from the
   venue network — the hotspot keeps running). Verify `GET /health` still ok
   and the phone still syncs (green "Hub conectado" pill).

8. **Dry-run once end-to-end**, then reset + reseed (step 5 again).

## The script (1:00)

One continuous arc: messy voice report → structured incident → AI proposal →
human confirm → assignment on the phone. Submit EARLY — Gemma needs ~10-15 s
on the GPU for parse + dedup + match, and the narration covers it.

**0:00–0:10 — Offline proof + report.** Phone in frame: no internet, hotspot
only. "The network in La Guaira is down. Cloud AI is dead. Everything runs on
this laptop." While saying it, dictate on the phone and hit ENVIAR REPORTE:

> *urgente, edificio de 4 pisos colapsado en Playa Grande, Catia La Mar.
> escuchamos voces bajo los escombros, calculamos unas 20 personas atrapadas.
> necesitamos maquinaria pesada YA*

**0:10–0:25 — Cover the parse.** Outbox chip flips QUEUED → SYNCED — "saved
on the phone first; radio can die and nothing is lost." Pan the Command Post
seeded board: "every card here started as messy Spanish voice like that one."

**0:25–0:40 — The incident lands.** Card appears: `rescue · Playa Grande ·
~20 people · CRITICAL`, ranked **priority 1** above the whole board. "Messy
speech in, structured triage out — Gemma, on this laptop."

**0:40–0:52 — Proposal → human confirm.** The agent proposes the **idle
excavator crew from Caraballeda** — point at the rationale: *it rejected the
closer water truck; capability beats distance*. Click **Confirm**; the
assignment pops on the phone's Asignaciones tab. "The agent proposes; the
human decides. Always."

**0:52–1:00 — Close.** "No connectivity. Nothing left this laptop. Brújula
works when everything else has failed."

If the card hasn't landed by 0:25, stretch the board tour — the beats tolerate
±10 s; the close line does not. Never wait in silence.

## Cut beats — keep loaded for Q&A

Each of these is one action, pre-rehearsed, ready when a judge asks:

- **Dedup** ("what about duplicate reports?"): send the second collapse report
  (different words, same event) — board still shows ONE incident; open the
  drawer, show both merged reports as evidence:
  > *confirmado derrumbe total de un edificio residencial en playa grande.
  > vecinos dicen que hay gente viva adentro, quizas 15 o mas.*
- **Photo triage** ("multimodal?"): 📷 Añadir foto on a rubble photo —
  compressed on-device, rides the offline outbox, Gemma reads
  damage/hazards/people from it. Only if rehearsed once with a real photo.
- **Protocol advisory** ("is the guidance safe?"): incident drawer → INSARAG
  steps (silence periods, shore before entry) from the local knowledge
  service, offline, with sources.
- **Sitrep** ("handoff?"): one click → plain-language situation report.
- **Roles/crew status** ("who are the resources?"): volunteers and crews
  register from their phones and become dispatchable; engaged crews are
  excluded from matching in code.

## Fallbacks

| If | Then |
|---|---|
| Model reply feels slow | You forgot warmup, or the GPU toggle is off — check `GET /health` → `gpu_in_use` |
| Report stays SYNCED, no incident | Pipeline still chewing (fine on GPU in seconds). The hub acks within 20 s and finishes parsing in background; the incident appears on the board via sync when done |
| Dedup or match makes a weird call | `npm run seed` (10 s), refresh pages, rerun — decisions are temperature-0 but input-order dependent |
| Knowledge service down | Advisory falls back to the built-in KB automatically — demo continues, nobody notices |
| Phone won't reach hub | Windows firewall: allow node.exe inbound (or use the laptop's own browser at `localhost:8000/field` — story survives, offline claim intact) |
| Board looks stale/empty after reseed | Refresh the Command Post tab and relaunch the phone app (old sync cursor) |
| The yellow OFFLINE pill | Not an error — it's the pitch ("no internet, everything local"). The connection indicator is the SYNCED pill next to it |
| Everything on fire | `npm run verify:hub` is the whole demo as one command with PASS lines — screen-record it on the GPU laptop ahead of time as backup footage |

## Rehearsal checklist

- [ ] Full run under 1:00, timed (including the Gemma wait — rehearse on the
      demo GPU, not a CPU laptop)
- [ ] Q&A cut-beats each tried once (dedup, advisory, sitrep at minimum)
- [ ] `npm run verify:hub` green on the GPU laptop (15 checks)
- [ ] Warmup done < 60 min before going live
- [ ] Board reseeded + pages refreshed after every rehearsal
- [ ] Brújula icon installed on the demo phone (Add to Home Screen)
- [ ] Backup screen recording of `verify:hub` on the GPU laptop
- [ ] Phone visibly without internet in frame at 0:00
