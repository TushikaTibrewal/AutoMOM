"""Audit log helper."""
from sqlalchemy.orm import Session

from app.models import AuditLog


def record_audit(db: Session, user_id: int | None, action: str, detail: str = "") -> None:
    db.add(AuditLog(user_id=user_id, action=action, detail=detail[:2000]))
    db.commit()
