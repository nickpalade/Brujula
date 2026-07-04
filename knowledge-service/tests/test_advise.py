"""
Tests for the REAL knowledge-service (matcher wired, content from data/*.json).

Covers the definition of done in CLAUDE.md:
  - /health and /protocols work; all four domains load from data/.
  - /advise returns contract-shaped, domain-correct guidance for every
    covered incident_type, with named sources per domain.
  - Forgiving matching: keyword fallback on needs/notes (incl. Spanish and
    accented text), and the generic "other" response instead of any error.
  - Disclaimer and non-empty safety_flags on every response.
  - No treatment/diagnosis language anywhere in the authored content.

Run:  pytest -q      (from /knowledge-service)
"""
import pytest
from fastapi.testclient import TestClient

import matcher
from app import DISCLAIMER, app

client = TestClient(app)

DOMAINS = ("structural_collapse", "casualty_triage", "water_sanitation", "shelter_disease")
VALID_PRIORITIES = {"critical", "high", "routine"}

# Each domain must cite its own named standard(s) in source_standards.
EXPECTED_STANDARDS = {
    "structural_collapse": ("INSARAG",),
    "casualty_triage": ("START", "SALT"),
    "water_sanitation": ("Sphere",),
    "shelter_disease": ("WHO/PAHO",),
}


def advise(body):
    response = client.post("/advise", json=body)
    assert response.status_code == 200
    return response.json()


# ---------------------------------------------------------------- endpoints

def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_protocols_reflects_real_data_coverage():
    r = client.get("/protocols")
    assert r.status_code == 200
    assert set(r.json()["covered"]) == set(DOMAINS)


def test_all_four_data_files_load():
    assert matcher.covered_incident_types() == sorted(DOMAINS)


# ------------------------------------------------- contract shape per domain

@pytest.mark.parametrize("incident_type", DOMAINS)
def test_domain_response_matches_contract(incident_type):
    body = advise({"incident_type": incident_type})

    assert body["incident_type"] == incident_type
    assert body["matched_by"] == "exact"
    assert body["disclaimer"] == DISCLAIMER
    assert body["safety_flags"], "safety_flags must be non-empty"
    assert body["source_standards"], "source_standards must be non-empty"

    guidance = body["guidance"]
    assert len(guidance) >= 4, "each domain needs a real ordered procedure"
    for index, step in enumerate(guidance, start=1):
        assert step["step"] == index, "steps must be numbered 1..n"
        assert step["priority"] in VALID_PRIORITIES
        for field in ("action", "rationale", "source"):
            assert isinstance(step[field], str) and step[field].strip()


@pytest.mark.parametrize("incident_type", DOMAINS)
def test_domain_cites_its_named_standard(incident_type):
    body = advise({"incident_type": incident_type})
    joined = " ".join(body["source_standards"])
    assert any(std in joined for std in EXPECTED_STANDARDS[incident_type])


# ----------------------------------------------------- forgiving matching

@pytest.mark.parametrize(
    "request_body, expected_type",
    [
        # keyword hit via needs tags
        ({"needs": ["water"]}, "water_sanitation"),
        ({"incident_type": "unknown_thing", "needs": ["triage"]}, "casualty_triage"),
        # keyword hit via free-text notes
        ({"context": {"notes": "people trapped under the rubble, knocking heard"}},
         "structural_collapse"),
        ({"context": {"notes": "measles outbreak in the shelter"}}, "shelter_disease"),
        # a listed-but-uncovered incident_type falls through to keywords
        ({"incident_type": "flood", "context": {"notes": "sewage in the drinking water"}},
         "water_sanitation"),
        # Spanish field notes, with accents
        ({"context": {"notes": "brote de sarampión en el albergue"}}, "shelter_disease"),
        ({"context": {"notes": "hay gente atrapada bajo los escombros"}}, "structural_collapse"),
        # type-mangled payload: needs as a bare string must still match
        ({"needs": "agua contaminada"}, "water_sanitation"),
    ],
)
def test_keyword_fallback(request_body, expected_type):
    body = advise(request_body)
    assert body["incident_type"] == expected_type
    assert body["matched_by"] == "keywords"


@pytest.mark.parametrize(
    "request_body",
    [
        {},                                              # nothing at all
        {"incident_type": "fire"},                       # listed type, no protocol, no text
        {"incident_type": "alien_invasion"},             # unknown type, no text
        {"needs": [], "context": {"notes": "zzz qqq"}},  # text with zero keyword hits
        {"needs": 42, "context": "not a dict"},          # type-mangled everything
    ],
)
def test_unmatched_requests_fall_back_to_other_not_an_error(request_body):
    body = advise(request_body)
    assert body["incident_type"] == "other"
    assert body["matched_by"] == "fallback"
    assert body["guidance"], "even the fallback carries size-up guidance"


def test_exact_match_wins_over_keywords():
    # notes scream USAR, but the declared incident_type must win
    body = advise({
        "incident_type": "water_sanitation",
        "context": {"notes": "trapped in rubble knocking"},
    })
    assert body["incident_type"] == "water_sanitation"
    assert body["matched_by"] == "exact"


# ------------------------------------------------ safety invariants (rule 3)

ALL_RESPONSE_BODIES = [{"incident_type": d} for d in DOMAINS] + [{}]


@pytest.mark.parametrize("request_body", ALL_RESPONSE_BODIES)
def test_disclaimer_and_safety_flags_on_every_response(request_body):
    body = advise(request_body)
    assert body["disclaimer"] == DISCLAIMER
    assert isinstance(body["safety_flags"], list) and body["safety_flags"]


FORBIDDEN_TREATMENT_TERMS = (
    # hard rule 3: operational guidance only - never diagnosis or treatment
    "administer", "prescribe", "dose", "dosage", "medication", "antibiotic",
    "give the patient", "inject", "tourniquet", "cpr", "resuscitat",
)


def test_no_treatment_language_in_authored_content():
    for incident_type, protocol in matcher._PROTOCOLS.items():
        for step in protocol["guidance"]:
            text = (step["action"] + " " + step["rationale"]).lower()
            for term in FORBIDDEN_TREATMENT_TERMS:
                assert term not in text, (
                    f"{incident_type} step {step['step']} contains forbidden "
                    f"treatment term {term!r}"
                )
