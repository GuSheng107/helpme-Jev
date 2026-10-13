"""重试退避测试：核对连接瞬断的自动重试，不访问外部接口。"""

from __future__ import annotations

import httpx
import pytest

from app.clients import retry
from app.clients.retry import post_with_backoff


class _StubClient:
    """按脚本产出结果或抛异常的假 client，记录调用次数。"""

    def __init__(self, script: list):
        self.script = list(script)
        self.calls = 0

    def post(self, *_args, **_kwargs):
        self.calls += 1
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    """退避不真等，测试保持快。"""
    monkeypatch.setattr(retry.time, "sleep", lambda *_: None)


def test_connect_error_then_success_retries(monkeypatch: pytest.MonkeyPatch) -> None:
    """首次连接瞬断、第二次成功：应自动重试并返回成功响应。"""
    ok = httpx.Response(200, json={"choices": []})
    client = _StubClient([httpx.ConnectError("boom"), ok])
    response = post_with_backoff(
        client, "https://example.com/v1/chat/completions",
        json={}, headers={}, timeout=10,
    )
    assert response.status_code == 200
    assert client.calls == 2


def test_connect_error_exhausts_then_raises() -> None:
    """连续瞬断：重试用尽后原样抛出，交由上层转友好错误。"""
    client = _StubClient([httpx.ConnectError("boom")] * retry.MAX_ATTEMPTS)
    with pytest.raises(httpx.ConnectError):
        post_with_backoff(
            client, "https://example.com/v1/chat/completions",
            json={}, headers={}, timeout=10,
        )
    assert client.calls == retry.MAX_ATTEMPTS


def test_success_first_try_no_retry() -> None:
    """一次就通：不多打请求。"""
    client = _StubClient([httpx.Response(200, json={"ok": True})])
    response = post_with_backoff(
        client, "https://example.com/v1/chat/completions",
        json={}, headers={}, timeout=10,
    )
    assert response.status_code == 200
    assert client.calls == 1


def test_server_error_still_retries() -> None:
    """原有行为不回退：5xx 仍退避重试。"""
    client = _StubClient([httpx.Response(503), httpx.Response(200, json={"ok": True})])
    response = post_with_backoff(
        client, "https://example.com/v1/chat/completions",
        json={}, headers={}, timeout=10,
    )
    assert response.status_code == 200
    assert client.calls == 2
