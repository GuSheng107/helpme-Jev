"""日志脱敏与调用日志级别。

脱敏三道防线：

1. **键名黑名单** —— 精确命中、后缀命中、子串命中
2. **请求头整条剔除** —— ``Authorization`` / ``Cookie`` 等
3. **自由文本再扫一遍** —— 兜住被误粘贴进正文的 key 形态串

红线：apiKey 明文绝不出现在日志 / 响应 / 异常栈中（见 DESIGN.md §6.2）。

级别判定只有一条规则（``pick_level``）：**失败即 error；成功但结果被降级即 warn；其余 info**。
降级指流程没断但结果不再完整：缺上下文、缺图、缺题、正文截断、健康度偏低。
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from typing import Any

from ..domain.enums import CallLogLevel
from .constants import CALL_LOG_BODY_MAX_BYTES

REDACTED = "[REDACTED]"
MAX_DEPTH = 12

_SENSITIVE_EXACT = {
    "authorization",
    "cookie",
    "set-cookie",
    "token",
    "password",
    "app_secret",
    "api_key",
    "apikey",
    "secret",
    "invitation_code",
    "access_token",
    "refresh_token",
    "x-jev-api-key",
    "x-llm-api-key",
}

_SENSITIVE_SUFFIXES = (
    "_password",
    "_token",
    "_secret",
    "_cookie",
    "_apikey",
    "_api_key",
)

_SENSITIVE_SUBSTRINGS = (
    "apikey",
    "api_key",
    "password",
    "secret",
    "authorization",
    "invitation_code",
)

# 自由文本里可识别的 key 形态（保守列举，避免误伤正常文本）
_TEXT_PATTERNS = (
    re.compile(r"\bsk-or-v1-[A-Za-z0-9]{12,}\b"),
    re.compile(r"\bsk-[A-Za-z0-9_\-]{12,}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{16,}\b"),
    re.compile(r"\bBearer\s+[A-Za-z0-9._\-]{12,}", re.IGNORECASE),
)


def is_sensitive_key(key: str) -> bool:
    """判断字段名是否属于凭据类。"""
    if not key:
        return False
    lowered = key.strip().lower().replace("-", "_")
    if lowered in _SENSITIVE_EXACT:
        return True
    if lowered.endswith(_SENSITIVE_SUFFIXES):
        return True
    return any(token in lowered for token in _SENSITIVE_SUBSTRINGS)


def redact_text(text: str) -> str:
    """对自由文本做 key 形态擦洗。"""
    if not text:
        return text
    out = text
    for pattern in _TEXT_PATTERNS:
        out = pattern.sub(REDACTED, out)
    return out


def sanitize_log_value(value: Any, *, _depth: int = 0) -> Any:
    """递归脱敏任意 JSON 结构（dict / list / 标量）。"""
    if _depth > MAX_DEPTH:
        return "[TRUNCATED]"
    if isinstance(value, Mapping):
        return {
            str(k): (
                REDACTED
                if is_sensitive_key(str(k))
                else sanitize_log_value(v, _depth=_depth + 1)
            )
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [sanitize_log_value(item, _depth=_depth + 1) for item in value]
    if isinstance(value, str):
        return redact_text(value)
    return value


def sanitize_headers(headers: Mapping[str, Any]) -> dict[str, str]:
    """请求头脱敏：凭据头整条替换为 [REDACTED]。"""
    return {
        str(k): (REDACTED if is_sensitive_key(str(k)) else redact_text(str(v)))
        for k, v in headers.items()
    }


def dump_body(value: Any) -> tuple[str, bool]:
    """脱敏并序列化日志正文。

    返回 ``(文本, 是否截断)``：超过 ``CALL_LOG_BODY_MAX_BYTES`` 即按字节截断，
    并把截断事实回报给调用方置 ``CallLog.truncated``。
    """
    text = json.dumps(sanitize_log_value(value), ensure_ascii=False)
    raw = text.encode("utf-8")
    if len(raw) <= CALL_LOG_BODY_MAX_BYTES:
        return text, False
    return raw[:CALL_LOG_BODY_MAX_BYTES].decode("utf-8", errors="ignore"), True


def pick_level(*, ok: bool, degraded: bool = False) -> str:
    """调用日志级别：失败 error；成功但降级 warn；其余 info。"""
    if not ok:
        return CallLogLevel.ERROR.value
    return CallLogLevel.WARN.value if degraded else CallLogLevel.INFO.value
