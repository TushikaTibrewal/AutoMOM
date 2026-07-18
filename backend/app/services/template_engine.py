"""Deterministic template engine.

The AI never touches formatting. This module:
1. Builds a fully-computed render context (numbering, grouping) in Python.
2. Renders it through a Jinja2 template folder (autoescape ON).

A template is a folder under /templates:
    templates/<slug>/meta.json      {"name", "description", "version"}
    templates/<slug>/template.html  Jinja2 HTML
    templates/<slug>/styles.css     CSS injected as {{ styles }}
    templates/<slug>/logo.png       optional, exposed as base64 data URI

Drop a new folder in — it is picked up automatically.
"""
from __future__ import annotations

import base64
import json
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.config import get_settings
from app.schemas.meeting import AttendeeIn, MeetingInfo
from app.schemas.mom import MomExtraction

GROUP_ORDER = ["chairperson", "faculty", "core_team", "member", "guest"]
GROUP_LABELS = {
    "chairperson": "Chairperson",
    "faculty": "Faculty",
    "core_team": "Core Team",
    "member": "Members",
    "guest": "Guests",
}

REQUIRED_FILES = ("meta.json", "template.html")


class TemplateEngineError(Exception):
    pass


def list_templates() -> list[dict]:
    """Discover template folders on disk."""
    root = get_settings().templates_dir
    found = []
    if not root.exists():
        return found
    for folder in sorted(root.iterdir()):
        meta_path = folder / "meta.json"
        if folder.is_dir() and meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            found.append(
                {
                    "slug": folder.name,
                    "name": meta.get("name", folder.name),
                    "description": meta.get("description", ""),
                    "version": meta.get("version", "1.0.0"),
                }
            )
    return found


def validate_template_folder(folder: Path) -> None:
    for required in REQUIRED_FILES:
        if not (folder / required).exists():
            raise TemplateEngineError(f"Template missing required file: {required}")
    json.loads((folder / "meta.json").read_text(encoding="utf-8"))  # must parse


def build_context(meeting: MeetingInfo, attendees: list[AttendeeIn], mom: MomExtraction) -> dict:
    """All layout decisions (numbering, grouping, table rows) happen HERE,
    deterministically, so every template renders identical structure."""
    # --- agenda numbering: 1, 1.1, 1.2 ...
    numbered_agenda = []
    for i, item in enumerate(mom.agenda, start=1):
        numbered_agenda.append(
            {
                "number": str(i),
                "title": item.title,
                "subtopics": [
                    {"number": f"{i}.{j}", "title": sub}
                    for j, sub in enumerate(item.subtopics, start=1)
                ],
                "discussion": [],
            }
        )

    # --- attach discussion points to their agenda item
    unassigned_discussion = []
    for point in mom.discussion_points:
        idx = point.agenda_index
        if idx is not None and 0 <= idx < len(numbered_agenda):
            numbered_agenda[idx]["discussion"].append(point.text)
        else:
            unassigned_discussion.append(point.text)

    # --- attendees grouped in fixed role order
    groups = []
    for key in GROUP_ORDER:
        rows = [
            {
                "name": a.name,
                "role": a.role,
                "department": a.department,
                "present": a.present,
            }
            for a in attendees
            if a.group == key
        ]
        if rows:
            groups.append({"key": key, "label": GROUP_LABELS[key], "attendees": rows})

    decisions = [
        {
            "number": str(i),
            "description": d.description,
            "decided_by": d.decided_by or "—",
            "rationale": d.rationale or "—",
        }
        for i, d in enumerate(mom.decisions, start=1)
    ]
    action_items = [
        {
            "number": str(i),
            "description": a.description,
            "owner": a.owner or "Unassigned",
            "due_date": a.due_date or "—",
            "priority": (a.priority or "—").capitalize() if a.priority else "—",
            "status": a.status.replace("_", " ").capitalize(),
        }
        for i, a in enumerate(mom.action_items, start=1)
    ]

    present_count = sum(1 for a in attendees if a.present)
    return {
        "meeting": meeting.model_dump(),
        "attendee_groups": groups,
        "attendee_stats": {
            "total": len(attendees),
            "present": present_count,
            "absent": len(attendees) - present_count,
        },
        "agenda": numbered_agenda,
        "unassigned_discussion": unassigned_discussion,
        "decisions": decisions,
        "action_items": action_items,
        "summary": mom.summary,
        "confidence": mom.confidence,
    }


def render_html(
    meeting: MeetingInfo,
    attendees: list[AttendeeIn],
    mom: MomExtraction,
    template_slug: str = "classic",
) -> str:
    root = get_settings().templates_dir
    folder = root / template_slug
    if not folder.is_dir():
        raise TemplateEngineError(f"Unknown template: {template_slug}")
    validate_template_folder(folder)

    env = Environment(
        loader=FileSystemLoader(str(folder)),
        autoescape=select_autoescape(["html", "xml"]),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    context = build_context(meeting, attendees, mom)

    styles_path = folder / "styles.css"
    context["styles"] = styles_path.read_text(encoding="utf-8") if styles_path.exists() else ""

    logo_path = folder / "logo.png"
    if logo_path.exists():
        encoded = base64.b64encode(logo_path.read_bytes()).decode("ascii")
        context["logo_data_uri"] = f"data:image/png;base64,{encoded}"
    else:
        context["logo_data_uri"] = None

    return env.get_template("template.html").render(**context)
