"""调用日志接口：只能查自己的（admin 亦不可查他人，皇上明令）。"""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.time import utc_now
from ..repositories.models import CallLog, User
from .deps import require_active_user

router = APIRouter(prefix="/api/logs", tags=["logs"])


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
    kind: str | None = Query(default=None, pattern="^(jev|llm)$"),
    trace_id: str = Query(default="", max_length=64),
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    """按时间倒序；可按 trace_id / kind 过滤。"""
    conditions = [CallLog.owner_user_id == user.id]
    if kind:
        conditions.append(CallLog.kind == kind)
    if trace_id.strip():
        conditions.append(CallLog.trace_id == trace_id.strip())

    total = db.scalar(
        select(func.count()).select_from(CallLog).where(*conditions)
    )
    rows = db.scalars(
        select(CallLog)
        .where(*conditions)
        .order_by(CallLog.created_at.desc(), CallLog.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    from ..core.time import iso_utc

    return {
        "total": int(total or 0),
        "items": [
            {
                "id": row.id,
                "trace_id": row.trace_id,
                "kind": row.kind,
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
