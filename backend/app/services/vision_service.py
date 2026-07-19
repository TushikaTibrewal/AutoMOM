"""Read participant display names from a video-meeting screenshot via Groq vision.

Live mode captures the shared meeting tab's video; periodically a frame is sent
here and a vision model reads the name labels on the participant tiles. This is
how attendees are auto-tracked from Google Meet / Zoom without a bot.
Best-effort: any failure returns an empty list so the meeting is unaffected.
"""
from __future__ import annotations

import base64
import json
import re

import httpx

from app.config import get_settings
from app.utils.logging import get_logger

logger = get_logger("vision")
GROQ_CHAT_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"

_PROMPT = (
    "This image is a screenshot of a video conference (Google Meet or Zoom). "
    "Read the participant display names shown on the tiles / name labels. "
    'Return ONLY a JSON array of the distinct human names visible, e.g. ["Asha Rao","John"]. '
    "Strip trailing numbers or '(You)'. If no names are legible, return []."
)


def _parse_names(content: str) -> list[str]:
    match = re.search(r"\[.*\]", content, re.DOTALL)
    if not match:
        return []
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return []
    names: list[str] = []
    for item in data if isinstance(data, list) else []:
        if not isinstance(item, str):
            continue
        name = re.sub(r"\s*\(you\)\s*$", "", item, flags=re.IGNORECASE).strip()
        name = re.sub(r"\s+\d+$", "", name).strip()  # drop trailing device numbers
        if 1 < len(name) <= 80:
            names.append(name)
    # de-dupe, keep order
    return list(dict.fromkeys(names))


def detect_participants(image_bytes: bytes, mime: str = "image/jpeg") -> list[str]:
    settings = get_settings()
    if not settings.groq_api_key:
        return []
    b64 = base64.b64encode(image_bytes).decode("ascii")
    payload = {
        "model": settings.groq_vision_model,
        "temperature": 0,
        "max_tokens": 300,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": _PROMPT},
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                ],
            }
        ],
    }
    try:
        response = httpx.post(
            GROQ_CHAT_ENDPOINT,
            headers={"Authorization": f"Bearer {settings.groq_api_key}"},
            json=payload,
            timeout=settings.ai_timeout_seconds,
        )
        if response.status_code >= 400:
            logger.warning("Groq vision failed (%s): %s", response.status_code, response.text[:200])
            return []
        content = response.json()["choices"][0]["message"]["content"]
        return _parse_names(content)
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        logger.warning("Vision participant detection error: %s", exc)
        return []
