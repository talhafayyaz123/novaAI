# backend/auth/dependencies.py
"""FastAPI dependencies for authentication.
Provides:
- ``get_current_user``  validates the access token and returns the ORM User.
- ``admin_required``  ensures the user has admin role.
"""

import logging
import os
from pathlib import Path

from fastapi import Depends, Request, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

from ..db.models import User as UserModel
User = UserModel

from ..db import models as db_models
from ..auth.jwt import decode_token

PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env")

database_url = os.getenv("DATABASE_URL")
if not database_url:
    raise RuntimeError("DATABASE_URL must be set to connect to the database")
if database_url.startswith("postgres://"):
    database_url = f"postgresql://{database_url[len('postgres://'):]}"

engine = create_engine(database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
log = logging.getLogger(__name__)


def get_db():
    """Provide a DB session per request.

    The engine is instantiated once when the module is loaded, avoiding the
    overhead of recreating it on every request  a pattern typical of production
    FastAPI apps.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_current_user(request: Request, db: Session = Depends(get_db)):
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.lower().startswith("bearer "):
            token = auth_header[7:].strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = decode_token(token)
        user_id = int(payload.get("sub"))
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user = db.query(db_models.User).filter(db_models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if not getattr(user, "is_active", True):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is deactivated")
    return user

def admin_required(current_user: db_models.User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required")
    return current_user

def get_refresh_token(request: Request) -> str:
    """Retrieve refresh token from HttpOnly cookie."""
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token missing")
    return token
