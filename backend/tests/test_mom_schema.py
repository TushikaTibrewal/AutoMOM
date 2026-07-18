import pytest
from pydantic import ValidationError

from app.schemas.mom import ActionItem, MomExtraction


def test_valid_extraction():
    mom = MomExtraction.model_validate(
        {
            "agenda": [{"title": "Budget", "subtopics": ["Q1", "Q2"]}],
            "discussion_points": [{"agenda_index": 0, "text": "Costs rising"}],
            "decisions": [{"description": "Approved budget", "decided_by": None, "rationale": None}],
            "action_items": [{"description": "Send report", "owner": "Ravi", "due_date": None}],
            "summary": "Budget approved.",
            "confidence": 0.9,
        }
    )
    assert mom.agenda[0].subtopics == ["Q1", "Q2"]
    assert mom.action_items[0].status == "pending"


def test_markdown_stripped_from_llm_output():
    mom = MomExtraction.model_validate(
        {
            "agenda": [{"title": "**Budget**", "subtopics": []}],
            "discussion_points": [{"agenda_index": None, "text": "## Point <b>bold</b>"}],
            "decisions": [],
            "action_items": [],
            "summary": "```json summary```",
            "confidence": None,
        }
    )
    assert "**" not in mom.agenda[0].title
    assert "<" not in mom.discussion_points[0].text
    assert "```" not in (mom.summary or "")


def test_confidence_bounds_enforced():
    with pytest.raises(ValidationError):
        MomExtraction.model_validate({"agenda": [], "discussion_points": [], "decisions": [], "action_items": [], "summary": None, "confidence": 1.5})


def test_invalid_priority_rejected():
    with pytest.raises(ValidationError):
        ActionItem.model_validate({"description": "x", "priority": "urgent"})


def test_empty_title_rejected():
    with pytest.raises(ValidationError):
        MomExtraction.model_validate(
            {"agenda": [{"title": "", "subtopics": []}], "discussion_points": [], "decisions": [], "action_items": [], "summary": None, "confidence": None}
        )
