"""统一活动日志接口：只能查自己的（管理员亦不可查他人）。"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.time import iso_utc, to_naive_utc
from ..domain.enums import ActivityCategory, CallLogLevel
from ..repositories.models import ActivityLog, CallLog, User
from .deps import require_active_user

router = APIRouter(prefix="/api/logs", tags=["logs"])


@router.get("/stats")
def log_stats(
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict[str, int]:
    """首页只取出了结果的聊天分析和通用决策数量（降级但有结果也算）。"""
    count = db.scalar(
        select(func.count())
        .select_from(CallLog)
        .where(
            CallLog.owner_user_id == user.id,
            CallLog.kind == "jev",
            CallLog.phase.in_(("analyze", "decide")),
            CallLog.level.in_((CallLogLevel.INFO.value, CallLogLevel.WARN.value)),
            CallLog.status_code >= 200,
            CallLog.status_code < 400,
        )
    )
    return {"judgment_count": int(count or 0)}


@router.get("")
def list_logs(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    level: CallLogLevel | None = Query(default=None),
    category: ActivityCategory | None = Query(default=None),
    trace_id: str = Query(default="", max_length=64),
    start_time: datetime | None = Query(default=None),
    end_time: datetime | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    """按时间倒序查询自己的统一日志。查询本身不写活动日志。"""
    start = to_naive_utc(start_time)
    end = to_naive_utc(end_time)
    if start is not None and end is not None and start > end:
        raise HTTPException(status_code=422, detail="开始时间不能晚于结束时间")

    conditions = [ActivityLog.owner_user_id == user.id]
    if level is not None:
        conditions.append(ActivityLog.level == level.value)
    if category is not None:
        conditions.append(ActivityLog.category == category.value)
    if trace_id.strip():
        conditions.append(ActivityLog.trace_id == trace_id.strip())
    if start is not None:
        conditions.append(ActivityLog.created_at >= start)
    if end is not None:
        conditions.append(ActivityLog.created_at <= end)

    total = db.scalar(select(func.count()).select_from(ActivityLog).where(*conditions))
    rows = db.scalars(
        select(ActivityLog)
        .where(*conditions)
        .order_by(ActivityLog.created_at.desc(), ActivityLog.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()

    return {
        "total": int(total or 0),
        "items": [
            {
                "id": row.id,
                "trace_id": row.trace_id,
                "category": row.category,
                "source": row.source,
                "level": row.level,
                "summary": row.summary,
                "detail": row.detail,
                "status_code": row.status_code,
                "latency_ms": row.latency_ms,
                "error_code": row.error_code,
                "created_at": iso_utc(row.created_at) or "",
            }
            for row in rows
        ],
    }
