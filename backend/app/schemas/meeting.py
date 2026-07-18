"""Request/response schemas for meetings and attendees."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.mom import MomExtraction

AttendeeGroup = Literal["chairperson", "faculty", "core_team", "member", "guest"]


class AttendeeIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    role: str = Field("", max_length=255)
    department: str = Field("", max_length=255)
    present: bool = True
    group: AttendeeGroup = "member"


class AttendeeOut(AttendeeIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class MeetingInfo(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    meeting_date: str = Field("", max_length=50)
    meeting_time: str = Field("", max_length=50)
    venue: str = Field("", max_length=500)
    organization: str = Field("", max_length=500)
    meeting_type: str = Field("General", max_length=100)
    prepared_by: str = Field("", max_length=255)
    approved_by: str = Field("", max_length=255)


class GenerateRequest(BaseModel):
    meeting: MeetingInfo
    attendees: list[AttendeeIn] = Field(default_factory=list, max_length=500)
    transcript: str = Field(..., min_length=1)
    template_slug: str = Field("classic", max_length=100)
    meeting_id: int | None = None  # regenerate into an existing meeting


class MeetingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    meeting_date: str
    meeting_time: str
    venue: str
    organization: str
    meeting_type: str
    prepared_by: str
    approved_by: str
    transcript: str
    mom_json: dict | None
    template_slug: str
    status: str
    ai_confidence: float | None
    prompt_version: str
    created_at: datetime
    updated_at: datetime
    attendees: list[AttendeeOut] = []


class MeetingListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    meeting_date: str
    organization: str
    meeting_type: str
    status: str
    updated_at: datetime


class MeetingUpdate(BaseModel):
    meeting: MeetingInfo | None = None
    attendees: list[AttendeeIn] | None = None
    mom: MomExtraction | None = None
    template_slug: str | None = None
    status: Literal["draft", "generated", "finalized"] | None = None


class GenerateResponse(BaseModel):
    meeting_id: int
    mom: MomExtraction
    html_preview: str
    prompt_version: str
    provider: str
