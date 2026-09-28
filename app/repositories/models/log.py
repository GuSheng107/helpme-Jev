"""日志域模型：统一活动日志及供统计、历史回溯使用的原始日志。

权限红线：用户只能查自己的活动日志，管理员也不可查看他人日志。
"""

from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ...core.db import Base
from .base import TimestampMixin


class CallLog(Base, TimestampMixin):
    """调用日志：JEV / LLM 的**原始请求与响应**。

    明文入库（皇上定），但写入前必经脱敏管线 —— 凭据字段为 ``[REDACTED]``，
    ``Authorization`` 整条不入库。单条 body 超限即截断并置 ``truncated``。
    """

    __tablename__ = "call_logs"
    __table_args__ = (
        Index("ix_call_logs_owner_created", "owner_user_id", "created_at"),
        Index("ix_call_logs_trace", "trace_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    trace_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    request_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    kind: Mapped[str] = mapped_column(String(8), nullable=False)  # jev | llm
    phase: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    level: Mapped[str] = mapped_column(String(8), nullable=False, default="info")
    endpoint_url: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    model: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    request_body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    response_body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    truncated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    error: Mapped[str] = mapped_column(Text, nullable=False, default="")


class AuditLog(Base, TimestampMixin):
    """审计日志：登录 / 改密 / 配置变更 / 邀请码治理 / 数据导出与注销等动作。"""

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    actor_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    action: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    resource_type: Mapped[str] = mapped_column(String(48), nullable=False, default="")
    resource_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    result: Mapped[str] = mapped_column(String(16), nullable=False, default="ok")
    request_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    meta: Mapped[str] = mapped_column(Text, nullable=False, default="{}")


class ActivityLog(Base, TimestampMixin):
    """日志页的唯一数据源：请求摘要与同一 trace 下的业务明细。"""

    __tablename__ = "activity_logs"
    __table_args__ = (
        Index("ix_activity_logs_owner_created", "owner_user_id", "created_at"),
        Index("ix_activity_logs_owner_category_created", "owner_user_id", "category", "created_at"),
        Index("ix_activity_logs_trace", "trace_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    trace_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    level: Mapped[str] = mapped_column(String(8), nullable=False, default="info")
    summary: Mapped[str] = mapped_column(String(240), nullable=False)
    detail: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_code: Mapped[str] = mapped_column(String(64), nullable=False, default="")
