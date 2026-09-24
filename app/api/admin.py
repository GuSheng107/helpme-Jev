"""管理员接口：用户账号与邀请码。不读取任何人的聊天、人设或日志。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from pydantic import Field
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.constants import INVITATION_MAX_USES
from ..core.security import generate_invitation_code
from ..core.time import iso_utc
from ..domain.enums import AuditAction
from ..domain.errors import DomainError, DomainErrorCode
from ..domain.schemas.auth import StrictModel
from ..repositories.auth_repo import AuditRepository, InvitationRepository, UserRepository
from ..repositories.models import InvitationCode, User
from ..services.auth_service import AuthService
from ..services.image_service import delete_user_materials
from .deps import require_admin

router = APIRouter(prefix="/api/admin", tags=["admin"])

_users = UserRepository()
_invitations = InvitationRepository()
_audit = AuditRepository()
_auth = AuthService()


def _user_view(row: User) -> dict:
    return {
        "id": row.id,
        "username": row.username,
        "display_name": row.display_name,
        "role": row.role,
        "is_active": row.is_active,
        "must_change_password": row.must_change_password,
        "created_at": iso_utc(row.created_at) or "",
        "last_login_at": iso_utc(row.last_login_at) or "",
    }


class UserCreateRequest(StrictModel):
    username: str = Field(min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.\-]+$")
    display_name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=10, max_length=512)


class InvitationCreateRequest(StrictModel):
    note: str = Field(default="", max_length=255)
    max_uses: int = Field(default=1, ge=1, le=INVITATION_MAX_USES)


@router.get("/users")
def list_users(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> list[dict]:
    return [_user_view(row) for row in _users.list_all(db)]


@router.post("/users", status_code=201)
def create_user(
    payload: UserCreateRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    row = _auth.create_user(
        db,
        actor=admin,
        username=payload.username,
        display_name=payload.display_name,
        password=payload.password,
    )
    db.commit()
    return _user_view(row)


@router.post("/users/{user_id}/active")
def set_active(
    user_id: int,
    active: bool,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    row = _auth.set_active(db, actor=admin, user_id=user_id, active=active)
    db.commit()
    return _user_view(row)


@router.post("/users/{user_id}/reset-password")
def reset_password(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    row, temporary = _auth.reset_password(db, actor=admin, user_id=user_id)
    db.commit()
    return {**_user_view(row), "temporary_password": temporary}


@router.delete("/users/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> Response:
    _auth.delete_user(db, actor=admin, user_id=user_id)
    db.commit()
    delete_user_materials(user_id)
    return Response(status_code=204)


def _invitation_view(row: InvitationCode) -> dict:
    return {
        "id": row.id,
        "code": row.code,
        "note": row.note or "",
        "max_uses": row.max_uses,
        "used_count": row.used_count,
        "status": row.status(),
        "created_at": iso_utc(row.created_at) or "",
    }


@router.get("/invitations")
def list_invitations(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> list[dict]:
    rows, _total = _invitations.list_page(db, page=1, page_size=200)
    return [_invitation_view(row) for row in rows]


@router.post("/invitations", status_code=201)
def create_invitation(
    payload: InvitationCreateRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    code = generate_invitation_code()
    row = _invitations.add(
        db,
        InvitationCode(
            code=code,
            note=payload.note.strip(),
            max_uses=payload.max_uses,
            created_by_user_id=admin.id,
        ),
    )
    _audit.add(
        db,
        action=AuditAction.INVITATION_CREATED.value,
        actor_user_id=admin.id,
        resource_type="invitation",
        resource_id=str(row.id),
    )
    db.commit()
    return _invitation_view(row)


@router.post("/invitations/{invitation_id}/revoke")
def revoke_invitation(
    invitation_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    row = _invitations.get(db, invitation_id)
    if row is None:
        raise DomainError(DomainErrorCode.NOT_FOUND, "邀请码不存在", status_code=404)
    _invitations.revoke(db, invitation_id)
    db.refresh(row)
    _audit.add(
        db,
        action=AuditAction.INVITATION_REVOKED.value,
        actor_user_id=admin.id,
        resource_type="invitation",
        resource_id=str(row.id),
    )
    db.commit()
    return _invitation_view(row)
