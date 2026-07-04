// Temp faithful mock of Rares' knowledge-service (knowledge-service/CLAUDE.md).
// Returns his exact /advise contract shape so INTEGRATION can prove the
// proxy-with-fallback path in server/routes/advise.js (decisions.md D1).
// Run: node server/_mock-kb.mjs   (listens on :8100). Delete after use.
import http from "node:http";

const GUIDANCE = {
  structural_collapse: {
    incident_type: "structural_collapse",
    guidance: [
      { step: 1, action: "Establish a safe perimeter and assess structural stability before any entry.", priority: "critical", rationale: "size-up precedes entry", source: "INSARAG USAR" },
      { step: 2, action: "Enforce silence periods and call/listen to locate live victims.", priority: "critical", rationale: "signs of life drive extrication priority", source: "INSARAG USAR" },
      { step: 3, action: "Shore unstable elements before committing rescuers to voids.", priority: "high", rationale: "prevents secondary collapse", source: "INSARAG USAR" },
    ],
    safety_flags: ["Do not enter unshored voids", "Isolate suspected gas before powered tools"],
    disclaimer: "Operational guidance for trained responders. Not medical diagnosis or treatment advice.",
    source_standards: ["INSARAG", "Sphere Handbook", "WHO/PAHO"],
  },
};

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ status: "ok" }));
  }
  if (req.method === "POST" && req.url === "/advise") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let type = "structural_collapse";
      try {
        type = JSON.parse(body).incident_type || type;
      } catch {}
      const payload = GUIDANCE[type] ?? {
        incident_type: "other",
        guidance: [{ step: 1, action: "Size up the scene and report the primary need.", priority: "high", rationale: "generic", source: "field practice" }],
        safety_flags: ["Confirm scene safety"],
        disclaimer: "Operational guidance for trained responders. Not medical diagnosis or treatment advice.",
        source_standards: ["General humanitarian practice"],
      };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(payload));
    });
    return;
  }
  res.statusCode = 404;
  res.end("not found");
});

server.listen(8100, () => console.log("mock Rares KB listening on :8100"));
