import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.limiter import limiter
from app.config import get_settings
from app.database import get_db
from app.models import User
from app.schemas.auth import (
    LoginRequest,
    RegisterRequest,
    RegisterResponse,
    ResendRequest,
    TokenResponse,
    UserOut,
    VerifyRequest,
)
from app.services import email_service
from app.services.email_service import active_provider, send_verification_email
from app.utils.audit import record_audit
from app.utils.security import create_access_token, get_current_user, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])
settings = get_settings()


def _issue_verification(db: Session, user: User) -> None:
    """Generate a fresh token, persist it, and dispatch the verification email."""
    user.verification_token = secrets.token_urlsafe(32)
    user.token_expires = datetime.now(timezone.utc) + timedelta(
        hours=settings.verification_token_ttl_hours
    )
    db.commit()
    send_verification_email(user.email, user.full_name, user.verification_token)


@router.post("/register", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit(settings.rate_limit_auth)
def register(request: Request, payload: RegisterRequest, db: Session = Depends(get_db)):
    existing = db.scalar(select(User).where(User.email == payload.email.lower()))
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")
    user = User(
        email=payload.email.lower(),
        full_name=payload.full_name.strip(),
        hashed_password=hash_password(payload.password),
        is_verified=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    _issue_verification(db, user)
    record_audit(db, user.id, "auth.register", user.email)
    return RegisterResponse(message="Registration successful. Please check your email to verify your account.")


@router.post("/login", response_model=TokenResponse)
@limiter.limit(settings.rate_limit_auth)
def login(request: Request, payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if user is None or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if settings.require_email_verification and not user.is_verified:
        raise HTTPException(status_code=403, detail="Please verify your email before signing in")
    record_audit(db, user.id, "auth.login", user.email)
    return TokenResponse(access_token=create_access_token(user.id))


@router.post("/verify", response_model=UserOut)
def verify_email(payload: VerifyRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.verification_token == payload.token))
    if user is None:
        raise HTTPException(status_code=400, detail="Invalid or already-used verification link")
    expires = user.token_expires
    if expires is not None:
        if expires.tzinfo is None:  # SQLite returns naive datetimes; assume UTC
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="Verification link has expired. Request a new one.")
    user.is_verified = True
    user.verification_token = None
    user.token_expires = None
    db.commit()
    db.refresh(user)
    record_audit(db, user.id, "auth.verify", user.email)
    return user


@router.post("/resend-verification", status_code=202)
@limiter.limit(settings.rate_limit_auth)
def resend_verification(request: Request, payload: ResendRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    # Always return 202 — do not reveal whether an email is registered.
    if user and not user.is_verified:
        _issue_verification(db, user)
    return {"message": "If that account exists and is unverified, a new link has been sent."}


@router.post("/email-debug")
@limiter.limit(settings.rate_limit_auth)
def email_debug(request: Request, payload: ResendRequest, db: Session = Depends(get_db)):
    """Troubleshooting: attempt a verification send to the given email and report
    the provider outcome (status/message only, no secrets). Remove once email works."""
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    target = user.email if user else payload.email.lower()
    name = user.full_name if user else "Test"
    dispatched = send_verification_email(target, name, secrets.token_urlsafe(16))
    return {
        "provider": active_provider(),
        "dispatched": dispatched,
        "last_error": email_service.LAST_EMAIL_ERROR,
        "sent_to": target,
    }


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/email-status")
def email_status(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Report the active email provider and attempt a real verification send to
    the current user, returning whether the dispatch actually succeeded. Use this
    to confirm email delivery is working end-to-end."""
    token = secrets.token_urlsafe(32)
    current_user.verification_token = token
    current_user.token_expires = datetime.now(timezone.utc) + timedelta(
        hours=settings.verification_token_ttl_hours
    )
    db.commit()
    dispatched = send_verification_email(current_user.email, current_user.full_name, token)
    return {
        "provider": active_provider(),
        "dispatched": dispatched,
        "sent_to": current_user.email,
        "hint": None if dispatched else "Check server logs for the provider error line.",
    }
