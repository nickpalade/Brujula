// Standalone pipeline harness — NO Express, NO store, NO `npm start` needed.
// Talks straight to a live Ollama (spawns embedded `ollama serve` if not up).
//
//   node server/pipeline/test-pipeline.js            # 3 runs, all cases
//   node server/pipeline/test-pipeline.js --runs 1   # single run
//   node server/pipeline/test-pipeline.js --case dedup
//
// Gates (from PRD §7 + the PIPELINE task): the two differently-worded Playa
// Grande collapse reports MUST dedup-merge, and the idle excavator near
// Caraballeda MUST match the collapse. The suite must pass 3 runs in a row.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { logger } from "../logger.js";
import * as ollamaLifecycle from "../ollama-lifecycle.js";
import {
  dedupCheck,
  generateSitrep,
  parseReport,
  prioritize,
  proposeMatch,
} from "./index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "..", "..", "fixtures");

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf-8"));
}

// ------------------------------------------------------------- demo inputs
// PRD §7 step 2 — the spoken report.
const REPORT_A =
  "Edificio colapsado en Playa Grande, Catia La Mar. Escuchamos voces, unas 20 " +
  "personas atrapadas. Necesitamos maquinaria pesada.";

// PRD §7 step 4 — a SECOND, differently-worded report of the SAME collapse.
const REPORT_B =
  "Urgente! Se vino abajo un edificio de apartamentos en Playa Grande, por Catia " +
  "La Mar. Hay como veinte personas debajo de los escombros y se oyen gritos. " +
  "Manden una retroexcavadora ya.";

// A clearly UNRELATED report — dedup must NOT merge this into the collapse.
const REPORT_UNRELATED =
  "En el refugio de la escuela en Catia La Mar no hay agua potable desde ayer, " +
  "somos como 200 personas y los niños están tomando agua sucia.";

// ------------------------------------------------------------- assert plumbing
let currentChecks = [];

