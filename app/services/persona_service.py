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
    questions_for,
    trait_text,
)
from .analyze_service import RECENT_MESSAGE_LIMIT, AnalyzeService
from .image_service import image_context_contents
from .memory_service import MemoryService
from .model_log import record_model_call
from .preference_service import auto_translate_enabled
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

# 档案性别 → 展示（secret 不标注）
GENDER_LABELS = {"female": "女", "male": "男", "unspecified": ""}


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
        context_label: str = "",
        dimension_keys: list[str] | None = None,
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
        # 人设库档案优先：完整档案挡纯推断（结果会被判断链路无视）；
        # 占位档案由推断/自评原地补全；自评是主动动作，也允许覆盖完整档案
        absorb_profile = None
        if subject == "other":
            profile_hit = db.scalars(
                select(PersonaProfile).where(
                    PersonaProfile.owner_user_id == owner_user_id,
                    PersonaProfile.key == target_key,
                )
            ).first()
            if profile_hit is not None:
                is_placeholder = profile_hit.answers in ("{}", "") and profile_hit.traits in ("{}", "")
                if is_placeholder or self_report:
                    absorb_profile = profile_hit
                else:
                    raise DomainError(
                        DomainErrorCode.CONFLICT,
                        f"「{profile_hit.nickname}」已有人设库档案，判断时以档案为准；如需重建请先在档案里删除",
                        status_code=409,
                    )
        # 档位可以由用户选择：内置档位按预设取题，自定义档位按所选维度拼装。
        # 挂自定义场景时，题集始终以场景里materialize的那份为准。
        scenario_kind = kind_of(db, conversation)
        kind = context or persona_context_of(db, conversation)
        custom_source = (
            self._custom_persona_questions(db, conversation)
            if scenario_kind == "custom" else None
        )
        custom_questions = strip_meta(custom_source) if custom_source else None
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
        questions = custom_questions or questions_for(kind, dimension_keys, subject)
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

        traits, confidence, sufficient = _read_answers(result.answers, set(questions))
        if subject == "me":
            confidence = max(confidence, SELF_REPORT_CONFIDENCE)
            sufficient = True
        if absorb_profile is not None:
            # 档案吸收：推断/自评结果直接写进档案（判断链路只认档案），
            # 不再落推断表 —— 落了也会被档案遮蔽，等于无效提交。
            # 自评是主动证据，直接视为充分；纯推断证据不足时保持原档案。
            if self_report:
                sufficient = True
            if not sufficient or confidence < MIN_CONFIDENCE:
                return {
                    **self._profile_build_view(absorb_profile),
                    "kept": True,
                    "reason": "这段内容还看不出稳定的变化，档案保持原样",
                }
            if self_report:
                absorb_profile.answers = json.dumps(self_report, ensure_ascii=False)
            absorb_profile.traits = json.dumps(
                _stored_traits(traits, questions), ensure_ascii=False
            )
            # 调用方显式选了档位：档案跟着换档，否则档案会一直停在建库时那一档
            if context:
                absorb_profile.context = kind
                absorb_profile.context_label = context_label
            absorb_profile.confidence = confidence
            absorb_profile.version += 1
            db.commit()
            db.refresh(absorb_profile)
            return {
                **self._profile_build_view(absorb_profile),
                "kept": False,
                "reason": "",
            }
        existing = self._find(
            db,
            owner_user_id=owner_user_id,
            counterpart_key=target_key,
            subject=subject,
            context=kind,
        )
        if existing is not None and (not sufficient or confidence < MIN_CONFIDENCE):
            return {
                **self._view(existing),
                "kept": True,
                "reason": "这段内容还看不出稳定的变化，档案保持原样",
            }

        row = existing or Persona(
            owner_user_id=owner_user_id,
            counterpart_key=target_key,
            subject=subject,
            context=kind,
        )
        if context_label:
            row.context_label = context_label
        row.traits = json.dumps(_stored_traits(traits, custom_source), ensure_ascii=False)
        row.evidence = json.dumps(_evidence(rows, self_report), ensure_ascii=False)
        row.confidence = confidence
        row.version = (existing.version + 1) if existing else 1
        if existing is None:
            db.add(row)
        db.commit()
        db.refresh(row)
        return {**self._view(row), "kept": False, "reason": ""}

    def _profile_build_view(self, row: PersonaProfile) -> dict:
        """档案行的视图：形状与推断档案视图对齐，档案面板可直接渲染。"""
        return {
            "counterpart_key": row.key,
            "subject": "other",
            "context": row.context,
            "context_label": row.context_label or "",
            "traits": trait_items(row.traits),
            "confidence": round(row.confidence * 100),
            "version": row.version,
            "updated_at": iso_utc(row.updated_at),
        }

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
        人设库档案（key 命中）优先于推断档案，与判断链路同源。
        """
        resolved = context or persona_context_of(db, conversation)
        if conversation.is_group:
            targets = [(member.key, member.name) for member in parse_members(conversation.members)]
        else:
            targets = [
                (conversation.counterpart_key, conversation.counterpart_name or "对方"),
            ]
        profiles = {
            profile.key: profile
            for profile in db.scalars(
                select(PersonaProfile).where(
                    PersonaProfile.owner_user_id == owner_user_id,
                    PersonaProfile.key.in_([key for key, _ in targets]),
                )
            )
        }
        participants: list[dict] = []
        for key, name in targets:
            profile = profiles.get(key)
            if profile is not None:
                participants.append({
                    "key": key,
                    "name": profile.nickname or name,
                    "subject": "other",
                    "persona": {
                        "counterpart_key": key,
                        "subject": "other",
                        "context": profile.context,
                        "context_label": profile.context_label or "",
                        "traits": trait_items(profile.traits),
                        "confidence": round(profile.confidence * 100),
                        "version": profile.version,
                    },
                })
                continue
            row = self._find(
                db, owner_user_id=owner_user_id,
                counterpart_key=key, subject="other", context=resolved,
            )
            participants.append({
                "key": key,
                "name": name,
                "subject": "other",
                "persona": self._view(
                    row, counterpart_key=key, subject="other", context=resolved,
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
    ) -> list[str]:
        """判断的背景：有人设的成员各一行摘要，供 JEV 分清谁是谁。

        群聊按成员表、单聊取对方 —— 人设库档案（key 命中）优先于
        推断档案。整体受字符预算约束：JEV 背景总预算有限，人设摘要
        不能把记忆挤出去。
        """
        context = persona_context_of(db, conversation)
        if conversation.is_group:
            targets = [(member.key, member.name) for member in parse_members(conversation.members)]
        else:
            targets = [(conversation.counterpart_key, conversation.counterpart_name or "对方")]
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

        def _line(name: str, traits: list[dict], gender: str = "") -> str:
            # 带上特质名：裸分数（3/8）JEV 读不出含义；性别帮措辞拿准 TA / 她 / 他
            tag = f"（{gender}）" if gender else ""
            return (
                f"{name}{tag}的人设："
                + "、".join(f"{trait['title']}{trait['text']}" for trait in traits)
            )

        lines: list[str] = []
        used = 0
        for key, name in ordered:
            profile = profiles.get(key)
            gender = ""
            if profile is not None:
                traits = trait_items(profile.traits)[:6]
                display = profile.nickname or name
                gender = GENDER_LABELS.get(profile.gender, "") if profile.gender else ""
            else:
                row = self._find_any(
                    db, owner_user_id=owner_user_id,
                    counterpart_key=key, subject="other", context=context,
                )
                if row is None:
                    continue
                traits = self._view(row)["traits"][:6]
                display = name
            if not traits:
                continue
            line = _line(display, traits, gender)
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
        # 附件图片读成描述（多模态），与正文一起走注释翻译；
        # 自动翻译关闭（自训练中文 JEV）时中文原文与中文描述直通
        translate_on = auto_translate_enabled(db, owner_user_id)
        contents = image_context_contents(
            db,
            llm=llm,
            api_key=_providers.decrypt_key(llm),
            rows=rows,
            owner_user_id=owner_user_id,
            trace_id=trace_id,
            describe_english=translate_on,
        )
        annotated, translated = annotate(
            endpoint_url=llm.endpoint_url,
            api_key=_providers.decrypt_key(llm),
            model=llm.model,
            protocol=llm.protocol,
            lines=[(str(row.seq), text) for row, text in zip(rows, contents)],
            enabled=translate_on,
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

    def _find_any(
        self, db, *, owner_user_id, counterpart_key, subject, context: str = ""
    ) -> Persona | None:
        """按档位优先、其余档位兜底取一份档案。

        自定义档位的 slug 只存在于前端，服务端按会话推不出档位名；
        判断背景不该因此丢掉这个人的人设。
        """
        rows = list(
            db.scalars(
                select(Persona)
                .where(
                    Persona.owner_user_id == owner_user_id,
                    Persona.counterpart_key == counterpart_key,
                    Persona.subject == subject,
                )
                .order_by(Persona.updated_at.desc())
            )
        )
        if not rows:
            return None
        for row in rows:
            if row.context == context:
                return row
        return rows[0]

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
                "context_label": "",
                "traits": [],
                "confidence": 0,
                "version": 0,
                "updated_at": None,
            }
        return {
            "counterpart_key": row.counterpart_key,
            "subject": row.subject,
            "context": row.context,
            "context_label": row.context_label or "",
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


def _read_answers(answers: dict, asked: set[str] | None = None) -> tuple[dict, float, bool]:
    """把判定模型返回的作答收成 traits。

    ``asked`` 给出本次真正问过的题：模型多答的维度一律不认，
    否则换个档位后旧维度会从回答里漏进来污染档案。
    """
    traits: dict = {}
    confidences: list[float] = []
    for key, raw in answers.items():
        if key == "evidence_sufficient" or not isinstance(raw, dict):
            continue
        if asked is not None and key not in asked:
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
