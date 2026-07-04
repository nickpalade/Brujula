// Temp INTEGRATION E2E — PRD §7 demo flow against a running hub on :8000.
// Run: node server/_integration-e2e.mjs   (delete after use)
const BASE = process.env.E2E_BASE || "http://localhost:8000";

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

// 1. submit Playa Grande report -> parsed incident appears
const s1 = await post("/api/reports", { text: R1, source_device: "field-phone-1", lang: "es" });
ok("report 1 parsed into an incident", !!s1.incident, `${s1.incident?.category}/${s1.incident?.urgency}`);
const incId = s1.incident?.id;
ok("incident is rescue + critical", s1.incident?.category === "rescue" && s1.incident?.urgency === "critical");
ok("excavator match proposed on report 1", !!s1.incident?.proposed_dispatch_id);

// 2. submit differently-worded duplicate -> merge visible
const s2 = await post("/api/reports", { text: R2, source_device: "field-phone-3", lang: "es" });
ok("report 2 dedup-merged into same incident", s2.incident?.id === incId, `got ${s2.incident?.id}`);
ok("merged_report_ids now has 2", (s2.incident?.merged_report_ids || []).length === 2, JSON.stringify(s2.incident?.merged_report_ids));

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
ok("merged report bodies fetchable (dedup evidence)", reps.length === 2, `${reps.length} reports`);

// 6. advisory panel renders
const adv = await post("/api/advise", { incident_type: "rescue", context: "collapsed building, 20 trapped" });
ok("advisory returns steps", Array.isArray(adv.steps) && adv.steps.length > 0, adv.source_label);

// 7. sitrep generates
const sr = await j("/api/sitrep");
ok("sitrep generates text", typeof sr.text === "string" && sr.text.trim().length > 0);

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
