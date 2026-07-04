import { logger } from "../logger.js";

// Local stand-in for Rares' protocol KB (PRD §5D). If PROTOCOL_KB_URL is set,
// we POST /advise there and fall back to this content when it fails — so the
// remote module is additive and never blocking.
// Content condensed from established humanitarian standards. Operational
// guidance for trained responders only — never patient diagnosis.

const STANDARD_CAUTION =
  "Operational protocol for trained responders — not medical advice or patient diagnosis.";

const KB = {
  rescue: {
    steps: [
      "Enforce periodic silence on site (all machinery and voices stop) to listen for trapped survivors.",
      "Do not enter unstable structures — shore or crib before any entry.",
      "Mark searched areas with standard USAR markings to avoid duplicate searches.",
      "Triage extricated casualties with START; expect crush injuries in prolonged entrapment.",
      "Log void spaces and voice contacts with time and exact position for the next shift.",
    ],
    source_label: "INSARAG USAR field guidance (condensed)",
    cautions: [
      STANDARD_CAUTION,
      "Aftershocks: agree on an evacuation signal and safe assembly point before starting work.",
    ],
  },
  medical: {
    steps: [
      "Apply START triage: walking wounded first directed aside, then assess breathing, perfusion, mental status.",
      "Prioritize casualties freed after prolonged entrapment — crush syndrome risk rises after release.",
      "Route critical (red) casualties to the nearest facility with real capacity, not the nearest facility.",
      "Record name/description and destination of every evacuated casualty for family reunification.",
    ],
    source_label: "START mass-casualty triage (condensed)",
    cautions: [STANDARD_CAUTION],
  },
  water: {
    steps: [
      "Minimum survival allocation: ~15 L of water per person per day (Sphere).",
      "Chlorinate distributed water; target ~0.5 mg/L free residual chlorine at delivery point.",
      "If people are drinking from rivers or unknown sources, distribute purification tablets and instructions immediately.",
      "Separate defecation areas from water sources; latrines at least 30 m from any water point.",
    ],
    source_label: "Sphere Handbook — WASH minimum standards (condensed)",
    cautions: [
      STANDARD_CAUTION,
      "Untreated water consumption already reported → flag to health lead: diarrheal-disease watch.",
    ],
  },
  shelter: {
    steps: [
      "Target minimum ~3.5 m² covered living space per person; avoid dense open-floor crowding.",
      "Register occupants (headcount, unaccompanied minors, medical needs) on entry.",
      "Crowded shelters with low vaccination coverage: prioritize measles vaccination and isolate suspected cases (PAHO/WHO).",
      "Ensure water, latrines and handwashing points scale with occupancy — see WASH minimums.",
    ],
    source_label: "Sphere shelter standards + PAHO/WHO shelter disease-control guidance (condensed)",
    cautions: [STANDARD_CAUTION],
  },
  food: {
    steps: [
      "Distribute through registered lists per shelter/zone to avoid duplicate and missed households.",
      "Prioritize infants, pregnant women, elderly and people with medical dietary needs.",
      "Ready-to-eat rations where cooking water or fuel is not assured.",
    ],
    source_label: "Sphere food security standards (condensed)",
    cautions: [STANDARD_CAUTION],
  },
  machinery: {
    steps: [
      "Heavy machinery works under USAR direction only — never lift-and-pull on a structure that may hold live victims.",
      "Enforce silence periods before machinery starts at any site with possible trapped survivors.",
      "Stage fuel and operator rotation before committing equipment to a multi-hour extrication.",
    ],
    source_label: "INSARAG heavy rescue coordination (condensed)",
    cautions: [STANDARD_CAUTION],
  },
  hazard: {
    steps: [
      "Establish and mark a perimeter; assign one access control point.",
      "Report gas leaks, fire, and unstable structures up the chain before committing responders inside the perimeter.",
      "Reassess after every significant aftershock.",
    ],
    source_label: "General incident hazard-zone practice (condensed)",
    cautions: [STANDARD_CAUTION],
  },
};

const GENERIC = {
  steps: ["No specific protocol on file for this category — coordinator judgment applies."],
  source_label: "none",
  cautions: [STANDARD_CAUTION],
};

// Our board categories → knowledge-service incident_types (see
// knowledge-service/CLAUDE.md). Unmapped categories go as "other"; the
// service degrades gracefully by contract.
const KB_INCIDENT_TYPE = {
  rescue: "structural_collapse",
  machinery: "structural_collapse",
  medical: "casualty_triage",
  water: "water_sanitation",
  shelter: "shelter_disease",
};

// Normalize the knowledge-service response
// {guidance: [{action, rationale, ...}], safety_flags, disclaimer, source_standards}
// into the advisory card shape the frontend renders: {steps, source_label, cautions}.
function fromKbResponse(body) {
  if (!Array.isArray(body?.guidance) || body.guidance.length === 0) return null;
  return {
    steps: body.guidance.map((g) =>
      g.rationale ? `${g.action} (${g.rationale})` : g.action,
    ),
    source_label: (body.source_standards ?? []).join(", ") || "knowledge-service",
    cautions: [...(body.safety_flags ?? []), ...(body.disclaimer ? [body.disclaimer] : [])],
    incident_type: body.incident_type,
    source: "protocol-kb",
  };
}

export async function advise(category, context = {}) {
  const url = process.env.PROTOCOL_KB_URL;
  if (url) {
    try {
      const resp = await fetch(`${url.replace(/\/+$/, "")}/advise`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          incident_type: KB_INCIDENT_TYPE[category] ?? "other",
          needs: [category],
          context: {
            location_label: context.location ?? null,
            casualty_count: context.people_estimate ?? null,
            notes: context.summary ?? null,
          },
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (resp.ok) {
        const advisory = fromKbResponse(await resp.json());
        if (advisory) return advisory;
      }
      logger.warn(`Protocol KB returned unusable response (HTTP ${resp.status}); using local KB.`);
    } catch (err) {
      logger.warn(`Protocol KB unreachable (${err.message}); using local KB.`);
    }
  }
  return { ...(KB[category] ?? GENERIC), source: "local" };
}
