"""注释翻译：把非英文消息译成英文，并在方括号里补语用。

JEV 吃的是「译文 + 注释」，用户看的仍是原文。
没有特殊语用时**不加注释** —— 空注释只会把 state 变吵。

枚举结果不走这里：题目和选项本就是英文，展示用本地映射表。
"""

from __future__ import annotations

import json
import re

from . import llm_client
from .llm_client import UpstreamResult

# 含任何非 ASCII 即视为需要翻译。中英混排不会被当成纯英文漏掉。
_NON_ASCII = re.compile(r"[^\x00-\x7f]")

_SYSTEM_PROMPT = """You annotate chat lines for a decision model that only reads English well.
The model must judge subtext, so a plain translation is not enough.

Return a JSON object: {"lines":[{"id":"<same id>","text":"<annotated english>"}]}
One item per input line, same ids, same order.

Rules for each "text":
1. Translate literally into English. Do not embellish.
2. Keep punctuation, emoji, repeated characters, and interjections.
3. If the line carries pragmatic force a literal translation would lose, append ONE bracket note on the same line.
   The note may include: tone (dismissive, teasing, resigned, angry, cold), form (short sentence, trailing period, repeated chars, ellipsis), intent (likely testing whether you care, fishing for comfort, changing subject).
4. Keep the note under one line. No essay.
5. If there is no special pragmatic force, add NO brackets. An empty note is noise.
6. Lines that are already English pass through unchanged, still with a note only when needed."""


def needs_translation(text: str) -> bool:
    """含非 ASCII 才翻译。空文本不译。"""
    return bool(text) and _NON_ASCII.search(text) is not None


def annotate(
    *,
    endpoint_url: str,
    api_key: str,
    model: str,
    lines: list[tuple[str, str]],
    protocol: str = "openai",
) -> tuple[dict[str, str], UpstreamResult | None]:
    """把 ``(id, 原文)`` 译成注释英文。

    纯英文行原样返回，不调用上游。
    返回 ``(id → 送进 JEV 的文本, 调用结果或 None)``。
    失败时第二个值 ``ok`` 为假，调用方决定是否中断。
    """
    pending = [(line_id, text) for line_id, text in lines if needs_translation(text)]
    mapped = {line_id: text for line_id, text in lines if not needs_translation(text)}
    if not pending:
        return mapped, None

    payload = {
        "lines": [{"id": line_id, "text": text} for line_id, text in pending],
    }
    result = llm_client.chat_json(
        endpoint_url=endpoint_url,
        api_key=api_key,
        model=model,
        protocol=protocol,
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ],
    )
    if not result.ok:
        return mapped, result

    got = result.payload.get("lines")
    if not isinstance(got, list):
        result.ok = False
        result.detail = "翻译结果缺少 lines"
        result.error_code = "PROTOCOL_MISMATCH"
        return mapped, result

    by_id = {
        str(item.get("id")): str(item.get("text") or "").strip()
        for item in got
        if isinstance(item, dict) and item.get("id") is not None
    }
    missing = [line_id for line_id, _ in pending if not by_id.get(line_id)]
    if missing:
        result.ok = False
        result.detail = "翻译结果不完整"
        result.error_code = "PROTOCOL_MISMATCH"
        return mapped, result

    mapped.update(by_id)
    return mapped, result
