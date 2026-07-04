// Brújula end-to-end verifier (agent VERIFY).
//
// Proves the running hub demos the PRD §7 flow and hunts the demo-killers.
// Three sections, each printing one SUCCESS:/FAILURE: line per check (same
// style as the original parse-report smoke test):
//
//   1. E2E     — health → submit report → parsed incident → duplicate merges →
//                match proposed → confirm dispatch → in sync feed → advise → sitrep
//   2. OFFLINE — no outbound internet: cloud provider off, Ollama localhost-only,
//                no external/CDN URLs baked into the built app/dist bundle
//   3. DRILLS  — the failure modes that kill a live demo: double-confirm
//                idempotency, malformed input, store persistence (restart survival)
//
// Usage:
//   node verify.js                                  # all sections, localhost
//   node verify.js --url http://192.168.137.1:8000  # from the LAN side
//   node verify.js --section e2e|offline|drills|all
//   node verify.js --section offline                # bundle audit needs no server
//
// Exit code 0 iff every non-skipped check passed. MANUAL/observational checks
// print a NOTE and never fail the run — see context/verify-report.md for the
// drills that need an operator (cold Ollama, physical airplane mode).

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP_DIST = path.join(ROOT, "app", "dist");
// The hub store is SQLite (server/store.js → data/hub.db), not the old JSON
// file. The restart-survival drill opens it read-only and queries directly.
const STORE_FILE = path.join(ROOT, "data", "hub.db");

// ---- tiny result tracker ---------------------------------------------------

let passed = 0;
let failed = 0;
const failures = []; // {step, detail} — echoed in the summary for the report

function pass(step, msg = "") {
  passed += 1;
  console.log(`SUCCESS: ${step}${msg ? ` — ${msg}` : ""}`);
}
function fail(step, msg = "") {
  failed += 1;
  failures.push({ step, detail: msg });
  console.log(`FAILURE: ${step}${msg ? ` — ${msg}` : ""}`);
}
function note(msg) {
  console.log(`NOTE: ${msg}`);
}
function section(title) {
  console.log(`\n${"=".repeat(60)}\n  ${title}\n${"=".repeat(60)}`);
}

// ---- HTTP helper -----------------------------------------------------------

