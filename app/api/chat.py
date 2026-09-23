"""聊天判断与记忆复盘。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..domain.errors import DomainError, DomainErrorCode
from ..domain.schemas.analyze import AnalyzeView, ConversationRef
from ..repositories.conversations_repo import ConversationRepository
from ..repositories.models import User
from ..services.analyze_service import AnalyzeService
from ..services.memory_service import MemoryService
from .deps import require_active_user

router = APIRouter(prefix="/api/chat", tags=["chat"])

_SUBJECT_LABEL = {"me": "我", "other": "对方", "relation": "关系"}

_conversations = ConversationRepository()
_analyze = AnalyzeService()
_memory = MemoryService()


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
