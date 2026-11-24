# backend/auth/routes.py
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.admin.audit import record_activity
from backend.auth import schemas, crypto, jwt, dependencies

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

router = APIRouter()

@router.post("/register", response_model=schemas.TokenResponse)
async def register(user_in: schemas.RegisterSchema, db: Session = Depends(dependencies.get_db)):
    try:
        
        existing = db.query(dependencies.User).filter(dependencies.User.email == user_in.email).first()
        if existing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")
        hashed = crypto.hash_password(user_in.password)
        new_user = dependencies.User(email=user_in.email, hashed_password=hashed, role="user")
        try:
            db.add(new_user)
            db.flush()
            record_activity(db, new_user.id, "auth.register")
            db.commit()
            db.refresh(new_user)
        except IntegrityError:
            db.rollback()
            log.error("Register failed: email %s already exists", user_in.email)
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")
        
        access = jwt.create_access_token(user_id=new_user.id)
        refresh = jwt.create_refresh_token(user_id=new_user.id)
        response = JSONResponse(content={"access_token": access, "token_type": "bearer"})
        response.set_cookie(key="refresh_token", value=refresh, httponly=True, secure=False, samesite="strict")
        return response
    except Exception as e:
        
        log.error("Register endpoint error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/login", response_model=schemas.TokenResponse)
async def login(form: schemas.LoginSchema, db: Session = Depends(dependencies.get_db)):
    user = db.query(dependencies.User).filter(dependencies.User.email == form.email).first()
    if not user or not crypto.verify_password(user.hashed_password, form.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not getattr(user, "is_active", True):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is deactivated")
    record_activity(db, user.id, "auth.login")
    db.commit()
    access = jwt.create_access_token(user_id=user.id)
    refresh = jwt.create_refresh_token(user_id=user.id)
    response = JSONResponse(content={"access_token": access, "token_type": "bearer"})
    response.set_cookie(key="refresh_token", value=refresh, httponly=True, secure=False, samesite="strict")
    return response

@router.post("/refresh", response_model=schemas.TokenResponse)
async def refresh_token(request: Request, db: Session = Depends(dependencies.get_db)):
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token missing")
    payload = jwt.decode_token(refresh_token)
    user_id = int(payload.get("sub"))
    user = db.query(dependencies.User).filter(dependencies.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if not getattr(user, "is_active", True):
        response = JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={"detail": "Account is deactivated"},
        )
        response.delete_cookie(key="refresh_token")
        return response
    # Issue new tokens
    new_refresh = jwt.create_refresh_token(user_id=user_id)
    access = jwt.create_access_token(user_id=user_id)
    response = JSONResponse(content={"access_token": access, "token_type": "bearer"})
    response.set_cookie(key="refresh_token", value=new_refresh, httponly=True, secure=False, samesite="strict")
    return response

@router.post("/logout")
async def logout(request: Request):
    
    response = JSONResponse(content={"detail": "Logged out"})
    response.delete_cookie(key="refresh_token")
    return response

@router.get("/me")
async def read_me(current_user: dependencies.User = Depends(dependencies.get_current_user)):
    return {
        "id": current_user.id,
        "email": current_user.email,
        "role": current_user.role,
        "is_active": getattr(current_user, "is_active", True),
    }


@router.patch("/profile")
async def update_profile(
    payload: schemas.ProfileUpdateSchema,
    current_user: dependencies.User = Depends(dependencies.get_current_user),
    db: Session = Depends(dependencies.get_db),
):
    if payload.email is None and payload.new_password is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Provide a new email or password",
        )
    if not crypto.verify_password(current_user.hashed_password, payload.current_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )

    if payload.email is not None:
        normalized_email = str(payload.email).lower()
        existing = (
            db.query(dependencies.User)
            .filter(
                dependencies.User.email == normalized_email,
                dependencies.User.id != current_user.id,
            )
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Email is already in use",
            )
        current_user.email = normalized_email

    if payload.new_password is not None:
        current_user.hashed_password = crypto.hash_password(payload.new_password)

    record_activity(db, current_user.id, "auth.profile_updated")
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email is already in use",
        ) from exc
    db.refresh(current_user)
    return {
        "id": current_user.id,
        "email": current_user.email,
        "role": current_user.role,
    }