// Returns {ok, status, body, error}. Never throws — a network failure is a
// result, not a crash (the whole point of an offline tool is graceful degrade).
// Uses a manually-cleared AbortController timer (not AbortSignal.timeout) so no
// stray timer/handle survives to trip a libuv assertion at process exit.
async function call(base, endpoint, { method = "GET", body, timeout = 30_000, rawBody } = {}) {
  const url = `${base}${endpoint}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const init = { method, signal: controller.signal };
  if (rawBody !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = rawBody; // deliberately unparsed string (malformed-JSON drill)
  } else if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  try {
    const resp = await fetch(url, init);
    let json = null;
    try {
      json = await resp.json();
    } catch {
      json = null;
    }
    return { ok: resp.ok, status: resp.status, body: json };
  } catch (err) {
    return { ok: false, status: 0, body: null, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The two differently-worded reports of the SAME Playa Grande collapse
// (PRD §7 steps 2 + 4). They MUST dedup-merge into one incident.
const PRIMARY_REPORT =
  "Edificio colapsado en Playa Grande, Catia La Mar. Escuchamos voces, " +
  "unas 20 personas atrapadas. Necesitamos maquinaria pesada.";
const DUPLICATE_REPORT =
  "Reporte urgente desde Playa Grande (Catia La Mar): un edificio se vino " +
  "abajo, se oyen personas pidiendo auxilio bajo los escombros. Hacen falta " +
  "máquinas para levantar el concreto, hay como veinte atrapados.";

// ===========================================================================
// SECTION 1 — E2E
// ===========================================================================

async function runE2E(base) {
  section("E2E — PRD §7 demo flow against the running hub");

  // --- health --------------------------------------------------------------
  const health = await call(base, "/health", { timeout: 10_000 });
  if (!health.body) {
    fail("health", `server not reachable at ${base} (${health.error ?? "no body"}). Start it: npm start`);
    note("Aborting E2E — no server. Offline bundle audit can still run: node verify.js --section offline");
    return { aborted: true };
  }
  const info = health.body.data ?? {};
  console.log(
    `  health: provider=${info.provider} model=${info.model} ` +
      `ollama_reachable=${info.ollama_reachable} gpu_in_use=${info.gpu_in_use}`,
  );
  if (!health.body.success || !info.ollama_reachable) {
    fail("health", "/health reports backend not reachable — run bootstrap, then npm start");
    return { aborted: true };
  }
  pass("health", `provider=${info.provider}, model=${info.model}`);

  // Snapshot seq so we can later prove the confirm shows up as a sync delta.
  const seqBefore = (await call(base, "/api/sync?since=0")).body?.data?.seq ?? 0;

  // --- submit primary report ----------------------------------------------
  const t0 = Date.now();
  const sub = await call(base, "/api/reports", {
    method: "POST",
    timeout: 300_000, // first parse can pay a cold-model load
    body: { text: PRIMARY_REPORT, source_device: "verify-field-1", lang: "es" },
  });
  const submitMs = Date.now() - t0;
  if (sub.status !== 200 || !sub.body?.success || !sub.body.data?.report?.id) {
    fail("submit report", `expected 200 + report id, got status=${sub.status} body=${JSON.stringify(sub.body)?.slice(0, 200)}`);
    return { aborted: true };
  }
  const reportId = sub.body.data.report.id;
  pass("submit report", `report ${reportId} accepted in ${submitMs}ms`);
  if (submitMs > 15_000) {
    note(`first report took ${submitMs}ms — model was likely cold. Pre-warm with POST /warmup before the demo (README).`);
  }

  // --- poll until the parsed incident appears ------------------------------
  let incident = sub.body.data.incident ?? null;
  if (!incident) {
    // Pipeline may have degraded to pending; poll the report for parsed_into.
    for (let i = 0; i < 30 && !incident; i += 1) {
      await sleep(1000);
      const rep = await call(base, `/api/reports?ids=${reportId}`);
      const pid = rep.body?.data?.[0]?.parsed_into;
      if (pid) {
        const inc = await call(base, "/api/incidents");
        incident = (inc.body?.data ?? []).find((x) => x.id === pid) ?? null;
      }
    }
  }
  if (!incident) {
    fail("parsed incident appears", `report ${reportId} never produced an incident (stored pending). Pipeline/Ollama down? UI would show SYNCED-not-PARSED — demo-lethal for the parse moment.`);
    return { aborted: true, incidentMissing: true };
  }
  const rescueish = ["rescue", "machinery"].includes(incident.category);
  if (!rescueish) {
    fail("parsed incident appears", `incident ${incident.id} parsed category='${incident.category}' (expected rescue/machinery). summary='${incident.summary}'`);
  } else {
    pass("parsed incident appears", `${incident.id}: ${incident.category}/${incident.urgency} @ ${incident.location} (~${incident.people_count} ppl)`);
  }
  const incidentId = incident.id;

  // --- submit differently-worded duplicate → must MERGE --------------------
  const dup = await call(base, "/api/reports", {
    method: "POST",
    timeout: 300_000,
    body: { text: DUPLICATE_REPORT, source_device: "verify-field-2", lang: "es" },
  });
  if (dup.status !== 200 || !dup.body?.success) {
    fail("duplicate merges", `duplicate submit failed: status=${dup.status} ${dup.body?.error ?? ""}`);
  } else {
    const dupInc = dup.body.data.incident;
    const mergedIntoSame = dupInc && dupInc.id === incidentId;
    const mergeCount = dupInc?.merged_report_ids?.length ?? 0;
    if (mergedIntoSame && mergeCount >= 2) {
      pass("duplicate merges", `both Playa Grande reports collapsed into ${incidentId} (${mergeCount} reports merged)`);
    } else {
      fail(
        "duplicate merges",
        `duplicate did NOT merge — it created/hit incident '${dupInc?.id}' (merged=${mergeCount}) instead of '${incidentId}'. ` +
          `This is the money-shot of demo step 5; a missed merge = duplicate dispatch on stage. Re-run (LLM nondeterminism) or tighten dedup prompt.`,
      );
    }
  }

  // --- refresh incident + assert a match was proposed ----------------------
  const incs2 = await call(base, "/api/incidents");
  incident = (incs2.body?.data ?? []).find((x) => x.id === incidentId) ?? incident;
  const dispatchId = incident.proposed_dispatch_id;
  let dispatch = null;
  if (!dispatchId) {
    fail("match proposed", `incident ${incidentId} has no proposed_dispatch_id — the AI did not propose a resource (excavator). No CONFIRM moment to demo.`);
  } else {
    const syncAll = await call(base, "/api/sync?since=0");
    dispatch = (syncAll.body?.data?.dispatches ?? []).find((d) => d.id === dispatchId) ?? null;
    if (dispatch && dispatch.state === "proposed" && dispatch.resource_id) {
      pass("match proposed", `dispatch ${dispatchId}: resource ${dispatch.resource_id} → ${incidentId} (${dispatch.proposed_by_ai ? "AI-proposed" : "manual"})`);

      // Match QUALITY: a building collapse must get machinery/rescue, NOT a
      // clinic or water truck. Proposing a category-incompatible resource is a
      // demo-killer (PRD §7.6 = "idle excavator → collapse"). Compatible types
      // per incident category (rescue↔machinery are interchangeable for USAR).
      const COMPAT = {
        rescue: ["machinery", "rescue"],
        machinery: ["machinery", "rescue"],
        medical: ["medical"],
        water: ["water"],
        shelter: ["shelter"],
        food: ["food"],
      };
      const resources = (await call(base, "/api/resources")).body?.data ?? [];
      const chosen = resources.find((r) => r.id === dispatch.resource_id);
      const allowed = COMPAT[incident.category];
      if (chosen && allowed && !allowed.includes(chosen.type)) {
        const avail = resources.filter((r) => r.status === "available");
        const hadCompat = avail.some((r) => allowed.includes(r.type));
        fail(
          "match is category-appropriate",
          `${incident.category} incident matched to a '${chosen.type}' resource (${chosen.id}) — nonsensical on stage. ` +
            (hadCompat
              ? `A compatible '${allowed.join("/")}' resource WAS available — proposeMatch picked the wrong one.`
              : `No compatible '${allowed.join("/")}' resource was available (e.g. excavator already committed) — proposeMatch should return null instead of proposing an incompatible resource. Reseed the board (npm run seed) before the demo.`),
        );
      } else if (chosen && allowed) {
        pass("match is category-appropriate", `${incident.category} → '${chosen.type}' resource (${chosen.label})`);
      }
    } else {
      fail("match proposed", `proposed dispatch ${dispatchId} not found/invalid in sync feed: ${JSON.stringify(dispatch)?.slice(0, 160)}`);
    }
  }

  // --- confirm the dispatch ------------------------------------------------
  if (dispatch && dispatch.state === "proposed") {
    const conf = await call(base, `/api/incidents/${incidentId}/dispatch`, {
      method: "POST",
      body: { dispatch_id: dispatchId, action: "confirm" },
    });
    const d = conf.body?.data;
    if (conf.status === 200 && d?.state === "confirmed" && d?.confirmed_by_human_at) {
      pass("confirm dispatch", `dispatch ${dispatchId} confirmed at ${d.confirmed_by_human_at}`);
    } else {
      fail("confirm dispatch", `expected 200 + state=confirmed, got status=${conf.status} body=${JSON.stringify(conf.body)?.slice(0, 200)}`);
    }
  } else {
    fail("confirm dispatch", "skipped — no proposed dispatch to confirm");
  }

  // --- assert the confirm shows up in the sync delta -----------------------
  const delta = await call(base, `/api/sync?since=${seqBefore}`);
  const dispatches = delta.body?.data?.dispatches ?? [];
  const inFeed = dispatches.find((d) => d.id === dispatchId && d.state === "confirmed");
  if (inFeed) {
    pass("in sync feed", `confirmed dispatch ${dispatchId} present in /api/sync?since=${seqBefore} (field client will see it)`);
  } else {
    fail("in sync feed", `confirmed dispatch ${dispatchId} NOT in sync delta since seq ${seqBefore} — field inbox would never receive the assignment`);
  }

  // --- advise returns steps ------------------------------------------------
  const adv = await call(base, "/api/advise", {
    method: "POST",
    timeout: 15_000,
    body: { incident_type: "rescue", context: "edificio colapsado, ~20 atrapados, se oyen voces" },
  });
  const advData = adv.body?.data;
  if (adv.status === 200 && Array.isArray(advData?.steps) && advData.steps.length > 0) {
    pass("advise returns steps", `${advData.steps.length} steps from "${advData.source_label}"`);
    if (!Array.isArray(advData.cautions) || advData.cautions.length === 0) {
      fail("advise safety caution", "advisory has no cautions — the 'not medical advice' disclaimer (PRD §9) must be present on every response");
    } else {
      pass("advise safety caution", `${advData.cautions.length} caution(s) present`);
    }
  } else {
    fail("advise returns steps", `expected 200 + non-empty steps[], got status=${adv.status} body=${JSON.stringify(adv.body)?.slice(0, 200)}`);
  }

  // --- sitrep returns text -------------------------------------------------
  const sit = await call(base, "/api/sitrep", { timeout: 60_000 });
  const text = sit.body?.data?.text;
  if (sit.status === 200 && typeof text === "string" && text.trim().length > 20) {
    pass("sitrep returns text", `${text.length} chars generated`);
  } else {
    fail("sitrep returns text", `expected 200 + non-empty text, got status=${sit.status} body=${JSON.stringify(sit.body)?.slice(0, 200)}`);
  }

  return { aborted: false, incidentId, dispatchId };
}

// ===========================================================================
// SECTION 2 — OFFLINE AUDIT
// ===========================================================================

// Recursively read text-like files under a dir.
function walkFiles(dir, exts) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(full, exts));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(full);
  }
  return out;
}

// Host substrings that are NOT outbound internet (loopback / LAN / placeholders).
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", "::1", "192.168.", "10.", "example.com", "example.org"];
// URL prefixes that are XML/SVG namespaces or spec identifiers, not fetches.
const NAMESPACE_PREFIXES = [
  "http://www.w3.org/",
  "https://www.w3.org/",
  "http://schema.org",
  "https://schema.org",
];
// Framework documentation/error-code hosts. These appear ONLY as string
// constants inside dev-warning messages (e.g. "see https://react.dev/link/...")
// — they are never fetched, so they don't break airplane mode. Surfaced as a
// NOTE, not a failure.
const DOC_HOSTS = ["react.dev", "reactjs.org", "reactrouter.com", "github.com", "tc39.", "developer.mozilla.org"];

function classifyUrl(u) {
  if (NAMESPACE_PREFIXES.some((p) => u.startsWith(p))) return "namespace";
  if (LOCAL_HOSTS.some((h) => u.includes(h))) return "local";
  if (DOC_HOSTS.some((h) => u.includes(h))) return "doc";
  return "external";
}

// The offline killers: external URLs the browser would actually try to LOAD —
// script/link/img `src`/`href` in HTML, and `url(...)`/`@import` in CSS.
// A JS string constant that merely contains a URL is not a load.
function externalResourceUrls(content, ext) {
  const found = new Set();
  const push = (u) => {
    if (u && classifyUrl(u) === "external") found.add(u.replace(/[.,;]+$/, ""));
  };
  if (ext === ".html") {
    for (const m of content.matchAll(/(?:src|href)\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi)) push(m[1]);
  } else if (ext === ".css") {
    for (const m of content.matchAll(/url\(\s*['"]?(https?:\/\/[^'")\s]+)/gi)) push(m[1]);
    for (const m of content.matchAll(/@import\s+['"](https?:\/\/[^'"]+)/gi)) push(m[1]);
  }
  return found;
}

async function runOffline(base, { serverUp }) {
  section("OFFLINE AUDIT — would this survive airplane mode?");

  // --- cloud provider off --------------------------------------------------
  if (serverUp) {
    const health = await call(base, "/health", { timeout: 10_000 });
    const provider = health.body?.data?.provider;
    if (provider === "ollama") {
      pass("cloud provider off", "server reports provider=ollama (CLOUD_API_KEY unset → no outbound Anthropic calls)");
    } else if (provider === "cloud") {
      fail("cloud provider off", "server reports provider=CLOUD — CLOUD_API_KEY is set, so inference goes to api.anthropic.com over the internet. UNSET it in the field (README 'Offline audit').");
    } else {
      note(`could not read provider from /health (got '${provider}') — verify CLOUD_API_KEY is unset before the demo`);
    }
  } else {
    note("server not running — skipping live provider check. Ensure CLOUD_API_KEY is unset when you start it.");
  }

  // --- Ollama localhost-only ----------------------------------------------
  // We can only see this process's env, but verify runs on the hub. If someone
  // repointed OLLAMA_HOST off-box, inference would leave the laptop.
  const ollamaHost = process.env.OLLAMA_HOST;
  if (!ollamaHost) {
    pass("Ollama localhost-only", "OLLAMA_HOST unset → defaults to http://localhost:11434 (config.js)");
  } else if (classifyUrl(ollamaHost) === "local") {
    pass("Ollama localhost-only", `OLLAMA_HOST=${ollamaHost} (loopback/LAN)`);
  } else {
    fail("Ollama localhost-only", `OLLAMA_HOST=${ollamaHost} points off-box — inference would traverse the network. Point it at localhost on the hub.`);
  }

  // --- no CDN/external URLs baked into the built bundle --------------------
  if (!fs.existsSync(APP_DIST)) {
    fail("bundle loads no external resources", `app/dist not found — build it (cd app && npm run build) before auditing/serving. Without it the hub serves no UI to phones.`);
  } else {
    const files = walkFiles(APP_DIST, [".html", ".js", ".css", ".mjs"]);
    const urlRe = /https?:\/\/[^\s"'`)<>\\]+/g;
    const lethal = new Map(); // externally-LOADED resource url -> [files]
    const docLinks = new Set(); // framework doc/error-string URLs (benign)
    const otherStrings = new Map(); // other external URLs seen only as strings
    for (const f of files) {
      let content;
      try {
        content = fs.readFileSync(f, "utf8");
      } catch {
        continue;
      }
      const ext = path.extname(f);
      const rel = path.relative(ROOT, f);
      // (a) resources actually loaded (html src/href, css url/@import) → lethal
      for (const u of externalResourceUrls(content, ext)) {
        if (!lethal.has(u)) lethal.set(u, []);
        lethal.get(u).push(rel);
      }
      // (b) every other external URL string, for reporting/triage
      for (const m of content.match(urlRe) ?? []) {
        const clean = m.replace(/[.,;]+$/, "");
        const kind = classifyUrl(clean);
        if (kind === "doc") docLinks.add(clean);
        else if (kind === "external" && !lethal.has(clean)) {
          if (!otherStrings.has(clean)) otherStrings.set(clean, []);
          otherStrings.get(clean).push(rel);
        }
      }
    }
    console.log(`  scanned ${files.length} bundle files under app/dist`);
    if (docLinks.size > 0) {
      note(`ignored ${docLinks.size} framework doc/error-code link(s) (string constants in dev warnings, never fetched — e.g. react.dev/link/*)`);
    }
    if (lethal.size === 0) {
      pass("bundle loads no external resources", `no external script/style/font/img loaded by app/dist — UI renders fully offline`);
    } else {
      for (const [u, where] of lethal) console.log(`    LOADS external: ${u}  (in ${where[0]})`);
      fail("bundle loads no external resources", `${lethal.size} external resource(s) are LOADED by the built app (script/link/css) — these hang in airplane mode. Vendor or self-host them.`);
    }
    // Non-doc external URL strings inside JS are usually harmless constants, but
    // could be a hardcoded fetch/API base — surface for a human glance, no fail.
    if (otherStrings.size > 0) {
      note(`${otherStrings.size} other external URL string(s) in JS (likely constants; confirm none is a runtime fetch): ${[...otherStrings.keys()].slice(0, 3).join(", ")}`);
    }
  }
}

