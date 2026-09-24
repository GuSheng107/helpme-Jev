"""调用日志接口：只能查自己的（admin 亦不可查他人，皇上明令）。"""

from __future__ import annotations

import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.time import iso_utc, to_naive_utc
from ..domain.enums import CallLogLevel
from ..repositories.models import CallLog, User
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


def _maybe_json(raw: str):
    """body 存的是 JSON 字符串；解析失败（截断等）原样返回。"""
    try:
        return json.loads(raw or "")
    except json.JSONDecodeError:
        return raw or ""


@router.get("")
def list_logs(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    level: str = Query(default="", pattern="^(|info|warn|error)$"),
    kind: str = Query(default="", pattern="^(|jev|llm)$"),
    phase: str = Query(default="", max_length=32),
    trace_id: str = Query(default="", max_length=64),
    start_time: datetime | None = Query(default=None),
    end_time: datetime | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    """按时间倒序查询自己的调用日志，支持类型、阶段和时间范围筛选。"""
    start = to_naive_utc(start_time)
    end = to_naive_utc(end_time)
    if start is not None and end is not None and start > end:
        raise HTTPException(status_code=422, detail="开始时间不能晚于结束时间")

    conditions = [CallLog.owner_user_id == user.id]
    if level:
        conditions.append(CallLog.level == level)
    if kind:
        conditions.append(CallLog.kind == kind)
    if phase.strip():
        conditions.append(CallLog.phase == phase.strip())
    if trace_id.strip():
        conditions.append(CallLog.trace_id == trace_id.strip())
    if start is not None:
        conditions.append(CallLog.created_at >= start)
    if end is not None:
        conditions.append(CallLog.created_at <= end)

    total = db.scalar(select(func.count()).select_from(CallLog).where(*conditions))
    rows = db.scalars(
        select(CallLog)
        .where(*conditions)
        .order_by(CallLog.created_at.desc(), CallLog.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()

    return {
        "total": int(total or 0),
        "items": [
            {
                "id": row.id,
                "trace_id": row.trace_id,
                "kind": row.kind,
                "level": row.level,
                "phase": row.phase,
                "model": row.model,
                "status_code": row.status_code,
                "latency_ms": row.latency_ms,
                "error": row.error,
                "truncated": row.truncated,
                "created_at": iso_utc(row.created_at) or "",
                "request": _maybe_json(row.request_body),
                "response": _maybe_json(row.response_body),
            }
            for row in rows
        ],
    }
