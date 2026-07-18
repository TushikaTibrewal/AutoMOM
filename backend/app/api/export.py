"""Export endpoints: PDF, DOCX, recent exports, download."""
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import Export, Meeting, User
from app.schemas.meeting import AttendeeIn, MeetingInfo
from app.schemas.mom import MomExtraction
from app.services import meeting_service
from app.services.docx_service import context_to_docx
from app.services.pdf_service import PdfUnavailableError, html_to_pdf
from app.services.template_engine import TemplateEngineError, build_context, render_html
from app.utils.audit import record_audit
from app.utils.security import get_current_user

router = APIRouter(prefix="/api", tags=["export"])
settings = get_settings()


def _safe_filename(title: str, ext: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", title).strip("_") or "minutes"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    return f"{stem}_{stamp}.{ext}"


def _load_meeting_parts(db: Session, user_id: int, meeting_id: int):
    try:
        meeting = meeting_service.get_owned_meeting(db, user_id, meeting_id)
    except LookupError:
        raise HTTPException(status_code=404, detail="Meeting not found")
    if meeting.mom_json is None:
        raise HTTPException(status_code=409, detail="Meeting has no generated minutes yet")
    info = MeetingInfo(
        title=meeting.title,
        meeting_date=meeting.meeting_date,
        meeting_time=meeting.meeting_time,
        venue=meeting.venue,
        organization=meeting.organization,
        meeting_type=meeting.meeting_type,
        prepared_by=meeting.prepared_by,
        approved_by=meeting.approved_by,
    )
    attendees = [
        AttendeeIn(
            name=a.name, role=a.role, department=a.department, present=a.present, group=a.group
        )
        for a in meeting.attendees
    ]
    mom = MomExtraction.model_validate(meeting.mom_json)
    return meeting, info, attendees, mom


def _record_export(db: Session, meeting: Meeting, fmt: str, file_name: str, file_path: str) -> None:
    db.add(Export(meeting_id=meeting.id, format=fmt, file_name=file_name, file_path=file_path))
    db.commit()


@router.post("/export/pdf")
def export_pdf(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting_id = payload.get("meeting_id")
    if not isinstance(meeting_id, int):
        raise HTTPException(status_code=422, detail="meeting_id (int) is required")
    meeting, info, attendees, mom = _load_meeting_parts(db, current_user.id, meeting_id)

    try:
        html = render_html(info, attendees, mom, meeting.template_slug)
    except TemplateEngineError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    file_name = _safe_filename(meeting.title, "pdf")
    out_path = settings.exports_dir / file_name
    try:
        html_to_pdf(html, out_path)
    except PdfUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    _record_export(db, meeting, "pdf", file_name, str(out_path))
    record_audit(db, current_user.id, "export.pdf", f"meeting={meeting.id}")
    return FileResponse(out_path, media_type="application/pdf", filename=file_name)


@router.post("/export/docx")
def export_docx(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting_id = payload.get("meeting_id")
    if not isinstance(meeting_id, int):
        raise HTTPException(status_code=422, detail="meeting_id (int) is required")
    meeting, info, attendees, mom = _load_meeting_parts(db, current_user.id, meeting_id)

    context = build_context(info, attendees, mom)
    file_name = _safe_filename(meeting.title, "docx")
    out_path = settings.exports_dir / file_name
    context_to_docx(context, out_path)

    _record_export(db, meeting, "docx", file_name, str(out_path))
    record_audit(db, current_user.id, "export.docx", f"meeting={meeting.id}")
    return FileResponse(
        out_path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=file_name,
    )


@router.get("/exports/recent", response_model=list[dict])
def recent_exports(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    stmt = (
        select(Export)
        .join(Meeting)
        .where(Meeting.user_id == current_user.id)
        .order_by(Export.created_at.desc())
        .limit(20)
    )
    return [
        {
            "id": e.id,
            "meeting_id": e.meeting_id,
            "meeting_title": e.meeting.title,
            "format": e.format,
            "file_name": e.file_name,
            "created_at": e.created_at.isoformat(),
        }
        for e in db.scalars(stmt).all()
    ]
