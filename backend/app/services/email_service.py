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
            return False
        logger.info("Verification email sent via Brevo to %s", to_email)
        return True
    except httpx.HTTPError as exc:
        logger.error("Brevo request error for %s: %s", to_email, exc)
        return False


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


def active_provider() -> str:
    """Which provider send_verification_email will actually use, in priority order."""
    settings = get_settings()
    if settings.brevo_api_key and settings.brevo_sender_email:
        return "brevo"
    if settings.smtp_host and settings.smtp_username and settings.smtp_password:
        return "smtp"
    if settings.resend_api_key:
        return "resend"
    return "none (links are only logged)"


def send_verification_email(email: str, full_name: str, token: str) -> bool:
    """Returns True if an email was actually dispatched via Brevo, SMTP or Resend."""
    settings = get_settings()
    link = f"{settings.frontend_url.rstrip('/')}/verify?token={token}"
    html_content = _verification_html(full_name, link)

    # 1. Prefer Brevo API if configured (HTTP based, works on Render free tier without custom domain)
    if settings.brevo_api_key and settings.brevo_sender_email:
        return _send_brevo_email(email, full_name, "Verify your AutoMOM account", html_content)

    # 2. Fall back to SMTP if configured
    if settings.smtp_host and settings.smtp_username and settings.smtp_password:
        return _send_smtp_email(email, "Verify your AutoMOM account", html_content)

    # 3. Fall back to Resend API
    if settings.resend_api_key:
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
                return False
            logger.info("Verification email sent to %s via Resend", email)
            return True
        except httpx.HTTPError as exc:
            logger.error("Resend request error for %s: %s", email, exc)
            return False

    # 4. Fallback: log for local dev
    logger.warning("No email provider configured — verification link for %s: %s", email, link)
    return False
