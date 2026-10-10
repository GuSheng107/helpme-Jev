"""人设工具：判断背景的人设摘要、候选采用统计与 traits 存取。

推断建档（对话 → PersonaService.build）已随「会话档案」下线移除；
人设统一按「场景 + 题目作答」在档案库生成。
"""

from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.time import iso_utc
from ..domain.schemas.conversation import parse_members
from ..repositories.models import Conversation, Message, Persona, PersonaProfile
from ..scenarios.persona_questions import (
    TRAIT_LABELS,
    WEAK_SCIENCE_TRAITS,
    trait_text,
)
from .scenario_service import persona_context_of


# 群聊背景里成员人设摘要的字符预算（JEV 背景总预算 5000，摘要只占一小块）
PERSONA_LINES_BUDGET_CHARS = 1000

# 档案性别 → 展示（保密不标注）
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


class PersonaService:
    def usage(self, db: Session, *, owner_user_id: int) -> dict:
        """候选直接采用与手动改写，只计数，不评价。"""
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
                traits = trait_items(row.traits)[:6]
                display = name
            if not traits:
                continue
            line = _line(display, traits, gender)
            if used + len(line) > PERSONA_LINES_BUDGET_CHARS:
                break
            used += len(line) + 1
            lines.append(line)
        return lines

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
