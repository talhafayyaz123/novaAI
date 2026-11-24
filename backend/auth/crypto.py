# backend/auth/crypto.py
"""Argon2id password hashing utilities.
Uses argon2-cffi which is already in the backend requirements.
"""
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

ph = PasswordHasher(time_cost=2, memory_cost=102400, parallelism=8, hash_len=32, salt_len=16)


def hash_password(plain_password: str) -> str:
    """Return an Argon2id hash for the given plain password."""
    return ph.hash(plain_password)


def verify_password(hashed_password: str, plain_password: str) -> bool:
    """Verify that *plain_password* matches *hashed_password*.
    Returns True if the password is correct, False otherwise.
    """
    try:
        return ph.verify(hashed_password, plain_password)
    except VerifyMismatchError:
        return False
