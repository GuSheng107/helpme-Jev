"""候选回复：母语起草，注释翻译后交给 Jev 排序，分数只以中文返回。

恋爱、职场和用户场景共用一条链路；用户场景可自定义起草提示词。
"""

from __future__ import annotations

import json
from collections.abc import Iterator

from sqlalchemy.orm import Session

from ..clients import jev_client
from ..clients.llm_client import chat_json
from ..clients.translation import annotate
from ..core.logging import dump_body, pick_level
from ..domain.errors import DomainError, DomainErrorCode
from ..repositories.conversations_repo import MessageRepository
from ..repositories.models import CallLog, Conversation, Scenario
from ..scenarios.builders import choice
from ..scenarios.packs import JudgePack
from ..scenarios.reply_prompts import CUSTOM_REPLY_FORMAT, builtin_draft_prompt
from .analyze_service import RECENT_MESSAGE_LIMIT, AnalyzeService
from .model_log import record_model_call
from .preference_service import auto_translate_enabled
from .provider_service import ProviderService
from .scenario_service import effective_prompt, pack_of

_messages = MessageRepository()
_providers = ProviderService()
_analyze = AnalyzeService()

_HIGH_RISK_MESSAGES: dict[str, str] = {
    "romance": "此事不适合用文字处理，建议当面或电话沟通。",
    "workplace": "这件事利害不小，建议先电话或当面对齐，再落成文字。",
    "custom": "这段沟通风险较高，建议先确认情况再回复。",
}

_CLARIFY_PROMPT = """The judgment lacks context. Ask the user 1 to 3 short questions in Chinese that would fill the gap.
Return JSON: {"questions":["..."]}
Do not give reply advice."""

_EXPLAIN_PROMPT = """Explain in 2 Chinese sentences why the judgment reached this decision, using only the given decision and messages.
Return JSON: {"reason":"..."}
Do not suggest a reply. This is an interpretation, not a new decision."""

_POLISH_PROMPTS = {
    "chat": "Polish the pasted chat line in the same language. Fix typos and ambiguity, keep the tone.",
    "reply": "Polish this reply in the same language. Keep the meaning, make it sound like the sender.",
    "question": "Rewrite this into one decidable question in the same language, preserving the user's intent.",
}
_POLISH_FORMAT = 'Return exactly one valid JSON object: {"text":"polished text"}. No markdown or other text.'

_RANK_KEYS = ("reply_a", "reply_b", "reply_c")

# 自动回复管线的固定步骤：解读（注释翻译）→ 评分 → 起草 → 排序
_PIPELINE_STEPS = ("translate", "score", "draft", "rank")


def _rank_question(annotated: list[str]) -> dict:
    return {
        "best_reply": choice(
            "Which candidate reply best matches what the other person needs right now? "
            "Prefer the one that follows the decided action. Penalize dismissive or off-topic replies.",
            {key: text for key, text in zip(_RANK_KEYS, annotated)},
        )
    }


def _percent(value: object) -> int:
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0
    return round(max(0.0, min(1.0, number)) * 100)


