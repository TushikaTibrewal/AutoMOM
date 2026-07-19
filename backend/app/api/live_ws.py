"""WebSocket live sessions for the Chrome extension.

Flow:
  extension  --(transcript segments + roster)-->  /ws/live/{session_id}
  server      merges into the running minutes (incremental, deduped)
  server     --(updated transcript + MoM + HTML)-->  all sockets on the session

The side panel and the meeting tab share a session_id, so both see the same
live minutes. Sessions live in memory; "save" persists to the database.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from jose import JWTError, jwt
from starlette.concurrency import run_in_threadpool

from app.config import get_settings
from app.database import SessionLocal
from app.models import User
from app.schemas.meeting import AttendeeIn, MeetingInfo
from app.schemas.mom import MomExtraction
from app.services import meeting_service
from app.services.extractor import extractor
from app.services.template_engine import render_html
from app.utils.logging import get_logger
from app.utils.sanitize import sanitize_text

router = APIRouter(tags=["live"])
settings = get_settings()
logger = get_logger("live_ws")

END_CUES = (
    "meeting is adjourned", "let's wrap up", "lets wrap up", "that's all for today",
    "thats all for today", "meeting is over", "meeting is concluded", "wrap up the meeting",
    "meeting khatam", "meeting samapt", "official discussion over",
)


@dataclass
class TranscriptLine:
    ts: str
    speaker: str
    text: str


@dataclass
class LiveSession:
    user_id: int
    meeting: MeetingInfo = field(default_factory=lambda: MeetingInfo(title="Live Meeting"))
    template_slug: str = "classic"
    lines: list[TranscriptLine] = field(default_factory=list)
    attendees: dict[str, AttendeeIn] = field(default_factory=dict)
    mom: MomExtraction | None = None
    ended: bool = False
    last_extract_len: int = 0
    extracting: bool = False
    sockets: set[WebSocket] = field(default_factory=set)

    @property
    def full_text(self) -> str:
        return "\n".join(f"{ln.speaker}: {ln.text}" if ln.speaker else ln.text for ln in self.lines)


class SessionManager:
    def __init__(self) -> None:
        self._sessions: dict[str, LiveSession] = {}
        self._lock = asyncio.Lock()

    async def get(self, session_id: str, user_id: int) -> LiveSession:
        async with self._lock:
            s = self._sessions.get(session_id)
            if s is None:
                s = LiveSession(user_id=user_id)
                self._sessions[session_id] = s
            return s

    def drop_if_empty(self, session_id: str) -> None:
        s = self._sessions.get(session_id)
        if s and not s.sockets:
            self._sessions.pop(session_id, None)


manager = SessionManager()


def _authenticate(token: str | None) -> int | None:
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        return int(payload.get("sub"))
    except (JWTError, ValueError, TypeError):
        return None


async def _broadcast(session: LiveSession, message: dict) -> None:
    dead = []
    for ws in session.sockets:
        try:
            await ws.send_json(message)
        except Exception:  # noqa: BLE001
            dead.append(ws)
    for ws in dead:
        session.sockets.discard(ws)


def _render(session: LiveSession) -> str:
    if session.mom is None:
        return ""
    try:
        return render_html(session.meeting, list(session.attendees.values()), session.mom, session.template_slug)
    except Exception:  # noqa: BLE001
        return ""


async def _reextract_and_broadcast(session: LiveSession) -> None:
    if session.extracting:
        return
    text = session.full_text.strip()
    if len(text) < 40 or len(text) - session.last_extract_len < 80:
        return
    session.extracting = True
    session.last_extract_len = len(text)
    try:
        mom, provider, _ = await run_in_threadpool(
            extractor.merge,
            session.meeting.model_dump(),
            [a.model_dump() for a in session.attendees.values()],
            text,
            session.mom.model_dump() if session.mom else None,
        )
        session.mom = mom
        # Fold any AI-detected participants into the roster.
        for name in mom.participants:
            key = name.lower()
            if key not in session.attendees:
                session.attendees[key] = AttendeeIn(name=name, group="member")
        await _broadcast(
            session,
            {"type": "mom", "mom": mom.model_dump(), "html": _render(session), "provider": provider},
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("live re-extract failed: %s", exc)
    finally:
        session.extracting = False


def _detect_end(text: str) -> bool:
    low = text.lower()
    return any(cue in low for cue in END_CUES)


@router.websocket("/ws/live/{session_id}")
async def live_ws(websocket: WebSocket, session_id: str):
    user_id = _authenticate(websocket.query_params.get("token"))
    if user_id is None:
        await websocket.close(code=4401)
        return
    await websocket.accept()
    session = await manager.get(session_id, user_id)
    session.sockets.add(websocket)

    # Send current state to a newly-connected client (e.g. side panel opening late).
    await websocket.send_json(
        {
            "type": "state",
            "transcript": [ln.__dict__ for ln in session.lines],
            "mom": session.mom.model_dump() if session.mom else None,
            "html": _render(session),
            "attendees": [a.model_dump() for a in session.attendees.values()],
            "ended": session.ended,
        }
    )

    try:
        while True:
            msg = await websocket.receive_json()
            kind = msg.get("type")

            if kind == "config":
                if msg.get("meeting"):
                    session.meeting = MeetingInfo.model_validate(msg["meeting"])
                if msg.get("template_slug"):
                    session.template_slug = str(msg["template_slug"])

            elif kind == "segment":
                text = sanitize_text(str(msg.get("text", "")))
                if not text:
                    continue
                speaker = sanitize_text(str(msg.get("speaker", "")))[:80]
                ts = str(msg.get("ts") or datetime.now(timezone.utc).strftime("%H:%M:%S"))
                session.lines.append(TranscriptLine(ts=ts, speaker=speaker, text=text))
                await _broadcast(session, {"type": "transcript", "line": {"ts": ts, "speaker": speaker, "text": text}})
                if not session.ended and _detect_end(text):
                    session.ended = True
                    await _broadcast(session, {"type": "ended"})
                await _reextract_and_broadcast(session)

            elif kind == "roster":
                for name in msg.get("names", []):
                    clean = sanitize_text(str(name))[:80]
                    if clean and clean.lower() not in session.attendees:
                        session.attendees[clean.lower()] = AttendeeIn(name=clean, group="member")
                await _broadcast(
                    session,
                    {"type": "attendees", "attendees": [a.model_dump() for a in session.attendees.values()]},
                )

            elif kind == "mom_edit":  # side panel pushed a manual edit
                try:
                    session.mom = MomExtraction.model_validate(msg["mom"])
                    await _broadcast(session, {"type": "mom", "mom": session.mom.model_dump(), "html": _render(session)})
                except Exception:  # noqa: BLE001
                    pass

            elif kind == "resume":
                session.ended = False

            elif kind == "save":
                meeting_id = await run_in_threadpool(_persist_session, session)
                await _broadcast(session, {"type": "saved", "meeting_id": meeting_id})

    except WebSocketDisconnect:
        pass
    finally:
        session.sockets.discard(websocket)
        manager.drop_if_empty(session_id)


def _persist_session(session: LiveSession) -> int:
    """Write the live session into a real Meeting row (runs in a worker thread)."""
    db = SessionLocal()
    try:
        user = db.get(User, session.user_id)
        meeting = meeting_service.upsert_meeting(
            db, session.user_id, session.meeting, list(session.attendees.values())
        )
        meeting.transcript = session.full_text[: settings.max_transcript_chars]
        if session.mom:
            meeting.mom_json = session.mom.model_dump()
            meeting.ai_confidence = session.mom.confidence
        meeting.status = "generated"
        db.commit()
        db.refresh(meeting)
        return meeting.id
    finally:
        db.close()
