from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Meeting(Base):
    __tablename__ = "meetings"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)

    title: Mapped[str] = mapped_column(String(500), nullable=False)
    meeting_date: Mapped[str] = mapped_column(String(50), default="")
    meeting_time: Mapped[str] = mapped_column(String(50), default="")
    venue: Mapped[str] = mapped_column(String(500), default="")
    organization: Mapped[str] = mapped_column(String(500), default="")
    meeting_type: Mapped[str] = mapped_column(String(100), default="General")
    prepared_by: Mapped[str] = mapped_column(String(255), default="")
    approved_by: Mapped[str] = mapped_column(String(255), default="")

    transcript: Mapped[str] = mapped_column(Text, default="")
    mom_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    revision_history: Mapped[list | None] = mapped_column(JSON, nullable=True)
    template_slug: Mapped[str] = mapped_column(String(100), default="classic")
    status: Mapped[str] = mapped_column(String(50), default="draft")  # draft | generated | finalized
    ai_confidence: Mapped[float | None] = mapped_column(nullable=True)
    prompt_version: Mapped[str] = mapped_column(String(50), default="")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    owner = relationship("User", back_populates="meetings")
    attendees = relationship(
        "Attendee", back_populates="meeting", cascade="all, delete-orphan", order_by="Attendee.id"
    )
    exports = relationship("Export", back_populates="meeting", cascade="all, delete-orphan")
