# backend/admin/routes.py
"""Admin API routes protected by ``admin_required``."""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth.dependencies import admin_required, get_db
from ..db import models as db_models

router = APIRouter()


class UserStatusRequest(BaseModel):
    is_active: bool


@router.get("/stats")
def get_stats(db: Session = Depends(get_db), user: db_models.User = Depends(admin_required)):
    total_users = db.query(db_models.User).count()
    total_documents = db.query(db_models.Document).count()
    total_conversations = db.query(db_models.Conversation).count()
    total_ai_requests = db.query(db_models.AIUsage).count()
    total_tokens = (
        db.query(func.coalesce(func.sum(db_models.AIUsage.tokens_used), 0)).scalar()
    )
    recent_audit = (
        db.query(db_models.AuditLog)
        .order_by(db_models.AuditLog.timestamp.desc())
        .limit(10)
        .all()
    )
    audit_data = [
        {
            "id": entry.id,
            "user_id": entry.user_id,
            "email": entry.user.email if entry.user else None,
            "action": entry.action,
            "timestamp": entry.timestamp.isoformat(),
        }
        for entry in recent_audit
    ]
    return {
        "total_users": total_users,
        "total_conversations": total_conversations,
        "total_ai_requests": total_ai_requests,
        "total_documents": total_documents,
        "total_tokens_used": total_tokens,
        "recent_audit": audit_data,
    }


@router.get("/users")
def list_users(db: Session = Depends(get_db), user: db_models.User = Depends(admin_required)):
    users = db.query(db_models.User).all()
    return [
        {
            "id": u.id,
            "email": u.email,
            "role": u.role,
            "is_active": getattr(u, "is_active", True),
            "created_at": u.created_at.isoformat(),
        }
        for u in users
    ]


@router.patch("/users/{user_id}/status")
def update_user_status(
    user_id: int,
    payload: UserStatusRequest,
    db: Session = Depends(get_db),
    admin: db_models.User = Depends(admin_required),
):
    target = db.query(db_models.User).filter(db_models.User.id == user_id).first()
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if target.id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot deactivate your own account",
        )
    target.is_active = payload.is_active
    record_action = "admin.user_reactivated" if payload.is_active else "admin.user_deactivated"
    db.add(db_models.AuditLog(user_id=admin.id, action=record_action, details={"target_user_id": target.id}))
    db.commit()
    db.refresh(target)
    return {
        "id": target.id,
        "email": target.email,
        "role": target.role,
        "is_active": target.is_active,
        "created_at": target.created_at.isoformat(),
    }
