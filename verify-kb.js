// Contract test + report generator for Rares' knowledge-service (the offline
// protocol KB the main app proxies via /api/advise). Exercises the full
// interface contract from knowledge-service/CLAUDE.md against a running
// instance and writes a human-readable markdown report.
//
// Run the KB first (from /knowledge-service):
//   uvicorn app:app --port 8100
// Then, from the repo root:
//   npm run verify:kb                       # targets http://localhost:8100
//   node verify-kb.js --url http://host:8100 --report kb-report.md
//
// This talks to the KB DIRECTLY (Rares' service), not the Node proxy in
// server/routes/advise.js — so it isolates "does Rares' KB work?".
import fs from "node:fs";
import { parseArgs } from "node:util";

// From CLAUDE.md "The interface contract" — the disclaimer is a fixed line.
const DISCLAIMER =
  "Operational guidance for trained responders. Not medical diagnosis or treatment advice.";
const VALID_PRIORITIES = new Set(["critical", "high", "routine"]);
// The four domains the service must cover with real protocol content.
const DOMAINS = [
  "structural_collapse",
  "casualty_triage",
  "water_sanitation",
  "shelter_disease",
];

const results = []; // { section, label, ok, detail }
let currentSection = "general";
let failures = 0;

function section(name) {
  currentSection = name;
  console.log(`\n--- ${name} ---`);
}

