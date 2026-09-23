"""通用决策工作台接口。"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import Field
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..domain.schemas.auth import StrictModel
from ..repositories.models import User
from ..services.decide_service import DecideService
from .deps import require_active_user

router = APIRouter(prefix="/api/decide", tags=["decide"])

_decide = DecideService()


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
