"""提供方配置测试：CRUD、隔离、apiKey 掩码、连通/冒烟测试（上游 mock）。"""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.domain.enums import UserRole
from app.repositories.auth_repo import UserRepository
from app.repositories.models import User


def _make_user(client: TestClient, db: Session, username: str) -> str:
    password = f"{username}!Passw0rd"
    user = User(
        username=username,
        display_name=username,
        password_hash=hash_password(password),
        role=UserRole.USER.value,
        must_change_password=False,
        is_active=True,
    )
    UserRepository().add(db, user)
    db.commit()
    resp = client.post("/api/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ------------------------------------------------------------------ 上游 mock
class _FakeResponse:
    def __init__(self, status_code: int, payload: dict | None) -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = "" if payload is None else str(payload)

    def json(self) -> dict:
        if self._payload is None:
            raise ValueError("not json")
        return self._payload


class _FakeHttpClient:
    """替代 httpx.Client：按预设返回，或抛超时。"""

    def __init__(self, *, response=None, timeout_exc=False) -> None:
        self._response = response
        self._timeout_exc = timeout_exc

    def __enter__(self) -> "_FakeHttpClient":
        return self

    def __exit__(self, *args) -> bool:
        return False

    def post(self, url, json=None, headers=None):  # noqa: A002
        if self._timeout_exc:
            raise httpx.TimeoutException("timeout")
        return self._response


def _patch_httpx(monkeypatch: pytest.MonkeyPatch, *, response=None, timeout=False) -> None:
    def _factory(*args, **kwargs):
        return _FakeHttpClient(response=response, timeout_exc=timeout)

    monkeypatch.setattr(httpx, "Client", _factory)


# ------------------------------------------------------------------ CRUD
def _create_llm(client: TestClient, headers: dict) -> dict:
    resp = client.post(
        "/api/providers",
        json={
            "kind": "llm",
            "name": "我的 LLM",
            "endpoint_url": "https://api.example.com/v1/chat/completions",
            "api_key": "sk-abcdefghijklmnop",
            "model": "gpt-4o-mini",
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_create_returns_masked_key_only(client: TestClient, db: Session) -> None:
    """**apiKey 只进不出** —— 响应里绝不能出现明文。"""
    token = _make_user(client, db, "maskuser")
    body = _create_llm(client, _auth(token))

    assert "sk-abcdefghijklmnop" not in str(body)
    assert body["api_key_masked"].startswith("sk-a")
    assert "••••" in body["api_key_masked"]


def test_update_without_api_key_keeps_original(client: TestClient, db: Session) -> None:
    token = _make_user(client, db, "keepuser")
    headers = _auth(token)
    created = _create_llm(client, headers)

    updated = client.patch(
        f"/api/providers/{created['id']}", json={"name": "改名了"}, headers=headers
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "改名了"
    # 掩码不变 → 说明 Key 保持原值（空字符串不承担"清空"语义）
    assert updated.json()["api_key_masked"] == created["api_key_masked"]


def test_replace_api_key(client: TestClient, db: Session) -> None:
    token = _make_user(client, db, "repluser")
    headers = _auth(token)
    created = _create_llm(client, headers)

    updated = client.patch(
        f"/api/providers/{created['id']}", json={"api_key": "sk-ZZZZzzzz9999"}, headers=headers
    )
    assert updated.json()["api_key_masked"].startswith("sk-Z")


def test_only_one_default_per_kind(client: TestClient, db: Session) -> None:
    token = _make_user(client, db, "defuser")
    headers = _auth(token)

    first = client.post(
        "/api/providers",
        json={
            "kind": "llm",
            "name": "A",
            "endpoint_url": "https://a.example.com/v1",
            "api_key": "sk-aaaaaaaaaaaa",
            "model": "m1",
            "is_default": True,
        },
        headers=headers,
    ).json()
    second = client.post(
        "/api/providers",
        json={
            "kind": "llm",
            "name": "B",
            "endpoint_url": "https://b.example.com/v1",
            "api_key": "sk-bbbbbbbbbbbb",
            "model": "m2",
            "is_default": True,
        },
        headers=headers,
    ).json()

    rows = {item["id"]: item["is_default"] for item in client.get("/api/providers", headers=headers).json()}
    assert rows[second["id"]] is True
    assert rows[first["id"]] is False  # 旧的默认被清掉


def test_delete_provider(client: TestClient, db: Session) -> None:
    token = _make_user(client, db, "deluser")
    headers = _auth(token)
    created = _create_llm(client, headers)

    assert client.delete(f"/api/providers/{created['id']}", headers=headers).status_code == 204
    assert client.get("/api/providers", headers=headers).json() == []


# ------------------------------------------------------------------ 隔离
def test_provider_isolation(client: TestClient, db: Session) -> None:
    token_a = _make_user(client, db, "prov_a")
    token_b = _make_user(client, db, "prov_b")
    created = _create_llm(client, _auth(token_a))
    pid = created["id"]

    # B 看不到 A 的配置
    assert client.get("/api/providers", headers=_auth(token_b)).json() == []
    # B 改 / 删 / 测 A 的配置 → 一律 404
    assert client.patch(f"/api/providers/{pid}", json={"name": "x"}, headers=_auth(token_b)).status_code == 404
    assert client.delete(f"/api/providers/{pid}", headers=_auth(token_b)).status_code == 404
    assert client.post(f"/api/providers/{pid}/test", headers=_auth(token_b)).status_code == 404


# ------------------------------------------------------------------ 连通测试
def test_llm_connection_ok(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_httpx(
        monkeypatch,
        response=_FakeResponse(200, {"model": "gpt-4o-mini", "choices": [{"index": 0}], "usage": {"total_tokens": 3}}),
    )
    token = _make_user(client, db, "llmok")
    headers = _auth(token)
    created = _create_llm(client, headers)

    result = client.post(f"/api/providers/{created['id']}/test", headers=headers)
    assert result.status_code == 200
    body = result.json()
    assert body["ok"] is True
    assert "连通正常" in body["detail"]
    assert body["smoke"] is None  # LLM 不跑冒烟


def test_llm_connection_auth_failure(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_httpx(monkeypatch, response=_FakeResponse(401, {"error": "bad key"}))
    token = _make_user(client, db, "llmbad")
    headers = _auth(token)
    created = _create_llm(client, headers)

    body = client.post(f"/api/providers/{created['id']}/test", headers=headers).json()
    assert body["ok"] is False
    assert body["error_code"] == "LLM_UPSTREAM_ERROR"
    assert "API Key" in body["detail"]  # 错误信息要能指路


def test_llm_protocol_mismatch(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    """返回 JSON 但不是 OpenAI 结构 → 明确告知协议不匹配。"""
    _patch_httpx(monkeypatch, response=_FakeResponse(200, {"unexpected": True}))
    token = _make_user(client, db, "llmproto")
    headers = _auth(token)
    created = _create_llm(client, headers)

    body = client.post(f"/api/providers/{created['id']}/test", headers=headers).json()
    assert body["ok"] is False
    assert body["error_code"] == "PROTOCOL_MISMATCH"


def test_timeout_handled(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_httpx(monkeypatch, timeout=True)
    token = _make_user(client, db, "llmtimeout")
    headers = _auth(token)
    created = _create_llm(client, headers)

    body = client.post(f"/api/providers/{created['id']}/test", headers=headers).json()
    assert body["ok"] is False
    assert "超时" in body["detail"]


def _create_jev(client: TestClient, headers: dict) -> dict:
    resp = client.post(
        "/api/providers",
        json={
            "kind": "jev",
            "name": "我的 JEV",
            "endpoint_url": "https://api.typesafe.ai/v1/systemone",
            "api_key": "jev-key-abcdefgh",
            "model": "jev-latest",
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_jev_connection_and_smoke(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """JEV 连通过后应带冒烟报告与健康度。

    这里让 mock 对所有用例都回 0.9（负面/风险题"应高于阈值"，其余"应低于阈值"），
    因此**必然有对有错** —— 正好验证健康度是个真实的比例，而非恒 100。
    """
    _patch_httpx(
        monkeypatch,
        response=_FakeResponse(200, {"model": "jev-1.13.0", "answers": {"is_negative": {"type": "noul", "noul": 0.9}, "is_high_risk": {"type": "noul", "noul": 0.9}}}),
    )
    token = _make_user(client, db, "jevok")
    headers = _auth(token)
    created = _create_jev(client, headers)

    body = client.post(f"/api/providers/{created['id']}/test", headers=headers).json()
    assert body["ok"] is True
    assert body["model_reported"] == "jev-1.13.0"
    assert body["smoke"] is not None
    assert body["smoke"]["total"] == 5
    # 0.9 满足"负面 > 0.7"与"风险 > 0.7"，但不满足"低于阈值"的用例
    assert body["smoke"]["passed"] == 2
    assert body["smoke"]["health"] == 40


def test_jev_protocol_mismatch(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    """缺少 answers 字段 → 判定为协议不匹配。"""
    _patch_httpx(monkeypatch, response=_FakeResponse(200, {"choices": []}))
    token = _make_user(client, db, "jevproto")
    headers = _auth(token)
    created = _create_jev(client, headers)

    body = client.post(f"/api/providers/{created['id']}/test", headers=headers).json()
    assert body["ok"] is False
    assert body["error_code"] == "PROTOCOL_MISMATCH"


def test_jev_skip_smoke(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    """``with_smoke=false`` 时只验协议，不跑用例。"""
    _patch_httpx(
        monkeypatch,
        response=_FakeResponse(200, {"model": "jev-1.13.0", "answers": {"is_negative": {"type": "noul", "noul": 0.2}}}),
    )
    token = _make_user(client, db, "jevskip")
    headers = _auth(token)
    created = _create_jev(client, headers)

    body = client.post(
        f"/api/providers/{created['id']}/test", params={"with_smoke": "false"}, headers=headers
    ).json()
    assert body["ok"] is True
    assert body["smoke"] is None


def test_providers_require_auth(client: TestClient) -> None:
    assert client.get("/api/providers").status_code in (401, 403)
