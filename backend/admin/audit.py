from sqlalchemy.orm import Session

from backend.db.models import AIUsage, AuditLog


def record_activity(
    db: Session,
    user_id: int,
    action: str,
    details: dict | None = None,
) -> None:
    db.add(AuditLog(user_id=user_id, action=action, details=details))


def record_ai_request(
    db: Session,
    user_id: int,
    endpoint: str,
    tokens_used: int = 0,
    details: dict | None = None,
) -> None:
    db.add(AIUsage(user_id=user_id, endpoint=endpoint, tokens_used=tokens_used))
    record_activity(
        db,
        user_id,
        f"ai.{endpoint}",
        details,
    )
