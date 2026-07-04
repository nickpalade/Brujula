export class MockProvider {
  name = "mock";

  async health() {
    return { reachable: true, model: "mock-provider", detail: "deterministic test provider" };
  }

  async generateStructured({ userText, jsonSchema }) {
    if (jsonSchema?.properties?.kind) {
      return JSON.stringify(parseReport(userText));
    }
    if (jsonSchema?.properties?.matching_incident_id) {
      return JSON.stringify(dedupDecision(userText));
    }
    if (jsonSchema?.properties?.resource_id) {
      return JSON.stringify(matchDecision(userText));
    }
    if (jsonSchema?.properties?.sitrep) {
      return JSON.stringify({ sitrep: buildSitrep(userText) });
    }
    if (jsonSchema?.properties?.answer) {
      return JSON.stringify(chatAnswer(userText));
    }
    return JSON.stringify({});
  }
}

function parseReport(text = "") {
  const lower = text.toLowerCase();
  const people = extractPeople(lower);
  const location = lower.includes("playa grande")
    ? "Playa Grande, Catia La Mar"
    : lower.includes("san jose") || lower.includes("san jos")
      ? "Refugio San Jose, La Guaira"
      : lower.includes("simon bolivar") || lower.includes("simón bolívar")
        ? "Escuela Simon Bolivar, Catia La Mar"
        : null;

  if (lower.includes("maria lopez") || lower.includes("maría lopez")) {
    const isSafe = /safe|found|encontrad|a salvo|refugio/.test(lower);
    return {
      kind: "status",
      category: "status",
      location,
      people_count: people,
      urgency: isSafe ? "low" : "high",
      resource_label: null,
      summary: isSafe
        ? "Maria Lopez has been located and is safe."
        : "Maria Lopez is reported missing near the disaster area.",
      persons: [
        {
          name: "Maria Lopez",
          status: isSafe ? "safe" : "missing",
          detail: isSafe ? "Safe at Refugio San Jose." : "Last seen near Playa Grande.",
        },
      ],
    };
  }

  if (/\b(offer|offering|ofrecemos|ofrezco)\b/.test(lower)) {
    const isWater = /\b(water|agua)\b/.test(lower);
    return {
      kind: "resource",
      category: isWater ? "water" : "machinery",
      location,
      people_count: people,
      urgency: "low",
      resource_label: isWater ? "Water tanker offer" : "Equipment offer",
      summary: isWater
        ? "Water tanker offered for distribution."
        : "Heavy equipment offered to responders.",
      persons: [],
    };
  }

  if (/insulin|medical|medic|doctor|clinic|injur|herid|fever|fiebre/.test(lower)) {
    return {
      kind: "need",
      category: "medical",
      location,
      people_count: people ?? 2,
      urgency: "high",
      resource_label: null,
      summary: "Medical support and supplies are needed at the shelter.",
      persons: [],
    };
  }

  if (/\b(water|agua|drinking|potable|sed)\b/.test(lower)) {
    return {
      kind: "need",
      category: "water",
      location,
      people_count: people ?? 80,
      urgency: "high",
      resource_label: null,
      summary: "People need drinking water at the shelter.",
      persons: [],
    };
  }

  return {
    kind: "need",
    category: "rescue",
    location,
    people_count: people ?? 12,
    urgency: "critical",
    resource_label: null,
    summary: "Collapsed building with people trapped; rescue machinery is needed.",
    persons: [],
  };
}

function dedupDecision(text = "") {
  const openIncidentsMatch = text.match(/OPEN INCIDENTS:\n(.+)$/s);
  let incidents = [];
  try {
    incidents = openIncidentsMatch ? JSON.parse(openIncidentsMatch[1]) : [];
  } catch {
    incidents = [];
  }

  const newReportMatch = text.match(/NEW REPORT:\n(.+?)\n\nOPEN INCIDENTS:/s);
  let newReport = {};
  try {
    newReport = newReportMatch ? JSON.parse(newReportMatch[1]) : {};
  } catch {
    newReport = {};
  }

  const match = incidents.find(
    (incident) =>
      incident.category === newReport.category &&
      normalizeLocation(incident.location) === normalizeLocation(newReport.location),
  );

  return {
    matching_incident_id: match?.id ?? null,
    confidence: match ? 0.94 : 0,
    reason: match ? "Same category and location in test scenario." : "No matching incident.",
  };
}

function matchDecision(text = "") {
  const incidentMatch = text.match(/NEED INCIDENT:\n(.+?)\n\nAVAILABLE RESOURCES:/s);
  const resourcesMatch = text.match(/AVAILABLE RESOURCES:\n(.+)$/s);
  let incident = {};
  let resources = [];
  try {
    incident = incidentMatch ? JSON.parse(incidentMatch[1]) : {};
    resources = resourcesMatch ? JSON.parse(resourcesMatch[1]) : [];
  } catch {
    resources = [];
  }

  const preferredType =
    incident.category === "rescue"
      ? "machinery"
      : incident.category === "medical"
        ? "medical"
        : incident.category;
  const match =
    resources.find((r) => r.type === preferredType) ||
    resources.find((r) => r.status === "available") ||
    null;

  return {
    resource_id: match?.id ?? null,
    rationale: match ? `${match.label} best matches this ${incident.category} need.` : "No suitable resource available.",
    distance_note: match?.location ? `Staged at ${match.location}.` : "",
  };
}

function buildSitrep(text = "") {
  let board = {};
  try {
    board = JSON.parse(text);
  } catch {
    board = {};
  }
  const open = Array.isArray(board.incidents)
    ? board.incidents.filter((incident) => incident.status === "open")
    : [];
  const confirmed = Array.isArray(board.dispatches)
    ? board.dispatches.filter((dispatch) => dispatch.state === "confirmed")
    : [];
  return `SITREP (mock model): ${open.length} open incidents, ${confirmed.length} confirmed deployments.`;
}

function chatAnswer(text = "") {
  const question = text.match(/QUESTION:\n(.+?)\n\nCONTEXT:/s)?.[1] ?? text;
  const lower = question.toLowerCase();
  if (/\b(water|agua|resource|resources|inventory|available)\b/.test(lower)) {
    return {
      answer: "The water tanker is available from the resource inventory and can support potable-water distribution.",
      sources: [{ label: "Resource Inventory", type: "resource" }],
    };
  }
  if (/\b(rescue|collapse|silence|trapped|machinery|shoring)\b/.test(lower)) {
    return {
      answer: "Before machinery starts, rescue crews should enforce silence periods, listen for trapped survivors, and confirm shoring or structural stability.",
      sources: [{ label: "Knowledge Base: rescue", type: "kb" }],
    };
  }
  return {
    answer: "The KB contains response protocols and current board context for incidents, resources, dispatches, people, alerts, and field reports.",
    sources: [{ label: "Knowledge Base: protocols", type: "kb" }],
  };
}

function extractPeople(text) {
  const match = text.match(/(\d{1,4})\s*(people|personas|trapped|atrapad|victims|victimas|víctimas|patients|pacientes)?/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function normalizeLocation(location) {
  return (location ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
