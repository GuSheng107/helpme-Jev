"""配置与业务域模型：提供方配置、场景、会话、消息、摘要、追问。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.orm import relationship as orm_relationship

from ...core.db import Base
from .base import TimestampMixin


class ProviderConfig(Base, TimestampMixin):
    """用户的 JEV / LLM 配置。

    ``api_key_enc`` 是 ``hmj1.<ver>.<nonce>.<cipher+tag>`` 信封密文，
    接口**只进不出**（回显为掩码）。
    """

    __tablename__ = "provider_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(8), nullable=False)  # jev | llm
    name: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    endpoint_url: Mapped[str] = mapped_column(String(512), nullable=False)
    api_key_enc: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    supports_vision: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    context_window_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=64000)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class Scenario(Base, TimestampMixin):
    """场景 = 判断题目集 + 人设题目集 + 提示词。

    ``owner_user_id`` 为 ``NULL`` 表示**系统预设**（只读，所有用户可见）。
    """

    __tablename__ = "scenarios"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    slug: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="custom")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    judge_questions: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    persona_questions: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    rank_min: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    rank_max: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    is_builtin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class Conversation(Base, TimestampMixin):
    """一个聊天对象一条会话（人设按 ``counterpart_key`` 跨会话共用）。"""

    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    scenario_id: Mapped[int | None] = mapped_column(
        ForeignKey("scenarios.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    counterpart_key: Mapped[str] = mapped_column(String(128), index=True, nullable=False, default="")
    counterpart_name: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    relationship: Mapped[str] = mapped_column(String(64), nullable=False, default="")

    messages: Mapped[list["Message"]] = orm_relationship(
        back_populates="conversation", cascade="all, delete-orphan"
    )


class Message(Base, TimestampMixin):
    """会话消息。``source`` 区分手工输入与导入。

    ``(conversation_id, seq)`` 唯一 —— 防止并发 append 产出重复序号。
    """

    __tablename__ = "messages"
    __table_args__ = (
        UniqueConstraint("conversation_id", "seq", name="uq_messages_conversation_seq"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    role: Mapped[str] = mapped_column(String(8), nullable=False)  # me | other
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    attachments: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="manual")

    conversation: Mapped[Conversation] = orm_relationship(back_populates="messages")


class SessionSummary(Base, TimestampMixin):
    """滚动摘要：上下文逼近窗口上限时压缩历史。"""

    __tablename__ = "session_summaries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    upto_seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")


class Clarification(Base, TimestampMixin):
    """LLM 追问记录：可回溯"当时补了什么料"。"""

    __tablename__ = "clarifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    trace_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False, default="")
    questions: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    answers: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
