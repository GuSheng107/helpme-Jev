"""聊天判断：最近消息 → 注释翻译 → JEV 场景题集 → 中文面板。

题目集按会话挂的场景取（恋爱 / 职场），面板渲染逻辑共用（packs.JudgePack）。
"""

from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ..clients import jev_client
from ..clients.translation import annotate
from ..domain.errors import DomainError, DomainErrorCode
from ..repositories.conversations_repo import MessageRepository
from ..repositories.models import Conversation
from ..scenarios.packs import ROMANCE_PACK, JudgePack
from .context_service import dropped_count, ensure_summary, render_background
from .image_service import image_context_contents
from .memory_service import MemoryService
from .provider_service import ProviderService
from .scenario_service import pack_of

# 送进 JEV 的消息条数（DESIGN.md §9.2）
RECENT_MESSAGE_LIMIT = 10

_messages = MessageRepository()
_providers = ProviderService()
_memory = MemoryService()


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
    background: str = "",
) -> dict:
    """装配 JEV state。background 为空时省略，避免空字段干扰判断。"""
    tail = messages[-RECENT_MESSAGE_LIMIT:]
    latest_from = tail[-1]["from"] if tail else "other"
    state: dict = {
        "chat": {
            "relationship": relationship or "未说明",
            "messages": tail,
            "latest_from": latest_from,
        }
    }
    if background:
        state["background"] = background
    return state


def present_answers(answers: dict, pack: JudgePack = ROMANCE_PACK) -> dict:
    """把 System One 的 answers 收成面板能直接画的结构。"""
    items: list[dict] = []
    questions = pack.questions()
    for key, title in pack.question_titles.items():
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
                    {
                        "key": str(name),
                        "label": pack.label_of(key, str(name)),
                        "value": _as_float(prob) or 0.0,
                    }
                    for name, prob in probabilities.items()
                ]
                bars.sort(key=lambda item: item["value"], reverse=True)
            items.append(
                {
                    "key": key,
                    "title": title,
                    "kind": "choice",
                    "value": chosen,
                    "text": pack.label_of(key, chosen),
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
                    "text": pack.label_of(key, side),
                }
            )
            continue

        if "score" in raw:
            score = _as_float(raw.get("score"))
            level = int(round(score)) if score is not None else None
            labels = pack.level_labels.get(key)
            if labels and level is not None:
                text = labels[min(max(level, 0), len(labels) - 1)]
                scale_max = len(labels) - 1
            else:
                levels = _score_levels(questions, key)
                text = f"{level}/{len(levels) - 1}" if level is not None else "—"
                scale_max = len(levels) - 1
            items.append(
                {
                    "key": key,
                    "title": title,
                    "kind": "score",
                    "value": level,
                    "score": score,
                    "scale_max": scale_max,
                    "text": text,
                    "tone": _danger_tone(level) if key == pack.risk_key else "info",
                }
            )
            continue

        items.append({"key": key, "title": title, "kind": "missing", "text": "无法解析"})

    by_key = {item["key"]: item for item in items}
    risk = by_key.get(pack.risk_key, {})
    sufficient = by_key.get("context_sufficient", {})
    return {
        "panel": [by_key[key] for key in pack.panel_keys if key in by_key],
        "more": [item for item in items if item["key"] not in pack.panel_keys],
        "high_danger": (risk.get("value") or 0) >= pack.risk_threshold,
        "context_sufficient": sufficient.get("value") != "false",
        "sufficiency_percent": round((sufficient.get("probability") or 0) * 100),
    }


def _score_levels(questions: dict, key: str) -> list[str]:
    """score 题的档位数（文本 x/9 之类用）。取不到时按 10 档。"""
    question = questions.get(key) or {}
    levels = question.get("criteria")
    return levels if isinstance(levels, list) and levels else [""] * 10


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
                "暂无内容，请先保存对方发来的话。",
                status_code=422,
            )

        jev = self._require_provider(db, owner_user_id=owner_user_id, kind="jev")
        llm = self._require_provider(db, owner_user_id=owner_user_id, kind="llm")

        # 附件图片先读成英文描述（多模态，仅 vision 模型；系统不做 OCR），
        # 再与正文一起走注释翻译 —— 日志里原文与译文仍成对呈现
        contents = image_context_contents(
            db,
            llm=llm,
            api_key=_providers.decrypt_key(llm),
            rows=rows,
            owner_user_id=owner_user_id,
            trace_id=trace_id,
        )
        originals = [(str(row.seq), row.content) for row in rows]
        annotated, translated = annotate(
            endpoint_url=llm.endpoint_url,
            api_key=_providers.decrypt_key(llm),
            model=llm.model,
            lines=[(str(row.seq), text) for row, text in zip(rows, contents)],
        )
        if translated is not None and not translated.ok:
            self._write_logs(
                db,
                owner_user_id=owner_user_id,
                trace_id=trace_id,
                llm=llm,
                jev=jev,
                originals=originals,
                annotated=annotated,
                translated=translated,
                state={},
                result=None,
            )
            db.commit()
            raise DomainError(
                DomainErrorCode.LLM_UPSTREAM_ERROR,
                "内容转换失败，请重试。",
                status_code=502,
            )

        jev_messages = [
            {"from": row.role, "text": annotated[str(row.seq)]} for row in rows
        ]
        pack = pack_of(db, conversation)
        memories = _memory.list_active(
            db,
            owner_user_id=owner_user_id,
            counterpart_key=conversation.counterpart_key,
        )
        summary = ensure_summary(
            db,
            conversation_id=conversation.id,
            endpoint_url=llm.endpoint_url,
            api_key=_providers.decrypt_key(llm),
            model=llm.model,
        )
        background = render_background(memories, summary=summary)
        state = build_state(
            jev_messages, relationship=conversation.relationship, background=background
        )
        result = jev_client.call_with_fallback(
            endpoint_url=jev.endpoint_url,
            api_key=_providers.decrypt_key(jev),
            model=jev.model,
            state=state,
            questions=pack.questions(),
        )
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
        )
        db.commit()

        if not result.ok:
            code = (
                DomainErrorCode.PROTOCOL_MISMATCH
                if result.error_code == "PROTOCOL_MISMATCH"
                else DomainErrorCode.JEV_UPSTREAM_ERROR
            )
            raise DomainError(code, "分析未完成，请重试。", status_code=502)

        view = present_answers(result.answers, pack)
        view["trace_id"] = trace_id
        view["model"] = result.model_reported
        view["latency_ms"] = result.latency_ms
        view["message_count"] = len(rows)
        view["memory_count"] = len(memories)
        view["context_truncated"] = dropped_count(memories, summary=summary) > 0
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
                "尚未配置连接，请前往设置填写地址与密钥。",
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
        if result is not None:
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


def _dump(value: object) -> str:
    text = json.dumps(value, ensure_ascii=False)
    if len(text.encode("utf-8")) <= 64 * 1024:
        return text
    return text.encode("utf-8")[: 64 * 1024].decode("utf-8", errors="ignore")
