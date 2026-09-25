"""LLM 客户端：按 OpenAI Chat Completions、Responses 或 Anthropic Messages 协议请求。"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field

import httpx

from .http_client import get_client
from .retry import post_with_backoff

TIMEOUT_SECONDS = 60
# Anthropic Messages 要求 max_tokens；64 覆盖这次实测中 33 个推理 token 加最终答案。
ANTHROPIC_PROBE_MAX_TOKENS = 64
VISION_TIMEOUT_SECONDS = 75


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


def _root(base_url: str) -> str:
    """用户填到 /v1 即可，去掉已经带上的具体路径。"""
    cleaned = base_url.rstrip("/")
    for suffix in ("/chat/completions", "/responses", "/v1/messages", "/messages"):
        if cleaned.endswith(suffix):
            cleaned = cleaned[: -len(suffix)]
    return cleaned.rstrip("/")


def endpoint_for(base_url: str, protocol: str) -> str:
    root = _root(base_url)
    if protocol == "anthropic":
        return root + "/messages" if root.endswith("/v1") else root + "/v1/messages"
    if protocol == "openai_responses":
        return root + "/responses"
    return root + "/chat/completions"


def _headers(api_key: str, protocol: str) -> dict[str, str]:
    if protocol == "anthropic":
        return {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def _post_with_protocol_headers(
    client: httpx.Client,
    url: str,
    *,
    body: dict,
    api_key: str,
    protocol: str,
    timeout: float,
    retry_transient: bool = False,
) -> httpx.Response:
    """仅使用所选 API 协议定义的认证头和请求格式。"""
    headers = _headers(api_key, protocol)
    if retry_transient:
        return post_with_backoff(client, url, json=body, headers=headers, timeout=timeout)
    return client.post(url, json=body, headers=headers, timeout=timeout)


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


# 1x1 纯红 PNG，用来确认模型真的能看图
_RED_PIXEL = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ"
    "/pLvAAAAAElFTkSuQmCC"
)


def _probe_body(protocol: str, model: str, *, vision: bool) -> dict:
    """连通试题：OpenAI 协议不设输出 token 上限；Anthropic 使用必填的 max_tokens。"""
    if vision:
        ask = "What color is this image? Reply with the color word only."
        if protocol == "anthropic":
            return {
                "model": model,
                "max_tokens": ANTHROPIC_PROBE_MAX_TOKENS,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": ask},
                            {
                                "type": "image",
                                "source": {"type": "base64", "media_type": "image/png", "data": _RED_PIXEL},
                            },
                        ],
                    }
                ],
            }
        if protocol == "openai_responses":
            return {
                "model": model,
                "input": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "input_text", "text": ask},
                            {
                                "type": "input_image",
                                "image_url": f"data:image/png;base64,{_RED_PIXEL}",
                                "detail": "low",
                            },
                        ],
                    }
                ],
            }
        return {
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": ask},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{_RED_PIXEL}", "detail": "low"},
                        },
                    ],
                }
            ],
        }
    ask = "Reply with exactly: ok"
    if protocol == "anthropic":
        return {
            "model": model,
            "max_tokens": ANTHROPIC_PROBE_MAX_TOKENS,
            "messages": [{"role": "user", "content": ask}],
        }
    if protocol == "openai_responses":
        return {"model": model, "input": ask}
    return {"model": model, "messages": [{"role": "user", "content": ask}]}


def test_connection(
    *,
    endpoint_url: str,
    api_key: str,
    model: str,
    protocol: str = "openai",
    vision: bool = False,
    timeout: int = TIMEOUT_SECONDS,
) -> UpstreamResult:
    """发一道固定试题，验证 URL / Key / 模型是否真能用。"""
    import time

    started = time.perf_counter()
    url = endpoint_for(endpoint_url, protocol)
    body = _probe_body(protocol, model, vision=vision)

    try:
        response = _post_with_protocol_headers(
            get_client(),
            url,
            body=body,
            api_key=api_key,
            protocol=protocol,
            timeout=timeout,
        )
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

    if not isinstance(data, dict):
        return UpstreamResult(
            ok=False,
            status_code=response.status_code,
            latency_ms=latency,
            detail="响应不是 JSON 对象",
            error_code="PROTOCOL_MISMATCH",
        )

    if protocol == "anthropic" and (not isinstance(data, dict) or "content" not in data):
        return UpstreamResult(
            ok=False,
            status_code=response.status_code,
            latency_ms=latency,
            detail="响应不是 Anthropic Messages 格式",
            error_code="PROTOCOL_MISMATCH",
        )

    if protocol == "openai" and (not isinstance(data, dict) or "choices" not in data):
        return UpstreamResult(
            ok=False,
            status_code=response.status_code,
            latency_ms=latency,
            detail="响应缺少 choices 字段 —— 该端点可能不是 OpenAI 兼容接口",
            error_code="PROTOCOL_MISMATCH",
        )

    if protocol == "openai_responses":
        reply = _responses_text(data) if isinstance(data, dict) else ""
    elif protocol == "anthropic":
        reply = _anthropic_text(data) if isinstance(data, dict) else ""
    else:
        reply = _message_text(data if isinstance(data, dict) else {})

    reply_lower = reply.lower()
    passed = ("red" in reply_lower or "红" in reply) if vision else "ok" in reply_lower
    if not passed:
        if not reply:
            detail = "上游请求成功但没有可见文本；请检查模型输出或响应内容"
            error_code = "EMPTY_MODEL_RESPONSE"
        elif vision:
            detail = "模型未能从图片中识别出要求的颜色"
            error_code = "PROTOCOL_MISMATCH"
        else:
            detail = "模型没有按要求作答"
            error_code = "PROTOCOL_MISMATCH"
        return UpstreamResult(
            ok=False,
            status_code=response.status_code,
            latency_ms=latency,
            detail=detail,
            error_code=error_code,
            payload={"reply": reply},
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


def _to_anthropic(messages: list[dict]) -> tuple[str, list[dict]]:
    """OpenAI 风格消息转成 Anthropic：system 单独抽出，图片块改写。"""
    system: list[str] = []
    converted: list[dict] = []
    for message in messages:
        role = message.get("role")
        content = message.get("content")
        if role == "system":
            system.append(content if isinstance(content, str) else "")
            continue
        if isinstance(content, list):
            blocks = []
            for item in content:
                if not isinstance(item, dict):
                    continue
                if item.get("type") == "text":
                    blocks.append({"type": "text", "text": item.get("text", "")})
                elif item.get("type") == "image_url":
                    url = str((item.get("image_url") or {}).get("url") or "")
                    if url.startswith("data:") and "," in url:
                        header, payload = url.split(",", 1)
                        media = header.split(";")[0].removeprefix("data:") or "image/png"
                        blocks.append(
                            {
                                "type": "image",
                                "source": {"type": "base64", "media_type": media, "data": payload},
                            }
                        )
            content = blocks
        converted.append({"role": "user" if role != "assistant" else "assistant", "content": content})
    return "\n".join(part for part in system if part), converted


def _to_responses(messages: list[dict]) -> tuple[str, list[dict]]:
    """保留系统指令，并把 Chat 图片块转换为 Responses 输入块。"""
    system: list[str] = []
    converted: list[dict] = []
    for message in messages:
        role = message.get("role")
        content = message.get("content")
        if role == "system":
            if isinstance(content, str):
                system.append(content)
            continue
        if role not in {"user", "assistant"}:
            continue
        if isinstance(content, list):
            blocks: list[dict] = []
            for item in content:
                if not isinstance(item, dict):
                    continue
                if item.get("type") == "text":
                    blocks.append({"type": "input_text", "text": str(item.get("text") or "")})
                elif item.get("type") == "image_url":
                    image = item.get("image_url") or {}
                    if isinstance(image, dict) and image.get("url"):
                        block = {"type": "input_image", "image_url": image["url"]}
                        if image.get("detail"):
                            block["detail"] = image["detail"]
                        blocks.append(block)
            content = blocks
        converted.append({"role": role, "content": content})
    return "\n".join(system), converted


def _responses_text(data: dict) -> str:
    output_text = data.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()
    parts: list[str] = []
    for item in data.get("output") or []:
        if not isinstance(item, dict):
            continue
        for block in item.get("content") or []:
            if isinstance(block, dict) and isinstance(block.get("text"), str):
                parts.append(block["text"])
    return "\n".join(parts).strip()


def _anthropic_text(data: dict) -> str:
    blocks = data.get("content")
    if not isinstance(blocks, list):
        return ""
    return "\n".join(
        block.get("text", "")
        for block in blocks
        if isinstance(block, dict) and block.get("type") == "text"
    ).strip()


def _format_ladder(response_schema: dict | None) -> list[dict | None]:
    """``response_format`` 的降级阶梯，末档 None 表示不带该字段。

    给了 schema 就从受约束的 ``json_schema`` 起步；网关不认时退到只保证合法
    JSON 的 ``json_object``，再不认就整段摘掉（提示词里已要求只回 JSON）。
    """
    ladder: list[dict | None] = []
    if response_schema is not None:
        ladder.append(
            {
                "type": "json_schema",
                "json_schema": {"name": "result", "strict": True, "schema": response_schema},
            }
        )
    ladder.extend([{"type": "json_object"}, None])
    return ladder


def chat_json(
    *,
    endpoint_url: str,
    api_key: str,
    model: str,
    messages: list[dict],
    protocol: str = "openai",
    timeout: int = TIMEOUT_SECONDS,
    max_output_tokens: int = 1024,
    response_schema: dict | None = None,
) -> UpstreamResult:
    """一次 chat 调用，要求返回 JSON 对象。

    ``response_schema`` 传 JSON Schema 时优先用 ``json_schema`` 受约束解码，
    上游不认就按 ``json_object`` → 不带 ``response_format`` 逐档降级重试，
    因此网关支持程度不一也不会直接判死。
    成功时 ``payload`` 是解析后的 JSON 对象，不是原始响应。
    """
    started = time.perf_counter()
    url = endpoint_for(endpoint_url, protocol)
    if protocol == "anthropic":
        system, converted = _to_anthropic(messages)
        body = {
            "model": model,
            "max_tokens": max_output_tokens,
            "system": system + "\nReply with a single JSON object and nothing else.",
            "messages": converted,
        }
    elif protocol == "openai_responses":
        system, converted = _to_responses(messages)
        body = {
            "model": model,
            "max_output_tokens": max_output_tokens,
            "instructions": "\n".join(
                part for part in (system, "Reply with a single JSON object and nothing else.") if part
            ),
            "input": converted,
        }
    else:
        body = {
            "model": model,
            "messages": messages,
            "temperature": 0,
        }

    def _post(payload: dict) -> httpx.Response:
        return _post_with_protocol_headers(
            get_client(),
            url,
            body=payload,
            api_key=api_key,
            protocol=protocol,
            timeout=timeout,
            retry_transient=True,
        )

    ladder: list[dict | None] = [None] if protocol != "openai" else _format_ladder(response_schema)
    response: httpx.Response | None = None
    try:
        for fmt in ladder:
            if fmt is None:
                body.pop("response_format", None)
            else:
                body["response_format"] = fmt
            response = _post(body)
            if response.status_code != 400:
                break
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

    assert response is not None
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

    if protocol == "anthropic" and isinstance(data, dict):
        text = _anthropic_text(data)
    elif protocol == "openai_responses" and isinstance(data, dict):
        text = _responses_text(data)
    else:
        text = _message_text(data if isinstance(data, dict) else {})
    candidate = text.strip()
    if candidate.startswith("```") and candidate.endswith("```"):
        candidate = candidate.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    try:
        parsed = json.loads(candidate) if candidate else None
    except json.JSONDecodeError:
        parsed = None
    if not isinstance(parsed, dict):
        choices = data.get("choices") if isinstance(data, dict) else None
        first = choices[0] if isinstance(choices, list) and choices else {}
        return UpstreamResult(
            ok=False,
            status_code=response.status_code,
            latency_ms=latency,
            detail="模型没有返回 JSON 对象",
            error_code="PROTOCOL_MISMATCH",
            payload={
                "response_excerpt": text[:1000],
                "finish_reason": first.get("finish_reason") if isinstance(first, dict) else None,
            },
        )

    return UpstreamResult(
        ok=True,
        status_code=response.status_code,
        latency_ms=latency,
        detail="ok",
        payload=parsed,
    )
