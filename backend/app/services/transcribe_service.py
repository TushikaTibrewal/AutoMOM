"""Server-side speech-to-text via Groq Whisper (OpenAI-compatible).

Used by live mode: the browser mixes tab audio (other participants) + mic
(the user) and uploads short segments here for transcription. Groq's Whisper
is fast and covered by the same GROQ_API_KEY already used for extraction.
"""
from __future__ import annotations

from dataclasses import dataclass

import httpx

from app.config import get_settings
from app.utils.logging import get_logger

logger = get_logger("transcribe")
GROQ_AUDIO_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions"

# Whisper's language names -> the three labels the live widget shows.
# Hinglish has no ISO code; Whisper transcribes it as "english" or "hindi"
# depending on which language dominates the segment, so the widget falls
# back to script/word heuristics (see extractor-side detection) when needed.
_LANGUAGE_LABELS = {"english": "English", "hindi": "Hindi"}


@dataclass
class TranscriptionResult:
    text: str
    language: str | None  # "English" | "Hindi" | None (unknown)


class TranscriptionUnavailableError(RuntimeError):
    pass


def transcribe_audio(audio_bytes: bytes, filename: str, language: str | None = None) -> TranscriptionResult:
    settings = get_settings()
    if not settings.groq_api_key:
        raise TranscriptionUnavailableError(
            "Live audio transcription needs GROQ_API_KEY (Groq Whisper). "
            "Set it in the environment to enable meeting capture."
        )

    data = {"model": settings.groq_whisper_model, "response_format": "verbose_json"}
    # Whisper language hint: "en", "hi", ... (omit for auto-detect)
    if language:
        data["language"] = language.split("-")[0]

    try:
        response = httpx.post(
            GROQ_AUDIO_ENDPOINT,
            headers={"Authorization": f"Bearer {settings.groq_api_key}"},
            data=data,
            files={"file": (filename, audio_bytes, "application/octet-stream")},
            timeout=settings.ai_timeout_seconds,
        )
    except httpx.HTTPError as exc:
        logger.error("Groq Whisper request error: %s", exc)
        raise TranscriptionUnavailableError(f"Transcription request failed: {exc}") from exc

    if response.status_code >= 400:
        logger.error("Groq Whisper failed (%s): %s", response.status_code, response.text[:300])
        raise TranscriptionUnavailableError(
            f"Transcription failed ({response.status_code}): {response.text[:200]}"
        )

    payload = response.json()
    text = str(payload.get("text", "")).strip()
    detected = str(payload.get("language", "")).strip().lower()
    return TranscriptionResult(text=text, language=_LANGUAGE_LABELS.get(detected))
