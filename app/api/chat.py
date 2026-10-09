"""聊天判断与记忆复盘。"""

from __future__ import annotations

import json
from collections.abc import Iterator

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..core.db import SessionLocal, get_db
from ..domain.errors import DomainError, DomainErrorCode, error_body
from ..domain.schemas.analyze import (
    AnalyzeView,
    ClarifyRequest,
    ConversationRef,
    EvaluateRequest,
    ExplainRequest,
    PolishRequest,
    ReplyRequest,
    ReplyStreamRequest,
)
from ..repositories.conversations_repo import ConversationRepository
from ..repositories.models import User
from ..services.activity_service import mark_stream_result
from ..services.analyze_service import AnalyzeService
from ..services.memory_service import MemoryService
from ..services.reply_service import ReplyService
from .deps import require_active_user

router = APIRouter(prefix="/api/chat", tags=["chat"])

_SUBJECT_LABEL = {"me": "我", "other": "对方", "relation": "关系"}

_conversations = ConversationRepository()
_analyze = AnalyzeService()
_memory = MemoryService()
_reply = ReplyService()


@router.get("/memories")
def list_memories(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    from ..core.time import iso_utc

    rows, total = _memory.list_all_active(
        db, owner_user_id=user.id, limit=limit, offset=offset
    )
    return {
        "total": total,
        "items": [
            {
                "id": row.id,
                "subject": _SUBJECT_LABEL.get(row.subject, row.subject),
                "category": row.category,
                "content": row.content,
                "counterpart_key": row.counterpart_key,
                "created_at": iso_utc(row.created_at) or "",
            }
            for row in rows
        ],
    }


@router.get("/reflections")
def list_reflections(
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> list[dict]:
    return [_reflection_view(row) for row in _memory.list_reflections(db, owner_user_id=user.id)]


@router.delete("/memories/{memory_id}", status_code=204)
def forget_memory(
    memory_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> Response:
    _memory.forget(db, owner_user_id=user.id, memory_id=memory_id)
    return Response(status_code=204)


@router.post("/analyze", response_model=AnalyzeView)
def analyze(
    payload: ConversationRef,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> AnalyzeView:
    conversation = _conversation_or_404(
        db, owner_user_id=user.id, conversation_id=payload.conversation_id
    )

    view = _analyze.analyze(
        db,
        owner_user_id=user.id,
        conversation=conversation,
        trace_id=getattr(request.state, "trace_id", ""),
    )
    return AnalyzeView(**view)


def _conversation_or_404(db: Session, *, owner_user_id: int, conversation_id: int):
    conversation = _conversations.get(
        db, owner_user_id=owner_user_id, conversation_id=conversation_id
    )
    if conversation is None:
        raise DomainError(DomainErrorCode.NOT_FOUND, "会话不存在", status_code=404)
    return conversation


@router.post("/reflect")
def reflect(
    payload: ConversationRef,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    conversation = _conversation_or_404(
        db, owner_user_id=user.id, conversation_id=payload.conversation_id
    )
    row = _memory.reflect(
        db,
        owner_user_id=user.id,
        conversation=conversation,
        trace_id=getattr(request.state, "trace_id", ""),
    )
    return _reflection_view(row)


@router.post("/reflect/{reflection_id}/revert")
def revert_reflect(
    reflection_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    row = _memory.revert(db, owner_user_id=user.id, reflection_id=reflection_id)
    return _reflection_view(row)


@router.post("/reply")
def reply(
    payload: ReplyRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    conversation = _conversation_or_404(
        db, owner_user_id=user.id, conversation_id=payload.conversation_id
    )
    return _reply.draft(
        db,
        owner_user_id=user.id,
        conversation=conversation,
        decision=payload.decision,
        trace_id=getattr(request.state, "trace_id", ""),
    )


def _frame(payload: dict) -> str:
    """SSE 单帧：一行 data 加一个空行。"""
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


@router.post("/reply/stream")
def reply_stream(
    payload: ReplyStreamRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> StreamingResponse:
    """流式自动回复：解读 → 评分 → 起草 → 排序，按阶段推给前端。

    会话不存在这类校验错误在开流前抛出，仍是普通 404 JSON；开流后的
    上游错误已经改不了状态码，改用 error 事件下发。
    """
    _conversation_or_404(db, owner_user_id=user.id, conversation_id=payload.conversation_id)
    trace_id = getattr(request.state, "trace_id", "")
    owner_user_id = user.id
    conversation_id = payload.conversation_id
    target_member = payload.target_member.strip()

    def events() -> Iterator[str]:
        # 会话在生成器内自建并重取：生成器的执行时机与请求依赖的清理时机无关
        db_stream = SessionLocal()
        try:
            conversation = _conversations.get(
                db_stream, owner_user_id=owner_user_id, conversation_id=conversation_id
            )
            if conversation is None:
                raise DomainError(DomainErrorCode.NOT_FOUND, "会话不存在", status_code=404)
            for event in _reply.reply_events(
                db_stream,
                owner_user_id=owner_user_id,
                conversation=conversation,
                target_member=target_member,
                trace_id=trace_id,
            ):
                if event.get("stage") == "done":
                    # 排序没走成只是降级（候选仍按起草顺序给出），不算失败
                    ranked = (event.get("payload") or {}).get("ranked")
                    mark_stream_result(
                        trace_id, owner_user_id,
                        level="warn" if ranked is False else "info",
                        label="生成候选回复",
                    )
                yield _frame(event)
        except DomainError as exc:
            mark_stream_result(
                trace_id, owner_user_id, level="error", error_code=exc.code.value,
                label="生成候选回复",
            )
            yield _frame({"stage": "error", "error": error_body(exc, trace_id)})
        except Exception:
            mark_stream_result(
                trace_id, owner_user_id, level="error", error_code="INTERNAL_ERROR",
                label="生成候选回复",
            )
            raise
        finally:
            db_stream.close()

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/evaluate")
def evaluate(
    payload: EvaluateRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    conversation = _conversation_or_404(
        db, owner_user_id=user.id, conversation_id=payload.conversation_id
    )
    return _reply.evaluate(
        db, owner_user_id=user.id, conversation=conversation, text=payload.text,
        trace_id=getattr(request.state, "trace_id", ""),
    )


@router.post("/clarify")
def clarify(
    payload: ClarifyRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    conversation = _conversation_or_404(
        db, owner_user_id=user.id, conversation_id=payload.conversation_id
    )
    return _reply.clarify(
        db, owner_user_id=user.id, conversation=conversation,
        trace_id=getattr(request.state, "trace_id", ""),
    )


@router.post("/explain")
def explain(
    payload: ExplainRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    conversation = _conversation_or_404(
        db, owner_user_id=user.id, conversation_id=payload.conversation_id
    )
    return _reply.explain(
        db, owner_user_id=user.id, conversation=conversation, decision=payload.decision,
        trace_id=getattr(request.state, "trace_id", ""),
    )


@router.post("/polish")
def polish(
    payload: PolishRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    return _reply.polish(
        db, owner_user_id=user.id, text=payload.text, kind=payload.kind,
        trace_id=getattr(request.state, "trace_id", ""),
    )


def _reflection_view(row) -> dict:
    import json

    from ..core.time import iso_utc

    try:
        changes = json.loads(row.changes or "[]")
    except json.JSONDecodeError:
        changes = []
    return {
        "id": row.id,
        "trace_id": row.trace_id,
        "scope": row.scope,
        "changes": changes,
        "applied": row.applied,
        "reverted_at": iso_utc(row.reverted_at),
        "model": row.model,
    }
