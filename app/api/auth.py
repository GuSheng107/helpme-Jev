"""认证接口：邀请码注册、登录、登出、当前用户。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from ..core import login_throttle
from ..core.db import get_db
from ..core.time import iso_utc
from ..domain.errors import DomainError, DomainErrorCode
from ..domain.schemas.auth import LoginRequest, LoginResponse, RegisterRequest, UserSummary
from ..repositories.models import User
from ..services.auth_service import AuthService, capabilities_for
from .deps import client_ip, client_ua, current_user, require_active_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


def to_summary(user: User) -> UserSummary:
    return UserSummary(
        id=str(user.id),
        username=user.username,
        display_name=user.display_name or user.username,
        role=user.role,
        must_change_password=user.must_change_password,
        capabilities=capabilities_for(user),
        email=user.email,
        created_at=iso_utc(user.created_at) or "",
        avatar_base64=user.avatar_base64 or None,
    )


def throttle_key(request: Request, username: str) -> str:
    """限流 key = client_ip|username（组合 key，避免同 IP 互相误锁）。"""
    return f"{client_ip(request)}|{(username or '').strip().lower()[:128]}"


def _ensure_allowed(key: str, message: str) -> None:
    if not login_throttle.allow(key):
        raise DomainError(DomainErrorCode.RATE_LIMIT_EXCEEDED, message, status_code=429)


@router.post("/register", response_model=UserSummary, status_code=201)
def register(
    payload: RegisterRequest, request: Request, db: Session = Depends(get_db)
) -> UserSummary:
    """注册**只走邀请码**。"""
    key = throttle_key(request, payload.username)
    _ensure_allowed(key, "尝试过于频繁，请稍后再试")
    try:
        user = AuthService().register(
            db,
            invitation_code=payload.invitation_code,
            username=payload.username,
            display_name=payload.display_name,
            password=payload.password,
            email=payload.email,
        )
    except DomainError as exc:
        db.rollback()
        if exc.code is DomainErrorCode.INVALID_INVITATION:
            login_throttle.record_failure(key)
        raise
    db.commit()
    login_throttle.reset(key)
    return to_summary(user)


@router.post("/login", response_model=LoginResponse)
def login(
    payload: LoginRequest, request: Request, db: Session = Depends(get_db)
) -> LoginResponse:
    key = throttle_key(request, payload.username)
    _ensure_allowed(key, "登录尝试过于频繁，请稍后再试")
    try:
        token, _expires_at, user = AuthService().login(
            db,
            payload.username,
            payload.password,
            client_ip=client_ip(request),
            user_agent=client_ua(request),
        )
    except DomainError as exc:
        db.rollback()
        if exc.code is DomainErrorCode.UNAUTHORIZED:
            login_throttle.record_failure(key)
        raise
    db.commit()
    login_throttle.reset(key)
    return LoginResponse(**to_summary(user).model_dump(), access_token=token)


@router.post("/logout", status_code=204)
def logout(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> Response:
    token = getattr(request.state, "token", "")
    AuthService().logout(db, token)
    db.commit()
    return Response(status_code=204)


@router.get("/me", response_model=UserSummary)
def me(user: User = Depends(require_active_user)) -> UserSummary:
    """当前用户。**强制改密状态下仍可访问**（白名单端点）。"""
    return to_summary(user)
