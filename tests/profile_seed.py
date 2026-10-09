"""人设前置规则下的测试播种辅助：直接落一行占位档案，建会话时引用。

规则（见 app/api/conversations.py）要求会话的对象/成员都在人设库有档案；
测试里不走向导（要 LLM），用这里直接播种。
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.repositories.models import PersonaProfile, User


def user_id_by_name(db: Session, username: str) -> int:
    return db.scalars(select(User.id).where(User.username == username)).one()


def seed_profile(
    db: Session,
    owner_user_id: int,
    key: str,
    *,
    nickname: str | None = None,
    context: str = "romance",
) -> int:
    """按 key 播种一行占位档案，返回 id；同 key 重复播种返回已有行。"""
    existing = db.scalars(
        select(PersonaProfile).where(
            PersonaProfile.owner_user_id == owner_user_id,
            PersonaProfile.key == key,
        )
    ).first()
    if existing is not None:
        return existing.id
    row = PersonaProfile(
        owner_user_id=owner_user_id,
        key=key,
        nickname=nickname or key,
        context=context,
        answers="{}",
        traits="{}",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row.id
