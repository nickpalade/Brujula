import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";

import express from "express";

process.env.BRUJULA_DATA_DIR = path.join(tmpdir(), `brujula-hub-contracts-${process.pid}`);
process.env.BRUJULA_PROVIDER = "mock";
process.env.BRUJULA_CHAT_PROVIDER = "mock";
process.env.REPORT_ACK_TIMEOUT_MS = "5000";

const store = await import("../server/store.js");
const { hubRouter, mergeReportIntoIncident, dedupKindsCompatible } = await import("../server/routes/hub.js");

let server;
let base;

before(async () => {
  const app = express();
  app.use(express.json({ limit: "25mb" }));
  app.use(hubRouter);
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  store.reset();
});

after(() => {
  server?.close();
});

async function api(pathname, { method = "GET", body } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

function expectOk(result) {
  assert.equal(result.payload.success, true, result.payload.error ?? "expected success envelope");
  return result.payload.data;
}

test("reports are validated, parsed, idempotent, and photo-safe", async () => {
  const invalid = await api("/api/reports", { method: "POST", body: { text: "   " } });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.payload.success, false);

  const first = expectOk(await api("/api/reports", {
    method: "POST",
    body: {
      text: "Building collapsed in Playa Grande, Catia La Mar. 12 people trapped.",
      image_base64: "not-a-real-photo",
      image_mime: "image/jpeg",
      source_device: "field-1",
      reported_by: "Ana Field · reporter",
      client_ref: "same-report-ref",
      lat: 10.6081,
      lon: -67.0472,
      accuracy: 12,
    },
  }));

  assert.equal(first.report.client_ref, "same-report-ref");
  assert.equal(first.report.has_image, true);
  assert.equal(first.report.image_base64, undefined);
  assert.equal(first.report.lat, 10.6081);
  assert.equal(first.incident.category, "rescue");
  assert.equal(first.incident.urgency, "critical");
  assert.equal(first.incident.people_count, 12);
  assert.equal(first.incident.lat, 10.6081);

  const replay = expectOk(await api("/api/reports", {
    method: "POST",
    body: { text: "duplicate retry", client_ref: "same-report-ref" },
  }));

  assert.equal(replay.report.id, first.report.id);
  assert.equal(store.listReports().filter((report) => report.client_ref === "same-report-ref").length, 1);
});

test("registration creates dispatchable resources and crew status updates availability", async () => {
  const registration = expectOk(await api("/api/register", {
    method: "POST",
    body: {
      role: "crew",
      name: "Rescue Team Alpha",
      skill: "rescue",
      location: "Caraballeda",
      team_size: 5,
      device_id: "crew-alpha",
    },
  }));

  assert.equal(registration.personnel.role, "crew");
  assert.equal(registration.resource.type, "rescue");
  assert.equal(registration.resource.status, "available");
  assert.equal(registration.resource.field_status, "idle");

  const traveling = expectOk(await api("/api/crew-status", {
    method: "POST",
    body: { device_id: "crew-alpha", field_status: "traveling" },
  }));
  assert.equal(traveling.resource.field_status, "traveling");
  assert.equal(store.matchableResources().some((resource) => resource.id === traveling.resource.id), false);

  const returning = expectOk(await api("/api/crew-status", {
    method: "POST",
    body: { device_id: "crew-alpha", field_status: "returning" },
  }));
  assert.equal(returning.resource.field_status, "returning");
});

