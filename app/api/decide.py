"""通用决策工作台接口。"""

from __future__ import annotations

import json
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import Field
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from ..core.config import get_settings
from ..core.db import get_db
from ..core.time import iso_utc, utc_now
from ..domain.enums import CallLogLevel
from ..domain.schemas.auth import StrictModel
from ..repositories.models import CallLog, User
from ..services.decide_service import DecideService
from .deps import require_active_user

router = APIRouter(prefix="/api/decide", tags=["decide"])

_decide = DecideService()

# 出了结果的级别：warn 只是结果被降级，仍算成功（失败才是 error）
_RESULT_LEVELS = (CallLogLevel.INFO.value, CallLogLevel.WARN.value)


class PolishDecisionRequest(StrictModel):
    question: str = Field(min_length=1, max_length=2000)
    question_type: Literal["noul", "choice", "score"]
    options: list[str] = Field(default_factory=list, max_length=10)
    context: str = Field(default="", max_length=2000)


class DecideRequest(StrictModel):
    question: str = Field(min_length=1, max_length=2000)
    question_type: Literal["noul", "choice", "score"]
    options: list[str] = Field(default_factory=list, max_length=10)
    context: str = Field(default="", max_length=2000)


@router.post("")
def decide(
    payload: DecideRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    return _decide.decide(
        db,
        owner_user_id=user.id,
        question=payload.question,
        question_type=payload.question_type,
        options=payload.options,
        context=payload.context,
        trace_id=getattr(request.state, "trace_id", ""),
    )


@router.post("/polish")
def polish_decision(
    payload: PolishDecisionRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    return _decide.polish(
        db,
        owner_user_id=user.id,
        question=payload.question,
        question_type=payload.question_type,
        options=payload.options,
        context=payload.context,
        trace_id=getattr(request.state, "trace_id", ""),
    )

def _body(raw: str) -> dict:
    try:
        parsed = json.loads(raw or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


@router.get("/history")
def decision_history(
    limit: int = Query(default=10, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    """从现有调用日志还原保留期内的决策任务，不另存任务数据。"""
    cutoff = utc_now() - timedelta(days=get_settings().retention_days)
    # 失败于翻译阶段的请求尚无 Jev 日志；旧日志用原始 question 字段识别。
    translation_failure = and_(
        CallLog.kind == "llm", CallLog.phase == "translate",
        CallLog.level == "error", CallLog.request_body.like('%"question"%'),
    )
    task_log = or_(
        and_(CallLog.kind == "jev", CallLog.phase == "decide"),
        translation_failure,
    )
    conditions = (CallLog.owner_user_id == user.id, CallLog.created_at >= cutoff, task_log)
    total = int(db.scalar(select(func.count()).select_from(CallLog).where(*conditions)) or 0)
    rows = db.scalars(
        select(CallLog).where(*conditions)
        .order_by(CallLog.created_at.desc(), CallLog.id.desc())
        .limit(limit).offset(offset)
    ).all()
    traces = [row.trace_id for row in rows if row.phase == "decide" and row.trace_id]
    paired = db.scalars(
        select(CallLog).where(
            CallLog.owner_user_id == user.id,
            CallLog.trace_id.in_(traces),
            CallLog.kind == "llm",
            CallLog.phase == "translate",
        ).order_by(CallLog.id.desc())
    ).all() if traces else []
    translation_by_trace = {}
    for row in paired:
        translation_by_trace.setdefault(row.trace_id, row)

    items = []
    for row in rows:
        request = _body(row.request_body)
        response = _body(row.response_body)
        source = request.get("user_input")
        if not isinstance(source, dict):
            source = (
                _body(translation_by_trace[row.trace_id].request_body)
                if row.trace_id in translation_by_trace else request
            )
        state = request.get("state") if isinstance(request.get("state"), dict) else {}
        questions = request.get("questions") if isinstance(request.get("questions"), dict) else {}
        decision = questions.get("decision") if isinstance(questions.get("decision"), dict) else {}
        kind = source.get("question_type") or decision.get("type") or "unknown"
        raw_options = source.get("options")
        if not isinstance(raw_options, list):
            criteria = decision.get("criteria")
            raw_options = list(criteria.values()) if isinstance(criteria, dict) else []
        options = [str(option) for option in raw_options]
        result = response.get("presented")
        if not isinstance(result, dict) and row.phase == "decide" and row.level in _RESULT_LEVELS:
            answers = response.get("answers") if isinstance(response.get("answers"), dict) else {}
            answer = answers.get("decision")
            if kind in ("noul", "choice", "score") and isinstance(answer, dict):
                try:
                    result = _decide._present(kind, answer, options)
                except Exception:
                    result = None
        if not isinstance(result, dict):
            result = None
        items.append({
            "id": row.id,
            "question": str(source.get("question") or state.get("question") or ""),
            "question_type": kind,
            "options": options,
            "context": str(source.get("context") or state.get("context") or ""),
            "status": "success" if row.level in _RESULT_LEVELS and result is not None else "error",
            "result": result,
            "error": row.error or ("历史结果无法还原" if row.level in _RESULT_LEVELS and result is None else ""),
            "model": row.model,
            "latency_ms": row.latency_ms,
            "created_at": iso_utc(row.created_at) or "",
        })
    return {"total": total, "items": items, "retention_days": get_settings().retention_days}
