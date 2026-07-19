"""Transactional email via SMTP or Resend.

If neither is configured, the verification link is logged instead of sent.
"""
from __future__ import annotations

import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import httpx

from app.config import get_settings
from app.utils.logging import get_logger

logger = get_logger("email")
RESEND_ENDPOINT = "https://api.resend.com/emails"
BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email"

# Last send outcome, exposed via /api/auth/email-debug for troubleshooting.
# Holds only a provider status/message snippet — never secrets.
LAST_EMAIL_ERROR: str | None = None
LAST_EMAIL_OK: bool | None = None


def _record(ok: bool, error: str | None) -> bool:
    global LAST_EMAIL_ERROR, LAST_EMAIL_OK
    LAST_EMAIL_OK = ok
    LAST_EMAIL_ERROR = error
    return ok


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


def _send_brevo_email(to_email: str, to_name: str, subject: str, html_content: str) -> bool:
    settings = get_settings()
    try:
        response = httpx.post(
            BREVO_ENDPOINT,
            headers={
                "accept": "application/json",
                "api-key": settings.brevo_api_key,
                "content-type": "application/json",
            },
            json={
                "sender": {
                    "name": settings.brevo_sender_name,
                    "email": settings.brevo_sender_email,
                },
                "to": [
                    {
                        "email": to_email,
                        "name": to_name,
                    }
                ],
                "subject": subject,
                "htmlContent": html_content,
            },
            timeout=15,
        )
        if response.status_code >= 400:
            logger.error("Brevo send failed (%s): %s", response.status_code, response.text[:300])
            return _record(False, f"Brevo {response.status_code}: {response.text[:200]}")
        logger.info("Verification email sent via Brevo to %s", to_email)
        return _record(True, None)
    except httpx.HTTPError as exc:
        logger.error("Brevo request error for %s: %s", to_email, exc)
        return _record(False, f"Brevo request error: {exc}")


def _send_smtp_email(to_email: str, subject: str, html_content: str) -> bool:
    settings = get_settings()
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = settings.smtp_username
        msg["To"] = to_email

        part = MIMEText(html_content, "html")
        msg.attach(part)

        if settings.smtp_port == 465:
            server = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=15)
        else:
            server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15)
            server.ehlo()
            server.starttls()
            server.ehlo()

        server.login(settings.smtp_username, settings.smtp_password)
        server.sendmail(settings.smtp_username, to_email, msg.as_string())
        server.quit()
        logger.info("Verification email sent via SMTP to %s", to_email)
        return True
    except (OSError, smtplib.SMTPException) as exc:
        logger.error(
            "SMTP send failed for %s: %s. NOTE: many hosts (including Render) block "
            "outbound SMTP ports 25/465/587 — use an HTTP email API (Brevo/Resend) instead.",
            to_email,
            exc,
        )
        return False


def _has_brevo() -> bool:
    s = get_settings()
    return bool(s.brevo_api_key and s.brevo_sender_email)


def _has_smtp() -> bool:
    s = get_settings()
    return bool(s.smtp_host and s.smtp_username and s.smtp_password)


def _has_resend() -> bool:
    return bool(get_settings().resend_api_key)


def active_provider() -> str:
    """Which provider send_verification_email will actually use.

    EMAIL_PROVIDER forces a specific one; "auto" picks the first configured.
    """
    forced = get_settings().email_provider.lower()
    if forced in ("brevo", "smtp", "resend"):
        return forced
    if _has_brevo():
        return "brevo"
    if _has_smtp():
        return "smtp"
    if _has_resend():
        return "resend"
    return "none (links are only logged)"


def _send_resend_email(email: str, html_content: str) -> bool:
    settings = get_settings()
    try:
        response = httpx.post(
            RESEND_ENDPOINT,
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={
                "from": settings.resend_from,
                "to": [email],
                "subject": "Verify your AutoMOM account",
                "html": html_content,
            },
            timeout=15,
        )
        if response.status_code >= 400:
            logger.error("Resend send failed (%s): %s", response.status_code, response.text[:300])
            return _record(False, f"Resend {response.status_code}: {response.text[:200]}")
        logger.info("Verification email sent to %s via Resend", email)
        return _record(True, None)
    except httpx.HTTPError as exc:
        logger.error("Resend request error for %s: %s", email, exc)
        return _record(False, f"Resend request error: {exc}")


def send_verification_email(email: str, full_name: str, token: str) -> bool:
    """Returns True if an email was actually dispatched. Honors EMAIL_PROVIDER."""
    settings = get_settings()
    link = f"{settings.frontend_url.rstrip('/')}/verify?token={token}"
    html_content = _verification_html(full_name, link)
    provider = active_provider()

    if provider == "brevo" and _has_brevo():
        return _send_brevo_email(email, full_name, "Verify your AutoMOM account", html_content)
    if provider == "smtp" and _has_smtp():
        return _send_smtp_email(email, "Verify your AutoMOM account", html_content)
    if provider == "resend" and _has_resend():
        return _send_resend_email(email, html_content)

    # 4. Fallback: log for local dev
    logger.warning("No email provider configured — verification link for %s: %s", email, link)
    return False
