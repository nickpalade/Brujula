// Tests for server/geocode.js — the offline gazetteer that puts incidents on
// the map when a report has no phone GPS. Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";

import { geocodeLabel } from "../server/geocode.js";

// ---- happy paths ------------------------------------------------------------

test("known place resolves to its coordinates", () => {
  const hit = geocodeLabel("Caraballeda");
  assert.ok(hit);
  assert.equal(hit.place, "Caraballeda");
  assert.equal(typeof hit.lat, "number");
  assert.equal(typeof hit.lon, "number");
});

test("place embedded in a free-text sentence matches", () => {
  const hit = geocodeLabel("edificio azul cerca del mercado en Catia La Mar, cuarto piso");
  assert.equal(hit?.place, "Catia La Mar");
});

test("matching is case-insensitive", () => {
  assert.equal(geocodeLabel("MAIQUETÍA")?.place, "Maiquetía");
  assert.equal(geocodeLabel("maiquetía")?.place, "Maiquetía");
});

test("accents are optional in the query (field notes often lack them)", () => {
  assert.equal(geocodeLabel("maiquetia")?.place, "Maiquetía");
  assert.equal(geocodeLabel("naiguata")?.place, "Naiguatá");
  assert.equal(geocodeLabel("camuri chico")?.place, "Camurí Chico");
});

test("hyphens/underscores in the query normalize to spaces", () => {
  assert.equal(geocodeLabel("catia-la-mar")?.place, "Catia La Mar");
  assert.equal(geocodeLabel("catia_la_mar")?.place, "Catia La Mar");
});

// ---- specificity ------------------------------------------------------------

test("longest (most specific) name wins over a contained shorter one", () => {
  // "Refugio San José" must beat "La Guaira" inside the same label.
  const hit = geocodeLabel("Refugio San José, La Guaira");
  assert.equal(hit?.place, "Refugio San José");
});

test("school shelter label pins to the school, not the town", () => {
  const hit = geocodeLabel("Refugio Escuela Básica Simón Bolívar, Catia La Mar");
  assert.equal(hit?.place, "Escuela Básica Simón Bolívar");
});

test("equal-length tier ties break by position in the label", () => {
  // Both places match; "Playa Grande" is named first so it wins.
  const hit = geocodeLabel("Playa Grande, Catia La Mar");
  assert.equal(hit?.place, "Playa Grande");
});

test("road names with accents and hyphens resolve", () => {
  const hit = geocodeLabel("Carretera Vieja Caracas–La Guaira, cerca de Maiquetía".replace("–", "-"));
  assert.equal(hit?.place, "Carretera Vieja Caracas-La Guaira");
});

// ---- misses & junk input (must never throw) ---------------------------------

test("unknown place returns null", () => {
  assert.equal(geocodeLabel("Plaza Bolívar de Mérida"), null);
  assert.equal(geocodeLabel("somewhere unknown"), null);
});

test("partial word does not false-positive (whole-word matching)", () => {
  assert.equal(geocodeLabel("los macutos"), null); // "macutos" ≠ "Macuto"
  assert.equal(geocodeLabel("macutico"), null);
});

test("junk inputs return null without throwing", () => {
  assert.equal(geocodeLabel(null), null);
  assert.equal(geocodeLabel(undefined), null);
  assert.equal(geocodeLabel(""), null);
  assert.equal(geocodeLabel("   "), null);
  assert.equal(geocodeLabel(42), null);
  assert.equal(geocodeLabel({ location: "Macuto" }), null);
  assert.equal(geocodeLabel(["Macuto"]), null);
  assert.equal(geocodeLabel(true), null);
});

test("every gazetteer coordinate is inside the prefetched demo region", async () => {
  const { readFile } = await import("node:fs/promises");
  const entries = JSON.parse(await readFile(new URL("../fixtures/gazetteer.json", import.meta.url), "utf-8"));
  assert.ok(entries.length >= 10, "gazetteer should cover the demo region well");
  for (const e of entries) {
    assert.ok(e.lat >= 10.5 && e.lat <= 10.7, `${e.name} lat ${e.lat} outside tile bbox`);
    assert.ok(e.lon >= -67.12 && e.lon <= -66.68, `${e.name} lon ${e.lon} outside tile bbox`);
  }
});
