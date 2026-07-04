"""
Smoke tests for the MOCK knowledge-service.

These exercise the scaffold + mock server only: /health, /protocols, and canned
/advise lookups including the forgiving "other" fallback. Real protocol-content
tests (correct steps per domain, keyword fallback, offline guarantee) are still
TODO - see CLAUDE.md "Current state - start here tomorrow".

Run:  pytest -q      (from /knowledge-service)
"""
from fastapi.testclient import TestClient

from app import DISCLAIMER, app

client = TestClient(app)

DOMAINS = ("structural_collapse", "casualty_triage", "water_sanitation", "shelter_disease")


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_protocols_lists_the_four_domains():
    r = client.get("/protocols")
    assert r.status_code == 200
    assert set(r.json()["covered"]) == set(DOMAINS)


def test_advise_structural_collapse_returns_matching_canned_response():
    r = client.post("/advise", json={"incident_type": "structural_collapse"})
    assert r.status_code == 200
    body = r.json()
    assert body["incident_type"] == "structural_collapse"
    assert body["guidance"] and body["guidance"][0]["step"] == 1
    assert body["disclaimer"] == DISCLAIMER


def test_every_domain_has_a_canned_response():
    for incident_type in DOMAINS:
        r = client.post("/advise", json={"incident_type": incident_type})
        assert r.status_code == 200
        assert r.json()["incident_type"] == incident_type


def test_advise_unknown_incident_type_falls_back_to_other():
    r = client.post("/advise", json={"incident_type": "alien_invasion"})
    assert r.status_code == 200
    assert r.json()["incident_type"] == "other"


def test_advise_missing_incident_type_does_not_error():
    # Forgiving contract: no incident_type must not 422.
    r = client.post("/advise", json={"needs": ["water"], "context": {"notes": "no clean water"}})
    assert r.status_code == 200
    assert r.json()["incident_type"] == "other"


# TODO(Rares): once matcher.py is real -
#   - assert domain-correct steps/sources are loaded from data/*.json
#   - test the keyword fallback on needs/notes when incident_type is missing
#   - assert the disclaimer and non-empty safety_flags appear on every response
#   - assert no network call happens (offline guarantee / airplane-mode test)
