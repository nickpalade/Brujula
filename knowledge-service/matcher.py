"""
matcher.py - situation -> guidance lookup (the REAL logic).

Loads the four protocol files from data/*.json once at import time and
resolves an incoming /advise request to the right guidance deterministically:
no model inference, no database, and no network - plain dict lookups and
keyword scoring, so it answers instantly and identically in airplane mode.

Matching is FORGIVING per the interface contract (CLAUDE.md):
  1. Exact match on incident_type when it is a covered type.
  2. Else keyword-score the request's `needs` tags and context["notes"] text
     against each protocol's keyword list; best score wins (ties broken by
     _TIE_BREAK_ORDER, life-rescue first).
  3. Else return the generic "other" size-up guidance. Never raise.

Text is normalized before matching (lowercase, underscores/hyphens to spaces,
accents stripped) so "Atrapados" matches "atrapado" and "sarampión" matches
"sarampion" - field notes from the Venezuela scenario may arrive in Spanish.

Hard rules that apply here: offline only, operational guidance for trained
responders only (no diagnosis/treatment), paraphrased content with named
sources. The content itself lives in data/*.json; this module only retrieves.
"""
from __future__ import annotations

import copy
import json
import logging
import re
import unicodedata
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"

DISCLAIMER = (
    "Operational guidance for trained responders. "
    "Not medical diagnosis or treatment advice."
)

_VALID_PRIORITIES = {"critical", "high", "routine"}
_REQUIRED_PROTOCOL_KEYS = {
    "incident_type",
    "guidance",
    "safety_flags",
    "source_standards",
    "keywords",
}
_REQUIRED_STEP_KEYS = {"step", "action", "priority", "rationale", "source"}

# When two protocols keyword-score the same, prefer them in this order
# (immediate life rescue first). Deterministic on purpose.
_TIE_BREAK_ORDER = [
    "structural_collapse",
    "casualty_triage",
    "water_sanitation",
    "shelter_disease",
]

# Generic fallback when nothing matches: general size-up guidance under
# incident_type "other", never an error (contract requirement).
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


def _normalize(text: str) -> str:
    """Lowercase, strip accents, and turn _/- into spaces for matching."""
    decomposed = unicodedata.normalize("NFKD", text)
    ascii_ish = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return ascii_ish.lower().replace("_", " ").replace("-", " ")


def _validate_protocol(payload: dict[str, Any], name: str) -> None:
    """Raise ValueError if a protocol file doesn't satisfy the contract."""
    missing = _REQUIRED_PROTOCOL_KEYS - payload.keys()
    if missing:
        raise ValueError(f"{name}: missing keys {sorted(missing)}")
    if not payload["guidance"]:
        raise ValueError(f"{name}: guidance is empty")
    if not payload["safety_flags"]:
        raise ValueError(f"{name}: safety_flags is empty")
    for index, step in enumerate(payload["guidance"], start=1):
        step_missing = _REQUIRED_STEP_KEYS - step.keys()
        if step_missing:
            raise ValueError(f"{name}: step {index} missing {sorted(step_missing)}")
        if step["priority"] not in _VALID_PRIORITIES:
            raise ValueError(f"{name}: step {index} bad priority {step['priority']!r}")
        if step["step"] != index:
            raise ValueError(f"{name}: steps not numbered 1..n (found {step['step']} at {index})")


def load_protocols(data_dir: Path = DATA_DIR) -> dict[str, dict[str, Any]]:
    """Load and validate data/*.json into an {incident_type: protocol} map.

    A malformed file is logged and skipped rather than taking the whole
    service down - the service must stay non-blocking for the demo - but the
    test suite asserts all four domains load, so a regression is caught there.
    """
    protocols: dict[str, dict[str, Any]] = {}
    for path in sorted(data_dir.glob("*.json")):
        try:
            with path.open(encoding="utf-8") as fh:
                payload = json.load(fh)
            _validate_protocol(payload, path.name)
        except (OSError, ValueError) as exc:
            logger.warning("Skipping protocol file %s: %s", path.name, exc)
            continue
        protocols[payload["incident_type"]] = payload
    if not protocols:
        logger.warning("No protocol files loaded from %s - serving fallback only", data_dir)
    return protocols


# Loaded once at import - the only file I/O the matcher ever does.
_PROTOCOLS: dict[str, dict[str, Any]] = load_protocols()


def covered_incident_types() -> list[str]:
    """The incident_types the service can answer with real protocol content."""
    return sorted(_PROTOCOLS)


def _collect_match_text(
    needs: Optional[Any], context: Optional[Any]
) -> str:
    """Fold `needs` and context['notes'] into one normalized string.

    Defensive about shapes: the contract promises we never error on a messy
    request, so a string where a list was expected (etc.) is tolerated.
    """
    parts: list[str] = []
    if isinstance(needs, str):
        parts.append(needs)
    elif isinstance(needs, (list, tuple)):
        parts.extend(str(item) for item in needs)
    if isinstance(context, dict):
        notes = context.get("notes")
        if isinstance(notes, str):
            parts.append(notes)
        elif notes is not None:
            parts.append(str(notes))
    return _normalize(" ".join(parts))


def _keyword_score(protocol: dict[str, Any], text: str) -> int:
    """Count how many of the protocol's keywords appear in the text (whole words)."""
    score = 0
    for keyword in protocol["keywords"]:
        normalized = _normalize(str(keyword)).strip()
        if normalized and re.search(rf"\b{re.escape(normalized)}\b", text):
            score += 1
    return score


def _tie_break_position(incident_type: str) -> int:
    try:
        return _TIE_BREAK_ORDER.index(incident_type)
    except ValueError:
        return len(_TIE_BREAK_ORDER)


def _build_response(protocol: dict[str, Any], matched_by: str) -> dict[str, Any]:
    """Assemble a contract-shaped response from a loaded protocol.

    Deep-copies mutable content so a caller can never mutate the loaded data.
    `matched_by` ("exact" | "keywords" | "fallback") is additive to the
    contract - a debugging aid for integration, safe for consumers to ignore.
    """
    return {
        "incident_type": protocol["incident_type"],
        "guidance": copy.deepcopy(protocol["guidance"]),
        "safety_flags": list(protocol["safety_flags"]),
        "disclaimer": DISCLAIMER,
        "source_standards": list(protocol["source_standards"]),
        "matched_by": matched_by,
    }


def match(
    incident_type: Optional[Any],
    needs: Optional[Any] = None,
    context: Optional[Any] = None,
) -> dict[str, Any]:
    """Resolve a situation to a guidance response. Never raises.

    1. exact incident_type -> 2. keyword score on needs/notes -> 3. "other".
    """
    # 1. Exact incident_type (case/accent/separator-insensitive).
    if isinstance(incident_type, str):
        key = _normalize(incident_type).strip().replace(" ", "_")
        if key in _PROTOCOLS:
            return _build_response(_PROTOCOLS[key], "exact")

    # 2. Keyword fallback over needs + context.notes.
    text = _collect_match_text(needs, context)
    if text:
        scores = {
            itype: _keyword_score(protocol, text)
            for itype, protocol in _PROTOCOLS.items()
        }
        best = max(scores.values(), default=0)
        if best > 0:
            winner = min(
                (itype for itype, score in scores.items() if score == best),
                key=_tie_break_position,
            )
            return _build_response(_PROTOCOLS[winner], "keywords")

    # 3. Generic size-up guidance - the contract's "other", never an error.
    fallback = copy.deepcopy(OTHER_RESPONSE)
    fallback["matched_by"] = "fallback"
    return fallback
