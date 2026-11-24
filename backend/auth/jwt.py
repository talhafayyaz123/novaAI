# backend/auth/jwt.py
"""Utility functions for JWT creation and verification.
The secret key is taken from the environment variable ``JWT_SECRET_KEY``.
Access tokens are short lived (e.g., 15min) while refresh tokens live longer
(e.g., 7 days). Both are stored in HttpOnly Secure SameSite=strict cookies.
"""
import os
from datetime import datetime, timedelta
from typing import Dict, Any

import jwt

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "replace-me-with-secret")

ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))


def _create_token(data: Dict[str, Any], expires_delta: timedelta) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + expires_delta
    to_encode.update({"exp": expire, "iat": datetime.utcnow()})
    return jwt.encode(to_encode, SECRET_KEY, algorithm="HS256")


def create_access_token(user_id: int, is_admin: bool = False) -> str:
    """Create a short lived access token.
    Payload contains the user identifier and a ``role`` claim.
    """
    payload = {"sub": str(user_id), "role": "admin" if is_admin else "user"}
    return _create_token(payload, timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))


def create_refresh_token(user_id: int) -> str:
    """Create a longer lived refresh token.
    The payload is minimal  just the subject.
    """
    payload = {"sub": str(user_id), "type": "refresh"}
    return _create_token(payload, timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS))


def decode_token(token: str) -> Dict[str, Any]:
    """Decode a JWT and return its payload.
    Raises ``jwt.ExpiredSignatureError`` or ``jwt.InvalidTokenError`` on failure.
    """
    return jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
