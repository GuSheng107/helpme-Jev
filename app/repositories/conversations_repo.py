"""会话与消息数据访问。

**所有查询都强制带 ``owner_user_id``** —— 这是越权隔离的第一道也是最重要的一道防线。
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import Conversation, Message, SessionSummary


class ConversationRepository:
    def get(
        self, db: Session, *, owner_user_id: int, conversation_id: int
    ) -> Conversation | None:
        """按 (owner, id) 取会话 —— 拿不到别人的会话。"""
        stmt = select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.owner_user_id == owner_user_id,
        )
        return db.scalars(stmt).first()

    def list_all(self, db: Session, *, owner_user_id: int) -> list[Conversation]:
        stmt = (
            select(Conversation)
            .where(Conversation.owner_user_id == owner_user_id)
            .order_by(Conversation.updated_at.desc(), Conversation.id.desc())
        )
        return list(db.scalars(stmt))

    def by_counterpart_key(
        self, db: Session, *, owner_user_id: int, counterpart_key: str
    ) -> list[Conversation]:
        stmt = select(Conversation).where(
            Conversation.owner_user_id == owner_user_id,
            Conversation.counterpart_key == counterpart_key,
        )
        return list(db.scalars(stmt))

    def add(self, db: Session, row: Conversation) -> Conversation:
        db.add(row)
        db.flush()
        return row

    def delete(self, db: Session, row: Conversation) -> None:
        db.delete(row)
        db.flush()


class MessageRepository:
    def get(self, db: Session, message_id: int) -> Message | None:
        return db.get(Message, message_id)

    def list_by_conversation(
        self,
        db: Session,
        *,
        conversation_id: int,
        limit: int | None = None,
        after_seq: int | None = None,
    ) -> list[Message]:
        """按 seq 正序返回消息。

        ``limit`` 语义是"取**最近** N 条"（故先倒序取再翻正），
        且 ``after_seq`` 条件在两种分支下都必须生效。
        """

        def _filtered():
            stmt = select(Message).where(Message.conversation_id == conversation_id)
            if after_seq is not None:
                stmt = stmt.where(Message.seq > after_seq)
            return stmt

        if limit is None:
            return list(db.scalars(_filtered().order_by(Message.seq.asc(), Message.id.asc())))

        recent = (
            _filtered().order_by(Message.seq.desc(), Message.id.desc()).limit(limit)
        )
        return list(reversed(list(db.scalars(recent))))

    def count(self, db: Session, *, conversation_id: int) -> int:
        return int(
            db.scalar(
                select(func.count()).select_from(Message).where(
                    Message.conversation_id == conversation_id
                )
            )
            or 0
        )

    def next_seq(self, db: Session, *, conversation_id: int) -> int:
        current = db.scalar(
            select(func.max(Message.seq)).where(Message.conversation_id == conversation_id)
        )
        return int(current or 0) + 1

    def add(self, db: Session, row: Message) -> Message:
        db.add(row)
        db.flush()
        return row

    def delete(self, db: Session, row: Message) -> None:
        db.delete(row)
        db.flush()


class SummaryRepository:
    def add(self, db: Session, row: SessionSummary) -> SessionSummary:
        db.add(row)
        db.flush()
        return row

    def latest(self, db: Session, *, conversation_id: int) -> SessionSummary | None:
        stmt = (
            select(SessionSummary)
            .where(SessionSummary.conversation_id == conversation_id)
            .order_by(SessionSummary.upto_seq.desc())
            .limit(1)
        )
        return db.scalars(stmt).first()
