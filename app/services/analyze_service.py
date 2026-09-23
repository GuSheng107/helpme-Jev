"""恋爱判断：最近消息 → 注释翻译 → JEV 10 题 → 中文面板。

P2 的装配器是最小版，只取最近 N 条消息。记忆、人设、滚动摘要留到 P3。
"""

from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ..clients import jev_client
from ..clients.translation import annotate
from ..domain.errors import DomainError, DomainErrorCode
from ..repositories.conversations_repo import MessageRepository
from ..repositories.models import Conversation, Message
from ..scenarios.questions_romance import (
    HIGH_DANGER_LEVEL,
    INTENSITY_LABELS,
    PANEL_KEYS,
    QUESTION_TITLES,
    label_of,
    romance_questions,
)
from .provider_service import ProviderService

# 送进 JEV 的消息条数（DESIGN.md §9.2）
RECENT_MESSAGE_LIMIT = 10

_messages = MessageRepository()
_providers = ProviderService()


def _as_float(value: object) -> float | None:
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _danger_tone(level: int | None) -> str:
    if level is None:
        return "info"
    if level <= 2:
        return "success"
    if level <= 5:
        return "warning"
    return "danger"


def build_state(
    messages: list[dict],
    *,
    relationship: str,
) -> dict:
    """装配 JEV state。P2 不带 background / history。"""
    tail = messages[-RECENT_MESSAGE_LIMIT:]
    latest_from = tail[-1]["from"] if tail else "other"
    return {
        "chat": {
            "relationship": relationship or "未说明",
            "messages": tail,
            "latest_from": latest_from,
        }
    }


def present_answers(answers: dict) -> dict:
    """把 System One 的 answers 收成面板能直接画的结构。"""
    items: list[dict] = []
    for key, title in QUESTION_TITLES.items():
        raw = answers.get(key)
        if not isinstance(raw, dict):
            items.append({"key": key, "title": title, "kind": "missing", "text": "未返回"})
            continue

        if "choice" in raw:
            chosen = str(raw.get("choice") or "")
            confidence = _as_float(raw.get("confidence"))
            probabilities = raw.get("probabilities")
            bars = []
            if isinstance(probabilities, dict):
                bars = [
                    {"key": str(name), "label": label_of(key, str(name)), "value": _as_float(prob) or 0.0}
                    for name, prob in probabilities.items()
                ]
                bars.sort(key=lambda item: item["value"], reverse=True)
            items.append(
                {
                    "key": key,
                    "title": title,
                    "kind": "choice",
                    "value": chosen,
                    "text": label_of(key, chosen),
                    "confidence": confidence,
                    "bars": bars,
                }
            )
            continue

        if "noul" in raw:
            prob = _as_float(raw.get("noul"))
            side = "true" if prob is not None and prob >= 0.5 else "false"
            items.append(
                {
                    "key": key,
                    "title": title,
                    "kind": "noul",
                    "value": side,
                    "probability": prob,
                    "text": label_of(key, side),
                }
            )
            continue

        if "score" in raw:
            score = _as_float(raw.get("score"))
            level = int(round(score)) if score is not None else None
            if key == "emotion_intensity" and level is not None:
                text = INTENSITY_LABELS[min(max(level, 0), len(INTENSITY_LABELS) - 1)]
                scale_max = len(INTENSITY_LABELS) - 1
            else:
                text = f"{level}/9" if level is not None else "—"
                scale_max = 9
            items.append(
                {
                    "key": key,
                    "title": title,
                    "kind": "score",
                    "value": level,
                    "score": score,
                    "scale_max": scale_max,
                    "text": text,
                    "tone": _danger_tone(level) if key == "danger_level" else "info",
                }
            )
            continue

        items.append({"key": key, "title": title, "kind": "missing", "text": "无法解析"})

    by_key = {item["key"]: item for item in items}
    danger = by_key.get("danger_level", {})
    sufficient = by_key.get("context_sufficient", {})
    return {
        "panel": [by_key[key] for key in PANEL_KEYS if key in by_key],
        "more": [item for item in items if item["key"] not in PANEL_KEYS],
        "high_danger": (danger.get("value") or 0) >= HIGH_DANGER_LEVEL,
        "context_sufficient": sufficient.get("value") != "false",
    }


