"""
matcher.py - situation -> guidance lookup (REAL logic; NOT built yet).

Right now app.py serves canned responses straight from mock/advise_examples.json.
This module is where the real, offline, deterministic retrieval will live: load
the protocol files from data/*.json at startup and resolve an incoming request
to the correct guidance, with a forgiving fallback.

Planned contract (keep in sync with app.py and CLAUDE.md):

    match(incident_type, needs, context) -> advise-response dict

Matching must be FORGIVING (CLAUDE.md, "The interface contract"):
  1. Exact match on incident_type when it is one we cover.
  2. Else keyword-match on `needs` and context["notes"].
  3. Else return the generic "other" size-up guidance - never raise.

Hard rules that apply here too: offline only (no network), operational
guidance for trained responders only (no diagnosis/treatment), paraphrase and
cite sources by name.
"""
from __future__ import annotations

from typing import Any, Optional

# Incident types this service will cover once data/*.json is authored.
COVERED_INCIDENT_TYPES = [
    "structural_collapse",  # data/usar.json     - INSARAG
    "casualty_triage",      # data/triage.json   - START / SALT
    "water_sanitation",     # data/wash.json     - Sphere Handbook
    "shelter_disease",      # data/disease.json  - WHO/PAHO, Sphere
]


def match(
    incident_type: Optional[str],
    needs: Optional[list[str]] = None,
    context: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Resolve a situation to a guidance response. NOT IMPLEMENTED YET.

    Until this is built, app.py serves canned answers from the mock file.
    """
    raise NotImplementedError(
        "Real matcher not built yet - app.py currently serves the mock. See CLAUDE.md."
    )


# TODO(Rares):
#   - load_protocols(data_dir) -> {incident_type: [guidance steps ...]}
#   - build a small keyword index over needs/notes for the fallback path
#   - implement match(...) per the forgiving contract above
#   - wire app.advise() to call match(...) instead of the canned lookup
