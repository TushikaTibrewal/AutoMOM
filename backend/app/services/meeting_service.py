"""Shared persistence logic for meetings and attendees."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import Attendee, Meeting
from app.schemas.meeting import AttendeeIn, MeetingInfo
from app.utils.sanitize import sanitize_text

MAX_REVISIONS = 20


def _clean_info(info: MeetingInfo) -> dict:
    data = info.model_dump()
    return {k: sanitize_text(v) if isinstance(v, str) else v for k, v in data.items()}


def upsert_meeting(
    db: Session,
    user_id: int,
    info: MeetingInfo,
    attendees: list[AttendeeIn],
    meeting_id: int | None = None,
) -> Meeting:
    if meeting_id is not None:
        meeting = db.get(Meeting, meeting_id)
        if meeting is None or meeting.user_id != user_id:
            raise LookupError("Meeting not found")
    else:
        meeting = Meeting(user_id=user_id, title=info.title)
        db.add(meeting)

    for key, value in _clean_info(info).items():
        setattr(meeting, key, value)

    replace_attendees(db, meeting, attendees)
    db.commit()
    db.refresh(meeting)
    return meeting


def replace_attendees(db: Session, meeting: Meeting, attendees: list[AttendeeIn]) -> None:
    meeting.attendees.clear()
    for a in attendees:
        meeting.attendees.append(
            Attendee(
                name=sanitize_text(a.name),
                role=sanitize_text(a.role),
                department=sanitize_text(a.department),
                present=a.present,
                group=a.group,
            )
        )


def push_revision(meeting: Meeting) -> None:
    """Keep a bounded history of prior mom_json versions (revision history)."""
    if meeting.mom_json is None:
        return
    history = list(meeting.revision_history or [])
    history.append({"mom": meeting.mom_json, "saved_at": meeting.updated_at.isoformat() if meeting.updated_at else None})
    meeting.revision_history = history[-MAX_REVISIONS:]


def get_owned_meeting(db: Session, user_id: int, meeting_id: int) -> Meeting:
    meeting = db.get(Meeting, meeting_id)
    if meeting is None or meeting.user_id != user_id:
        raise LookupError("Meeting not found")
    return meeting
