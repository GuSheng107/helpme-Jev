"""人设档案：自评优先，对话推断次之；证据不足时不覆盖旧档案。"""

from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..clients import jev_client
from ..clients.translation import annotate
from ..core.time import iso_utc
from ..domain.errors import DomainError, DomainErrorCode
from ..repositories.conversations_repo import MessageRepository
from ..repositories.models import Conversation, Persona
from ..scenarios.persona_questions import (
    TRAIT_LABELS,
    WEAK_SCIENCE_TRAITS,
    persona_questions_for,
    trait_text,
)
from .analyze_service import RECENT_MESSAGE_LIMIT, AnalyzeService
from .image_service import image_context_contents
from .provider_service import ProviderService
from .scenario_service import kind_of

_messages = MessageRepository()
_providers = ProviderService()
_analyze = AnalyzeService()

MIN_CONFIDENCE = 0.45
SELF_REPORT_CONFIDENCE = 0.9


def _load(raw: str, fallback):
    try:
        return json.loads(raw or "")
    except json.JSONDecodeError:
        return fallback


def _percent(value: object) -> int:
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0
    return round(max(0.0, min(1.0, number)) * 100)


class PersonaService:
    def get(
        self,
        db: Session,
        *,
        owner_user_id: int,
        counterpart_key: str,
        subject: str,
        context: str = "romance",
    ) -> dict:
        row = self._find(
            db,
            owner_user_id=owner_user_id,
            counterpart_key=counterpart_key,
            subject=subject,
            context=context,
        )
        return self._view(
            row, counterpart_key=counterpart_key, subject=subject, context=context
        )

    def build(
        self,
        db: Session,
        *,
        owner_user_id: int,
        conversation: Conversation,
        subject: str,
        self_report: dict | None = None,
        context: str | None = None,
    ) -> dict:
        if subject not in {"me", "other"}:
            raise DomainError(DomainErrorCode.VALIDATION_FAILED, "对象只能是我或对方", status_code=422)
        # 情境优先取请求；没带就从会话挂的场景推断 —— 同一个人在恋爱与职场各一份档案
        kind = context or kind_of(db, conversation)
        if kind not in {"romance", "workplace"}:
            kind = "romance"
        rows = _messages.list_by_conversation(
            db, conversation_id=conversation.id, limit=RECENT_MESSAGE_LIMIT
        )
        if subject == "other" and not rows:
            raise DomainError(DomainErrorCode.VALIDATION_FAILED, "暂无对话，无法推断对方", status_code=422)
        if subject == "me" and not self_report:
            raise DomainError(DomainErrorCode.VALIDATION_FAILED, "请先完成自评", status_code=422)

        jev = _analyze._require_provider(db, owner_user_id=owner_user_id, kind="jev")
        state = self._state(db, owner_user_id, conversation, rows, self_report)
        result = jev_client.call_with_fallback(
            endpoint_url=jev.endpoint_url,
            api_key=_providers.decrypt_key(jev),
            model=jev.model,
            state=state,
            questions=persona_questions_for(kind, subject),
        )
        if not result.ok:
            raise DomainError(DomainErrorCode.JEV_UPSTREAM_ERROR, "建模未完成，请重试。", status_code=502)

        traits, confidence, sufficient = _read_answers(result.answers)
        if subject == "me":
            confidence = max(confidence, SELF_REPORT_CONFIDENCE)
            sufficient = True
        existing = self._find(
            db,
            owner_user_id=owner_user_id,
            counterpart_key=conversation.counterpart_key,
            subject=subject,
            context=kind,
        )
        if existing is not None and (not sufficient or confidence < MIN_CONFIDENCE):
            return {**self._view(existing), "kept": True, "reason": "证据不足，已保留原档案"}

        row = existing or Persona(
            owner_user_id=owner_user_id,
            counterpart_key=conversation.counterpart_key,
            subject=subject,
            context=kind,
        )
        row.traits = json.dumps(traits, ensure_ascii=False)
        row.evidence = json.dumps(_evidence(rows, self_report), ensure_ascii=False)
        row.confidence = confidence
        row.version = (existing.version + 1) if existing else 1
        if existing is None:
            db.add(row)
        db.commit()
        db.refresh(row)
        return {**self._view(row), "kept": False, "reason": ""}

    def usage(self, db: Session, *, owner_user_id: int) -> dict:
        """候选直接采用与手动改写，只计数，不评价。"""
        from ..repositories.models import Message

        rows = list(
            db.scalars(
                select(Message)
                .join(Conversation, Conversation.id == Message.conversation_id)
                .where(Conversation.owner_user_id == owner_user_id, Message.role == "me")
            )
        )
        adopted = sum(1 for row in rows if row.source == "candidate")
        rewritten = sum(1 for row in rows if row.source == "rewrite")
        return {"adopted": adopted, "rewritten": rewritten}

    def _state(self, db, owner_user_id, conversation, rows, self_report) -> dict:
        llm = _analyze._require_provider(db, owner_user_id=owner_user_id, kind="llm")
        # 附件图片读成英文描述（多模态），与正文一起走注释翻译
        contents = image_context_contents(
            db,
            llm=llm,
            api_key=_providers.decrypt_key(llm),
            rows=rows,
            owner_user_id=owner_user_id,
        )
        annotated, translated = annotate(
            endpoint_url=llm.endpoint_url,
            api_key=_providers.decrypt_key(llm),
            model=llm.model,
            lines=[(str(row.seq), text) for row, text in zip(rows, contents)],
        )
        if translated is not None and not translated.ok:
            raise DomainError(DomainErrorCode.LLM_UPSTREAM_ERROR, "内容转换失败，请重试。", status_code=502)
        return {
            "chat": {
                "relationship": conversation.relationship or "未说明",
                "messages": [{"from": row.role, "text": annotated[str(row.seq)]} for row in rows],
            },
            "self_report": self_report or {},
        }

    def _find(
        self, db, *, owner_user_id, counterpart_key, subject, context: str = "romance"
    ) -> Persona | None:
        return db.scalars(
            select(Persona).where(
                Persona.owner_user_id == owner_user_id,
                Persona.counterpart_key == counterpart_key,
                Persona.subject == subject,
                Persona.context == context,
            )
        ).first()

    def _view(
        self,
        row: Persona | None,
        *,
        counterpart_key: str = "",
        subject: str = "",
        context: str = "romance",
    ) -> dict:
        if row is None:
            return {
                "counterpart_key": counterpart_key,
                "subject": subject,
                "context": context,
                "traits": [],
                "confidence": 0,
                "version": 0,
                "updated_at": None,
            }
        stored = _load(row.traits, {})
        traits = [
            {
                "key": key,
                "title": TRAIT_LABELS.get(key, key),
                "text": trait_text(key, value),
                "value": value,
                "weak_science": key in WEAK_SCIENCE_TRAITS,
            }
            for key, value in stored.items()
        ]
        return {
            "counterpart_key": row.counterpart_key,
            "subject": row.subject,
            "context": row.context,
            "traits": traits,
            "confidence": round(row.confidence * 100),
            "version": row.version,
            "updated_at": iso_utc(row.updated_at),
        }


def _read_answers(answers: dict) -> tuple[dict, float, bool]:
    traits: dict = {}
    confidences: list[float] = []
    for key, raw in answers.items():
        if key == "evidence_sufficient" or not isinstance(raw, dict):
            continue
        if "choice" in raw:
            traits[key] = raw.get("choice")
            confidences.append(float(raw.get("confidence") or 0))
        elif "score" in raw:
            traits[key] = raw.get("score")
            confidences.append(float(raw.get("confidence") or 0.6))
    sufficient_raw = answers.get("evidence_sufficient") or {}
    sufficient = float(sufficient_raw.get("noul") or 0) >= 0.5
    confidence = sum(confidences) / len(confidences) if confidences else 0.0
    return traits, confidence, sufficient


def _evidence(rows, self_report: dict | None) -> list[dict]:
    items = [{"seq": row.seq, "text": row.content[:80]} for row in rows[-3:]]
    if self_report:
        items.insert(0, {"source": "self_report"})
    return items
