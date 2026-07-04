import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "sample_reports.json",
);
const REQUIRED_FIELDS = ["type", "location", "people_estimate", "severity", "summary"];

async function main() {
  const { values } = parseArgs({
    options: { url: { type: "string", default: "http://localhost:8000" } },
  });
  const base = values.url.replace(/\/+$/, "");

  let health;
  try {
    const resp = await fetch(`${base}/health`, { signal: AbortSignal.timeout(10_000) });
    health = await resp.json();
  } catch (err) {
    console.log(`FAILURE: server not reachable at ${base} (${err.message})`);
    console.log("Start it with:  npm start");
    return 1;
  }
  const info = health.data ?? {};
  console.log(
    `health: provider=${info.provider} model=${info.model} ` +
      `ollama_reachable=${info.ollama_reachable}`,
  );
  if (!health.success || !info.ollama_reachable) {
    console.log("FAILURE: /health reports backend not reachable. Run bootstrap first.");
    return 1;
  }

  const reports = JSON.parse(fs.readFileSync(FIXTURES, "utf-8"));
  let failures = 0;
  for (const report of reports) {
    console.log(`\n--- ${report.name} ---`);
    console.log(`in:  ${report.text.slice(0, 100)}`);
    let body;
    try {
      const resp = await fetch(`${base}/parse-report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: report.text }),
        signal: AbortSignal.timeout(300_000),
      });
      body = await resp.json();
    } catch (err) {
      console.log(`FAIL: request error: ${err.message}`);
      failures += 1;
      continue;
    }
    if (!body.success) {
      console.log(`FAIL: ${body.error}`);
      failures += 1;
      continue;
    }
    const missing = REQUIRED_FIELDS.filter((f) => !(f in body.data));
    if (missing.length > 0) {
      console.log(`FAIL: response missing fields ${missing.join(", ")}`);
      failures += 1;
      continue;
    }
    console.log(`out: ${JSON.stringify(body.data, null, 2)}`);
  }

  console.log();
  if (failures > 0) {
    console.log(`FAILURE: ${failures}/${reports.length} reports failed`);
    return 1;
  }
  console.log(`SUCCESS: all ${reports.length} reports parsed end-to-end (local path only)`);
  return 0;
}

process.exit(await main());
