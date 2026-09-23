"""场景列表：新建会话时选「恋爱 / 职场」用。

只读接口；自定义场景的增删改留到后续里程碑。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..repositories.models import Scenario, User
from .deps import require_active_user

router = APIRouter(prefix="/api/scenarios", tags=["scenarios"])


@router.get("")
def list_scenarios(
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> list[dict]:
    rows = db.scalars(
        select(Scenario)
        .where((Scenario.owner_user_id.is_(None)) | (Scenario.owner_user_id == user.id))
        .order_by(Scenario.id)
    ).all()
    return [
        {
            "id": row.id,
            "slug": row.slug,
            "name": row.name,
            "kind": row.kind,
            "description": row.description,
            "is_builtin": row.is_builtin,
        }
        for row in rows
    ]
