# Rares' Knowledge Service — Verification Report

- **Target:** `http://localhost:8100`
- **When:** 2026-07-04T13:44:43.440Z
- **Result:** PASS — KB is working
- **Checks:** 85/85 passed

Exercises the interface contract in `knowledge-service/CLAUDE.md`: `/health`, `/protocols`, and `/advise` (exact match per domain, Spanish keyword fallback, and the `other` size-up fallback), validating response shape, ordered steps, priorities, the fixed disclaimer, and non-empty safety flags on every response.

## Summary

| Section | Passed | Failed |
| --- | --- | --- |
| reachability | 2/2 | 0 |
| coverage (/protocols) | 5/5 | 0 |
| exact match per domain (/advise) | 40/40 | 0 |
| keyword fallback (Spanish field notes, no incident_type) | 10/10 | 0 |
| other fallback (unknown type, no matchable text) | 10/10 | 0 |
| forgiving inputs (must never 422/500) | 18/18 | 0 |

## Details

### reachability

- PASS — GET /health → 200 _(status=200)_
- PASS — GET /health → {"status":"ok"} _({"status":"ok"})_

### coverage (/protocols)

- PASS — GET /protocols → 200 _(status=200)_
- PASS — covers structural_collapse _(casualty_triage, shelter_disease, structural_collapse, water_sanitation)_
- PASS — covers casualty_triage _(casualty_triage, shelter_disease, structural_collapse, water_sanitation)_
- PASS — covers water_sanitation _(casualty_triage, shelter_disease, structural_collapse, water_sanitation)_
- PASS — covers shelter_disease _(casualty_triage, shelter_disease, structural_collapse, water_sanitation)_

### exact match per domain (/advise)

- PASS — structural_collapse: HTTP 200 (never errors) _(status=200)_
- PASS — structural_collapse: incident_type = structural_collapse _(got=structural_collapse)_
- PASS — structural_collapse: guidance is a non-empty array _(len=7)_
- PASS — structural_collapse: steps numbered 1..n in order _(1,2,3,4,5,6,7)_
- PASS — structural_collapse: every step priority in {critical,high,routine}
- PASS — structural_collapse: every step has action + rationale + source
- PASS — structural_collapse: safety_flags non-empty _(len=4)_
- PASS — structural_collapse: disclaimer is the exact contract line
- PASS — structural_collapse: source_standards non-empty _(INSARAG)_
- PASS — structural_collapse: matched_by = exact _(got=exact)_
- PASS — casualty_triage: HTTP 200 (never errors) _(status=200)_
- PASS — casualty_triage: incident_type = casualty_triage _(got=casualty_triage)_
- PASS — casualty_triage: guidance is a non-empty array _(len=6)_
- PASS — casualty_triage: steps numbered 1..n in order _(1,2,3,4,5,6)_
- PASS — casualty_triage: every step priority in {critical,high,routine}
- PASS — casualty_triage: every step has action + rationale + source
- PASS — casualty_triage: safety_flags non-empty _(len=3)_
- PASS — casualty_triage: disclaimer is the exact contract line
- PASS — casualty_triage: source_standards non-empty _(START, SALT)_
- PASS — casualty_triage: matched_by = exact _(got=exact)_
- PASS — water_sanitation: HTTP 200 (never errors) _(status=200)_
- PASS — water_sanitation: incident_type = water_sanitation _(got=water_sanitation)_
- PASS — water_sanitation: guidance is a non-empty array _(len=6)_
- PASS — water_sanitation: steps numbered 1..n in order _(1,2,3,4,5,6)_
- PASS — water_sanitation: every step priority in {critical,high,routine}
- PASS — water_sanitation: every step has action + rationale + source
- PASS — water_sanitation: safety_flags non-empty _(len=3)_
- PASS — water_sanitation: disclaimer is the exact contract line
- PASS — water_sanitation: source_standards non-empty _(Sphere Handbook, WHO/PAHO)_
- PASS — water_sanitation: matched_by = exact _(got=exact)_
- PASS — shelter_disease: HTTP 200 (never errors) _(status=200)_
- PASS — shelter_disease: incident_type = shelter_disease _(got=shelter_disease)_
- PASS — shelter_disease: guidance is a non-empty array _(len=6)_
- PASS — shelter_disease: steps numbered 1..n in order _(1,2,3,4,5,6)_
- PASS — shelter_disease: every step priority in {critical,high,routine}
- PASS — shelter_disease: every step has action + rationale + source
- PASS — shelter_disease: safety_flags non-empty _(len=3)_
- PASS — shelter_disease: disclaimer is the exact contract line
- PASS — shelter_disease: source_standards non-empty _(WHO/PAHO, Sphere Handbook)_
- PASS — shelter_disease: matched_by = exact _(got=exact)_