// ===========================================================================
// SECTION 3 — FAILURE DRILLS
// ===========================================================================

async function runDrills(base, e2e) {
  section("FAILURE DRILLS — the things that kill a live demo");

  const serverUp = e2e && !e2e.aborted;

  // --- double-confirm idempotency -----------------------------------------
  if (serverUp && e2e.dispatchId && e2e.incidentId) {
    const again = await call(base, `/api/incidents/${e2e.incidentId}/dispatch`, {
      method: "POST",
      body: { dispatch_id: e2e.dispatchId, action: "confirm" },
    });
    if (again.status === 409 && again.body?.success === false) {
      pass("double-confirm is idempotent", "re-confirming an already-confirmed dispatch returns a clean 409 (no double-commit, no crash)");
    } else if (again.status >= 500) {
      fail("double-confirm is idempotent", `re-confirm returned ${again.status} (server error) — a double-tap on CONFIRM would 5xx on stage`);
    } else {
      fail("double-confirm is idempotent", `expected 409 on re-confirm, got status=${again.status} body=${JSON.stringify(again.body)?.slice(0, 160)}`);
    }
  } else {
    note("double-confirm drill skipped (no confirmed dispatch from E2E)");
  }

  if (serverUp) {
    // --- malformed JSON body ------------------------------------------------
    const badJson = await call(base, "/api/reports", { method: "POST", rawBody: "{ this is not json" });
    if (badJson.status === 400 && badJson.body?.success === false) {
      pass("malformed body → clean 400", "invalid JSON body rejected with 400 envelope, not a crash");
    } else if (badJson.status >= 500) {
      fail("malformed body → clean 400", `invalid JSON body returned ${badJson.status} — should be a clean 400`);
    } else {
      fail("malformed body → clean 400", `expected 400, got status=${badJson.status}`);
    }

    // --- empty report text --------------------------------------------------
    const empty = await call(base, "/api/reports", { method: "POST", body: { text: "" } });
    if (empty.status === 400) {
      pass("empty report → 400", "empty text rejected with 400 (min length), not a crash");
    } else {
      fail("empty report → 400", `expected 400 for empty text, got status=${empty.status}`);
    }

    // --- garbage/pathological report → degrade, never 5xx -------------------
    const garbage = await call(base, "/api/reports", {
      method: "POST",
      timeout: 300_000,
      body: { text: "asdkjh qwe ### 你好 ¿¿¿ 12345 ....." },
    });
    if (garbage.status === 200 && garbage.body?.success) {
      const inc = garbage.body.data?.incident;
      pass("garbage report degrades cleanly", inc ? `parsed to incident ${inc.id}` : "stored pending (incident:null) — UI shows SYNCED not PARSED, no crash");
    } else if (garbage.status >= 500) {
      fail("garbage report degrades cleanly", `garbage text returned ${garbage.status} — hub must degrade to 200/pending, never 5xx (CONTRACTS §3)`);
    } else {
      fail("garbage report degrades cleanly", `unexpected status=${garbage.status} for garbage text`);
    }

    // --- legacy /parse-report malformed body path (README: clean 502/4xx) ---
    const legacy = await call(base, "/parse-report", { method: "POST", body: {} });
    if (legacy.status === 422 && legacy.body?.success === false) {
      pass("legacy parse-report bad body → 422", "missing text rejected cleanly (README: malformed model output → clean 502, never a crash)");
    } else if (legacy.status >= 500 && legacy.status !== 502) {
      fail("legacy parse-report bad body → 422", `got ${legacy.status} — expected a clean 422/502, never an unhandled 500`);
    } else {
      note(`/parse-report bad body returned ${legacy.status} (expected 422). The model-malformed→502 path is model-dependent; repro by feeding a schema-breaking prompt.`);
    }
  } else {
    note("input-drills skipped — server not running");
  }

  // --- store persistence / restart survival -------------------------------
  // Full repro needs an operator to Ctrl-C and restart the hub; here we prove
  // the write reached the SQLite file, which is what makes a restart
  // non-destructive. WAL mode means committed rows are on disk immediately.
  if (fs.existsSync(STORE_FILE)) {
    let db;
    try {
      db = new DatabaseSync(STORE_FILE, { readOnly: true });
    } catch (err) {
      db = null;
      note(`could not open ${STORE_FILE}: ${err.message}`);
    }
    if (db) {
      try {
        const persistedIncidents = db.prepare("SELECT COUNT(*) AS c FROM incidents").get().c;
        const persistedReports = db.prepare("SELECT COUNT(*) AS c FROM reports").get().c;
        const found = serverUp && e2e.incidentId
          ? Boolean(db.prepare("SELECT 1 FROM incidents WHERE id = ?").get(e2e.incidentId))
          : persistedIncidents > 0;
        if (found) {
          pass("store persists to disk", `data/hub.db holds ${persistedIncidents} incidents + ${persistedReports} reports on disk — survives a hub restart`);
          note("Full restart drill (MANUAL): Ctrl-C the hub mid-demo, run `npm start` again, GET /api/incidents — the board must return identical.");
        } else {
          fail("store persists to disk", `data/hub.db does not contain the E2E incident (${e2e?.incidentId}) — writes may not be committing; a restart would lose the board`);
        }
      } catch (err) {
        note(`could not query ${STORE_FILE}: ${err.message}`);
      } finally {
        db.close();
      }
    }
  } else {
    note(`${STORE_FILE} not found — the store seeds it on first write. Submit a report, then this drill can confirm persistence.`);
  }

  // --- Ollama slow/cold → pending, not crash (MANUAL) ---------------------
  note("Ollama cold/slow drill (MANUAL): unload the model (or first boot), submit a report from /field. Expected: the outbox item shows QUEUED→SYNCED (incident:null, 200), the UI stays alive, and it flips to PARSED once the model warms — never a crash/spinner-of-death. Pre-warm with POST /warmup before recording.");
}

