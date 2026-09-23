"""场景接口：内置场景只读列表 + 自定义场景的复制 / 编辑 / 删除。"""

from __future__ import annotations

import json
from uuid import uuid4

from fastapi import APIRouter, Depends
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..domain.errors import DomainError, DomainErrorCode
from ..domain.schemas.auth import StrictModel
from ..repositories.models import Scenario, User
from ..scenarios.packs import pack_for
from .deps import require_active_user

router = APIRouter(prefix="/api/scenarios", tags=["scenarios"])


class ScenarioCreate(StrictModel):
    name: str = Field(min_length=1, max_length=64)
    base_scenario_id: int | None = Field(default=None, ge=1)


class ScenarioUpdate(StrictModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    description: str | None = Field(default=None, max_length=500)
    # 题集以 JSON 字符串提交（结构校验在服务端）
    judge_questions: str | None = Field(default=None, min_length=2, max_length=200000)


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
    return [_view(row) for row in rows]


@router.post("", status_code=201)
def create_scenario(
    payload: ScenarioCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    base = _base_or_default(db, user, payload.base_scenario_id)
    judge = json.loads(base.judge_questions or "{}")
    if base.is_builtin:
        # 复制内置场景时带上中文标题与枚举标签，让这份 JSON 自解释、可编辑
        pack = pack_for(base.kind)
        judge = {
            key: _enriched(key, question, pack)
            for key, question in judge.items()
        }
    row = Scenario(
        owner_user_id=user.id,
        slug=f"custom-{uuid4().hex[:12]}",
        name=payload.name.strip(),
        kind="custom",
        description=f"复制自「{base.name}」",
        judge_questions=json.dumps(judge, ensure_ascii=False),
        persona_questions=base.persona_questions or "{}",
        rank_min=base.rank_min,
        rank_max=base.rank_max,
        is_builtin=False,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _view(row)


@router.patch("/{scenario_id}")
def update_scenario(
    scenario_id: int,
    payload: ScenarioUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    from ..services.scenario_service import validate_questions

    row = _own_or_404(db, user, scenario_id)
    if payload.name is not None:
        row.name = payload.name.strip()
    if payload.description is not None:
        row.description = payload.description.strip()
    if payload.judge_questions is not None:
        try:
            validate_questions(payload.judge_questions)
        except ValueError as exc:
            raise DomainError(DomainErrorCode.VALIDATION_FAILED, str(exc), status_code=422) from exc
        row.judge_questions = payload.judge_questions
    db.commit()
    db.refresh(row)
    return _view(row)


@router.delete("/{scenario_id}", status_code=204)
def delete_scenario(
    scenario_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> None:
    row = _own_or_404(db, user, scenario_id)
    db.delete(row)
    db.commit()


def _view(row: Scenario) -> dict:
    return {
        "id": row.id,
        "slug": row.slug,
        "name": row.name,
        "kind": row.kind,
        "description": row.description,
        "is_builtin": row.is_builtin,
        "judge_questions": row.judge_questions if not row.is_builtin else None,
        "persona_questions": None,
    }


def _base_or_default(db: Session, user: User, base_id: int | None) -> Scenario:
    if base_id is not None:
        row = db.get(Scenario, base_id)
        if row is None or (row.owner_user_id is not None and row.owner_user_id != user.id):
            raise DomainError(DomainErrorCode.NOT_FOUND, "场景不存在", status_code=404)
        return row
    row = db.scalars(
        select(Scenario).where(Scenario.owner_user_id.is_(None), Scenario.slug == "romance")
    ).first()
    if row is None:
        raise DomainError(DomainErrorCode.NOT_FOUND, "场景不存在", status_code=404)
    return row


def _own_or_404(db: Session, user: User, scenario_id: int) -> Scenario:
    row = db.get(Scenario, scenario_id)
    if row is None or row.is_builtin:
        raise DomainError(DomainErrorCode.NOT_FOUND, "场景不存在或不可修改", status_code=404)
    if row.owner_user_id != user.id:
        raise DomainError(DomainErrorCode.NOT_FOUND, "场景不存在或不可修改", status_code=404)
    return row


def _enriched(key: str, question: dict, pack) -> dict:
    item = dict(question)
    item["title"] = pack.question_titles.get(key, key)
    if question.get("type") == "choice":
        item["labels"] = {
            value: pack.label_of(key, value) for value in question.get("criteria", {})
        }
    return item