test("dispatch confirmation commits resources and enforces forward lifecycle", async () => {
  const created = expectOk(await api("/api/reports", {
    method: "POST",
    body: {
      text: "Building collapsed in Playa Grande with 9 people trapped. Need machinery.",
      client_ref: "dispatch-source",
    },
  }));
  const dispatch = store.listDispatches().find((item) => item.incident_id === created.incident.id);
  assert.ok(dispatch, "pipeline should propose a dispatch for the rescue need");

  const confirmed = expectOk(await api(`/api/incidents/${created.incident.id}/dispatch`, {
    method: "POST",
    body: { dispatch_id: dispatch.id, action: "confirm" },
  }));
  assert.equal(confirmed.state, "confirmed");
  assert.equal(store.getIncident(created.incident.id).status, "dispatched");
  assert.equal(store.getResource(confirmed.resource_id).status, "committed");

  const backward = await api(`/api/dispatches/${dispatch.id}/status`, {
    method: "POST",
    body: { state: "accepted" },
  });
  assert.equal(backward.status, 200);
  assert.equal(backward.payload.success, true);

  const duplicate = await api(`/api/dispatches/${dispatch.id}/status`, {
    method: "POST",
    body: { state: "accepted" },
  });
  assert.equal(duplicate.status, 400);
  assert.equal(duplicate.payload.success, false);

  expectOk(await api(`/api/dispatches/${dispatch.id}/status`, {
    method: "POST",
    body: { state: "en_route" },
  }));
  expectOk(await api(`/api/dispatches/${dispatch.id}/status`, {
    method: "POST",
    body: { state: "on_site" },
  }));
  const done = expectOk(await api(`/api/dispatches/${dispatch.id}/status`, {
    method: "POST",
    body: { state: "done", outcome: "All trapped people extracted." },
  }));

  assert.equal(done.dispatch.state, "done");
  assert.equal(done.resource.status, "available");
  assert.equal(done.resource.field_status, "returning");
  assert.equal(done.incident.outcome, "All trapped people extracted.");
});

test("human corrections, resources, alerts, trends, and chat use stable envelopes", async () => {
  const incident = store.addIncident({
    category: "water",
    location: "Escuela Simon Bolivar, Catia La Mar",
    urgency: "high",
    summary: "Shelter needs water.",
  });
  const resource = store.addResource({
    type: "water",
    label: "Water tanker",
    quantity: 3,
    unit: "loads",
  });

  const patchedIncident = expectOk(await api(`/api/incidents/${incident.id}`, {
    method: "PATCH",
    body: { people_count: 180, urgency: "critical" },
  }));
  assert.equal(patchedIncident.corrected_by_human, true);
  assert.equal(patchedIncident.people_count, 180);

  const patchedResource = expectOk(await api(`/api/resources/${resource.id}`, {
    method: "PATCH",
    body: { quantity: 2, status: "available" },
  }));
  assert.equal(patchedResource.quantity, 2);

  const alert = expectOk(await api("/api/alerts", {
    method: "POST",
    body: { message: "Aftershock warning", severity: "critical", zone: "Playa Grande" },
  }));
  assert.equal(alert.active, true);
  assert.equal(expectOk(await api("/api/alerts")).length, 1);
  const deactivated = expectOk(await api(`/api/alerts/${alert.id}/deactivate`, { method: "POST", body: {} }));
  assert.equal(deactivated.active, false);

  const chat = expectOk(await api("/api/chat", {
    method: "POST",
    body: { question: "Which water resources are available?", station: "command" },
  }));
  assert.match(chat.answer, /water tanker|resource inventory/i);
  assert.ok(chat.sources.some((source) => source.type === "resource"));

  const trends = expectOk(await api("/api/trends?window=45"));
  assert.equal(trends.window_minutes, 45);
  assert.ok(Array.isArray(trends.categories));
});

test("chat proposes validated board actions and POST /api/incidents adds nodes", async () => {
  const incident = store.addIncident({
    category: "water",
    location: "Escuela Simon Bolivar, Catia La Mar",
    urgency: "high",
    summary: "Shelter needs water.",
  });

  // Command station: the mock provider proposes an urgency escalation grounded
  // in a real incident id from the context; the hub re-validates it.
  const chat = expectOk(await api("/api/chat", {
    method: "POST",
    body: { question: "Escalate the water incident to critical urgency", station: "command" },
  }));
  assert.ok(Array.isArray(chat.proposed_actions));
  const action = chat.proposed_actions.find((a) => a.type === "update_incident");
  assert.ok(action, "expected an update_incident proposal");
  assert.equal(action.incident_id, incident.id);
  assert.equal(action.patch.urgency, "critical");
  assert.ok(action.reason.length > 0);

  // Applying a proposal goes through the same human-correction endpoint.
  const applied = expectOk(await api(`/api/incidents/${action.incident_id}`, {
    method: "PATCH",
    body: action.patch,
  }));
  assert.equal(applied.urgency, "critical");
  assert.equal(applied.corrected_by_human, true);

  // Field station chats never carry actions.
  const fieldChat = expectOk(await api("/api/chat", {
    method: "POST",
    body: { question: "Escalate the water incident to critical urgency", station: "field" },
  }));
  assert.equal((fieldChat.proposed_actions ?? []).length, 0);

  // Direct incident creation (apply path for create_incident proposals).
  const created = expectOk(await api("/api/incidents", {
    method: "POST",
    body: {
      category: "shelter",
      urgency: "high",
      summary: "Families without shelter after the collapse.",
      location: "Playa Grande, Catia La Mar",
    },
  }));
  assert.equal(created.status, "open");
  assert.equal(created.kind, "need");
  assert.equal(created.category, "shelter");
  assert.ok(store.getIncident(created.id));

  const invalid = await api("/api/incidents", { method: "POST", body: { category: "nope" } });
  assert.equal(invalid.status, 400);
});

