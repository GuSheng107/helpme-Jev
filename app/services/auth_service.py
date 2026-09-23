"""认证用例：邀请码注册、登录、登出、改密、能力计算。"""

from __future__ import annotations

import re
from datetime import datetime

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..core.config import get_settings
from ..core.constants import INVITATION_CODE_PREFIX_LEN
from ..core.security import (
    generate_session_token,
    hash_password,
    password_needs_rehash,
    verify_invitation_code,
    verify_password,
)
from ..core.time import utc_after_hours, utc_now
from ..domain.enums import AuditAction, Capability, UserRole
from ..domain.errors import DomainError, DomainErrorCode
from ..repositories.auth_repo import (
    AuditRepository,
    InvitationRepository,
    SessionRepository,
    UserRepository,
)
from ..repositories.models import AuthSession, InvitationCode, User

PASSWORD_MIN_LEN = 10
_HAS_LETTER = re.compile(r"[A-Za-z]")
_HAS_DIGIT = re.compile(r"\d")
_HAS_SYMBOL = re.compile(r"[^A-Za-z0-9]")


def validate_password_strength(password: str) -> None:
    """密码策略：≥10 位，且同时含字母、数字、符号。"""
    if len(password) < PASSWORD_MIN_LEN:
        raise DomainError(
            DomainErrorCode.VALIDATION_FAILED,
            f"密码至少 {PASSWORD_MIN_LEN} 位",
            status_code=422,
        )
    if not (
        _HAS_LETTER.search(password)
        and _HAS_DIGIT.search(password)
        and _HAS_SYMBOL.search(password)
    ):
        raise DomainError(
            DomainErrorCode.VALIDATION_FAILED,
            "密码需同时包含字母、数字与符号",
            status_code=422,
        )


def capabilities_for(user: User) -> list[str]:
    """能力清单。

    ``must_change_password`` 为真时**只给改密能力** —— 这就是强制改密闸门。
    """
    if user.must_change_password:
        return [Capability.ACCOUNT_PASSWORD_CHANGE.value]

    caps = [
        Capability.ACCOUNT_PASSWORD_CHANGE,
        Capability.ACCOUNT_PROFILE_UPDATE,
        Capability.PROVIDER_MANAGE,
        Capability.SCENARIO_MANAGE,
        Capability.CHAT_USE,
        Capability.DECISION_USE,
        Capability.MEMORY_MANAGE,
        Capability.PERSONA_MANAGE,
        Capability.IMPORT_USE,
        Capability.LOG_VIEW_OWN,
        Capability.DATA_EXPORT,
    ]
    if user.role == UserRole.ADMIN.value:
        caps += [Capability.INVITATION_MANAGE, Capability.USER_MANAGE]
    return [cap.value for cap in caps]