function check(label, ok, detail = "") {
  results.push({ section: currentSection, label, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
  return Boolean(ok);
}

async function call(base, method, pathName, body) {
  const resp = await fetch(`${base}${pathName}`, {
    method,
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(10_000),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await resp.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: resp.status, ok: resp.ok, json, text };
}

// Validate one /advise response against the contract. `expectType` is the
// incident_type we expect echoed back (skip the equality check when null,
// e.g. for the keyword/fallback cases where routing is the point).
function validateAdvisory(label, res, { expectType = null, expectMatchedBy = null } = {}) {
  const ok200 = check(`${label}: HTTP 200 (never errors)`, res.status === 200, `status=${res.status}`);
  if (!ok200) return;
  const body = res.json ?? {};

  if (expectType) {
    check(`${label}: incident_type = ${expectType}`, body.incident_type === expectType, `got=${body.incident_type}`);
  } else {
    check(`${label}: incident_type present`, typeof body.incident_type === "string" && body.incident_type.length > 0, `got=${body.incident_type}`);
  }

  const guidance = Array.isArray(body.guidance) ? body.guidance : null;
  const hasSteps = check(`${label}: guidance is a non-empty array`, guidance && guidance.length > 0, `len=${guidance?.length ?? "n/a"}`);

  if (hasSteps) {
    const orderedOk = guidance.every((g, i) => g?.step === i + 1);
    check(`${label}: steps numbered 1..n in order`, orderedOk, guidance.map((g) => g?.step).join(","));

    const prioritiesOk = guidance.every((g) => VALID_PRIORITIES.has(g?.priority));
    check(`${label}: every step priority in {critical,high,routine}`, prioritiesOk);

    const fieldsOk = guidance.every(
      (g) => nonEmpty(g?.action) && nonEmpty(g?.rationale) && nonEmpty(g?.source),
    );
    check(`${label}: every step has action + rationale + source`, fieldsOk);
  }

  const flags = Array.isArray(body.safety_flags) ? body.safety_flags : null;
  check(`${label}: safety_flags non-empty`, flags && flags.length > 0, `len=${flags?.length ?? "n/a"}`);

  check(`${label}: disclaimer is the exact contract line`, body.disclaimer === DISCLAIMER, body.disclaimer ? "" : "missing");

  const std = Array.isArray(body.source_standards) ? body.source_standards : null;
  check(`${label}: source_standards non-empty`, std && std.length > 0, std ? std.join(", ") : "missing");

  // matched_by is an additive debug field — verify only when asked, don't require it.
  if (expectMatchedBy) {
    check(`${label}: matched_by = ${expectMatchedBy}`, body.matched_by === expectMatchedBy, `got=${body.matched_by ?? "(absent)"}`);
  }
}

function nonEmpty(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function writeReport(reportPath, base) {
  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  const verdict = failures === 0 ? "PASS — KB is working" : `FAIL — ${failures} check(s) failed`;

  const bySection = new Map();
  for (const r of results) {
    if (!bySection.has(r.section)) bySection.set(r.section, []);
    bySection.get(r.section).push(r);
  }

  const lines = [];
  lines.push("# Rares' Knowledge Service — Verification Report");
  lines.push("");
  lines.push(`- **Target:** \`${base}\``);
  lines.push(`- **When:** ${new Date().toISOString()}`);
  lines.push(`- **Result:** ${verdict}`);
  lines.push(`- **Checks:** ${passed}/${total} passed`);
  lines.push("");
  lines.push("Exercises the interface contract in `knowledge-service/CLAUDE.md`: `/health`, `/protocols`, and `/advise` (exact match per domain, Spanish keyword fallback, and the `other` size-up fallback), validating response shape, ordered steps, priorities, the fixed disclaimer, and non-empty safety flags on every response.");
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push("| Section | Passed | Failed |");
  lines.push("| --- | --- | --- |");
  for (const [name, items] of bySection) {
    const p = items.filter((i) => i.ok).length;
    const f = items.length - p;
    lines.push(`| ${name} | ${p}/${items.length} | ${f} |`);
  }
  lines.push("");

  lines.push("## Details");
  for (const [name, items] of bySection) {
    lines.push("");
    lines.push(`### ${name}`);
    lines.push("");
    for (const r of items) {
      const mark = r.ok ? "PASS" : "**FAIL**";
      lines.push(`- ${mark} — ${r.label}${r.detail ? ` _(${r.detail})_` : ""}`);
    }
  }
  lines.push("");

  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
  console.log(`\nReport written to ${reportPath}`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: "string", default: "http://localhost:8100" },
      report: { type: "string", default: "kb-verification-report.md" },
    },
  });
  const base = values.url.replace(/\/+$/, "");
  console.log(`Verifying Rares' knowledge-service at ${base}`);

  // Reachability gate — a clear message beats a wall of connection errors.
  section("reachability");
  let health;
  try {
    health = await call(base, "GET", "/health");
  } catch (err) {
    check(`service reachable at ${base}`, false, err.message);
    writeReport(values.report, base);
    console.log("\nFAILURE: KB not reachable. Start it first (uvicorn app:app --port 8100 in /knowledge-service).");
    return 1;
  }
  check("GET /health → 200", health.status === 200, `status=${health.status}`);
  check('GET /health → {"status":"ok"}', health.json?.status === "ok", JSON.stringify(health.json));

  section("coverage (/protocols)");
  const protocols = await call(base, "GET", "/protocols");
  check("GET /protocols → 200", protocols.status === 200, `status=${protocols.status}`);
  const covered = Array.isArray(protocols.json?.covered) ? protocols.json.covered : [];
  for (const domain of DOMAINS) {
    check(`covers ${domain}`, covered.includes(domain), covered.join(", ") || "(none)");
  }

  section("exact match per domain (/advise)");
  for (const domain of DOMAINS) {
    const res = await call(base, "POST", "/advise", {
      incident_type: domain,
      needs: [],
      context: { notes: "" },
    });
    validateAdvisory(domain, res, { expectType: domain, expectMatchedBy: "exact" });
  }

  section("keyword fallback (Spanish field notes, no incident_type)");
  const kw = await call(base, "POST", "/advise", {
    needs: ["rescate"],
    context: { notes: "edificio colapsado, hay personas atrapadas bajo los escombros" },
  });
  validateAdvisory("es-notes→structural_collapse", kw, {
    expectType: "structural_collapse",
    expectMatchedBy: "keywords",
  });

  section("other fallback (unknown type, no matchable text)");
  const other = await call(base, "POST", "/advise", { incident_type: "extraterrestrial_event" });
  validateAdvisory("unknown→other", other, { expectType: "other", expectMatchedBy: "fallback" });

  section("forgiving inputs (must never 422/500)");
  const empty = await call(base, "POST", "/advise", {});
  validateAdvisory("empty body", empty, { expectType: "other" });
  const mangled = await call(base, "POST", "/advise", { needs: "water", context: { notes: "letrinas desbordadas" } });
  validateAdvisory("needs-as-string", mangled, {});

  writeReport(values.report, base);

  if (failures > 0) {
    console.log(`\nFAILURE: ${failures} check(s) failed — see ${values.report}`);
    return 1;
  }
  console.log(`\nSUCCESS: Rares' KB satisfies the contract — see ${values.report}`);
  return 0;
}

// Set exitCode rather than process.exit(): a hard exit while undici's
// keep-alive sockets are still open trips a libuv teardown assertion on
// Windows. Letting the event loop drain avoids it.
process.exitCode = await main().catch((err) => {
  console.log(`FAILURE: ${err.message}`);
  return 1;
});
