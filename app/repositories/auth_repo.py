"""认证域数据访问：用户、会话、邀请码、审计日志。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from ..core.time import utc_now
from .models import AuditLog, AuthSession, InvitationCode, User


class UserRepository:
    def get(self, db: Session, user_id: int) -> User | None:
        return db.get(User, user_id)

    def by_username(self, db: Session, username: str) -> User | None:
        return db.scalars(select(User).where(User.username == username.strip().lower())).first()

    def add(self, db: Session, user: User) -> User:
        db.add(user)
        db.flush()
        return user

    def list_all(self, db: Session) -> list[User]:
        return list(db.scalars(select(User).order_by(User.id)))

    def count(self, db: Session) -> int:
        return int(db.scalar(select(func.count()).select_from(User)) or 0)


class SessionRepository:
    def add(self, db: Session, row: AuthSession) -> AuthSession:
        db.add(row)
        db.flush()
        return row

    def by_token_hash(self, db: Session, token_hash: str) -> AuthSession | None:
        return db.scalars(select(AuthSession).where(AuthSession.token_hash == token_hash)).first()

    def revoke(self, db: Session, session_id: int, *, at: datetime | None = None) -> bool:
        moment = at or utc_now()
        result = db.execute(
            update(AuthSession)
            .where(AuthSession.id == session_id, AuthSession.revoked_at.is_(None))
            .values(revoked_at=moment, updated_at=moment)
        )
        return bool(result.rowcount)

    def revoke_all(self, db: Session, user_id: int, *, keep_session_id: int | None = None) -> int:
        moment = utc_now()
        stmt = (
            update(AuthSession)
            .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
            .values(revoked_at=moment, updated_at=moment)
        )
        if keep_session_id is not None:
            stmt = stmt.where(AuthSession.id != keep_session_id)
        result = db.execute(stmt)
        return int(result.rowcount or 0)


class InvitationRepository:
    def add(self, db: Session, row: InvitationCode) -> InvitationCode:
        db.add(row)
        db.flush()
        return row

    def get(self, db: Session, invitation_id: int) -> InvitationCode | None:
        return db.get(InvitationCode, invitation_id)

    def find_candidates(self, db: Session, prefix: str) -> list[InvitationCode]:
        """按前缀找候选（明文不落库，无法直接按明文查）。"""
        stmt = select(InvitationCode).where(
            InvitationCode.code_prefix == prefix,
            InvitationCode.revoked_at.is_(None),
        )
        return list(db.scalars(stmt))

    def list_page(self, db: Session, *, page: int, page_size: int) -> tuple[list[InvitationCode], int]:
        total = int(db.scalar(select(func.count()).select_from(InvitationCode)) or 0)
        stmt = (
            select(InvitationCode)
            .order_by(InvitationCode.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return list(db.scalars(stmt)), total

    def consume(self, db: Session, invitation_id: int) -> bool:
        """原子消费一次：仅当 ``used_count < max_uses`` 时才 +1。"""
        result = db.execute(
            update(InvitationCode)
            .where(
                InvitationCode.id == invitation_id,
                InvitationCode.revoked_at.is_(None),
                InvitationCode.used_count < InvitationCode.max_uses,
            )
            .values(used_count=InvitationCode.used_count + 1, updated_at=utc_now())
        )
        return bool(result.rowcount)

    def revoke(self, db: Session, invitation_id: int) -> bool:
        result = db.execute(
            update(InvitationCode)
            .where(InvitationCode.id == invitation_id, InvitationCode.revoked_at.is_(None))
            .values(revoked_at=utc_now(), updated_at=utc_now())
        )
        return bool(result.rowcount)

    def delete(self, db: Session, row: InvitationCode) -> None:
        db.delete(row)
        db.flush()


class AuditRepository:
    def add(
        self,
        db: Session,
        *,
        action: str,
        owner_user_id: int | None = None,
        actor_user_id: int | None = None,
        resource_type: str = "",
        resource_id: str = "",
        result: str = "ok",
        request_id: str = "",
        meta: str = "{}",
    ) -> AuditLog:
        row = AuditLog(
            owner_user_id=owner_user_id,
            actor_user_id=actor_user_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            result=result,
            request_id=request_id,
            meta=meta,
        )
        db.add(row)
        db.flush()
        return row
