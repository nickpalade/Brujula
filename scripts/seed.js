#!/usr/bin/env node
// Brújula demo reset — `npm run seed`
//
// Wipes the hub store and reloads the pre-seeded PRD §7 demo board from
// fixtures/ so Nick can reset between rehearsals in one command. Fully offline
// (no network required). Reads only fixtures/ + the hub's own store.reset().
//
// Two paths, tried in order:
//   1. Live reset — if the hub is running and exposes POST /api/board/reset,
//      hit it so the running server's in-memory board refreshes immediately
//      (no restart needed). Optional endpoint; absence is not an error.
//   2. File reset — always run store.reset(), which wipes the SQLite store
//      (data/hub.db) and reseeds from fixtures/seed_incidents.json +
//      fixtures/seed_resources.json. This is what a cold `npm start` will load.

import { reset, listDispatches, listIncidents, listResources } from "../server/store.js";

const HUB_URL = process.env.BRUJULA_URL || "http://localhost:8000";
const RESET_ENDPOINT = `${HUB_URL}/api/board/reset`;

async function tryLiveReset() {
  try {
    const res = await fetch(RESET_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) return true;
    // Endpoint not implemented yet (404) or other status — fall through to file reset.
    return false;
  } catch {
    // Hub not running / unreachable — expected when reseeding before `npm start`.
    return false;
  }
}

async function main() {
  const live = await tryLiveReset();

  // Always refresh the on-disk store so a cold boot loads the fresh board.
  reset();
  const incidents = listIncidents();
  const resources = listResources();
  const dispatches = listDispatches();

  console.log("");
  console.log("  Brújula — demo board reset");
  console.log("  " + "-".repeat(46));
  console.log(`  Incidents seeded: ${incidents.length}`);
  for (const i of incidents) {
    const people = i.people_count == null ? "—" : i.people_count;
    console.log(`    · [${i.urgency.toUpperCase()}] ${i.category} · ${people} ppl · ${i.location}`);
  }
  console.log(`  Resources seeded: ${resources.length}`);
  for (const r of resources) {
    console.log(`    · ${r.type} · ${r.label} · ${r.location}`);
  }
  console.log(`  Dispatches seeded: ${dispatches.length}`);
  for (const d of dispatches) {
    console.log(`    · [${d.state.toUpperCase()}] ${d.incident_id} → ${d.resource_id}`);
  }
  console.log("  " + "-".repeat(46));
  if (live) {
    console.log("  Live hub refreshed via POST /api/board/reset — no restart needed.");
  } else {
    console.log("  data/hub.db rewritten. If the hub is RUNNING, restart it");
    console.log("  (Ctrl+C then `npm start`) so it reloads the fresh board.");
    console.log("  (Ollama stays warm across a Node restart — re-warm not needed.)");
  }
  console.log("");
}

main().catch((err) => {
  console.error("seed failed:", err.message);
  process.exit(1);
});
