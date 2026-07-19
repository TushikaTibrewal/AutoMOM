"""Transactional email via Resend.

If RESEND_API_KEY is unset, the verification link is logged instead of sent —
so local dev and the offline demo work without an email provider.
"""
from __future__ import annotations

import httpx

from app.config import get_settings
from app.utils.logging import get_logger

logger = get_logger("email")
RESEND_ENDPOINT = "https://api.resend.com/emails"


def _verification_html(full_name: str, link: str) -> str:
    return f"""\
<div style="font-family:Helvetica,Arial,sans-serif;max-width:480px;margin:auto;color:#0f172a">
  <h2 style="color:#4f46e5">Verify your AutoMOM account</h2>
  <p>Hi {full_name or "there"},</p>
  <p>Confirm your email address to activate your AutoMOM account.</p>
  <p style="margin:28px 0">
    <a href="{link}"
       style="background:#4f46e5;color:#fff;padding:12px 22px;border-radius:8px;
              text-decoration:none;font-weight:600">Verify email</a>
  </p>
  <p style="font-size:12px;color:#64748b">
    Or paste this link into your browser:<br><a href="{link}">{link}</a>
  </p>
  <p style="font-size:12px;color:#94a3b8">If you didn't create this account, ignore this email.</p>
</div>"""


def send_verification_email(email: str, full_name: str, token: str) -> bool:
    """Returns True if an email was actually dispatched via Resend."""
    settings = get_settings()
    link = f"{settings.frontend_url.rstrip('/')}/verify?token={token}"

    if not settings.resend_api_key:
        logger.warning("RESEND_API_KEY not set — verification link for %s: %s", email, link)
        return False

    try:
        response = httpx.post(
            RESEND_ENDPOINT,
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={
                "from": settings.resend_from,
                "to": [email],
                "subject": "Verify your AutoMOM account",
                "html": _verification_html(full_name, link),
            },
            timeout=15,
        )
        if response.status_code >= 400:
            logger.error("Resend send failed (%s): %s", response.status_code, response.text[:300])
            return False
        logger.info("Verification email sent to %s", email)
        return True
    except httpx.HTTPError as exc:
        logger.error("Resend request error for %s: %s", email, exc)
        return False
