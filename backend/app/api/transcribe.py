"""POST /api/transcribe — accept an uploaded transcript file and return clean text.

Live microphone speech-to-text happens in the browser (SpeechRecognition API);
this endpoint handles the "upload transcript" path (.txt/.md/.vtt/.srt).
"""
import re

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.config import get_settings
from app.models import User
from app.services.transcribe_service import TranscriptionUnavailableError, transcribe_audio
from app.services.vision_service import detect_participants
from app.utils.sanitize import sanitize_text
from app.utils.security import get_current_user

router = APIRouter(prefix="/api", tags=["transcribe"])
settings = get_settings()

ALLOWED_EXTENSIONS = {".txt", ".md", ".vtt", ".srt", ".text"}
MAX_AUDIO_BYTES = 25 * 1024 * 1024  # Groq Whisper per-request limit


def _strip_subtitle_markup(text: str, extension: str) -> str:
    if extension not in (".vtt", ".srt"):
        return text
    lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped == "WEBVTT" or stripped.isdigit():
            continue
        if re.match(r"^\d{2}:\d{2}(:\d{2})?[.,]\d{3}\s+-->", stripped):
            continue
        lines.append(stripped)
    return "\n".join(lines)


@router.post("/transcribe")
def transcribe(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    name = (file.filename or "").lower()
    extension = "." + name.rsplit(".", 1)[-1] if "." in name else ""
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{extension}'. Allowed: {sorted(ALLOWED_EXTENSIONS)}",
        )
    raw = file.file.read(settings.max_upload_bytes + 1)
    if len(raw) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="File too large")

    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        try:
            text = raw.decode("latin-1")
        except UnicodeDecodeError:
            raise HTTPException(status_code=422, detail="File is not readable text")

    text = _strip_subtitle_markup(text, extension)
    text = sanitize_text(text, max_length=settings.max_transcript_chars)
    if not text:
        raise HTTPException(status_code=422, detail="File contained no usable text")
    return {"text": text, "characters": len(text)}


# Common Latin-script Hindi words/particles that show up when Whisper labels a
# Hindi/English code-switched segment as plain "English" — a cheap Hinglish tell.
_HINGLISH_MARKERS = re.compile(
    r"\b(hai|hain|nahi|nahin|kya|kyu|kyun|matlab|bhai|yaar|accha|acha|theek|thik|"
    r"karo|kar[oe]nge|kijiye|chalo|abhi|bilkul|samajh|batao|bolo|haan|zyada)\b",
    re.IGNORECASE,
)


def _refine_language(text: str, detected: str | None) -> str | None:
    if detected == "English" and _HINGLISH_MARKERS.search(text):
        return "Hinglish"
    return detected


@router.post("/transcribe-audio")
def transcribe_audio_segment(
    file: UploadFile = File(...),
    language: str | None = Form(None),
    current_user: User = Depends(get_current_user),
):
    """Transcribe a short audio segment (live meeting capture) via Groq Whisper."""
    raw = file.file.read(MAX_AUDIO_BYTES + 1)
    if not raw:
        return {"text": "", "language": None}
    if len(raw) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio segment too large")
    try:
        result = transcribe_audio(raw, file.filename or "segment.webm", language)
    except TranscriptionUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    text = sanitize_text(result.text)
    return {"text": text, "language": _refine_language(text, result.language)}


@router.post("/detect-participants")
def detect_participants_endpoint(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """Read participant names from a meeting-screen frame (Groq vision).

    Best-effort: returns an empty list rather than erroring so live capture is
    never interrupted by a vision hiccup or missing key.
    """
    raw = file.file.read(MAX_AUDIO_BYTES + 1)
    if not raw or len(raw) > MAX_AUDIO_BYTES:
        return {"names": []}
    names = [sanitize_text(n) for n in detect_participants(raw, file.content_type or "image/jpeg")]
    return {"names": [n for n in names if n]}
