// Hub acceptance test — replays the PRD §7 demo flow against a running hub
// (the /api/* surface the React app consumes). Needs the server up with a
// live model: `npm start`, then `npm run verify:hub`.
//
// POST /api/reports acknowledges within REPORT_ACK_TIMEOUT_MS and may finish
// the pipeline in the background (slow CPU boxes); this harness handles both
// paths — when the ack carries no incident it polls until the report parses
// and the match lands. Knobs: E2E_BASE (default http://localhost:8000),
// E2E_PARSE_TIMEOUT_MS per model stage (default 8 min, generous for CPU).
const BASE = process.env.E2E_BASE || "http://localhost:8000";
const PARSE_TIMEOUT_MS = Number(process.env.E2E_PARSE_TIMEOUT_MS ?? 8 * 60_000);
const POLL_MS = 3000;

async function j(path, opts) {
  const r = await fetch(BASE + path, opts);
  const p = await r.json();
  if (!p || p.success !== true) throw new Error(`${path} -> ${p && p.error}`);
  return p.data;
}
const post = (path, body) =>
  j(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Poll until the stored report has parsed_into set; returns the incident id.
async function awaitParsed(reportId, label) {
  const deadline = Date.now() + PARSE_TIMEOUT_MS;
  for (;;) {
    const reps = await j(`/api/reports?ids=${reportId}`);
    const into = reps[0]?.parsed_into;
    if (into) return into;
    if (Date.now() > deadline) {
      throw new Error(`${label}: report ${reportId} not parsed within ${PARSE_TIMEOUT_MS}ms`);
    }
    await sleep(POLL_MS);
  }
}

async function getIncident(id) {
  const incidents = await j("/api/incidents");
  return incidents.find((i) => i.id === id) ?? null;
}

// Poll until the incident carries a proposed dispatch (match is one more model
// call after parse, so it can land after parsed_into does). Null on timeout.
async function awaitProposal(incidentId, label) {
  const deadline = Date.now() + PARSE_TIMEOUT_MS;
  for (;;) {
    const inc = await getIncident(incidentId);
    if (inc?.proposed_dispatch_id) return inc;
    if (Date.now() > deadline) {
      console.log(`(${label}: no dispatch proposal within ${PARSE_TIMEOUT_MS}ms)`);
      return inc;
    }
    await sleep(POLL_MS);
  }
}

let failures = 0;
function ok(label, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}${extra ? " :: " + extra : ""}`);
  if (!cond) failures++;
}

const R1 =
  "Edificio colapsado en Playa Grande, Catia La Mar. Escuchamos voces, unas 20 personas atrapadas. Necesitamos maquinaria pesada.";
const R2 =
  "Un bloque de apartamentos se vino abajo cerca de la playa en Catia La Mar. Hay gente debajo de los escombros, se oyen gritos. Hace falta una excavadora urgente.";

// 0. health
const h = await j("/health");
ok("hub health ok", h.status === "ok", `${h.provider}/${h.model}`);

// 1. submit Playa Grande report -> accepted; parsed incident appears (inline
// on fast hardware, via background pipeline + polling on slow).
const s1 = await post("/api/reports", {
  text: R1,
  source_device: "field-phone-1",
  lang: "es",
  client_ref: `e2e_r1_${process.pid}_${Date.now()}`,
});
ok("report 1 accepted by hub", !!s1.report?.id, s1.report?.id);
const incId = s1.incident?.id ?? (await awaitParsed(s1.report.id, "report 1"));
ok("report 1 parsed into an incident", !!incId, incId);
let inc1 = await awaitProposal(incId, "report 1 match");
ok("incident is rescue + critical", inc1?.category === "rescue" && inc1?.urgency === "critical", `${inc1?.category}/${inc1?.urgency}`);
ok("excavator match proposed on report 1", !!inc1?.proposed_dispatch_id);

// 2. submit differently-worded duplicate -> merge visible
const s2 = await post("/api/reports", {
  text: R2,
  source_device: "field-phone-3",
  lang: "es",
  client_ref: `e2e_r2_${process.pid}_${Date.now()}`,
});
ok("report 2 accepted by hub", !!s2.report?.id, s2.report?.id);
const incId2 = s2.incident?.id ?? (await awaitParsed(s2.report.id, "report 2"));
ok("report 2 dedup-merged into same incident", incId2 === incId, `got ${incId2}`);
const merged = await getIncident(incId);
ok("merged_report_ids has both reports", (merged?.merged_report_ids || []).length >= 2, JSON.stringify(merged?.merged_report_ids));

// 3. excavator match proposed
const sync0 = await j("/api/sync?since=0");
const dsp = sync0.dispatches.find((d) => d.incident_id === incId && d.state === "proposed");
ok("proposed dispatch exists for incident", !!dsp);
const resources = await j("/api/resources");
const excav = resources.find((r) => r.id === dsp?.resource_id);
ok("matched resource is machinery (excavator)", excav?.type === "machinery", excav?.label);

// 4. CONFIRM -> dispatch confirmed, incident dispatched, resource committed
const conf = await post(`/api/incidents/${incId}/dispatch`, { dispatch_id: dsp.id, action: "confirm" });
ok("dispatch confirmed", conf.state === "confirmed" && !!conf.confirmed_by_human_at);

// 5. dispatch shows in field inbox (sync feed)
const sync1 = await j("/api/sync?since=0");
const cdsp = sync1.dispatches.find((d) => d.id === dsp.id);
ok("confirmed dispatch visible in sync feed (field inbox)", cdsp?.state === "confirmed");
const cinc = sync1.incidents.find((i) => i.id === incId);
ok("incident status is dispatched", cinc?.status === "dispatched");
const cres = sync1.resources.find((r) => r.id === dsp.resource_id);
ok("resource status is committed", cres?.status === "committed");

// dedup evidence: merged report bodies fetchable
const reps = await j(`/api/reports?ids=${(cinc.merged_report_ids || []).join(",")}`);
ok("merged report bodies fetchable (dedup evidence)", reps.length >= 2, `${reps.length} reports`);

// 6. advisory panel renders
const adv = await post("/api/advise", { incident_type: "rescue", context: "collapsed building, 20 trapped" });
ok("advisory returns steps", Array.isArray(adv.steps) && adv.steps.length > 0, adv.source_label);

// 7. sitrep generates
const sr = await j("/api/sitrep");
ok("sitrep generates text", typeof sr.text === "string" && sr.text.trim().length > 0);

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