class ReplyService:
    def draft(
        self,
        db: Session,
        *,
        owner_user_id: int,
        conversation: Conversation,
        decision: dict,
        trace_id: str,
    ) -> dict:
        rows = _messages.list_by_conversation(
            db, conversation_id=conversation.id, limit=RECENT_MESSAGE_LIMIT
        )
        if not rows:
            raise DomainError(DomainErrorCode.VALIDATION_FAILED, "暂无内容", status_code=422)
        pack = pack_of(db, conversation)
        scenario = db.get(Scenario, conversation.scenario_id) if conversation.scenario_id else None
        prompt = effective_prompt(scenario) if scenario else builtin_draft_prompt(pack.kind)
        if scenario is None or scenario.kind == "custom":
            prompt += CUSTOM_REPLY_FORMAT
        if _high_risk(decision, pack):
            raise DomainError(
                DomainErrorCode.VALIDATION_FAILED,
                _HIGH_RISK_MESSAGES.get(pack.kind, _HIGH_RISK_MESSAGES["romance"]),
                status_code=422,
            )
        llm = _analyze._require_provider(db, owner_user_id=owner_user_id, kind="llm")
        jev = _analyze._require_provider(db, owner_user_id=owner_user_id, kind="jev")
        payload = _draft_payload(
            conversation=conversation, scenario=scenario, pack=pack,
            decision=decision, rows=rows,
        )
        drafted = chat_json(
            endpoint_url=llm.endpoint_url,
            api_key=_providers.decrypt_key(llm),
            model=llm.model,
            protocol=llm.protocol,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
            ],
        )
        replies = _three(drafted.payload.get("replies") if drafted.ok else None)
        record_model_call(
            db, owner_user_id=owner_user_id, trace_id=trace_id, kind="llm",
            phase="draft", provider=llm, result=drafted, request=payload,
            response=drafted.payload, ok=bool(drafted.ok and replies),
        )
        if not drafted.ok or replies is None:
            raise DomainError(DomainErrorCode.LLM_UPSTREAM_ERROR, "候选未生成，请重试。", status_code=502)

        annotated, translated = annotate(
            endpoint_url=llm.endpoint_url,
            api_key=_providers.decrypt_key(llm),
            model=llm.model,
            protocol=llm.protocol,
            lines=[(str(index), text) for index, text in enumerate(replies)],
            enabled=auto_translate_enabled(db, owner_user_id),
        )
        if translated is not None:
            record_model_call(
                db, owner_user_id=owner_user_id, trace_id=trace_id, kind="llm",
                phase="translate", provider=llm, result=translated,
                request={"lines": replies}, response=translated.payload, ok=translated.ok,
            )
        if translated is not None and not translated.ok:
            raise DomainError(DomainErrorCode.LLM_UPSTREAM_ERROR, "候选未能完成排序，请重试。", status_code=502)

        ranked = self._rank(
            db=db, owner_user_id=owner_user_id, trace_id=trace_id,
            jev=jev,
            state=_state(rows, conversation.relationship, conversation),
            annotated=[annotated[str(index)] for index in range(3)],
        )
        ordered = sorted(
            (
                {"text": replies[index], "percent": ranked[index]}
                for index in range(3)
            ),
            key=lambda item: item["percent"],
            reverse=True,
        )
        return {"candidates": ordered}

    def reply_events(
        self,
        db: Session,
        *,
        owner_user_id: int,
        conversation: Conversation,
        target_member: str = "",
        trace_id: str,
    ) -> Iterator[dict]:
        """自动回复管线：解读 → 评分 → 起草 → 排序，按阶段产出事件。

        消息与 Provider 检查在第一个事件前完成：开流前的 422/409 仍是
        普通 JSON；开流后的失败由调用方转成 error 事件。高危判断不改判
        也不起草，直接以 blocked 收尾。
        """
        rows = _messages.list_by_conversation(
            db, conversation_id=conversation.id, limit=RECENT_MESSAGE_LIMIT
        )
        if not rows:
            raise DomainError(
                DomainErrorCode.VALIDATION_FAILED,
                "暂无内容，请先保存对方发来的话。",
                status_code=422,
            )
        pack = pack_of(db, conversation)
        llm = _analyze._require_provider(db, owner_user_id=owner_user_id, kind="llm")
        jev = _analyze._require_provider(db, owner_user_id=owner_user_id, kind="jev")

        # 自动翻译关闭（自训练中文 JEV）时，plan 里不出现解读一步
        translate_on = auto_translate_enabled(db, owner_user_id)
        yield {"stage": "plan", "steps": list(_PIPELINE_STEPS if translate_on else _PIPELINE_STEPS[1:])}

        view: dict = {}
        for event in _analyze.analyze_events(
            db, owner_user_id=owner_user_id, conversation=conversation, trace_id=trace_id,
        ):
            if event["stage"] == "done":
                view = event["view"]
            else:
                yield event

        scores = view.get("panel") or []
        if view.get("high_danger"):
            yield {"stage": "done", "payload": {
                "scores": scores,
                "candidates": [],
                "blocked": _HIGH_RISK_MESSAGES.get(pack.kind, _HIGH_RISK_MESSAGES["romance"]),
                "ranked": False,
            }}
            return

        # 起草：决策取自评分面板；人设摘要进 payload，群聊点名时再标回复对象
        decision = {
            item["key"]: {"text": str(item.get("text") or ""), "value": item.get("value")}
            for item in (*view.get("panel", []), *view.get("more", []))
        }
        scenario = db.get(Scenario, conversation.scenario_id) if conversation.scenario_id else None
        prompt = effective_prompt(scenario) if scenario else builtin_draft_prompt(pack.kind)
        if scenario is None or scenario.kind == "custom":
            prompt += CUSTOM_REPLY_FORMAT
        payload = _draft_payload(
            conversation=conversation, scenario=scenario, pack=pack,
            decision=decision, rows=rows,
        )
        self_persona = _self_persona_line(db, owner_user_id=owner_user_id)
        if self_persona:
            payload["self_persona"] = self_persona
        persona_lines = _persona_lines(db, owner_user_id=owner_user_id, conversation=conversation)
        if persona_lines:
            payload["personas"] = persona_lines
        reply_to = _member_name(conversation, target_member)
        if reply_to:
            payload["reply_to"] = reply_to
        drafted = chat_json(
            endpoint_url=llm.endpoint_url,
            api_key=_providers.decrypt_key(llm),
            model=llm.model,
            protocol=llm.protocol,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
            ],
        )
        replies = _three(drafted.payload.get("replies") if drafted.ok else None)
        record_model_call(
            db, owner_user_id=owner_user_id, trace_id=trace_id, kind="llm",
            phase="draft", provider=llm, result=drafted, request=payload,
            response=drafted.payload, ok=bool(drafted.ok and replies),
        )
        if not drafted.ok or replies is None:
            raise DomainError(DomainErrorCode.LLM_UPSTREAM_ERROR, "候选未生成，请重试。", status_code=502)
        yield {"stage": "draft_done"}

        # 排序：注释翻译 + JEV。任一步不成就降级为起草顺序，不让整张卡报错。
        ranked = True
        percents = [0, 0, 0]
        annotated, translated = annotate(
            endpoint_url=llm.endpoint_url,
            api_key=_providers.decrypt_key(llm),
            model=llm.model,
            protocol=llm.protocol,
            lines=[(str(index), text) for index, text in enumerate(replies)],
            enabled=auto_translate_enabled(db, owner_user_id),
        )
        if translated is not None:
            record_model_call(
                db, owner_user_id=owner_user_id, trace_id=trace_id, kind="llm",
                phase="translate", provider=llm, result=translated,
                request={"lines": replies}, response=translated.payload, ok=translated.ok,
            )
        if translated is None or translated.ok:
            try:
                percents = self._rank(
                    db=db, owner_user_id=owner_user_id, trace_id=trace_id,
                    jev=jev,
                    state=_state(rows, conversation.relationship, conversation),
                    annotated=[annotated[str(index)] for index in range(3)],
                )
            except DomainError:
                ranked = False
        else:
            ranked = False
        ordered = sorted(
            ({"text": replies[index], "percent": percents[index]} for index in range(3)),
            key=lambda item: item["percent"],
            reverse=True,
        )
        yield {"stage": "done", "payload": {
            "scores": scores,
            "candidates": ordered,
            "blocked": None,
            "ranked": ranked,
        }}

    def evaluate(
        self,
        db: Session,
        *,
        owner_user_id: int,
        conversation: Conversation,
        text: str,
        trace_id: str = "",
    ) -> dict:
        rows = _messages.list_by_conversation(
            db, conversation_id=conversation.id, limit=RECENT_MESSAGE_LIMIT
        )
        llm = _analyze._require_provider(db, owner_user_id=owner_user_id, kind="llm")
        jev = _analyze._require_provider(db, owner_user_id=owner_user_id, kind="jev")
        annotated, translated = annotate(
            endpoint_url=llm.endpoint_url,
            api_key=_providers.decrypt_key(llm),
            model=llm.model,
            protocol=llm.protocol,
            lines=[("0", text)],
            enabled=auto_translate_enabled(db, owner_user_id),
        )
        if translated is not None:
            record_model_call(
                db, owner_user_id=owner_user_id, trace_id=trace_id, kind="llm",
                phase="translate", provider=llm, result=translated,
                request={"text": text}, response=translated.payload, ok=translated.ok,
            )
        if translated is not None and not translated.ok:
            raise DomainError(DomainErrorCode.LLM_UPSTREAM_ERROR, "评估未完成，请重试。", status_code=502)
        question = {
            "fits": {
                "type": "noul",
                "instructions": (
                    "Would sending this reply fit what the other person needs right now, "
                    "without escalating the situation?"
                ),
            }
        }
        state = _state(rows, conversation.relationship, conversation)
        state["candidate_reply"] = annotated["0"]
        result = jev_client.call_with_fallback(
            endpoint_url=jev.endpoint_url,
            api_key=_providers.decrypt_key(jev),
            model=jev.model,
            state=state,
            questions=question,
        )
        record_model_call(
            db, owner_user_id=owner_user_id, trace_id=trace_id, kind="jev",
            phase="evaluate", provider=jev, result=result,
            request={"state": state, "questions": question},
            response=result.answers, ok=result.ok,
        )
        if not result.ok:
            raise DomainError(DomainErrorCode.JEV_UPSTREAM_ERROR, "评估未完成，请重试。", status_code=502)
        raw = (result.answers.get("fits") or {}).get("noul")
        percent = _percent(raw)
        verdict = "适合发送" if percent >= 60 else "不太适合"
        return {"percent": percent, "verdict": verdict}

    def clarify(
        self, db: Session, *, owner_user_id: int, conversation: Conversation,
        trace_id: str = "",
    ) -> dict:
        rows = _messages.list_by_conversation(
            db, conversation_id=conversation.id, limit=RECENT_MESSAGE_LIMIT
        )
        llm = _analyze._require_provider(db, owner_user_id=owner_user_id, kind="llm")
        result = chat_json(
            endpoint_url=llm.endpoint_url,
            api_key=_providers.decrypt_key(llm),
            model=llm.model,
            protocol=llm.protocol,
            messages=[
                {"role": "system", "content": _CLARIFY_PROMPT},
                {
                    "role": "user",
                    "content": json.dumps(
                        [{"from": row.role, "text": row.content} for row in rows],
                        ensure_ascii=False,
                    ),
                },
            ],
        )
        questions = result.payload.get("questions") if result.ok else None
        record_model_call(
            db, owner_user_id=owner_user_id, trace_id=trace_id, kind="llm",
            phase="clarify", provider=llm, result=result,
            request={"conversation_id": conversation.id}, response=result.payload,
            ok=isinstance(questions, list),
        )
        if not isinstance(questions, list):
            raise DomainError(DomainErrorCode.LLM_UPSTREAM_ERROR, "追问未生成，请重试。", status_code=502)
        cleaned = [str(item).strip() for item in questions if str(item).strip()][:3]
        return {"questions": cleaned}

    def explain(
        self, db: Session, *, owner_user_id: int, conversation: Conversation,
        decision: dict, trace_id: str = "",
    ) -> dict:
        rows = _messages.list_by_conversation(
            db, conversation_id=conversation.id, limit=RECENT_MESSAGE_LIMIT
        )
        llm = _analyze._require_provider(db, owner_user_id=owner_user_id, kind="llm")
        result = chat_json(
            endpoint_url=llm.endpoint_url,
            api_key=_providers.decrypt_key(llm),
            model=llm.model,
            protocol=llm.protocol,
            messages=[
                {"role": "system", "content": _EXPLAIN_PROMPT},
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "decision": decision,
                            "messages": [{"from": row.role, "text": row.content} for row in rows],
                        },
                        ensure_ascii=False,
                    ),
                },
            ],
        )
        reason = str(result.payload.get("reason") or "").strip() if result.ok else ""
        record_model_call(
            db, owner_user_id=owner_user_id, trace_id=trace_id, kind="llm",
            phase="explain", provider=llm, result=result,
            request={"conversation_id": conversation.id, "decision": decision},
            response=result.payload, ok=bool(reason),
        )
        if not reason:
            raise DomainError(DomainErrorCode.LLM_UPSTREAM_ERROR, "说明未生成，请重试。", status_code=502)
        return {"reason": reason}

    def polish(
        self, db: Session, *, owner_user_id: int, text: str, kind: str,
        trace_id: str = "",
    ) -> dict:
        llm = _analyze._require_provider(db, owner_user_id=owner_user_id, kind="llm")
        prompt = _POLISH_PROMPTS.get(kind, _POLISH_PROMPTS["chat"]) + "\n" + _POLISH_FORMAT
        polished = ""
        for attempt in range(2):
            messages = [
                {"role": "system", "content": prompt},
                {"role": "user", "content": text},
            ]
            if attempt:
                messages.append({
                    "role": "user",
                    "content": "The previous answer was invalid. Return only the JSON object with a nonempty text string.",
                })
            result = chat_json(
                endpoint_url=llm.endpoint_url,
                api_key=_providers.decrypt_key(llm),
                model=llm.model,
                protocol=llm.protocol,
                messages=messages,
            )
            polished = (
                result.payload.get("text", "").strip()
                if result.ok and isinstance(result.payload.get("text"), str) else ""
            )
            if polished:
                break
            if result.ok:
                result.ok = False
                result.detail = "润色结果缺少 text"
                result.error_code = "PROTOCOL_MISMATCH"
            if result.error_code != "PROTOCOL_MISMATCH":
                break
        request_body, request_cut = dump_body({"kind": kind, "text": text})
        response_body, response_cut = dump_body(result.payload)
        truncated = request_cut or response_cut
        db.add(CallLog(
            owner_user_id=owner_user_id,
            trace_id=trace_id,
            kind="llm",
            phase="polish",
            level=pick_level(ok=bool(polished), degraded=truncated),
            endpoint_url=llm.endpoint_url,
            model=llm.model,
            request_body=request_body,
            response_body=response_body,
            truncated=truncated,
            status_code=result.status_code,
            latency_ms=result.latency_ms,
            error="" if polished else result.detail,
        ))
        db.commit()
        if not polished:
            raise DomainError(
                DomainErrorCode.LLM_UPSTREAM_ERROR,
                "润色未完成，请查看日志中的润色调用详情。", status_code=502,
            )
        return {"text": polished}

    def _rank(
        self, *, db: Session, owner_user_id: int, trace_id: str,
        jev, state: dict, annotated: list[str],
    ) -> list[int]:
        questions = _rank_question(annotated)
        result = jev_client.call_with_fallback(
            endpoint_url=jev.endpoint_url,
            api_key=_providers.decrypt_key(jev),
            model=jev.model,
            state=state,
            questions=questions,
        )
        record_model_call(
            db, owner_user_id=owner_user_id, trace_id=trace_id, kind="jev",
            phase="rank", provider=jev, result=result,
            request={"state": state, "questions": questions},
            response=result.answers, ok=result.ok,
        )
        if not result.ok:
            raise DomainError(DomainErrorCode.JEV_UPSTREAM_ERROR, "排序未完成，请重试。", status_code=502)
        answer = result.answers.get("best_reply") or {}
        probabilities = answer.get("probabilities") if isinstance(answer, dict) else {}
        if not isinstance(probabilities, dict):
            probabilities = {}
        return [_percent(probabilities.get(key)) for key in _RANK_KEYS]


