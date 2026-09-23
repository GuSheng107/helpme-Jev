"""知识域模型：记忆条目、复盘记录、人设档案、QA 对、素材。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ...core.db import Base
from .base import TimestampMixin


class Memory(Base, TimestampMixin):
    """记忆条目 —— **用户级**：按用户隔离，但**不区分聊天对象**（跨会话共享）。

    对象归属（皇上 2026-09-23 定）：

    - ``subject`` 为 ``me`` / ``relation`` 时，``counterpart_key`` **留空 = 全局共享**
    - ``subject`` 为 ``other`` 时，``counterpart_key`` **带对象标识**，
      装配 background 时按当前对象过滤 —— 否则"她喜欢可颂"会串到别的对象会话里

    时序设计（借鉴 Zep / Graphiti）：变更**不覆盖**，旧的置 ``valid_to``（INVALIDATE），
    历史保留可追溯。
    """

    __tablename__ = "memories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    subject: Mapped[str] = mapped_column(String(16), nullable=False, default="relation")
    counterpart_key: Mapped[str] = mapped_column(
        String(128), nullable=False, default="", index=True
    )
    category: Mapped[str] = mapped_column(String(32), nullable=False, default="其他", index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    valid_from: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    valid_to: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="reflection")
    evidence: Mapped[str] = mapped_column(Text, nullable=False, default="[]")


class MemoryReflection(Base, TimestampMixin):
    """复盘记录：一次 LLM 复盘产出的记忆变更集，**可回溯、可撤销**。"""

    __tablename__ = "memory_reflections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    trace_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False, default="")
    scope: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    changes: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    applied: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    reverted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    model: Mapped[str] = mapped_column(String(128), nullable=False, default="")


class Persona(Base, TimestampMixin):
    """人设档案 —— 按「聊天对象 × 情境」区分（与记忆相反）。

    同一个人可能既是恋爱对象又是职场协作方：``counterpart_key`` 相同、
    ``context`` 不同，各建一份，互不覆盖。``traits`` 存结构化人格维度，
    ``confidence`` 不足时**保留旧档案不覆盖**。
    """

    __tablename__ = "personas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    counterpart_key: Mapped[str] = mapped_column(String(128), index=True, nullable=False, default="")
    subject: Mapped[str] = mapped_column(String(8), nullable=False, default="other")  # me | other
    context: Mapped[str] = mapped_column(
        String(16), nullable=False, default="romance", index=True
    )  # romance | workplace
    traits: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    evidence: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class QaPair(Base, TimestampMixin):
    """用户提交的 QA 对（JSON 批量导入）。**用户直给，置信度高于自动抽取**。"""

    __tablename__ = "qa_pairs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    conversation_id: Mapped[int | None] = mapped_column(
        ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True
    )
    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    tags: Mapped[str] = mapped_column(Text, nullable=False, default="[]")


class Material(Base, TimestampMixin):
    """建模素材：聊天截图（原文交多模态 LLM，**系统不做 OCR**）/ 聊天记录导入。"""

    __tablename__ = "materials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    conversation_id: Mapped[int | None] = mapped_column(
        ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # screenshot | chat_import
    file_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    mime: Mapped[str | None] = mapped_column(String(64), nullable=True)
    bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    parsed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    retention: Mapped[str] = mapped_column(String(16), nullable=False, default="discard")
