"""POST /api/transcribe — accept an uploaded transcript file and return clean text.

Live microphone speech-to-text happens in the browser (SpeechRecognition API);
this endpoint handles the "upload transcript" path (.txt/.md/.vtt/.srt).
"""
import re

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.config import get_settings
from app.models import User
from app.utils.sanitize import sanitize_text
from app.utils.security import get_current_user

router = APIRouter(prefix="/api", tags=["transcribe"])
settings = get_settings()

ALLOWED_EXTENSIONS = {".txt", ".md", ".vtt", ".srt", ".text"}


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