def _draft_payload(
    *,
    conversation: Conversation,
    scenario: Scenario | None,
    pack: JudgePack,
    decision: dict,
    rows: list,
) -> dict:
    """起草请求体：关系 / 场景 / 决策摘要 / 最近消息，手选与自动管线共用。"""
    return {
        "relationship": conversation.relationship,
        "scenario": pack.kind,
        "scenario_name": scenario.name if scenario else "",
        "scenario_description": scenario.description if scenario else "",
        "is_group": conversation.is_group,
        "judgments": decision,
        "decision": {
            "intent": _text(decision, "true_intent"),
            "action": _text(decision, "best_action"),
            "needs": _text(decision, pack.needs_key),
            "risk": _text(decision, pack.risk_key),
        },
        "messages": [{"from": _from_of(row, conversation), "text": row.content} for row in rows],
    }


def _self_persona_line(db: Session, *, owner_user_id: int) -> dict | None:
    """「我」的人设进起草请求：知道自己是谁、什么口吻，候选才像自己写的。"""
    from .persona_profile_service import PersonaProfileService

    profile = PersonaProfileService().get_self(db, owner_user_id=owner_user_id)
    if profile is None:
        return None
    from .persona_service import trait_items

    traits = "、".join(
        f"{item['title']} {item['text']}" for item in trait_items(profile.traits)[:6]
    )
    gender = GENDER_LABELS.get(profile.gender, "")
    return {"gender": gender, "traits": traits, "summary": profile.summary or ""}


