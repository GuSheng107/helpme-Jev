"""人设档案：自评优先，对话推断次之；证据不足时不覆盖旧档案。"""

from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..clients import jev_client
from ..clients.translation import annotate
from ..core.time import iso_utc
from ..domain.errors import DomainError, DomainErrorCode
from ..domain.schemas.conversation import parse_members
from ..repositories.conversations_repo import MessageRepository
from ..repositories.models import Conversation, Persona, PersonaProfile, Scenario
from ..scenarios.persona_questions import (
    TRAIT_LABELS,
    WEAK_SCIENCE_TRAITS,
    persona_questions_for,
    trait_text,
)
from .analyze_service import RECENT_MESSAGE_LIMIT, AnalyzeService
from .image_service import image_context_contents
from .memory_service import MemoryService
from .model_log import record_model_call
from .provider_service import ProviderService
from .scenario_service import kind_of, persona_context_of, strip_meta

_messages = MessageRepository()
_providers = ProviderService()
_analyze = AnalyzeService()
_memory = MemoryService()

MIN_CONFIDENCE = 0.45
SELF_REPORT_CONFIDENCE = 0.9

# 群聊背景里成员人设摘要的字符预算（JEV 背景总预算 5000，摘要只占一小块）
PERSONA_LINES_BUDGET_CHARS = 1000


def _load(raw: str, fallback):
    try:
        return json.loads(raw or "")
    except json.JSONDecodeError:
        return fallback


