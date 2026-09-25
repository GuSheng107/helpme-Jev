"""协议适配测试：核对请求体与模型响应，不访问外部接口。"""

from __future__ import annotations

import httpx
import pytest

from app.clients.llm_client import chat_json, test_connection as check_connection


def test_responses_preserves_system_text_and_image(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[dict] = []
    response = httpx.Response(
        200,
        json={"output": [{"content": [{"type": "output_text", "text": '{"description":"ok"}'}]}]},
    )

    class FakeClient:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def post(self, url, json, headers, timeout=None):
            sent.append({"url": url, "body": json, "headers": headers})
            return response

    monkeypatch.setattr(httpx, "Client", FakeClient)
    result = chat_json(
        endpoint_url="https://example.com/v1",
        api_key="test-key",
        model="test-model",
        protocol="openai_responses",
        messages=[
            {"role": "system", "content": "Describe only visible facts."},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "What is shown?"},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}},
                ],
            },
        ],
    )
    assert result.ok is True
    assert result.payload == {"description": "ok"}
    assert sent[0]["url"] == "https://example.com/v1/responses"
    assert "Describe only visible facts." in sent[0]["body"]["instructions"]
    assert sent[0]["body"]["input"] == [
        {
            "role": "user",
            "content": [
                {"type": "input_text", "text": "What is shown?"},
                {"type": "input_image", "image_url": "data:image/png;base64,AAAA"},
            ],
        }
    ]


def test_responses_connection_rejects_non_object(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeClient:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def post(self, *_args, **_kwargs):
            return httpx.Response(200, json=[])

    monkeypatch.setattr(httpx, "Client", FakeClient)
    result = check_connection(
        endpoint_url="https://example.com/v1",
        api_key="test-key",
        model="test-model",
        protocol="openai_responses",
    )
    assert result.ok is False
    assert result.error_code == "PROTOCOL_MISMATCH"


_SCHEMA = {
    "type": "object",
    "properties": {"question": {"type": "string"}},
    "required": ["question"],
    "additionalProperties": False,
}


def _chat_kwargs() -> dict:
    return {
        "endpoint_url": "https://example.com/v1",
        "api_key": "test-key",
        "model": "test-model",
        "response_schema": _SCHEMA,
        "messages": [{"role": "user", "content": "translate"}],
    }


def test_json_schema_falls_back_to_json_object(monkeypatch: pytest.MonkeyPatch) -> None:
    """网关不认 json_schema 时降到 json_object，而不是直接判失败。"""
    sent: list[object] = []

    class FakeClient:
        def __init__(self, **_kwargs):
            pass

        def post(self, url, json, headers, timeout=None):  # noqa: A002
            fmt = json.get("response_format")
            sent.append(fmt.get("type") if isinstance(fmt, dict) else None)
            if isinstance(fmt, dict) and fmt["type"] == "json_schema":
                return httpx.Response(400, json={"error": "response_format not supported"})
            return httpx.Response(
                200, json={"choices": [{"message": {"content": '{"question":"ok"}'}}]}
            )

    monkeypatch.setattr(httpx, "Client", FakeClient)
    result = chat_json(**_chat_kwargs())
    assert result.ok is True
    assert result.payload == {"question": "ok"}
    assert sent == ["json_schema", "json_object"]


def test_response_format_dropped_when_both_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    """两档都不认时整段摘掉 response_format，仍能拿到 JSON。"""
    sent: list[bool] = []

    class FakeClient:
        def __init__(self, **_kwargs):
            pass

        def post(self, url, json, headers, timeout=None):  # noqa: A002
            sent.append("response_format" in json)
            if "response_format" in json:
                return httpx.Response(400, json={"error": "response_format not supported"})
            return httpx.Response(
                200, json={"choices": [{"message": {"content": '{"question":"ok"}'}}]}
            )

    monkeypatch.setattr(httpx, "Client", FakeClient)
    result = chat_json(**_chat_kwargs())
    assert result.ok is True
    assert sent == [True, True, False]


def test_json_schema_tier_carries_strict_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    """受约束解码那一档必须带 strict 与完整 schema，否则约束不生效。"""
    sent: list[dict] = []

    class FakeClient:
        def __init__(self, **_kwargs):
            pass

        def post(self, url, json, headers, timeout=None):  # noqa: A002
            sent.append(json)
            return httpx.Response(
                200, json={"choices": [{"message": {"content": '{"question":"ok"}'}}]}
            )

    monkeypatch.setattr(httpx, "Client", FakeClient)
    result = chat_json(**_chat_kwargs())
    assert result.ok is True
    assert sent[0]["response_format"] == {
        "type": "json_schema",
        "json_schema": {"name": "result", "strict": True, "schema": _SCHEMA},
    }
