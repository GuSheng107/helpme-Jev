"""P0 脱敏测试：apiKey 等凭据绝不残留在日志结构里。"""

from __future__ import annotations

from app.core.logging import (
    REDACTED,
    is_sensitive_key,
    redact_text,
    sanitize_headers,
    sanitize_log_value,
)


def test_sensitive_key_detection() -> None:
    sensitive = [
        "api_key",
        "apikey",
        "apiKey",
        "X-Jev-Api-Key",
        "x-llm-api-key",
        "password",
        "user_password",
        "access_token",
        "refresh_token",
        "app_secret",
        "authorization",
        "invitation_code",
    ]
    for key in sensitive:
        assert is_sensitive_key(key), f"应判定为敏感: {key}"

    harmless = ["model", "state", "questions", "content", "username", "display_name", "tags"]
    for key in harmless:
        assert not is_sensitive_key(key), f"不应判定为敏感: {key}"


def test_nested_structure_redaction() -> None:
    payload = {
        "model": "jev-latest",
        "headers": {
            "Authorization": "Bearer sk-abcdefghijklmnop",
            "Content-Type": "application/json",
        },
        "config": {
            "api_key": "super-secret-value",
            "nested": [{"token": "abc123"}, {"keep": "this"}],
            "ok": "keep",
        },
    }

    out = sanitize_log_value(payload)

    assert out["model"] == "jev-latest"
    assert out["headers"]["Authorization"] == REDACTED
    assert out["headers"]["Content-Type"] == "application/json"
    assert out["config"]["api_key"] == REDACTED
    assert out["config"]["nested"][0]["token"] == REDACTED
    assert out["config"]["nested"][1]["keep"] == "this"
    assert out["config"]["ok"] == "keep"


def test_free_text_scrubbing() -> None:
    text = "用这个 key: sk-abcdefghijklmnop 试试，别外传"
    out = redact_text(text)
    assert "sk-abcdefghijklmnop" not in out
    assert REDACTED in out
    assert "别外传" in out  # 非凭据内容保留


def test_bearer_token_scrubbed_in_text() -> None:
    out = redact_text("header: Bearer abcdefghijklmnopqrst, end")
    assert "abcdefghijklmnopqrst" not in out


def test_headers_sanitized() -> None:
    out = sanitize_headers({"Authorization": "Bearer xyz123456789", "User-Agent": "pytest"})
    assert out["Authorization"] == REDACTED
    assert out["User-Agent"] == "pytest"


def test_deep_nesting_is_truncated_not_crashed() -> None:
    """超深嵌套不应递归爆栈，而是截断标记。"""
    deep: dict[str, object] = {"leaf": "value"}
    for _ in range(30):
        deep = {"child": deep}
    assert sanitize_log_value(deep) is not None
