"""
Brujula - Knowledge Service (MOCK server).

Offline protocol advisory for disaster response. THIS IS THE MOCK: POST /advise
returns canned responses loaded from mock/advise_examples.json, keyed by
incident_type, with a generic "other" fallback. There is no real retrieval yet
- that lands in matcher.py, reading the protocol files in data/*.json.

Contract lives in CLAUDE.md ("The interface contract"). Fully offline: no
network calls at runtime.

Run:  uvicorn app:app --port 8100
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict

BASE_DIR = Path(__file__).resolve().parent
MOCK_FILE = BASE_DIR / "mock" / "advise_examples.json"

DISCLAIMER = (
    "Operational guidance for trained responders. "
    "Not medical diagnosis or treatment advice."
)

# Generic fallback used when incident_type is unknown or missing and nothing
# else matches. The contract requires we degrade to "other" with general
# size-up guidance rather than returning an error.
OTHER_RESPONSE: dict[str, Any] = {
    "incident_type": "other",
    "guidance": [
        {
            "step": 1,
            "action": "Perform a scene size-up and confirm it is safe to approach before doing anything else.",
            "priority": "critical",
            "rationale": "Responder safety precedes all action; an unsafe scene only creates more casualties.",
            "source": "General incident command",
        },
        {
            "step": 2,
            "action": "Identify the incident type and the single most urgent unmet need, then route to the matching protocol.",
            "priority": "high",
            "rationale": "Correct classification points responders to the right established procedure.",
            "source": "General incident command",
        },
        {
            "step": 3,
            "action": "Report the situation up the chain and request the specific resources the scene needs.",
            "priority": "high",
            "rationale": "Early, specific reporting lets the command post match resources to needs.",
            "source": "General incident command",
        },
    ],
    "safety_flags": [
        "Do not approach an unsecured scene",
        "Escalate to a specialist protocol once the incident type is known",
    ],
    "disclaimer": DISCLAIMER,
    "source_standards": ["General incident command"],
}


def _load_mock_responses() -> dict[str, dict[str, Any]]:
    """Load mock/advise_examples.json into an {incident_type: response} map."""
    with MOCK_FILE.open(encoding="utf-8") as fh:
        payload = json.load(fh)
    responses: dict[str, dict[str, Any]] = {}
    for pair in payload.get("examples", []):
        response = pair.get("response", {})
        incident_type = response.get("incident_type") or pair.get("request", {}).get(
            "incident_type"
        )
        if incident_type:
            responses[incident_type] = response
    return responses


# Loaded once at startup - no runtime I/O beyond this, no network ever.
MOCK_RESPONSES = _load_mock_responses()


class AdviseRequest(BaseModel):
    """Incoming /advise body.

    Forgiving by design: every field is optional and extra fields are allowed,
    so a missing or unknown incident_type falls back to "other" instead of
    raising a 422 (see CLAUDE.md: "Matching must be forgiving").
    """

    model_config = ConfigDict(extra="allow")

    incident_type: Optional[str] = None
    needs: Optional[list[str]] = None
    context: Optional[dict[str, Any]] = None


app = FastAPI(title="Brujula Knowledge Service (MOCK)", version="0.1.0-mock")


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness probe - proves the service is up."""
    return {"status": "ok"}


@app.get("/protocols")
def protocols() -> dict[str, list[str]]:
    """Which incident_types the (mock) service can currently answer."""
    return {"covered": sorted(MOCK_RESPONSES.keys())}


@app.post("/advise")
def advise(req: AdviseRequest) -> dict[str, Any]:
    """Return protocol guidance for a situation.

    MOCK behaviour: straight lookup by incident_type, otherwise the generic
    "other" response. The real forgiving matcher (keyword fallback on
    needs/notes, content loaded from data/*.json) will replace this body and
    live in matcher.py.
    """
    # TODO(Rares): replace this canned lookup with matcher.match(req).
    if req.incident_type and req.incident_type in MOCK_RESPONSES:
        return MOCK_RESPONSES[req.incident_type]
    return OTHER_RESPONSE