def trait_items(stored: str) -> list[dict]:
    """把人设 traits JSON 转成可直接展示的列表（key / 中文标题 / 文案 / 弱框架标记）。

    人设库档案与推断档案共用同一存储格式，也共用这一渲染。
    """
    stored_data = _load(stored, {})
    if isinstance(stored_data, dict) and stored_data.get("_schema") == "custom_v1":
        values = stored_data.get("values", {})
        metadata = stored_data.get("meta", {})
    else:
        values = stored_data
        metadata = {}
    if not isinstance(values, dict):
        values = {}
    if not isinstance(metadata, dict):
        metadata = {}
    return [
        {
            "key": key,
            "title": str(meta.get("title") or TRAIT_LABELS.get(key, key)),
            "text": _trait_text_with_meta(key, value, meta),
            "value": value,
            "weak_science": key in WEAK_SCIENCE_TRAITS,
        }
        for key, value in values.items()
        for meta in [metadata.get(key) if isinstance(metadata.get(key), dict) else {}]
    ]


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
        trace_id: str = "",
        member_key: str = "",
    ) -> dict:
        if subject not in {"me", "other"}:
            raise DomainError(DomainErrorCode.VALIDATION_FAILED, "对象只能是我或对方", status_code=422)
        # 群聊：给某位成员建档；单人会话沿用会话的 counterpart_key
        target_key = conversation.counterpart_key
        focus_name = ""
        if conversation.is_group and subject == "other":
            members = {member.key: member.name for member in parse_members(conversation.members)}
            if member_key not in members:
                raise DomainError(
                    DomainErrorCode.VALIDATION_FAILED, "发言人必须是群成员", status_code=422
                )
            target_key = member_key
            focus_name = members[member_key]
        # 档案情境可以由用户选择；题集始终取会话挂载的自定义场景。
        # persona_context_of 已把自定义场景映射到 romance / workplace，这里不可能再是 custom
        scenario_kind = kind_of(db, conversation)
        kind = context or persona_context_of(db, conversation)
        custom_source = (
            self._custom_persona_questions(db, conversation)
            if scenario_kind == "custom" else None
        )
        custom_questions = strip_meta(custom_source) if custom_source else None
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
        state = self._state(
            db, owner_user_id, conversation, rows, self_report, trace_id,
            focus_name=focus_name,
        )
        questions = custom_questions or persona_questions_for(kind, subject)
        result = jev_client.call_with_fallback(
            endpoint_url=jev.endpoint_url,
            api_key=_providers.decrypt_key(jev),
            model=jev.model,
            state=state,
            questions=questions,
        )
        record_model_call(
            db, owner_user_id=owner_user_id, trace_id=trace_id,
            kind="jev", phase="persona", provider=jev, result=result,
            request={"state": state, "questions": questions},
            response=result.answers, ok=result.ok,
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
            counterpart_key=target_key,
            subject=subject,
            context=kind,
        )
        if existing is not None and (not sufficient or confidence < MIN_CONFIDENCE):
            return {**self._view(existing), "kept": True, "reason": "证据不足，已保留原档案"}

        row = existing or Persona(
            owner_user_id=owner_user_id,
            counterpart_key=target_key,
            subject=subject,
            context=kind,
        )
        row.traits = json.dumps(_stored_traits(traits, custom_source), ensure_ascii=False)
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

    def batch_for_conversation(
        self, db: Session, *, owner_user_id: int, conversation: Conversation,
        context: str | None = None,
    ) -> dict:
        """批量取一个会话里所有人的人设与上下文（记忆）。

        群聊返回每位成员 + 我；单聊返回对方 + 我。记忆是会话级的
        （群聊共享一份）， 人设按成员 key 各自取情境分档。
        ``context`` 不传则按会话挂的场景推断。
        """
        resolved = context or persona_context_of(db, conversation)
        participants: list[dict] = []
        if conversation.is_group:
            for member in parse_members(conversation.members):
                row = self._find(
                    db, owner_user_id=owner_user_id,
                    counterpart_key=member.key, subject="other", context=resolved,
                )
                participants.append({
                    "key": member.key,
                    "name": member.name,
                    "subject": "other",
                    "persona": self._view(
                        row, counterpart_key=member.key, subject="other", context=resolved
                    ),
                })
        else:
            row = self._find(
                db, owner_user_id=owner_user_id,
                counterpart_key=conversation.counterpart_key,
                subject="other", context=resolved,
            )
            participants.append({
                "key": conversation.counterpart_key,
                "name": conversation.counterpart_name or "对方",
                "subject": "other",
                "persona": self._view(
                    row, counterpart_key=conversation.counterpart_key,
                    subject="other", context=resolved,
                ),
            })
        me_row = self._find(
            db, owner_user_id=owner_user_id,
            counterpart_key=conversation.counterpart_key, subject="me", context=resolved,
        )
        participants.append({
            "key": "me",
            "name": "我",
            "subject": "me",
            "persona": self._view(
                me_row, counterpart_key=conversation.counterpart_key,
                subject="me", context=resolved,
            ),
        })
        memories = _memory.list_active(
            db, owner_user_id=owner_user_id, counterpart_key=conversation.counterpart_key
        )
        return {
            "conversation_id": conversation.id,
            "is_group": conversation.is_group,
            "context": resolved,
            "counterpart_key": conversation.counterpart_key,
            "participants": participants,
            "memories": [
                {
                    "id": item.id,
                    "subject": item.subject,
                    "category": item.category,
                    "content": item.content,
                }
                for item in memories
            ],
        }

    def member_persona_lines(
        self, db: Session, *, owner_user_id: int, conversation: Conversation,
        extra_keys: tuple[str, ...] | list[str] = (),
    ) -> list[str]:
        """判断的背景：每位有人设的成员一行摘要，供 JEV 分清谁是谁。

        单聊传 ``extra_keys=[counterpart_key]`` 也会并入 —— 人设库档案
        （key 命中）优先于推断档案。整体受字符预算约束：JEV 背景
        总预算有限，人设摘要不能把记忆挤出去。
        """
        context = persona_context_of(db, conversation)
        if conversation.is_group:
            targets = [(member.key, member.name) for member in parse_members(conversation.members)]
        else:
            targets = [(conversation.counterpart_key, conversation.counterpart_name or "对方")]
        targets.extend((key, key) for key in extra_keys if key)
        seen: set[str] = set()
        ordered: list[tuple[str, str]] = []
        for key, name in targets:
            if key and key not in seen:
                seen.add(key)
                ordered.append((key, name))
        if not ordered:
            return []

        profiles = {
            profile.key: profile
            for profile in db.scalars(
                select(PersonaProfile).where(
                    PersonaProfile.owner_user_id == owner_user_id,
                    PersonaProfile.key.in_([key for key, _ in ordered]),
                )
            )
        }

        def _line(name: str, traits: list[dict]) -> str:
            # 带上特质名：裸分数（3/8）JEV 读不出含义
            return (
                f"{name}的人设："
                + "、".join(f"{trait['title']}{trait['text']}" for trait in traits)
            )

        lines: list[str] = []
        used = 0
        for key, name in ordered:
            profile = profiles.get(key)
            if profile is not None:
                traits = trait_items(profile.traits)[:6]
                if traits:
                    line = _line(profile.nickname or name, traits)
            else:
                row = self._find(
                    db, owner_user_id=owner_user_id,
                    counterpart_key=key, subject="other", context=context,
                )
                if row is None:
                    continue
                traits = self._view(row)["traits"][:6]
                if not traits:
                    continue
                line = _line(name, traits)
            if used + len(line) > PERSONA_LINES_BUDGET_CHARS:
                break
            used += len(line) + 1
            lines.append(line)
        return lines

    def _custom_persona_questions(self, db, conversation) -> dict | None:
        """读取自定义场景的人设题集，保留展示字段供档案使用。"""
        from ..services.scenario_service import _load_questions

        if conversation.scenario_id is None:
            return None
        scenario = db.get(Scenario, conversation.scenario_id)
        if scenario is None:
            return None
        raw = _load_questions(scenario.persona_questions or "{}")
        if not raw:
            return None
        return raw

    def _state(
        self, db, owner_user_id, conversation, rows, self_report, trace_id: str,
        focus_name: str = "",
    ) -> dict:
        llm = _analyze._require_provider(db, owner_user_id=owner_user_id, kind="llm")
        # 附件图片读成英文描述（多模态），与正文一起走注释翻译
        contents = image_context_contents(
            db,
            llm=llm,
            api_key=_providers.decrypt_key(llm),
            rows=rows,
            owner_user_id=owner_user_id,
            trace_id=trace_id,
        )
        annotated, translated = annotate(
            endpoint_url=llm.endpoint_url,
            api_key=_providers.decrypt_key(llm),
            model=llm.model,
            protocol=llm.protocol,
            lines=[(str(row.seq), text) for row, text in zip(rows, contents)],
        )
        if translated is not None:
            record_model_call(
                db, owner_user_id=owner_user_id, trace_id=trace_id,
                kind="llm", phase="translate", provider=llm, result=translated,
                request={"conversation_id": conversation.id},
                response=translated.payload, ok=translated.ok,
            )
        if translated is not None and not translated.ok:
            raise DomainError(DomainErrorCode.LLM_UPSTREAM_ERROR, "内容转换失败，请重试。", status_code=502)
        state = {
            "chat": {
                "relationship": conversation.relationship or "未说明",
                "messages": [
                    {
                        "from": (row.speaker or row.role) if conversation.is_group else row.role,
                        "text": annotated[str(row.seq)],
                    }
                    for row in rows
                ],
            },
            "self_report": self_report or {},
        }
        if focus_name:
            # 群聊建档：告诉 JEV 这份档案描述的是哪位成员
            state["chat"]["focus"] = focus_name
        return state

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
        return {
            "counterpart_key": row.counterpart_key,
            "subject": row.subject,
            "context": row.context,
            "traits": trait_items(row.traits),
            "confidence": round(row.confidence * 100),
            "version": row.version,
            "updated_at": iso_utc(row.updated_at),
        }


def _stored_traits(traits: dict, questions: dict | None) -> dict:
    if not questions:
        return traits
    meta = {
        key: {
            field: question[field]
            for field in ("title", "labels", "level_labels")
            if field in question
        }
        for key in traits
        if isinstance(question := questions.get(key), dict)
    }
    return {"_schema": "custom_v1", "values": traits, "meta": meta}


def _trait_text_with_meta(key: str, value: object, meta: dict) -> str:
    labels = meta.get("labels")
    if isinstance(labels, dict) and str(value) in labels:
        return str(labels[str(value)])
    levels = meta.get("level_labels")
    if isinstance(levels, list):
        try:
            index = int(value)
        except (TypeError, ValueError):
            index = -1
        if 0 <= index < len(levels):
            return str(levels[index])
    return trait_text(key, value)


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
