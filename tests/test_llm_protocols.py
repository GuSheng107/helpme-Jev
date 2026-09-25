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