### keyword fallback (Spanish field notes, no incident_type)

- PASS — es-notes→structural_collapse: HTTP 200 (never errors) _(status=200)_
- PASS — es-notes→structural_collapse: incident_type = structural_collapse _(got=structural_collapse)_
- PASS — es-notes→structural_collapse: guidance is a non-empty array _(len=7)_
- PASS — es-notes→structural_collapse: steps numbered 1..n in order _(1,2,3,4,5,6,7)_
- PASS — es-notes→structural_collapse: every step priority in {critical,high,routine}
- PASS — es-notes→structural_collapse: every step has action + rationale + source
- PASS — es-notes→structural_collapse: safety_flags non-empty _(len=4)_
- PASS — es-notes→structural_collapse: disclaimer is the exact contract line
- PASS — es-notes→structural_collapse: source_standards non-empty _(INSARAG)_
- PASS — es-notes→structural_collapse: matched_by = keywords _(got=keywords)_

### other fallback (unknown type, no matchable text)

- PASS — unknown→other: HTTP 200 (never errors) _(status=200)_
- PASS — unknown→other: incident_type = other _(got=other)_
- PASS — unknown→other: guidance is a non-empty array _(len=3)_
- PASS — unknown→other: steps numbered 1..n in order _(1,2,3)_
- PASS — unknown→other: every step priority in {critical,high,routine}
- PASS — unknown→other: every step has action + rationale + source
- PASS — unknown→other: safety_flags non-empty _(len=2)_
- PASS — unknown→other: disclaimer is the exact contract line
- PASS — unknown→other: source_standards non-empty _(General incident command)_
- PASS — unknown→other: matched_by = fallback _(got=fallback)_

### forgiving inputs (must never 422/500)

- PASS — empty body: HTTP 200 (never errors) _(status=200)_
- PASS — empty body: incident_type = other _(got=other)_
- PASS — empty body: guidance is a non-empty array _(len=3)_
- PASS — empty body: steps numbered 1..n in order _(1,2,3)_
- PASS — empty body: every step priority in {critical,high,routine}
- PASS — empty body: every step has action + rationale + source
- PASS — empty body: safety_flags non-empty _(len=2)_
- PASS — empty body: disclaimer is the exact contract line
- PASS — empty body: source_standards non-empty _(General incident command)_
- PASS — needs-as-string: HTTP 200 (never errors) _(status=200)_
- PASS — needs-as-string: incident_type present _(got=water_sanitation)_
- PASS — needs-as-string: guidance is a non-empty array _(len=6)_
- PASS — needs-as-string: steps numbered 1..n in order _(1,2,3,4,5,6)_
- PASS — needs-as-string: every step priority in {critical,high,routine}
- PASS — needs-as-string: every step has action + rationale + source
- PASS — needs-as-string: safety_flags non-empty _(len=3)_
- PASS — needs-as-string: disclaimer is the exact contract line
- PASS — needs-as-string: source_standards non-empty _(Sphere Handbook, WHO/PAHO)_
