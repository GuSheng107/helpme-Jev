"""P7：日志、数据导出与账号注销。上游一律 mock。"""

from __future__ import annotations

import json

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.domain.enums import UserRole
from app.repositories.auth_repo import UserRepository
from app.repositories.models import User


def _user(client: TestClient, db: Session, username: str) -> tuple[dict[str, str], str]:
    password = f"{username}!Passw0rd"
    UserRepository().add(
        db,
        User(
            username=username,
            display_name=username,
            password_hash=hash_password(password),
            role=UserRole.USER.value,
            must_change_password=False,
            is_active=True,
        ),
    )
    db.commit()
    resp = client.post("/api/auth/login", json={"username": username, "password": password})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}, password


def _configure(client: TestClient, headers: dict) -> None:
    for kind in ("llm", "jev"):
        created = client.post(
            "/api/providers",
            headers=headers,
            json={
                "kind": kind,
                "name": kind,
                "endpoint_url": (
                    "https://llm.example/v1/chat/completions"
                    if kind == "llm"
                    else "https://jev.example/v1/systemone"
                ),
                "api_key": "sk-abcdefghijklmnop",
                "model": kind,
                "is_default": True,
            },
        )
        assert created.status_code == 201, created.text


class _Resp:
    def __init__(self, payload) -> None:
        self.status_code = 200
        self._payload = payload
        self.text = json.dumps(payload)

    def json(self):
        return self._payload


def json_dumps(value) -> str:
    return json.dumps(value, ensure_ascii=False)


class _FullRouter:
    """翻译 + JEV 判断的完整 mock。"""

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def post(self, url, json=None, headers=None):  # noqa: A002
        if "systemone" not in url:
            return _Resp(
                {
                    "choices": [
                        {"message": {"content": json_dumps({"lines": [{"id": "1", "text": "Again? [short; blame]"}]})}}
                    ]
                }
            )
        return _Resp(
            {
                "model": "jev-1.13.0",
                "answers": {
                    "danger_level": {"score": 4},
                    "best_action": {"choice": "acknowledge"},
                    "she_needs": {"choice": "care"},
                    "emotion": {"choice": "wronged"},
                    "true_intent": {"choice": "confirm_you_care"},
                    "context_sufficient": {"noul": 0.9},
                },
            }
        )


def _run_analysis(client: TestClient, headers: dict, monkeypatch: pytest.MonkeyPatch) -> str:
    conv_id = client.post(
        "/api/conversations",
        headers=headers,
        json={"title": "聊天", "counterpart_name": "小林"},
    ).json()["id"]
    client.post(
        f"/api/conversations/{conv_id}/messages",
        headers=headers,
        json={"role": "other", "content": "你是不是又忘了。"},
    )
    monkeypatch.setattr(httpx, "Client", lambda *args, **kwargs: _FullRouter())
    judged = client.post("/api/chat/analyze", json={"conversation_id": conv_id}, headers=headers)
    assert judged.status_code == 200, judged.text
    return judged.json()["trace_id"]


def test_logs_list_and_trace_filter(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers, _ = _user(client, db, "logsone")
    _configure(client, headers)
    trace_id = _run_analysis(client, headers, monkeypatch)

    listed = client.get("/api/logs", headers=headers)
    assert listed.status_code == 200, listed.text
    body = listed.json()
    assert body["total"] >= 2  # 翻译 + 判断各一条
    translate = next(
        item for item in body["items"] if item["kind"] == "llm" and item["phase"] == "translate"
    )
    # 中英并排：请求里就带着 原文/译文 成对
    lines = translate["request"]["lines"]
    assert lines[0]["original"] == "你是不是又忘了。"
    assert "Again?" in lines[0]["annotated"]
    # 密钥绝不出现
    assert "sk-abcdefghijklmnop" not in json.dumps(body, ensure_ascii=False)

    filtered = client.get("/api/logs", headers=headers, params={"trace_id": trace_id})
    assert all(item["trace_id"] == trace_id for item in filtered.json()["items"])

    by_kind = client.get("/api/logs", headers=headers, params={"kind": "jev"})
    assert all(item["kind"] == "jev" for item in by_kind.json()["items"])


def test_logs_isolated_between_users(client: TestClient, db: Session) -> None:
    headers_a, _ = _user(client, db, "logsisa")
    headers_b, _ = _user(client, db, "logsisb")
    listed = client.get("/api/logs", headers=headers_b)
    assert listed.json()["total"] == 0


def test_export_contains_personal_data(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers, _ = _user(client, db, "exportone")
    _configure(client, headers)
    _run_analysis(client, headers, monkeypatch)
    exported = client.get("/api/account/export", headers=headers)
    assert exported.status_code == 200, exported.text
    body = exported.json()
    assert body["user"]["username"] == "exportone"
    assert len(body["conversations"]) >= 1
    assert "你是不是又忘了。" in json.dumps(body, ensure_ascii=False)
    # 不含密钥明文
    assert "sk-abcdefghijklmnop" not in json.dumps(body, ensure_ascii=False)


def test_account_deletion_requires_password_and_cascades(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers, password = _user(client, db, "deleteone")
    _configure(client, headers)
    _run_analysis(client, headers, monkeypatch)

    wrong = client.request(
        "DELETE", "/api/account", headers=headers, json={"password": "wrong-password"}
    )
    assert wrong.status_code == 422

    gone = client.request(
        "DELETE", "/api/account", headers=headers, json={"password": password}
    )
    assert gone.status_code == 204

    # token 立即失效，数据全没了
    assert client.get("/api/logs", headers=headers).status_code == 401
    assert client.get("/api/conversations", headers=headers).status_code == 401
    from app.repositories.auth_repo import UserRepository

    assert UserRepository().by_username(db, "deleteone") is None
