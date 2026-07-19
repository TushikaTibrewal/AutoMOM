"""The strict extraction contract. The LLM must return exactly this shape.

Formatting is NEVER decided here — this is pure structured data. The template
engine owns all presentation.
"""
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class AgendaItem(BaseModel):
    title: str = Field(..., min_length=1, description="Agenda topic title, plain text only")
    subtopics: list[str] = Field(default_factory=list, description="Plain-text subtopics")

    @field_validator("title", "subtopics", mode="before")
    @classmethod
    def strip_markup(cls, v):
        return _strip(v)


class DiscussionPoint(BaseModel):
    agenda_index: int | None = Field(
        None, description="0-based index of the related agenda item, null if unrelated"
    )
    text: str = Field(..., min_length=1, description="Plain-text discussion point")

    @field_validator("text", mode="before")
    @classmethod
    def strip_markup(cls, v):
        return _strip(v)


class Decision(BaseModel):
    description: str = Field(..., min_length=1)
    decided_by: str | None = Field(None, description="Person or group, null if not stated")
    rationale: str | None = Field(None, description="Why, null if not stated")

    @field_validator("description", "decided_by", "rationale", mode="before")
    @classmethod
    def strip_markup(cls, v):
        return _strip(v)


class ActionItem(BaseModel):
    description: str = Field(..., min_length=1)
    owner: str | None = Field(None, description="Assignee name, null if not stated")
    due_date: str | None = Field(None, description="Due date as stated in transcript, null if absent")
    priority: Literal["high", "medium", "low"] | None = None
    status: Literal["pending", "in_progress", "done"] = "pending"

    @field_validator("description", "owner", "due_date", mode="before")
    @classmethod
    def strip_markup(cls, v):
        return _strip(v)


class MomExtraction(BaseModel):
    """Validated JSON returned by the AI layer. Plain text only — no markdown/HTML."""

    agenda: list[AgendaItem] = Field(default_factory=list)
    discussion_points: list[DiscussionPoint] = Field(default_factory=list)
    decisions: list[Decision] = Field(default_factory=list)
    action_items: list[ActionItem] = Field(default_factory=list)
    participants: list[str] = Field(
        default_factory=list,
        description="Names of people identified as present/speaking. Empty if none stated.",
    )
    summary: str | None = Field(None, description="1-3 sentence neutral summary, null if unclear")

    @field_validator("participants", mode="before")
    @classmethod
    def strip_participants(cls, v):
        return _strip(v)
    confidence: float | None = Field(
        None, ge=0.0, le=1.0, description="Extraction confidence 0..1, null if not assessable"
    )

    @field_validator("summary", mode="before")
    @classmethod
    def strip_markup(cls, v):
        return _strip(v)


_MARKUP_CHARS = ("**", "__", "##", "<", ">", "```")


def _strip(v):
    """Reject/strip markdown and HTML markers so output stays plain text."""
    if v is None:
        return v
    if isinstance(v, list):
        return [_strip(x) for x in v]
    if isinstance(v, str):
        s = v.strip()
        for token in ("```json", "```", "**", "__", "###", "##", "#"):
            s = s.replace(token, "")
        # Drop angle-bracket markup entirely
        s = s.replace("<", "").replace(">", "")
        return s.strip()
    return v
