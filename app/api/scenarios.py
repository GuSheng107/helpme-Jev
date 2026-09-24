"""场景接口：查看内置配置，管理个人场景与生成题集。"""

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
from ..scenarios.reply_prompts import DEFAULT_CUSTOM_DRAFT_PROMPT
from ..services.scenario_generation_service import generate_question_set
from ..services.scenario_service import (
    effective_prompt,
    validate_persona_questions,
    validate_questions,
)
from .deps import require_active_user

router = APIRouter(prefix="/api/scenarios", tags=["scenarios"])


class ScenarioCreate(StrictModel):
    name: str = Field(min_length=1, max_length=64)
    base_scenario_id: int | None = Field(default=None, ge=1)
    description: str | None = Field(default=None, max_length=500)
    system_prompt: str | None = Field(default=None, max_length=10000)
    judge_questions: str | None = Field(default=None, min_length=2, max_length=200000)
    persona_questions: str | None = Field(default=None, min_length=2, max_length=200000)


class ScenarioUpdate(StrictModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    description: str | None = Field(default=None, max_length=500)
    system_prompt: str | None = Field(default=None, max_length=10000)
    judge_questions: str | None = Field(default=None, min_length=2, max_length=200000)
    persona_questions: str | None = Field(default=None, min_length=2, max_length=200000)


class ScenarioGenerate(StrictModel):
    kind: str = Field(pattern="^(judge|persona)$")
    name: str = Field(min_length=1, max_length=64)
    description: str = Field(default="", max_length=500)
    requirements: str = Field(default="", max_length=2000)


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


@router.post("/generate-questions")
def generate_questions(
    payload: ScenarioGenerate,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    return {"questions": generate_question_set(
        db,
        owner_user_id=user.id,
        kind=payload.kind,
        name=payload.name.strip(),
        description=payload.description.strip(),
        requirements=payload.requirements.strip(),
    )}


@router.post("", status_code=201)
def create_scenario(
    payload: ScenarioCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    # 旧调用只传名字时仍从恋爱场景复制；传两套题集时可从空白创建。
    base = (
        _base_or_default(db, user, payload.base_scenario_id)
        if payload.base_scenario_id is not None or payload.judge_questions is None
        else None
    )
    if base is None and payload.persona_questions is None:
        raise DomainError(
            DomainErrorCode.VALIDATION_FAILED,
            "从空白创建时需要判断题集和人设题集",
            status_code=422,
        )
    judge = payload.judge_questions
    if judge is None and base is not None:
        questions = json.loads(base.judge_questions or "{}")
        if base.is_builtin:
            pack = pack_for(base.kind)
            questions = {
                key: _enriched(key, question, pack)
                for key, question in questions.items()
            }
        judge = json.dumps(questions, ensure_ascii=False)
    persona = payload.persona_questions or (base.persona_questions if base else "{}")
    _validate_set(judge or "{}", persona=False)
    _validate_set(persona, persona=True)
    prompt = (payload.system_prompt or "").strip()
    if not prompt:
        prompt = effective_prompt(base) if base else DEFAULT_CUSTOM_DRAFT_PROMPT
    description = (
        payload.description.strip() if payload.description is not None
        else f"复制自「{base.name}」" if base else ""
    )
    row = Scenario(
        owner_user_id=user.id,
        slug=f"custom-{uuid4().hex[:12]}",
        name=payload.name.strip(),
        kind="custom",
        description=description,
        judge_questions=judge,
        persona_questions=persona,
        system_prompt=prompt,
        rank_min=base.rank_min if base else 3,
        rank_max=base.rank_max if base else 5,
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
    row = _own_or_404(db, user, scenario_id)
    if payload.name is not None:
        row.name = payload.name.strip()
    if payload.description is not None:
        row.description = payload.description.strip()
    if payload.judge_questions is not None:
        _validate_set(payload.judge_questions, persona=False)
        row.judge_questions = payload.judge_questions
    if payload.persona_questions is not None:
        _validate_set(payload.persona_questions, persona=True)
        row.persona_questions = payload.persona_questions
    if payload.system_prompt is not None:
        row.system_prompt = payload.system_prompt.strip() or DEFAULT_CUSTOM_DRAFT_PROMPT
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
    judge = row.judge_questions
    if row.is_builtin:
        pack = pack_for(row.kind)
        judge = json.dumps({
            key: _enriched(key, question, pack)
            for key, question in json.loads(judge or "{}").items()
        }, ensure_ascii=False)
    return {
        "id": row.id,
        "slug": row.slug,
        "name": row.name,
        "kind": row.kind,
        "description": row.description,
        "is_builtin": row.is_builtin,
        "system_prompt": effective_prompt(row),
        "judge_questions": judge,
        "persona_questions": row.persona_questions,
    }


def _validate_set(raw: str, *, persona: bool) -> None:
    try:
        if persona:
            validate_persona_questions(raw)
        else:
            validate_questions(raw)
    except ValueError as exc:
        raise DomainError(DomainErrorCode.VALIDATION_FAILED, str(exc), status_code=422) from exc


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
