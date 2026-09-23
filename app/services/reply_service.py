"""候选回复：母语起草，注释翻译后交给 Jev 排序，分数只以中文返回。"""

from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ..clients import jev_client
from ..clients.llm_client import chat_json
from ..clients.translation import annotate
from ..domain.errors import DomainError, DomainErrorCode
from ..repositories.conversations_repo import MessageRepository
from ..repositories.models import Conversation
from ..scenarios.builders import choice
from .analyze_service import RECENT_MESSAGE_LIMIT, AnalyzeService
from .provider_service import ProviderService

_messages = MessageRepository()
_providers = ProviderService()
_analyze = AnalyzeService()

_DRAFT_PROMPT = """Write exactly 3 reply candidates in the user's language (Chinese unless the chat is English).
They must follow the given decision. Do not decide a different action.
Return JSON: {"replies":["...","...","..."]}
Each reply is one or two sentences, distinct in tone, no explanation, no English translation."""

_CLARIFY_PROMPT = """The judgment lacks context. Ask the user 1 to 3 short questions in Chinese that would fill the gap.
Return JSON: {"questions":["..."]}
Do not give reply advice."""

_POLISH_PROMPTS = {
    "chat": "Polish the pasted chat line in the same language. Fix typos and ambiguity, keep the tone. Return JSON: {\"text\":\"...\"}",
    "reply": "Polish this reply in the same language. Keep the meaning, make it sound like the sender. Return JSON: {\"text\":\"...\"}",
    "question": "Rewrite this into one decidable question in the same language. Return JSON: {\"text\":\"...\"}",
}

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
        llm = _analyze._require_provider(db, owner_user_id=owner_user_id, kind="llm")
        jev = _analyze._require_provider(db, owner_user_id=owner_user_id, kind="jev")
        payload = {
            "relationship": conversation.relationship,
            "decision": {
                "intent": _text(decision, "true_intent"),
                "action": _text(decision, "best_action"),
                "needs": _text(decision, "she_needs"),
                "danger": _text(decision, "danger_level"),
            },
            "messages": [{"from": row.role, "text": row.content} for row in rows],
        }
        drafted = chat_json(
            endpoint_url=llm.endpoint_url,
            api_key=_providers.decrypt_key(llm),
            model=llm.model,
            messages=[
                {"role": "system", "content": _DRAFT_PROMPT},
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

    def polish(self, db: Session, *, owner_user_id: int, text: str, kind: str) -> dict:
        llm = _analyze._require_provider(db, owner_user_id=owner_user_id, kind="llm")
        result = chat_json(
            endpoint_url=llm.endpoint_url,
            api_key=_providers.decrypt_key(llm),
            model=llm.model,
            messages=[
                {"role": "system", "content": _POLISH_PROMPTS.get(kind, _POLISH_PROMPTS["chat"])},
                {"role": "user", "content": text},
            ],
        )
        polished = str(result.payload.get("text") or "").strip() if result.ok else ""
        if not polished:
            raise DomainError(DomainErrorCode.LLM_UPSTREAM_ERROR, "润色未完成，请重试。", status_code=502)
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