GENDER_LABELS = {"female": "女", "male": "男", "unspecified": "保密"}


def _persona_lines(db: Session, *, owner_user_id: int, conversation: Conversation) -> list[str]:
    """起草用的人设摘要：函数内导入，避免与 persona_service 循环引用。"""
    from .persona_service import PersonaService

    return PersonaService().member_persona_lines(
        db, owner_user_id=owner_user_id, conversation=conversation
    )


def _member_name(conversation: Conversation, key: str) -> str:
    """群聊点名回复时的对象显示名；单聊或未点名返回空。"""
    if not key or not conversation.is_group:
        return ""
    from ..domain.schemas.conversation import parse_members

    for member in parse_members(conversation.members):
        if member.key == key:
            return member.name
    return key


def _three(raw: object) -> list[str] | None:
    if not isinstance(raw, list):
        return None
    texts = [str(item).strip() for item in raw if str(item).strip()]
    if len(texts) < 3:
        return None
    return texts[:3]


def _high_risk(decision: dict, pack: JudgePack) -> bool:
    item = decision.get(pack.risk_key) if isinstance(decision, dict) else None
    if not isinstance(item, dict):
        return False
    try:
        return float(item.get("value") or 0) >= pack.risk_threshold
    except (TypeError, ValueError):
        return False


def _text(decision: dict, key: str) -> str:
    item = decision.get(key) if isinstance(decision, dict) else None
    if isinstance(item, dict):
        return str(item.get("text") or "")
    return ""


def _from_of(row, conversation: Conversation) -> str:
    """消息归属：群聊显示发言人名，单人会话保持 me / other。"""
    return (row.speaker or row.role) if conversation.is_group else row.role


def _state(rows, relationship: str, conversation: Conversation) -> dict:
    tail = [{"from": _from_of(row, conversation), "text": row.content} for row in rows][
        -RECENT_MESSAGE_LIMIT:
    ]
    return {
        "chat": {
            "relationship": relationship or "未说明",
            "messages": tail,
            "latest_from": tail[-1]["from"] if tail else "other",
        }
    }
