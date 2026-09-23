"""记忆与复盘记录。查询一律带 owner_user_id。"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Memory, MemoryReflection


class MemoryRepository:
    def active_for(
        self, db: Session, *, owner_user_id: int, counterpart_key: str
    ) -> list[Memory]:
        """当前仍有效、且属于这个对象（或全局）的记忆。新的在前。"""
        stmt = (
            select(Memory)
            .where(
                Memory.owner_user_id == owner_user_id,
                Memory.valid_to.is_(None),
            )
            .order_by(Memory.id.desc())
        )
        rows = list(db.scalars(stmt))
        kept = [
            row
            for row in rows
            if row.subject in ("me", "relation")
            or (row.subject == "other" and row.counterpart_key == counterpart_key and row.counterpart_key)
        ]
        # 雷区优先于偏好，同类里新的在前。预算不够时先丢掉不那么要紧的。
        rank = {"雷区": 0, "事件": 1, "情绪模式": 2, "偏好": 3}
        kept.sort(key=lambda row: (rank.get(row.category, 4), -row.id))
        return kept

    def list_active(
        self, db: Session, *, owner_user_id: int, limit: int = 50, offset: int = 0
    ) -> tuple[list[Memory], int]:
        """该用户全部仍有效的记忆，新的在前。返回 (本页, 总数)。"""
        from sqlalchemy import func

        where = (Memory.owner_user_id == owner_user_id, Memory.valid_to.is_(None))
        total = int(db.scalar(select(func.count()).select_from(Memory).where(*where)) or 0)
        stmt = (
            select(Memory).where(*where).order_by(Memory.id.desc()).limit(limit).offset(offset)
        )
        return list(db.scalars(stmt)), total

    def get(self, db: Session, *, owner_user_id: int, memory_id: int) -> Memory | None:
        stmt = select(Memory).where(
            Memory.id == memory_id, Memory.owner_user_id == owner_user_id
        )
        return db.scalars(stmt).first()

    def add(self, db: Session, row: Memory) -> Memory:
        db.add(row)
        db.flush()
        return row


class ReflectionRepository:
    def get(
        self, db: Session, *, owner_user_id: int, reflection_id: int
    ) -> MemoryReflection | None:
        stmt = select(MemoryReflection).where(
            MemoryReflection.id == reflection_id,
            MemoryReflection.owner_user_id == owner_user_id,
        )
        return db.scalars(stmt).first()

    def newer_open(
        self, db: Session, *, owner_user_id: int, reflection_id: int
    ) -> MemoryReflection | None:
        """比指定记录更新、且尚未撤销的复盘。撤销必须从最新一次开始。"""
        stmt = (
            select(MemoryReflection)
            .where(
                MemoryReflection.owner_user_id == owner_user_id,
                MemoryReflection.id > reflection_id,
                MemoryReflection.reverted_at.is_(None),
            )
            .order_by(MemoryReflection.id.desc())
            .limit(1)
        )
        return db.scalars(stmt).first()

    def list_for(
        self, db: Session, *, owner_user_id: int, limit: int = 20
    ) -> list[MemoryReflection]:
        stmt = (
            select(MemoryReflection)
            .where(MemoryReflection.owner_user_id == owner_user_id)
            .order_by(MemoryReflection.id.desc())
            .limit(limit)
        )
        return list(db.scalars(stmt))

    def add(self, db: Session, row: MemoryReflection) -> MemoryReflection:
        db.add(row)
        db.flush()
        return row
