"""账户接口：改密（含强制改密路径）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..domain.errors import DomainError
from ..domain.schemas.auth import PasswordChangeRequest, UserSummary
from ..repositories.models import User
from ..services.auth_service import AuthService
from .auth import to_summary
from .deps import require_active_user

router = APIRouter(prefix="/api/account", tags=["account"])


@router.post("/password", response_model=UserSummary)
def change_password(
    payload: PasswordChangeRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> UserSummary:
    """改密。

    强制改密状态下**也能调用**（属白名单端点）；
    改密成功后会把该用户的其余会话全部撤销，只保留当前会话。
    """
    token = getattr(request.state, "token", "")
    session = AuthService().session_by_token(db, token)
    try:
        AuthService().change_password(
            db,
            user,
            old_password=payload.old_password,
            new_password=payload.new_password,
            keep_session_id=session.id if session is not None else None,
        )
    except DomainError:
        db.rollback()
        raise
    db.commit()
    return to_summary(user)
