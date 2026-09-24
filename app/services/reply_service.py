"""候选回复：母语起草，注释翻译后交给 Jev 排序，分数只以中文返回。

恋爱、职场和用户场景共用一条链路；用户场景可自定义起草提示词。
"""

from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ..clients import jev_client
from ..clients.llm_client import chat_json
from ..clients.translation import annotate
from ..domain.errors import DomainError, DomainErrorCode
from ..repositories.conversations_repo import MessageRepository
from ..repositories.models import CallLog, Conversation, Scenario
from ..scenarios.builders import choice
from ..scenarios.packs import JudgePack
from ..scenarios.reply_prompts import CUSTOM_REPLY_FORMAT, builtin_draft_prompt
from .analyze_service import RECENT_MESSAGE_LIMIT, AnalyzeService
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
        if scenario is not None and not scenario.is_builtin:
            prompt += CUSTOM_REPLY_FORMAT
        if _high_risk(decision, pack):
            raise DomainError(
                DomainErrorCode.VALIDATION_FAILED,
                _HIGH_RISK_MESSAGES.get(pack.kind, _HIGH_RISK_MESSAGES["romance"]),
                status_code=422,
            )
        llm = _analyze._require_provider(db, owner_user_id=owner_user_id, kind="llm")
        jev = _analyze._require_provider(db, owner_user_id=owner_user_id, kind="jev")
        payload = {
            "relationship": conversation.relationship,
            "scenario": pack.kind,
            "scenario_name": scenario.name if scenario else "",
            "scenario_description": scenario.description if scenario else "",
            "judgments": decision,
            "decision": {
                "intent": _text(decision, "true_intent"),
                "action": _text(decision, "best_action"),
                "needs": _text(decision, pack.needs_key),
                "risk": _text(decision, pack.risk_key),
            },
            "messages": [{"from": row.role, "text": row.content} for row in rows],
        }
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
        if not drafted.ok or replies is None:
            raise DomainError(DomainErrorCode.LLM_UPSTREAM_ERROR, "候选未生成，请重试。", status_code=502)

        annotated, translated = annotate(
            endpoint_url=llm.endpoint_url,
            api_key=_providers.decrypt_key(llm),
            model=llm.model,
            protocol=llm.protocol,
            lines=[(str(index), text) for index, text in enumerate(replies)],
        )
        if translated is not None and not translated.ok:
            raise DomainError(DomainErrorCode.LLM_UPSTREAM_ERROR, "候选未能完成排序，请重试。", status_code=502)

        ranked = self._rank(
            jev=jev,
            state=_state(rows, conversation.relationship),
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
        del trace_id
        return {"candidates": ordered}

    def evaluate(
        self,
        db: Session,
        *,
        owner_user_id: int,
        conversation: Conversation,
        text: str,
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
        state = _state(rows, conversation.relationship)
        state["candidate_reply"] = annotated["0"]
        result = jev_client.call_with_fallback(
            endpoint_url=jev.endpoint_url,
            api_key=_providers.decrypt_key(jev),
            model=jev.model,
            state=state,
            questions=question,
        )
        if not result.ok:
            raise DomainError(DomainErrorCode.JEV_UPSTREAM_ERROR, "评估未完成，请重试。", status_code=502)
        raw = (result.answers.get("fits") or {}).get("noul")
        percent = _percent(raw)
        verdict = "适合发送" if percent >= 60 else "不太适合"
        return {"percent": percent, "verdict": verdict}

    def clarify(self, db: Session, *, owner_user_id: int, conversation: Conversation) -> dict:
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
        if not isinstance(questions, list):
            raise DomainError(DomainErrorCode.LLM_UPSTREAM_ERROR, "追问未生成，请重试。", status_code=502)
        cleaned = [str(item).strip() for item in questions if str(item).strip()][:3]
        return {"questions": cleaned}

    def explain(self, db: Session, *, owner_user_id: int, conversation: Conversation, decision: dict) -> dict:
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
        if not reason:
            raise DomainError(DomainErrorCode.LLM_UPSTREAM_ERROR, "说明未生成，请重试。", status_code=502)
        return {"reason": reason}

    def polish(
        self, db: Session, *, owner_user_id: int, text: str, kind: str,
        trace_id: str = "",
    ) -> dict:
        from ..core.logging import dump_body, pick_level

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

    def _rank(self, *, jev, state: dict, annotated: list[str]) -> list[int]:
        result = jev_client.call_with_fallback(
            endpoint_url=jev.endpoint_url,
            api_key=_providers.decrypt_key(jev),
            model=jev.model,
            state=state,
            questions=_rank_question(annotated),
        )
        if not result.ok:
            raise DomainError(DomainErrorCode.JEV_UPSTREAM_ERROR, "排序未完成，请重试。", status_code=502)
        answer = result.answers.get("best_reply") or {}
        probabilities = answer.get("probabilities") if isinstance(answer, dict) else {}
        if not isinstance(probabilities, dict):
            probabilities = {}
        return [_percent(probabilities.get(key)) for key in _RANK_KEYS]


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


def _state(rows, relationship: str) -> dict:
    tail = [{"from": row.role, "text": row.content} for row in rows][-RECENT_MESSAGE_LIMIT:]
    return {
        "chat": {
            "relationship": relationship or "未说明",
            "messages": tail,
            "latest_from": tail[-1]["from"] if tail else "other",
        }
    }