function check(label, ok, detail = "") {
  currentChecks.push({ label, ok, detail });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`      [${mark}] ${label}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

function incidentFromParsed(parsed, id, minutesAgo = 0) {
  const ts = new Date(Date.now() - minutesAgo * 60000).toISOString();
  return {
    id,
    kind: parsed.kind,
    category: parsed.category,
    location: parsed.location,
    people_count: parsed.people_count,
    urgency: parsed.urgency,
    status: "open",
    summary: parsed.summary,
    merged_report_ids: [],
    proposed_dispatch_id: null,
    created_at: ts,
    updated_at: ts,
  };
}

const latencies = {}; // step → [ms, ...]
async function timed(step, fn) {
  const t0 = Date.now();
  const out = await fn();
  const ms = Date.now() - t0;
  (latencies[step] ??= []).push(ms);
  console.log(`      (${step}: ${ms}ms)`);
  return out;
}

// ------------------------------------------------------------- the run
async function runOnce(runIdx, only) {
  currentChecks = [];
  console.log(`\n── RUN ${runIdx} ─────────────────────────────────────────────`);
  const want = (c) => only === "all" || only === c;

  let parsedA = null;

  // 1. PARSE
  if (want("parse") || want("dedup")) {
    console.log("  1. PARSE  (report A → structured incident)");
    parsedA = await timed("parse", () => parseReport(REPORT_A, "es"));
    console.log(`      → ${JSON.stringify(parsedA)}`);
    if (want("parse")) {
      check("kind = need", parsedA.kind === "need", parsedA.kind);
      check("category = rescue", parsedA.category === "rescue", parsedA.category);
      check("urgency = critical", parsedA.urgency === "critical", parsedA.urgency);
      check(
        "location mentions Playa Grande",
        /playa\s*grande/i.test(parsedA.location ?? ""),
        String(parsedA.location),
      );
      check("people_count = 20", parsedA.people_count === 20, String(parsedA.people_count));
    }
  }

  // 2. DEDUP  ── GATE: the two collapse reports must merge; unrelated must not.
  if (want("dedup")) {
    console.log("  2. DEDUP  (report B vs open board — must MERGE)");
    const incidentA = incidentFromParsed(parsedA, "inc-collapse-1", 5);
    const parsedB = await timed("parse", () => parseReport(REPORT_B, "es"));
    console.log(`      report B → ${JSON.stringify(parsedB)}`);
    const dupB = await timed("dedup", () => dedupCheck({ ...parsedB, raw_text: REPORT_B }, [incidentA]));
    console.log(`      dedup(B) → ${JSON.stringify(dupB)}`);
    check("report B flagged duplicate", dupB.is_duplicate === true);
    check(
      "matches the Playa Grande collapse",
      dupB.matching_incident_id === "inc-collapse-1",
      String(dupB.matching_incident_id),
    );

    console.log("  2b. DEDUP  (unrelated water report — must NOT merge)");
    const parsedU = await timed("parse", () => parseReport(REPORT_UNRELATED, "es"));
    const dupU = await timed("dedup", () => dedupCheck({ ...parsedU, raw_text: REPORT_UNRELATED }, [incidentA]));
    console.log(`      dedup(unrelated) → ${JSON.stringify(dupU)}`);
    check("unrelated report NOT merged into collapse", dupU.is_duplicate === false);
  }

  // 3. MATCH  ── GATE: idle excavator near Caraballeda must be chosen.
  if (want("match")) {
    console.log("  3. MATCH  (collapse need → available resources)");
    const seedIncidents = loadFixture("seed_incidents.json");
    const resources = loadFixture("seed_resources.json");
    const collapse = seedIncidents.find((i) => i.category === "rescue");
    const match = await timed("match", () => proposeMatch(collapse, resources));
    console.log(`      match → ${JSON.stringify(match)}`);
    check("a match was proposed", match !== null);
    check(
      "chose the Caraballeda excavator",
      match?.resource_id === "res-seed-excavator-caraballeda",
      String(match?.resource_id),
    );
  }

  // 4. PRIORITIZE  (pure code)
  if (want("prioritize")) {
    console.log("  4. PRIORITIZE  (board ordering)");
    const seedIncidents = loadFixture("seed_incidents.json");
    const ordered = await timed("prioritize", () => prioritize(seedIncidents));
    console.log(`      order → ${ordered.map((i) => `${i.category}/${i.urgency}`).join(" > ")}`);
    check("live-victim rescue ranks first", ordered[0]?.category === "rescue", ordered[0]?.category);
    check("top incident is critical", ordered[0]?.urgency === "critical", ordered[0]?.urgency);
    check(
      "every incident got a numeric urgency_score",
      ordered.every((i) => typeof i.urgency_score === "number"),
    );
  }

  // 6. SITREP
  if (want("sitrep")) {
    console.log("  6. SITREP  (board → situation report text)");
    const board = {
      incidents: loadFixture("seed_incidents.json"),
      resources: loadFixture("seed_resources.json"),
      dispatches: [],
    };
    const sitrep = await timed("sitrep", () => generateSitrep(board));
    console.log(`      → ${JSON.stringify(sitrep).slice(0, 400)}`);
    check("sitrep is a non-trivial string", typeof sitrep === "string" && sitrep.trim().length > 40);
  }

  const failed = currentChecks.filter((c) => !c.ok);
  const ok = failed.length === 0;
  console.log(`  RUN ${runIdx}: ${ok ? "PASS" : "FAIL"} (${currentChecks.length - failed.length}/${currentChecks.length} checks)`);
  return ok;
}

function summariseLatency() {
  console.log("\n── LATENCY (per model step) ──────────────────────────────");
  for (const [step, arr] of Object.entries(latencies)) {
    const avg = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
    const max = Math.max(...arr);
    console.log(`  ${step.padEnd(11)} avg ${String(avg).padStart(6)}ms   max ${String(max).padStart(6)}ms   (n=${arr.length})`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const runsIdx = args.indexOf("--runs");
  const runs = runsIdx >= 0 ? Math.max(1, Number.parseInt(args[runsIdx + 1], 10) || 3) : 3;
  const caseIdx = args.indexOf("--case");
  const only = caseIdx >= 0 ? args[caseIdx + 1] : "all";

  console.log("Brújula pipeline harness — ensuring Ollama is up...");
  const status = await ollamaLifecycle.ensureRunning();
  console.log(`Ollama: ${status.detail}`);
  if (!status.running) {
    console.error("\nFAILURE: Ollama is not running and could not be started. Run bootstrap first.");
    process.exit(1);
  }

  // Warm-up: first call pays the model-load cost; keep it out of the latency stats.
  console.log("Warming up the model (first call loads it into VRAM/RAM)...");
  try {
    await parseReport("Prueba de arranque: edificio dañado en La Guaira.", "es");
    logger.info("[harness] warm-up complete");
  } catch (err) {
    console.error(`\nFAILURE: warm-up parse failed — ${err.message}`);
    process.exit(1);
  }

  const results = [];
  for (let i = 1; i <= runs; i += 1) {
    results.push(await runOnce(i, only));
  }

  summariseLatency();

  const passed = results.filter(Boolean).length;
  const allPass = passed === runs;
  console.log("\n" + "=".repeat(60));
  console.log(`${allPass ? "SUCCESS" : "FAILURE"}: ${passed}/${runs} runs passed` + (allPass ? " (gates green 3× in a row)" : ""));
  console.log("=".repeat(60));

  ollamaLifecycle.shutdown();
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error("\nFAILURE: harness crashed:", err);
  ollamaLifecycle.shutdown();
  process.exit(1);
});
