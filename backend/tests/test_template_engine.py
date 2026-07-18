from app.schemas.meeting import AttendeeIn, MeetingInfo
from app.schemas.mom import MomExtraction
from app.services.template_engine import build_context, list_templates, render_html


def _fixtures():
    meeting = MeetingInfo(title="Review <script>alert(1)</script>", organization="ABC")
    attendees = [
        AttendeeIn(name="Chair", group="chairperson"),
        AttendeeIn(name="Guest One", group="guest", present=False),
        AttendeeIn(name="Member One", group="member"),
    ]
    mom = MomExtraction.model_validate(
        {
            "agenda": [
                {"title": "Budget", "subtopics": ["Capex", "Opex"]},
                {"title": "Sports", "subtopics": []},
            ],
            "discussion_points": [
                {"agenda_index": 0, "text": "Costs discussed"},
                {"agenda_index": 5, "text": "Orphan point"},
            ],
            "decisions": [{"description": "Approved", "decided_by": "Chair", "rationale": None}],
            "action_items": [{"description": "Do thing", "owner": None, "due_date": "Friday"}],
            "summary": "All good.",
            "confidence": 0.8,
        }
    )
    return meeting, attendees, mom


def test_agenda_numbering_deterministic():
    meeting, attendees, mom = _fixtures()
    ctx = build_context(meeting, attendees, mom)
    assert ctx["agenda"][0]["number"] == "1"
    assert ctx["agenda"][0]["subtopics"][0]["number"] == "1.1"
    assert ctx["agenda"][0]["subtopics"][1]["number"] == "1.2"
    assert ctx["agenda"][1]["number"] == "2"


def test_attendee_grouping_order():
    meeting, attendees, mom = _fixtures()
    ctx = build_context(meeting, attendees, mom)
    labels = [g["label"] for g in ctx["attendee_groups"]]
    assert labels == ["Chairperson", "Members", "Guests"]
    assert ctx["attendee_stats"] == {"total": 3, "present": 2, "absent": 1}


def test_out_of_range_discussion_goes_to_unassigned():
    meeting, attendees, mom = _fixtures()
    ctx = build_context(meeting, attendees, mom)
    assert ctx["unassigned_discussion"] == ["Orphan point"]
    assert ctx["agenda"][0]["discussion"] == ["Costs discussed"]


def test_action_item_defaults():
    meeting, attendees, mom = _fixtures()
    ctx = build_context(meeting, attendees, mom)
    item = ctx["action_items"][0]
    assert item["owner"] == "Unassigned"
    assert item["due_date"] == "Friday"
    assert item["status"] == "Pending"


def test_render_html_escapes_user_input():
    meeting, attendees, mom = _fixtures()
    html = render_html(meeting, attendees, mom, "classic")
    assert "<script>alert(1)</script>" not in html
    assert "Budget" in html
    assert "1.1" in html


def test_templates_discovered():
    slugs = {t["slug"] for t in list_templates()}
    assert {"classic", "modern"} <= slugs
