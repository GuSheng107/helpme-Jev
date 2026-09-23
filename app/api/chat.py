"""聊天判断。P2 只做 analyze：粘贴过的话 → 决策面板。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..domain.errors import DomainError, DomainErrorCode
from ..domain.schemas.analyze import AnalyzeView
from ..repositories.conversations_repo import ConversationRepository
from ..repositories.models import User
from ..services.analyze_service import AnalyzeService
from .deps import require_active_user

router = APIRouter(prefix="/api/chat", tags=["chat"])

_conversations = ConversationRepository()
_analyze = AnalyzeService()


@router.post("/analyze", response_model=AnalyzeView)
def analyze(
    payload: dict,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> AnalyzeView:
    conversation_id = payload.get("conversation_id") if isinstance(payload, dict) else None
    if not isinstance(conversation_id, int):
        raise DomainError(
            DomainErrorCode.VALIDATION_FAILED, "缺少 conversation_id", status_code=422
        )
    conversation = _conversations.get(
        db, owner_user_id=user.id, conversation_id=conversation_id
    )
    if conversation is None:
        raise DomainError(DomainErrorCode.NOT_FOUND, "会话不存在", status_code=404)

    view = _analyze.analyze(
        db,
        owner_user_id=user.id,
        conversation=conversation,
        trace_id=getattr(request.state, "trace_id", ""),
    )
    return AnalyzeView(**view)
