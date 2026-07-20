"""POST /api/generate — the core pipeline endpoint.

transcript -> preprocess -> LLM -> validate -> repair -> persist -> render preview
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.limiter import limiter
from app.config import get_settings
from app.database import get_db
from app.models import User
from app.schemas.meeting import AttendeeIn, GenerateRequest, GenerateResponse, MeetingInfo
from app.schemas.mom import MomExtraction
from app.services import meeting_service
from app.services.extractor import ExtractionError, extractor
from app.services.template_engine import TemplateEngineError, render_html
from app.utils.audit import record_audit
from app.utils.logging import get_logger
from app.utils.security import get_current_user

router = APIRouter(prefix="/api", tags=["generate"])
settings = get_settings()
logger = get_logger("api.generate")


@router.post("/generate", response_model=GenerateResponse)
@limiter.limit(settings.rate_limit_generate)
def generate(
    request: Request,
    payload: GenerateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if len(payload.transcript) > settings.max_transcript_chars:
        raise HTTPException(
            status_code=413,
            detail=f"Transcript exceeds {settings.max_transcript_chars} characters",
        )

    try:
        meeting = meeting_service.upsert_meeting(
            db, current_user.id, payload.meeting, payload.attendees, payload.meeting_id
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="Meeting not found")

    try:
        mom, provider, prompt_version = extractor.extract(
            meeting_meta=payload.meeting.model_dump(),
            attendees=[a.model_dump() for a in payload.attendees],
            transcript=payload.transcript,
        )
    except ExtractionError as exc:
        logger.error("Extraction failed for meeting %s: %s", meeting.id, exc)
        raise HTTPException(status_code=502, detail="AI extraction failed after retries")

    meeting_service.push_revision(meeting)
    meeting.transcript = payload.transcript[: settings.max_transcript_chars]
    meeting.mom_json = mom.model_dump()
    meeting.template_slug = payload.template_slug
    meeting.status = "generated"
    meeting.ai_confidence = mom.confidence
    meeting.prompt_version = prompt_version
    db.commit()

    try:
        html = render_html(payload.meeting, payload.attendees, mom, payload.template_slug)
    except TemplateEngineError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    record_audit(db, current_user.id, "meeting.generate", f"meeting={meeting.id} provider={provider}")
    return GenerateResponse(
        meeting_id=meeting.id,
        mom=mom,
        html_preview=html,
        prompt_version=prompt_version,
        provider=provider,
    )


@router.post("/preview", response_model=dict)
def preview(
    payload: dict,
    current_user: User = Depends(get_current_user),
):
    """Re-render HTML preview from edited MoM JSON without calling the AI."""
    try:
        meeting = MeetingInfo.model_validate(payload["meeting"])
        attendees = [AttendeeIn.model_validate(a) for a in payload.get("attendees", [])]
        mom = MomExtraction.model_validate(payload["mom"])
        template_slug = str(payload.get("template_slug", "classic"))
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"Invalid preview payload: {exc}")
    try:
        html = render_html(meeting, attendees, mom, template_slug)
    except TemplateEngineError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"html_preview": html}


@router.post("/extract")
@limiter.limit(settings.rate_limit_extract)
def extract_live(
    request: Request,
    payload: GenerateRequest,
    current_user: User = Depends(get_current_user),
):
    """Stateless extraction for live mode: transcript -> MoM JSON + HTML.

    Does NOT persist — the live page polls this repeatedly as the transcript
    grows, then saves once via /generate when the meeting ends.
    """
    if not payload.transcript.strip():
        return {"mom": None, "html_preview": "", "provider": "none"}
    if len(payload.transcript) > settings.max_transcript_chars:
        raise HTTPException(status_code=413, detail="Transcript too long")
    mom, provider, _ = extractor.extract(
        meeting_meta=payload.meeting.model_dump(),
        attendees=[a.model_dump() for a in payload.attendees],
        transcript=payload.transcript,
    )
    try:
        html = render_html(payload.meeting, payload.attendees, mom, payload.template_slug)
    except TemplateEngineError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"mom": mom.model_dump(), "html_preview": html, "provider": provider}


@router.post("/translate")
def translate_transcript(
    payload: dict,
    current_user: User = Depends(get_current_user),
):
    """Translate raw notes (e.g., Hinglish, Hindi) into formal English."""
    text = str(payload.get("text", "")).strip()
    if not text:
        return {"translated_text": ""}
    if len(text) > settings.max_transcript_chars:
        raise HTTPException(status_code=413, detail="Text exceeds maximum limit")
    translated = extractor.translate_text(text)
    return {"translated_text": translated}