class AuthService:
    def __init__(self) -> None:
        self.users = UserRepository()
        self.sessions = SessionRepository()
        self.invitations = InvitationRepository()
        self.audit = AuditRepository()

    # ---------------------------------------------------------------- 注册
    def register(
        self,
        db: Session,
        *,
        invitation_code: str,
        username: str,
        display_name: str,
        password: str,
        email: str | None = None,
    ) -> User:
        validate_password_strength(password)
        normalized = username.strip().lower()
        if self.users.by_username(db, normalized) is not None:
            raise DomainError(DomainErrorCode.CONFLICT, "用户名已被占用", status_code=409)

        invitation = self._match_invitation(db, invitation_code)
        # 先消费再建号：消费失败（并发争抢）直接拒绝，避免超额发放
        if not self.invitations.consume(db, invitation.id):
            raise DomainError(
                DomainErrorCode.INVALID_INVITATION, "邀请码已用尽或已失效", status_code=400
            )

        user = User(
            username=normalized,
            display_name=display_name.strip(),
            password_hash=hash_password(password),
            role=UserRole.USER.value,
            must_change_password=False,
            is_active=True,
            email=email,
        )
        try:
            self.users.add(db, user)
        except IntegrityError as exc:
            # check-then-insert 竞态：并发注册同名用户时会撞 users.username 唯一索引。
            # 必须转成 409（而非让 IntegrityError 冒泡成 500）
            db.rollback()
            raise DomainError(
                DomainErrorCode.CONFLICT, "用户名已被占用", status_code=409
            ) from exc

        self.audit.add(
            db,
            action=AuditAction.REGISTERED.value,
            owner_user_id=user.id,
            actor_user_id=user.id,
            resource_type="user",
            resource_id=str(user.id),
        )
        return user

    def _match_invitation(self, db: Session, plaintext: str) -> InvitationCode:
        """明文不落库，故按**前缀**找候选，再逐条比对哈希。"""
        normalized = "".join(ch for ch in (plaintext or "").upper() if ch.isalnum())
        if len(normalized) < INVITATION_CODE_PREFIX_LEN:
            raise DomainError(DomainErrorCode.INVALID_INVITATION, "邀请码无效", status_code=400)
        prefix = normalized[:INVITATION_CODE_PREFIX_LEN]
        for row in self.invitations.find_candidates(db, prefix):
            if verify_invitation_code(normalized, row.code_hash):
                if row.status() != "active":
                    raise DomainError(
                        DomainErrorCode.INVALID_INVITATION, "邀请码已失效", status_code=400
                    )
                return row
        raise DomainError(DomainErrorCode.INVALID_INVITATION, "邀请码无效", status_code=400)

    # ---------------------------------------------------------------- 登录
    def login(
        self,
        db: Session,
        username: str,
        password: str,
        *,
        client_ip: str | None = None,
        user_agent: str | None = None,
    ) -> tuple[str, datetime, User]:
        user = self.users.by_username(db, username)
        if user is None or not verify_password(password, user.password_hash):
            raise DomainError(DomainErrorCode.UNAUTHORIZED, "用户名或密码错误", status_code=401)
        if not user.is_active:
            raise DomainError(DomainErrorCode.FORBIDDEN, "账号已停用", status_code=403)

        # 顺带升级哈希参数
        if password_needs_rehash(user.password_hash):
            user.password_hash = hash_password(password)
        user.last_login_at = utc_now()

        token, prefix, token_hash = generate_session_token()
        expires_at = utc_after_hours(get_settings().session_ttl_hours)
        self.sessions.add(
            db,
            AuthSession(
                user_id=user.id,
                token_hash=token_hash,
                token_prefix=prefix,
                expires_at=expires_at,
                client_ip=client_ip,
                user_agent=(user_agent or "")[:255] or None,
            ),
        )
        self.audit.add(
            db,
            action=AuditAction.LOGIN.value,
            owner_user_id=user.id,
            actor_user_id=user.id,
            resource_type="user",
            resource_id=str(user.id),
        )
        return token, expires_at, user

    # ---------------------------------------------------------------- 校验
    def user_by_token(self, db: Session, token: str) -> User | None:
        from ..core.security import hash_token

        row = self.sessions.by_token_hash(db, hash_token(token))
        if row is None or row.revoked_at is not None:
            return None
        if row.expires_at <= utc_now():
            return None
        user = self.users.get(db, row.user_id)
        if user is None or not user.is_active:
            return None
        return user

    def session_by_token(self, db: Session, token: str) -> AuthSession | None:
        from ..core.security import hash_token

        return self.sessions.by_token_hash(db, hash_token(token))

    # ---------------------------------------------------------------- 登出
    def logout(self, db: Session, token: str) -> None:
        row = self.session_by_token(db, token)
        if row is None:
            return
        self.sessions.revoke(db, row.id)
        self.audit.add(
            db,
            action=AuditAction.LOGOUT.value,
            owner_user_id=row.user_id,
            actor_user_id=row.user_id,
        )

    # ---------------------------------------------------------------- 改密
    def change_password(
        self,
        db: Session,
        user: User,
        *,
        old_password: str,
        new_password: str,
        keep_session_id: int | None = None,
    ) -> None:
        if not verify_password(old_password, user.password_hash):
            raise DomainError(DomainErrorCode.UNAUTHORIZED, "原密码不正确", status_code=401)
        validate_password_strength(new_password)
        if verify_password(new_password, user.password_hash):
            raise DomainError(
                DomainErrorCode.VALIDATION_FAILED, "新密码不能与原密码相同", status_code=422
            )

        user.password_hash = hash_password(new_password)
        user.must_change_password = False
        # 强制改密握手完成后，踢掉除当前会话外的全部会话
        self.sessions.revoke_all(db, user.id, keep_session_id=keep_session_id)
        self.audit.add(
            db,
            action=AuditAction.PASSWORD_CHANGED.value,
            owner_user_id=user.id,
            actor_user_id=user.id,
            resource_type="user",
            resource_id=str(user.id),
        )
