"""
Brujula - Knowledge Service.

Offline protocol advisory for disaster response. POST /advise resolves a
situation to the correct humanitarian response procedure via matcher.py,
which loads the four protocol files in data/*.json at startup (USAR / triage
/ WASH / disease control) and matches deterministically: exact incident_type,
else keywords over needs/notes, else generic "other" size-up guidance.

Contract lives in CLAUDE.md ("The interface contract"). Fully offline: no
network calls at runtime. mock/advise_examples.json is no longer served -
it remains in the repo as the integration fixture handed to Pepe.

Run:  uvicorn app:app --port 8100
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict

import matcher
from matcher import DISCLAIMER  # re-exported; tests and callers import it from app

__all__ = ["app", "DISCLAIMER"]


class AdviseRequest(BaseModel):
    """Incoming /advise body.

    Forgiving by design: every field is optional, extra fields are allowed,
    and the declared types are loose (Any) so even a type-mangled payload -
    e.g. `needs` as a string - reaches the matcher instead of a 422
    (see CLAUDE.md: "Matching must be forgiving"). matcher.match() is
    defensive about shapes and never raises.
    """

    model_config = ConfigDict(extra="allow")

    incident_type: Optional[Any] = None
    needs: Optional[Any] = None
    context: Optional[Any] = None


app = FastAPI(title="Brujula Knowledge Service", version="1.0.0")


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness probe - proves the service is up."""
    return {"status": "ok"}


@app.get("/protocols")
def protocols() -> dict[str, list[str]]:
    """Which incident_types the service covers with real protocol content."""
    return {"covered": matcher.covered_incident_types()}


@app.post("/advise")
def advise(req: AdviseRequest) -> dict[str, Any]:
    """Return protocol guidance for a situation.

    Forgiving contract: exact incident_type match, else keyword match on
    needs/notes, else the generic "other" size-up response - never an error.
    """
    return matcher.match(req.incident_type, req.needs, req.context)
