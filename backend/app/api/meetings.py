"""Meeting history, search, autosave (PATCH), revision history, delete."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Meeting, User
from app.schemas.meeting import MeetingListItem, MeetingOut, MeetingUpdate
from app.services import meeting_service
from app.utils.audit import record_audit
from app.utils.security import get_current_user

router = APIRouter(prefix="/api/meetings", tags=["meetings"])


@router.get("", response_model=list[MeetingListItem])
def list_meetings(
    q: str | None = Query(None, max_length=200),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    stmt = select(Meeting).where(Meeting.user_id == current_user.id)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                Meeting.title.ilike(like),
                Meeting.organization.ilike(like),
                Meeting.meeting_type.ilike(like),
                Meeting.transcript.ilike(like),
            )
        )
    stmt = stmt.order_by(Meeting.updated_at.desc()).limit(limit).offset(offset)
    return db.scalars(stmt).all()


@router.get("/{meeting_id}", response_model=MeetingOut)
def get_meeting(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        return meeting_service.get_owned_meeting(db, current_user.id, meeting_id)
    except LookupError:
        raise HTTPException(status_code=404, detail="Meeting not found")


@router.patch("/{meeting_id}", response_model=MeetingOut)
def update_meeting(
    meeting_id: int,
    payload: MeetingUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Autosave endpoint: any subset of fields can be sent."""
    try:
        meeting = meeting_service.get_owned_meeting(db, current_user.id, meeting_id)
    except LookupError:
        raise HTTPException(status_code=404, detail="Meeting not found")

    if payload.meeting is not None:
        for key, value in meeting_service._clean_info(payload.meeting).items():
            setattr(meeting, key, value)
    if payload.attendees is not None:
        meeting_service.replace_attendees(db, meeting, payload.attendees)
    if payload.mom is not None:
        meeting_service.push_revision(meeting)
        meeting.mom_json = payload.mom.model_dump()
    if payload.template_slug is not None:
        meeting.template_slug = payload.template_slug
    if payload.status is not None:
        meeting.status = payload.status

    db.commit()
    db.refresh(meeting)
    return meeting


@router.get("/{meeting_id}/revisions", response_model=list[dict])
def get_revisions(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        meeting = meeting_service.get_owned_meeting(db, current_user.id, meeting_id)
    except LookupError:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting.revision_history or []


@router.delete("/{meeting_id}", status_code=204)
def delete_meeting(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        meeting = meeting_service.get_owned_meeting(db, current_user.id, meeting_id)
    except LookupError:
        raise HTTPException(status_code=404, detail="Meeting not found")
    db.delete(meeting)
    db.commit()
    record_audit(db, current_user.id, "meeting.delete", f"meeting={meeting_id}")
