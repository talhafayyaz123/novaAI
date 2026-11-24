# backend/auth/csrf.py
"""Simple CSRF middleware for FastAPI.
For state changing requests (POST, PUT, DELETE) it expects the
client to send a header ``X-CSRF-Token`` that matches a token stored
in a secure HttpOnly cookie named ``csrf_token``.
When the token is missing or mismatched, a 403 error is raised.
"""
from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware

CSRF_HEADER = "X-CSRF-Token"
CSRF_COOKIE = "csrf_token"


class CSRFMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            header_token = request.headers.get(CSRF_HEADER)
            cookie_token = request.cookies.get(CSRF_COOKIE)
            if not header_token or not cookie_token or header_token != cookie_token:
                raise HTTPException(status_code=403, detail="CSRF token invalid or missing")
        response = await call_next(request)
        return response
