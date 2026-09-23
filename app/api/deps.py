"""FastAPI 依赖：当前用户、能力校验、强制改密闸门。"""

from __future__ import annotations

from collections.abc import Callable

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..domain.enums import Capability
from ..domain.errors import DomainError, DomainErrorCode
from ..repositories.models import User
from ..services.auth_service import AuthService, capabilities_for

bearer = HTTPBearer(auto_error=False)

# 强制改密状态下**仍可访问**的白名单端点（其余一律 403）
PASSWORD_CHANGE_ALLOWLIST: set[tuple[str, str]] = {
    ("POST", "/api/auth/logout"),
    ("GET", "/api/auth/me"),
    ("POST", "/api/account/password"),
}


def client_ip(request: Request) -> str:
    return request.client.host if request.client is not None else "unknown"


def client_ua(request: Request) -> str:
    return request.headers.get("user-agent", "")


def current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    """解析 Bearer token → User。失败一律 401。"""
    if credentials is None or not credentials.credentials:
        raise DomainError(DomainErrorCode.UNAUTHORIZED, "未提供访问令牌", status_code=401)
    user = AuthService().user_by_token(db, credentials.credentials)
    if user is None:
        raise DomainError(
            DomainErrorCode.UNAUTHORIZED, "登录已失效，请重新登录", status_code=401
        )
    request.state.user = user
    request.state.token = credentials.credentials
    return user


def require_active_user(
    request: Request,
    user: User = Depends(current_user),
) -> User:
    """强制改密闸门：``must_change_password`` 为真时只放行白名单端点。"""
    if user.must_change_password:
        key = (request.method.upper(), request.url.path)
        if key not in PASSWORD_CHANGE_ALLOWLIST:
            raise DomainError(
                DomainErrorCode.MUST_CHANGE_PASSWORD,
                "首次登录需先修改密码",
                status_code=403,
            )
    return user


def require_capability(capability: Capability) -> Callable[[User], User]:
    """能力校验依赖工厂。"""

    def _checker(user: User = Depends(require_active_user)) -> User:
        if capability.value not in capabilities_for(user):
            raise DomainError(DomainErrorCode.FORBIDDEN, "没有该操作的权限", status_code=403)
        return user

    return _checker


def require_admin(user: User = Depends(require_active_user)) -> User:
    """管理员校验。

    注意：**admin 也不可查看他人日志**（皇上明令）—— 该限制在日志接口内另行实现。
    """
    if Capability.USER_MANAGE.value not in capabilities_for(user):
        raise DomainError(DomainErrorCode.FORBIDDEN, "需要管理员权限", status_code=403)
    return user
