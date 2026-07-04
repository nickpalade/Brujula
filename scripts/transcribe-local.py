#!/usr/bin/env python3
"""Local STT wrapper for Brujula voice reports.

Usage:
    python scripts/transcribe-local.py <audio_path> [lang] [output_path]

Requires:
    pip install faster-whisper

The script prints plain transcript text to stdout and also writes output_path
when supplied. faster-whisper uses local Whisper models and ffmpeg for formats
like webm/opus recorded by mobile browsers.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def transcribe(audio_path: Path, lang: str) -> str:
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise SystemExit(
            "faster-whisper is not installed. Run: pip install faster-whisper"
        ) from exc

    model_name = os.environ.get("BRUJULA_TRANSCRIBE_MODEL", "small")
    device = os.environ.get("BRUJULA_TRANSCRIBE_DEVICE", "auto")
    compute_type = os.environ.get("BRUJULA_TRANSCRIBE_COMPUTE_TYPE", "default")
    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    segments, _info = model.transcribe(
        str(audio_path),
        language=lang or "es",
        vad_filter=True,
        beam_size=5,
    )
    return " ".join(segment.text.strip() for segment in segments).strip()


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: transcribe-local.py <audio_path> [lang] [output_path]", file=sys.stderr)
        return 2

    audio_path = Path(argv[1])
    lang = argv[2] if len(argv) >= 3 else "es"
    output_path = Path(argv[3]) if len(argv) >= 4 else None

    text = transcribe(audio_path, lang)
    if output_path:
        output_path.write_text(text, encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