// ===========================================================================

async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: "string", default: "http://localhost:8000" },
      section: { type: "string", default: "all" },
    },
  });
  const base = values.url.replace(/\/+$/, "");
  const sec = values.section;

  console.log(`Brújula verify — target ${base}, section=${sec}`);

  let e2e = null;
  let serverUp = false;

  if (sec === "all" || sec === "e2e") {
    e2e = await runE2E(base);
    serverUp = e2e && !e2e.aborted;
  } else {
    // Probe the server so offline/drills can adapt without a full E2E.
    const h = await call(base, "/health", { timeout: 5_000 });
    serverUp = !!h.body?.success;
  }

  if (sec === "all" || sec === "offline") {
    await runOffline(base, { serverUp });
  }

  if (sec === "all" || sec === "drills") {
    await runDrills(base, e2e ?? { aborted: !serverUp });
  }

  // ---- summary ------------------------------------------------------------
  section("SUMMARY");
  if (failed === 0) {
    console.log(`SUCCESS: all ${passed} checks passed.`);
    return 0;
  }
  console.log(`FAILURE: ${failed} of ${passed + failed} checks failed:`);
  for (const f of failures) console.log(`  - ${f.step}: ${f.detail}`);
  return 1;
}

// Set exitCode and let the loop drain naturally (undici keep-alive sockets close
// on their own). A hard process.exit() here can trip a libuv handle-close
// assertion on Windows if any fetch socket/timer is still settling. The unref'd
// timer is a belt-and-braces force-quit only if a keep-alive socket lingers.
const code = await main();
process.exitCode = code;
setTimeout(() => process.exit(code), 1500).unref();
