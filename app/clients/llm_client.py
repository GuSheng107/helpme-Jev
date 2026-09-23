"""OpenAI 兼容 LLM 客户端：连通测试与 JSON chat。

约定：请求走 ``POST {endpoint_url}``（用户填完整 URL），
``Authorization: Bearer <key>``；**不做 provider 推断、不拼路径**。
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field

import httpx

TIMEOUT_SECONDS = 60
# 连通测试只花极少的 token
PROBE_MAX_TOKENS = 1


@dataclass
class UpstreamResult:
    """上游调用结果（成功或失败都返回，由调用方决定怎么呈现）。"""

    ok: bool
    status_code: int | None = None
    latency_ms: int = 0
    detail: str = ""
    # 业务侧需要的响应体（已由调用方决定是否入库）
    payload: dict = field(default_factory=dict)
    error_code: str = ""


def _auth_headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


def _explain_status(status: int, body_text: str) -> str:
    """把上游状态码翻译成人能看懂的原因（便于用户排障）。"""
    snippet = (body_text or "").strip()[:300]
    hints = {
        400: "请求被拒绝 —— 常见于模型名不存在或参数不被支持",
        401: "鉴权失败 —— 请检查 API Key",
        403: "无权访问 —— Key 有效但无该模型权限，或被地区/策略限制",
        404: "端点不存在 —— 请检查 URL 是否填错（应为完整路径）",
        422: "参数校验失败 —— 端点可能不是 OpenAI 兼容协议",
        429: "触发限流 —— Key 可用但当前超频",
        500: "上游内部错误",
        502: "上游网关错误",
        503: "上游服务不可用",
        504: "上游超时",
    }
    hint = hints.get(status, "未预期的状态码")
    return f"HTTP {status}：{hint}" + (f"；响应摘要：{snippet}" if snippet else "")


def test_connection(
    *,
    endpoint_url: str,
    api_key: str,
    model: str,
    timeout: int = TIMEOUT_SECONDS,
) -> UpstreamResult:
    """发一个最小 chat 请求，验证 URL / Key / 模型三者是否可用。"""
    import time

    started = time.perf_counter()
    body = {
        "model": model,
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": PROBE_MAX_TOKENS,
    }

    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.post(endpoint_url, json=body, headers=_auth_headers(api_key))
    except httpx.TimeoutException:
        return UpstreamResult(
            ok=False,
            latency_ms=int((time.perf_counter() - started) * 1000),
            detail=f"连接超时（>{timeout}s）—— 请检查 URL 与网络",
            error_code="LLM_UPSTREAM_ERROR",
        )
    except httpx.HTTPError as exc:
        return UpstreamResult(
            ok=False,
            latency_ms=int((time.perf_counter() - started) * 1000),
            detail=f"网络错误：{type(exc).__name__}",
            error_code="LLM_UPSTREAM_ERROR",
        )

    latency = int((time.perf_counter() - started) * 1000)

    if response.status_code >= 400:
        return UpstreamResult(
            ok=False,
            status_code=response.status_code,
            latency_ms=latency,
            detail=_explain_status(response.status_code, response.text),
            error_code="LLM_UPSTREAM_ERROR",
        )

    try:
        data = response.json()
    except ValueError:
        return UpstreamResult(
            ok=False,
            status_code=response.status_code,
            latency_ms=latency,
            detail="返回内容不是 JSON —— 该端点可能不是 OpenAI 兼容接口",
            error_code="PROTOCOL_MISMATCH",
        )

    if not isinstance(data, dict) or "choices" not in data:
        return UpstreamResult(
            ok=False,
            status_code=response.status_code,
            latency_ms=latency,
            detail="响应缺少 choices 字段 —— 该端点可能不是 OpenAI 兼容接口",
            error_code="PROTOCOL_MISMATCH",
        )

    usage = data.get("usage") or {}
    return UpstreamResult(
        ok=True,
        status_code=response.status_code,
        latency_ms=latency,
        detail=f"连通正常；模型 {data.get('model') or model}；用量 {usage.get('total_tokens', '—')} tokens",
        payload=data,
    )


def _message_text(data: dict) -> str:
    """从 chat completion 里取出助手文本。兼容字符串与多段 content。"""
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    if not isinstance(message, dict):
        return ""
    content = message.get("content")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = [
            item.get("text", "")
            for item in content
            if isinstance(item, dict) and isinstance(item.get("text"), str)
        ]
        return "\n".join(part for part in parts if part).strip()
    return ""


def chat_json(
    *,
    endpoint_url: str,
    api_key: str,
    model: str,
    messages: list[dict],
    timeout: int = TIMEOUT_SECONDS,
) -> UpstreamResult:
    """一次 chat 调用，要求返回 JSON 对象。

    ``response_format`` 不被支持（400）时去掉该字段重试一次。
    成功时 ``payload`` 是解析后的 JSON 对象，不是原始响应。
    """
    started = time.perf_counter()
    body: dict = {
        "model": model,
        "messages": messages,
        "temperature": 0,
        "response_format": {"type": "json_object"},
    }

    def _post(payload: dict) -> httpx.Response:
        with httpx.Client(timeout=timeout) as client:
            return client.post(endpoint_url, json=payload, headers=_auth_headers(api_key))

    try:
        response = _post(body)
        if response.status_code == 400 and "response_format" in body:
            body.pop("response_format")
            response = _post(body)
    except httpx.TimeoutException:
        return UpstreamResult(
            ok=False,
            latency_ms=int((time.perf_counter() - started) * 1000),
            detail=f"连接超时（>{timeout}s）—— 请检查 URL 与网络",
            error_code="LLM_UPSTREAM_ERROR",
        )
    except httpx.HTTPError as exc:
        return UpstreamResult(
            ok=False,
            latency_ms=int((time.perf_counter() - started) * 1000),
            detail=f"网络错误：{type(exc).__name__}",
            error_code="LLM_UPSTREAM_ERROR",
        )

    latency = int((time.perf_counter() - started) * 1000)
    if response.status_code >= 400:
        return UpstreamResult(
            ok=False,
            status_code=response.status_code,
            latency_ms=latency,
            detail=_explain_status(response.status_code, response.text),
            error_code="LLM_UPSTREAM_ERROR",
        )

    try:
        data = response.json()
    except ValueError:
        return UpstreamResult(
            ok=False,
            status_code=response.status_code,
            latency_ms=latency,
            detail="返回内容不是 JSON —— 该端点可能不是 OpenAI 兼容接口",
            error_code="PROTOCOL_MISMATCH",
        )

    text = _message_text(data if isinstance(data, dict) else {})
    try:
        parsed = json.loads(text) if text else None
    except json.JSONDecodeError:
        parsed = None
    if not isinstance(parsed, dict):
        return UpstreamResult(
            ok=False,
            status_code=response.status_code,
            latency_ms=latency,
            detail="模型没有返回 JSON 对象",
            error_code="PROTOCOL_MISMATCH",
        )

    return UpstreamResult(
        ok=True,
        status_code=response.status_code,
        latency_ms=latency,
        detail="ok",
        payload=parsed,
    )
