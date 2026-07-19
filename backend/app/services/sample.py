"""Canned sample data for rendering template previews."""
from app.schemas.meeting import AttendeeIn, MeetingInfo
from app.schemas.mom import MomExtraction

SAMPLE_MEETING = MeetingInfo(
    title="Quarterly Curriculum Review",
    meeting_date="2026-07-15",
    meeting_time="10:00",
    venue="Conference Room B",
    organization="ABC Institute of Technology",
    meeting_type="Committee",
    prepared_by="A. Sharma",
    approved_by="Dr. R. Rao",
)

SAMPLE_ATTENDEES = [
    AttendeeIn(name="Dr. R. Rao", role="Principal", department="Administration", group="chairperson"),
    AttendeeIn(name="Prof. M. Iyer", role="HOD", department="Computer Science", group="faculty"),
    AttendeeIn(name="Prof. S. Nair", role="Coordinator", department="Electronics", group="faculty", present=False),
    AttendeeIn(name="K. Menon", role="Lab In-charge", department="Computer Science", group="core_team"),
    AttendeeIn(name="A. Gupta", role="Student Rep", department="Computer Science", group="member"),
    AttendeeIn(name="V. Rao", role="Industry Guest", department="—", group="guest"),
]

SAMPLE_MOM = MomExtraction.model_validate(
    {
        "agenda": [
            {"title": "Curriculum updates for the new semester", "subtopics": ["Elective restructuring", "Lab hour allocation"]},
            {"title": "Infrastructure and equipment", "subtopics": []},
        ],
        "discussion_points": [
            {"agenda_index": 0, "text": "The committee reviewed the proposed elective structure and agreed it improves flexibility for final-year students."},
            {"agenda_index": 0, "text": "Lab hours will be increased from two to three per week for core subjects."},
            {"agenda_index": 1, "text": "Additional workstations are required for the machine learning lab before the next intake."},
        ],
        "decisions": [
            {"description": "Approve the revised elective structure effective next semester.", "decided_by": "Committee", "rationale": "Improves student flexibility and industry alignment."},
            {"description": "Sanction procurement of ten new workstations.", "decided_by": "Dr. R. Rao", "rationale": None},
        ],
        "action_items": [
            {"description": "Circulate the finalized elective list to all departments.", "owner": "Prof. M. Iyer", "due_date": "2026-07-22", "priority": "high", "status": "pending"},
            {"description": "Obtain three vendor quotes for the workstations.", "owner": "K. Menon", "due_date": "2026-07-30", "priority": "medium", "status": "pending"},
        ],
        "summary": "The committee approved a revised elective structure and additional lab investment for the coming semester.",
        "confidence": 0.9,
    }
)
