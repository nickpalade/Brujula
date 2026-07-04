// End-to-end check of the agent pipeline against a running server.
// Replays the PRD demo: seed board → collapse report → duplicate report
// (must merge) → dispatch proposal (must pick the excavator) → confirm →
// sitrep. Strict on agent decisions on purpose: this is the acceptance test.
import { parseArgs } from "node:util";

const REPORT_A =
  "urgente, edificio de 4 pisos colapsado en Playa Grande, Catia La Mar. " +
  "escuchamos voces bajo los escombros, calculamos unas 20 personas atrapadas. " +
  "necesitamos maquinaria pesada para levantar las losas YA";

const REPORT_B =
  "confirmado derrumbe total de un edificio residencial en playa grande. " +
  "vecinos dicen que hay gente viva adentro, quizas 15 o mas. no hay equipos " +
  "trabajando en el sitio todavia";

const REPORT_C =
  "aqui en el puerto de La Guaira tenemos un camion cisterna de 8000 litros " +
  "con chofer, disponible ahora mismo, diganos donde hace falta";

let failures = 0;

function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function call(base, method, pathName, body) {
  const resp = await fetch(`${base}${pathName}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });
  const parsed = await resp.json();
  if (!parsed.success) {
    throw new Error(`${method} ${pathName} failed: ${parsed.error}`);
  }
  return parsed.data;
}

async function main() {
  const { values } = parseArgs({
    options: { url: { type: "string", default: "http://localhost:8000" } },
  });
  const base = values.url.replace(/\/+$/, "");

  try {
    const health = await (await fetch(`${base}/health`, { signal: AbortSignal.timeout(10_000) })).json();
    const info = health.data ?? {};
    console.log(`health: provider=${info.provider} model=${info.model}`);
    if (!health.success || !info.ollama_reachable) {
      console.log("FAILURE: backend not reachable. Run bootstrap + npm start first.");
      return 1;
    }
  } catch (err) {
    console.log(`FAILURE: server not reachable at ${base} (${err.message})`);
    return 1;
  }

  console.log("\n--- seed board ---");
  await call(base, "POST", "/board/reset");
  const seeded = await call(base, "POST", "/board/seed");
  check(
    "board seeded",
    seeded.incidents.length === 2 && seeded.resources.length === 3,
    `${seeded.incidents.length} incidents, ${seeded.resources.length} resources`,
  );
  const excavator = seeded.resources.find((r) => r.category === "machinery");

  console.log("\n--- report A: collapse at Playa Grande (voices heard) ---");
  const cardA = await call(base, "POST", "/reports", {
    text: REPORT_A,
    source_device: "phone-field-1",
  });
  check("parsed as need", cardA.parsed.kind === "need", `kind=${cardA.parsed.kind}`);
  check(
    "category rescue or machinery",
    ["rescue", "machinery"].includes(cardA.parsed.category),
    `category=${cardA.parsed.category}`,
  );
  check("urgency critical", cardA.parsed.urgency === "critical", `urgency=${cardA.parsed.urgency}`);
  check("incident created", Boolean(cardA.incident), cardA.incident?.id);
  check("incident is priority 1", cardA.incident?.priority === 1, `priority=${cardA.incident?.priority}`);
  check(
    "dispatch proposes the excavator",
    Boolean(cardA.dispatch) && cardA.dispatch.resource_id === excavator?.id,
    cardA.dispatch ? `${cardA.dispatch.resource_id}: ${cardA.dispatch.reason}` : "no dispatch",
  );
  check("advisory attached", (cardA.advisory?.steps?.length ?? 0) > 0);

  console.log("\n--- report B: same collapse, different wording ---");
  const cardB = await call(base, "POST", "/reports", {
    text: REPORT_B,
    source_device: "phone-field-2",
  });
  check(
    "recognized as duplicate",
    cardB.dedup?.merged_into === cardA.incident?.id,
    cardB.dedup ? `merged into ${cardB.dedup.merged_into}: ${cardB.dedup.reason}` : "not merged",
  );
  check(
    "no second dispatch for the same incident",
    !cardB.dispatch || cardB.dispatch.id === cardA.dispatch?.id,
    cardB.dispatch?.id,
  );

  const board = await call(base, "GET", "/board");
  check(
    "board has exactly 3 incidents (2 seeded + 1 merged collapse)",
    board.incidents.length === 3,
    `${board.incidents.length} incidents`,
  );

  console.log("\n--- report C: a water truck becomes available ---");
  const waterIncident = board.incidents.find((i) => i.category === "water");
  const cardC = await call(base, "POST", "/reports", {
    text: REPORT_C,
    source_device: "phone-field-3",
  });
  check("parsed as resource", cardC.parsed.kind === "resource", `kind=${cardC.parsed.kind}`);
  check("resource registered", Boolean(cardC.resource), cardC.resource?.id);
  check(
    "matched to the waiting water incident",
    Boolean(cardC.dispatch) && cardC.dispatch.incident_id === waterIncident?.id,
    cardC.dispatch ? `${cardC.dispatch.incident_id}: ${cardC.dispatch.reason}` : "no dispatch",
  );

  if (cardA.dispatch) {
    console.log("\n--- coordinator confirms the dispatch ---");
    const confirmed = await call(base, "POST", `/dispatches/${cardA.dispatch.id}/confirm`);
    check("dispatch confirmed", confirmed.state === "confirmed");
    const after = await call(base, "GET", "/board");
    const resource = after.resources.find((r) => r.id === cardA.dispatch.resource_id);
    check("resource committed", resource?.status === "committed", `status=${resource?.status}`);
  }

  console.log("\n--- sitrep ---");
  const { sitrep } = await call(base, "GET", "/sitrep");
  check("sitrep generated", typeof sitrep === "string" && sitrep.length > 50);
  console.log(`\n${sitrep}\n`);

  if (failures > 0) {
    console.log(`FAILURE: ${failures} check(s) failed`);
    return 1;
  }
  console.log("SUCCESS: full agent pipeline verified end-to-end (offline path)");
  return 0;
}

process.exit(
  await main().catch((err) => {
    console.log(`FAILURE: ${err.message}`);
    return 1;
  }),
);
