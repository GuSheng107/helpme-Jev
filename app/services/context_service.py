"""JEV 侧 background 装配：记忆与滚动摘要按字符预算整段裁剪。

人设留到 P5。最近 10 条消息不占这里的预算。
"""

from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ..clients.llm_client import chat_json
from ..core.constants import JEV_STATE_BUDGET_CHARS
from ..repositories.conversations_repo import MessageRepository, SummaryRepository
from ..repositories.models import Memory, SessionSummary

# 超过最近 10 条这么多，才值得再压一次摘要
SUMMARY_GAP = 20

# 单条记忆写进 background 的上限，避免一条长记忆吃光预算
_LINE_CAP = 240


def _line(memory: Memory) -> str:
    who = {"me": "我", "other": "对方", "relation": "关系"}.get(memory.subject, memory.subject)
    text = " ".join(memory.content.split())
    if len(text) > _LINE_CAP:
        text = text[:_LINE_CAP].rstrip()
    return f"{who}/{memory.category}：{text}"


def render_background(
    memories: list[Memory],
    *,
    summary: str = "",
    budget: int = JEV_STATE_BUDGET_CHARS,
) -> str:
    """记忆优先。摘要整段放在后面，放不下就整段丢掉，再从最旧的记忆整条丢掉。"""
    memory_lines = [_line(memory) for memory in memories]
    summary_line = f"更早的对话：{' '.join(summary.split())}" if summary.strip() else ""

    def _pack(candidates: list[str]) -> list[str]:
        kept: list[str] = []
        used = 0
        for line in candidates:
            extra = len(line) + (1 if kept else 0)
            if used + extra > budget:
                break
            kept.append(line)
            used += extra
        return kept

    if summary_line and len(_pack([summary_line, *memory_lines])) == 1 + len(memory_lines):
        return "\n".join(_pack([summary_line, *memory_lines]))
    return "\n".join(_pack(memory_lines))


def dropped_count(
    memories: list[Memory], *, summary: str = "", budget: int = JEV_STATE_BUDGET_CHARS
) -> int:
    """预算装不下的段数，供面板提示「上下文已截断」。"""
    total = len(memories) + (1 if summary.strip() else 0)
    rendered = render_background(memories, summary=summary, budget=budget)
    kept = len(rendered.splitlines()) if rendered else 0
    return max(0, total - kept)


_SUMMARY_PROMPT = """Compress the older part of a chat into one short Chinese paragraph.
Return JSON: {"summary":"..."}
Keep facts that would change a later reply: plans, complaints, what was already resolved.
At most 200 Chinese characters. Do not give advice."""

_messages = MessageRepository()
_summaries = SummaryRepository()


def ensure_summary(
    db: Session,
    *,
    conversation_id: int,
    owner_user_id: int,
    endpoint_url: str,
    api_key: str,
    model: str,
    protocol: str = "openai",
    trace_id: str = "",
) -> str:
    """最近 10 条之外积压超过阈值时，把更早的内容压成一条摘要。失败则沿用旧摘要。"""
    current = _summaries.latest(db, conversation_id=conversation_id)
    upto = current.upto_seq if current else 0
    older = _messages.list_by_conversation(
        db, conversation_id=conversation_id, after_seq=upto
    )
    pending = older[:-10] if len(older) > 10 else []
    if len(pending) < SUMMARY_GAP:
        return current.summary if current else ""

    payload = {
        "previous": current.summary if current else "",
        "messages": [{"from": row.role, "text": row.content} for row in pending],
    }
    result = chat_json(
        endpoint_url=endpoint_url,
        api_key=api_key,
        model=model,
        protocol=protocol,
        messages=[
            {"role": "system", "content": _SUMMARY_PROMPT},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ],
    )
    text = str(result.payload.get("summary") or "").strip() if result.ok else ""
    _log_summary(
        db,
        owner_user_id=owner_user_id,
        trace_id=trace_id,
        endpoint_url=endpoint_url,
        model=model,
        payload=payload,
        result=result,
        kept=bool(text),
    )
    if not text:
        return current.summary if current else ""
    _summaries.add(
        db,
        SessionSummary(
            conversation_id=conversation_id,
            upto_seq=pending[-1].seq,
            summary=text[:500],
        ),
    )
    return text[:500]


def _log_summary(
    db: Session,
    *,
    owner_user_id: int,
    trace_id: str,
    endpoint_url: str,
    model: str,
    payload: dict,
    result,
    kept: bool,
) -> None:
    """摘要调用也进调用日志（phase=summarize）。

    摘要失败只是沿用旧摘要、主流程照常，所以**不记 error**：拿不到新摘要即 warn。
    """
    from ..core.logging import dump_body, pick_level
    from ..repositories.models import CallLog

    request_body, request_cut = dump_body(payload)
    response_body, response_cut = dump_body(result.payload)
    truncated = request_cut or response_cut
    db.add(
        CallLog(
            owner_user_id=owner_user_id,
            trace_id=trace_id,
            kind="llm",
            phase="summarize",
            level=pick_level(ok=True, degraded=not kept or truncated),
            endpoint_url=endpoint_url,
            model=model,
            request_body=request_body,
            response_body=response_body,
            truncated=truncated,
            status_code=result.status_code,
            latency_ms=result.latency_ms,
            error="" if kept else (result.detail or "摘要未生成，沿用旧摘要"),
        )
    )
