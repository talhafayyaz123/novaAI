# backend/auth/schemas.py
"""Pydantic request/response models for authentication endpoints."""
from pydantic import BaseModel, EmailStr, Field


class RegisterSchema(BaseModel):
    email: EmailStr = Field(..., example="user@example.com")
    password: str = Field(..., min_length=8, example="StrongP@ssw0rd")


class LoginSchema(BaseModel):
    email: EmailStr = Field(..., example="user@example.com")
    password: str = Field(..., example="StrongP@ssw0rd")


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class PasswordResetRequest(BaseModel):
    email: EmailStr = Field(..., example="user@example.com")


class PasswordResetConfirm(BaseModel):
    token: str = Field(..., description="Password reset token sent via email")
    new_password: str = Field(..., min_length=8)


class ProfileUpdateSchema(BaseModel):
    current_password: str = Field(..., min_length=8, max_length=128)
    email: EmailStr | None = None
    new_password: str | None = Field(default=None, min_length=8, max_length=128)