test("parsed report fields are persisted and returned by GET /api/reports", async () => {
  const created = expectOk(await api("/api/reports", {
    method: "POST",
    body: {
      text: "Need drinking water for 60 people at Escuela Simon Bolivar.",
      client_ref: "parsed-fields-ref",
    },
  }));

  assert.equal(created.report.parsed_kind, "need");
  assert.equal(created.report.parsed_category, "water");
  assert.equal(created.report.parsed_location, "Escuela Simon Bolivar, Catia La Mar");
  assert.equal(created.report.parsed_people_count, 60);
  assert.equal(created.report.parsed_urgency, "high");

  const byId = expectOk(await api(`/api/reports?ids=${created.report.id}`));
  assert.equal(byId.length, 1);
  assert.equal(byId[0].parsed_kind, "need");
  assert.equal(byId[0].parsed_category, "water");
  assert.equal(byId[0].parsed_people_count, 60);

  const listed = expectOk(await api("/api/reports")).find((report) => report.id === created.report.id);
  assert.equal(listed.parsed_kind, "need");
  assert.equal(listed.parsed_urgency, "high");
});

test("resource-offer reports do not dedup-merge into need incidents", async () => {
  const need = expectOk(await api("/api/reports", {
    method: "POST",
    body: {
      text: "Need drinking water for 60 people at Escuela Simon Bolivar.",
      client_ref: "need-water-ref",
    },
  }));
  assert.equal(need.incident.kind, "need");
  assert.equal(need.incident.category, "water");

  const offer = expectOk(await api("/api/reports", {
    method: "POST",
    body: {
      text: "We offer a water tanker ready to distribute at Escuela Simon Bolivar.",
      client_ref: "offer-water-ref",
    },
  }));

  assert.equal(offer.report.parsed_kind, "resource");
  assert.ok(offer.incident, "offer should still produce its own incident");
  assert.equal(offer.incident.kind, "resource");
  assert.notEqual(offer.incident.id, need.incident.id);

  const needAfterOffer = store.getIncident(need.incident.id);
  assert.equal(needAfterOffer.people_count, 60);
  assert.deepEqual(needAfterOffer.merged_report_ids, [need.report.id]);

  // Same-kind dedup still merges: another need report at the same place.
  const followUp = expectOk(await api("/api/reports", {
    method: "POST",
    body: {
      text: "Still no drinking water at Escuela Simon Bolivar, people are thirsty.",
      client_ref: "need-water-again-ref",
    },
  }));
  assert.equal(followUp.incident.id, need.incident.id);
  assert.deepEqual(
    store.getIncident(need.incident.id).merged_report_ids,
    [need.report.id, followUp.report.id],
  );

  // The deterministic backstop itself, both directions.
  assert.equal(dedupKindsCompatible("need", "resource"), false);
  assert.equal(dedupKindsCompatible("resource", "need"), false);
  assert.equal(dedupKindsCompatible("need", "need"), true);
  assert.equal(dedupKindsCompatible("status", "need"), true);
  assert.equal(dedupKindsCompatible(undefined, "resource"), false);
});

test("resource reports merged as evidence do not inflate need people counts", () => {
  const incident = store.addIncident({
    kind: "need",
    category: "water",
    location: "Escuela Simon Bolivar, Catia La Mar",
    urgency: "high",
    summary: "Shelter needs water.",
    people_count: 25,
    merged_report_ids: ["rep-need"],
  });

  const merged = mergeReportIntoIncident(incident, "rep-resource", {
    kind: "resource",
    category: "water",
    location: "La Guaira staging",
    people_count: 10000,
    urgency: "critical",
    summary: "Water tanker available with 10,000 liters.",
  });

  assert.equal(merged.people_count, 25);
  assert.equal(merged.urgency, "critical");
  assert.deepEqual(merged.merged_report_ids, ["rep-need", "rep-resource"]);
});
