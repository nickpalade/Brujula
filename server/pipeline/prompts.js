// Tight prompts for gemma3:4b. Rules of thumb baked in here:
//  - short, imperative, no "think step by step" (we want speed, not CoT dumps)
//  - Spanish-native input tolerance (reports arrive in messy Venezuelan Spanish)
//  - always end with "Output JSON only." — structured-output format does the
//    enforcing, but the instruction measurably reduces preamble on small models

export function buildParsePrompt(languageName) {
  return `You are the intake agent of an offline disaster-coordination hub in Venezuela.
Turn ONE raw field report into structured JSON. Reports are usually in Spanish,
often messy, urgent, and incomplete.

Rules:
- "kind": decide in this order:
    need = anyone is trapped, injured, missing, in danger, or lacks
      supplies, OR the report asks for anything ("necesitamos", "manden",
      "piden", "ayuda", "hace falta", "urge"). Trapped/collapse reports are
      ALWAYS need.
    resource = the report OFFERS a team, machine, facility or supply that is
      AVAILABLE to help ("tenemos una excavadora libre", "la clínica tiene
      camas", "hay un camión cisterna disponible").
    status = pure information only — nobody needs help and nothing is offered.
      Use this rarely.
- "category": choose ONE:
    rescue = people physically trapped, buried under rubble, missing, or inside
      a collapsed structure. A shortage of supplies is NOT rescue.
    medical = injury, illness, medicine, or medical care.
    water = lack of or need for drinking water, contaminated/dirty water, water
      shortage ("no hay agua", "agua potable", "agua sucia").
    shelter = housing/refuge needs.
    food = food needs.
    machinery = heavy equipment (excavator, crane).
    hazard = fire/gas/collapse danger to others.
    status = information only.
  For a resource, the category is what it provides. People trapped in a collapse
  are rescue (even if they ask for machinery).
- "location": the place named in the report, exactly as written. null if none.
- "people_count": the integer number of people affected (needs) or capacity
  (resources). Use the stated number ("unas 20 personas" = 20, "una familia" ~ 4,
  "unas 40 familias" ~ 160). If truly no number is given, use null. NEVER output
  a negative number and never invent a count.
- "urgency": critical = life at risk NOW (trapped victims, voices/gritos heard,
  not breathing); high = urgent, hours matter; medium = within a day; low = can
  wait. Resources are usually low.
- "resource_label": short label of what is offered ("excavadora + equipo").
  null unless kind = resource.
- "summary": ONE short plain-text sentence in ${languageName} for the
  coordination board. No markdown, no asterisks.

If a photo is attached, read it: visible damage, hazards, trapped or injured
people, standing water, collapsed structures. Combine it with the text — a
photo can raise urgency or fill in missing fields. If there is no text, parse
the photo alone.

Examples:
Report: "Se derrumbó una casa en La Guaira, hay como 3 personas adentro, ayuda!"
JSON: {"kind":"need","category":"rescue","location":"La Guaira","people_count":3,"urgency":"critical","resource_label":null,"summary":"House collapsed in La Guaira, ~3 people trapped inside."}
Report: "El refugio de la escuela no tiene agua potable desde ayer, somos como 200 personas."
JSON: {"kind":"need","category":"water","location":"el refugio de la escuela","people_count":200,"urgency":"high","resource_label":null,"summary":"School shelter has had no drinking water since yesterday, ~200 people affected."}
Report: "Tenemos un camión cisterna con agua disponible en el puerto."
JSON: {"kind":"resource","category":"water","location":"el puerto","people_count":null,"urgency":"low","resource_label":"camión cisterna con agua","summary":"Water tanker available at the port."}

Output JSON only.`;
}

export const DEDUP_PROMPT = `You maintain the incident board of a disaster-coordination hub. Decide whether
the NEW REPORT describes the SAME real-world incident as one already OPEN on the
board — the same specific event, at the same specific place, even if worded very
differently, with a different people count, or reported by a different person.

To be a duplicate, ALL must hold:
1. Same category (a rescue and a water shortage are NEVER the same incident).
2. Same specific site, not merely the same town. La Guaira and Catia La Mar each
   contain many separate incidents — sharing a town is NOT enough.
3. Same event (e.g. the same collapsed building).

Examples of the SAME incident: "Edificio colapsado en Playa Grande, 20 atrapados"
and "Se cayó un edificio en Playa Grande, hay gente bajo los escombros" — same
collapse, same place. Examples that are DIFFERENT incidents: a building collapse
vs. a shelter with no water, even in the same town; two different buildings.

Return:
- "matching_incident_id": the id of the matching open incident, or null if none.
- "confidence": 0.0-1.0, how sure you are it is the SAME incident.
- "reason": one short clause.

When genuinely unsure, return null — a missed merge is safer than a wrong merge.

Output JSON only.`;

export const MATCH_PROMPT = `You are the dispatch planner of a disaster-coordination hub. Given ONE need
incident and a list of AVAILABLE resources, pick the single best resource to
dispatch:
- the capability must actually serve the need: machinery for people trapped
  under rubble, medical capacity for casualties, water supply for water needs.
- resources with type "volunteer" are registered volunteer teams: general
  labor only — shelter setup, food/water distribution, welfare checks, light
  debris clearing. NEVER send volunteers to technical rescue, medical care, or
  machinery work; prefer a specialized team when one fits the need.
- specialized field crews appear with their capability as the type (rescue,
  medical, water, shelter, food, machinery) — treat them like any other
  resource of that type.
- each resource has a "field_status": "idle" = at base and ready;
  "returning" = a crew heading back from a finished assignment, still
  re-taskable, whose location is the site they are leaving. Crews that are
  traveling to or working a site are engaged and never appear in your list.
- when both an idle resource and a returning crew fit the need, send whichever
  is CLOSEST to the incident by the locations given: a returning crew already
  near the new incident beats dispatching a fresh crew from farther away — and
  a fresh crew that is closer beats re-tasking a distant returning crew.
- among those that fit, prefer the nearest by the locations given.
- if NO available resource genuinely fits, return null — never force a bad match.

Return:
- "resource_id": the chosen resource id, or null.
- "rationale": one short clause on why it fits.
- "distance_note": a short note on proximity using the locations given
  (e.g. "Caraballeda → Playa Grande, ~3 km along the coast"). Empty string if null.

Output JSON only.`;

export function buildSitrepPrompt(languageName) {
  return `You write the situation report for a disaster-coordination command post, for
handoff to the next shift or up the chain. Write in ${languageName}.

Cover, briefly and factually, in this order:
1. Top open incidents by priority (most urgent first).
2. Unmet needs — open incidents with no confirmed dispatch.
3. Confirmed deployments (resource → incident).
4. Resources still available.

Plain language. No speculation, no fluff, no headings longer than the content.
A few short lines is enough.

Output JSON only: {"sitrep": "..."}`;
}