class AnalyzeService:
    def analyze(
        self,
        db: Session,
        *,
        owner_user_id: int,
        conversation: Conversation,
        trace_id: str,
    ) -> dict:
        rows = _messages.list_by_conversation(
            db, conversation_id=conversation.id, limit=RECENT_MESSAGE_LIMIT
        )
        if not rows:
            raise DomainError(
                DomainErrorCode.VALIDATION_FAILED,
                "还没有消息。先粘贴对方的话，再判断。",
                status_code=422,
            )

        jev = self._require_provider(db, owner_user_id=owner_user_id, kind="jev")
        llm = self._require_provider(db, owner_user_id=owner_user_id, kind="llm")

        originals = [(str(row.seq), row.content) for row in rows]
        annotated, translated = annotate(
            endpoint_url=llm.endpoint_url,
            api_key=_providers.decrypt_key(llm),
            model=llm.model,
            lines=originals,
        )
        if translated is not None and not translated.ok:
            raise DomainError(
                DomainErrorCode.LLM_UPSTREAM_ERROR,
                f"翻译失败：{translated.detail}",
                status_code=502,
            )

        jev_messages = [
            {"from": row.role, "text": annotated[str(row.seq)]} for row in rows
        ]
        state = build_state(jev_messages, relationship=conversation.relationship)
        result = jev_client.call_with_fallback(
            endpoint_url=jev.endpoint_url,
            api_key=_providers.decrypt_key(jev),
            model=jev.model,
            state=state,
            questions=romance_questions(),
        )
        if not result.ok:
            code = (
                DomainErrorCode.PROTOCOL_MISMATCH
                if result.error_code == "PROTOCOL_MISMATCH"
                else DomainErrorCode.JEV_UPSTREAM_ERROR
            )
            raise DomainError(code, result.detail or "JEV 调用失败", status_code=502)

        self._write_logs(
            db,
            owner_user_id=owner_user_id,
            trace_id=trace_id,
            llm=llm,
            jev=jev,
            originals=originals,
            annotated=annotated,
            translated=translated,
            state=state,
            result=result,
            rows=rows,
        )
        db.commit()

        view = present_answers(result.answers)
        view["trace_id"] = trace_id
        view["model"] = result.model_reported
        view["latency_ms"] = result.latency_ms
        view["message_count"] = len(rows)
        return view

    def _require_provider(self, db: Session, *, owner_user_id: int, kind: str):
        chosen = _providers.repo.default_of_kind(db, owner_user_id=owner_user_id, kind=kind)
        if chosen is None:
            rows = _providers.list_for_user(db, owner_user_id=owner_user_id, kind=kind)
            chosen = rows[0] if rows else None
        if chosen is None:
            code = (
                DomainErrorCode.JEV_NOT_CONFIGURED
                if kind == "jev"
                else DomainErrorCode.LLM_NOT_CONFIGURED
            )
            name = "JEV" if kind == "jev" else "LLM"
            raise DomainError(
                code,
                f"还没有配置 {name}。去设置里填完整 URL、Key 和模型。",
                status_code=409,
            )
        return chosen

    def _write_logs(
        self,
        db: Session,
        *,
        owner_user_id: int,
        trace_id: str,
        llm,
        jev,
        originals: list[tuple[str, str]],
        annotated: dict[str, str],
        translated,
        state: dict,
        result,
        rows: list[Message],
    ) -> None:
        """中英并排写进调用日志，方便以后分清是翻译错还是判断错。"""
        from ..core.logging import sanitize_log_value
        from ..repositories.models import CallLog

        pairs = [
            {"seq": seq, "original": text, "annotated": annotated.get(seq, text)}
            for seq, text in originals
        ]
        if translated is not None:
            db.add(
                CallLog(
                    owner_user_id=owner_user_id,
                    trace_id=trace_id,
                    kind="llm",
                    phase="translate",
                    endpoint_url=llm.endpoint_url,
                    model=llm.model,
                    request_body=_dump(sanitize_log_value({"lines": pairs})),
                    response_body=_dump(sanitize_log_value(translated.payload)),
                    status_code=translated.status_code,
                    latency_ms=translated.latency_ms,
                    error="" if translated.ok else translated.detail,
                )
            )
        db.add(
            CallLog(
                owner_user_id=owner_user_id,
                trace_id=trace_id,
                kind="jev",
                phase="analyze",
                endpoint_url=jev.endpoint_url,
                model=result.model_reported or jev.model,
                request_body=_dump(sanitize_log_value({"state": state, "lines": pairs})),
                response_body=_dump(sanitize_log_value({"answers": result.answers})),
                status_code=result.status_code,
                latency_ms=result.latency_ms,
                error="" if result.ok else result.detail,
            )
        )
        del rows


def _dump(value: object) -> str:
    text = json.dumps(value, ensure_ascii=False)
    if len(text.encode("utf-8")) <= 64 * 1024:
        return text
    return text.encode("utf-8")[: 64 * 1024].decode("utf-8", errors="ignore")
