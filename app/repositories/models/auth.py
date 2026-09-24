"""认证域模型：用户、会话、邀请码。

安全要点：

- ``User.password_hash`` 存 Argon2id（PHC 编码）
- ``AuthSession.token_hash`` 只存 SHA256，**明文 token 只在登录响应里出现一次**
- ``InvitationCode`` 存明文以支持管理员重复复制；应限制数据库访问。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ...core.db import Base
from .base import TimestampMixin, utc_now


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="user")
    must_change_password: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    disabled_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    avatar_base64: Mapped[str] = mapped_column(Text, nullable=False, default="")

    sessions: Mapped[list["AuthSession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class AuthSession(Base, TimestampMixin):
    """服务端会话：8 小时固定过期，**无滑动续期**；登出为软撤销。"""

    __tablename__ = "auth_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    token_prefix: Mapped[str] = mapped_column(String(16), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    client_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)

    user: Mapped[User] = relationship(back_populates="sessions")


class InvitationCode(Base, TimestampMixin):
    """邀请码：注册的唯一入口（皇上要求保留此机制）。"""

    __tablename__ = "invitation_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    code_prefix: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    max_uses: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    used_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by_user_id: Mapped[int] = mapped_column(Integer, nullable=False)

    def status(self) -> str:
        """active / revoked / expired / exhausted。"""
        if self.revoked_at is not None:
            return "revoked"
        if self.expires_at is not None and self.expires_at <= utc_now():
            return "expired"
        if self.used_count >= self.max_uses:
            return "exhausted"
        return "active"
