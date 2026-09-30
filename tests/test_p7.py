"""P7：日志、数据导出与账号注销。上游一律 mock。"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.domain.enums import UserRole
from app.repositories.auth_repo import UserRepository
from app.repositories.models import CallLog, ProviderConfig, User
from tests.profile_seed import seed_profile, user_id_by_name


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


def _configure(client: TestClient, db: Session, headers: dict) -> None:
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
        # 本组用例只测业务日志；模拟已完成连通性测试的提供方。
        provider = db.get(ProviderConfig, created.json()["id"])
        assert provider is not None
        provider.last_test_ok = True
        provider.is_enabled = True
        db.commit()


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

    def post(self, url, json=None, headers=None, timeout=None):  # noqa: A002
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


def _run_analysis(
    client: TestClient, db: Session, username: str, headers: dict, monkeypatch: pytest.MonkeyPatch
) -> str:
    # 人设前置：先给对象播种档案，再引用档案建单聊
    conv_id = client.post(
        "/api/conversations",
        headers=headers,
        json={
            "title": "聊天",
            "profile_id": seed_profile(db, user_id_by_name(db, username), "小林"),
        },
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
    _configure(client, db, headers)
    trace_id = _run_analysis(client, db, "logsone", headers, monkeypatch)

    listed = client.get("/api/logs", headers=headers)
    assert listed.status_code == 200, listed.text
    body = listed.json()
    assert body["total"] >= 3  # 请求摘要 + 翻译 + 判断
    translate = next(
        item for item in body["items"] if item["source"] == "LLM" and item["summary"].startswith("翻译")
    )
    # 中英并排：请求里就带着 原文/译文 成对
    lines = json.loads(translate["detail"])["request"]["lines"]
    assert lines[0]["original"] == "你是不是又忘了。"
    assert "Again?" in lines[0]["annotated"]
    # 密钥绝不出现
    assert "sk-abcdefghijklmnop" not in json.dumps(body, ensure_ascii=False)

    filtered = client.get("/api/logs", headers=headers, params={"trace_id": trace_id})
    trace_items = filtered.json()["items"]
    assert all(item["trace_id"] == trace_id for item in trace_items)
    assert {item["source"] for item in trace_items} >= {"用户", "LLM", "JEV"}
    assert any(item["summary"].startswith("发起聊天判断") for item in trace_items)

    by_level = client.get("/api/logs", headers=headers, params={"level": "info"})
    assert all(item["level"] == "info" for item in by_level.json()["items"])
    by_category = client.get("/api/logs", headers=headers, params={"category": "chat"})
    assert by_category.status_code == 200
    assert all(item["category"] == "chat" for item in by_category.json()["items"])

    logged_at = datetime.fromisoformat(translate["created_at"].replace("Z", "+00:00"))
    local_time = logged_at.astimezone(timezone(timedelta(hours=8))).isoformat()
    exact_window = client.get(
        "/api/logs",
        headers=headers,
        params={
            "category": "chat",
            "trace_id": trace_id,
            "start_time": local_time,
            "end_time": local_time,
        },
    )
    assert any(item["id"] == translate["id"] for item in exact_window.json()["items"])
    assert client.get(
        "/api/logs", headers=headers,
        params={"start_time": (logged_at + timedelta(days=1)).isoformat()},
    ).json()["total"] == 0
    assert client.get(
        "/api/logs", headers=headers,
        params={"end_time": (logged_at - timedelta(days=1)).isoformat()},
    ).json()["total"] == 0
    assert client.get(
        "/api/logs", headers=headers,
        params={"start_time": (logged_at + timedelta(days=1)).isoformat(), "end_time": local_time},
    ).status_code == 422

    first_page = client.get("/api/logs", headers=headers, params={"limit": 1, "offset": 0}).json()
    second_page = client.get("/api/logs", headers=headers, params={"limit": 1, "offset": 1}).json()
    assert first_page["total"] == second_page["total"]
    assert first_page["items"][0]["id"] != second_page["items"][0]["id"]

    stats = client.get("/api/logs/stats", headers=headers)
    assert stats.status_code == 200
    assert stats.json()["judgment_count"] == 1
    assert client.get("/api/logs", headers=headers).json()["total"] == body["total"]


def test_failed_and_limited_login_are_logged_without_password(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers, password = _user(client, db, "loginaction")
    wrong = client.post(
        "/api/auth/login",
        headers={"X-Trace-Id": "login-failed-trace"},
        json={"username": "loginaction", "password": "wrong-password"},
    )
    assert wrong.status_code == 401
    monkeypatch.setattr("app.core.login_throttle.allow", lambda _key: False)
    limited = client.post(
        "/api/auth/login",
        headers={"X-Trace-Id": "login-limited-trace"},
        json={"username": "loginaction", "password": password},
    )
    assert limited.status_code == 429
    logs = client.get("/api/logs", headers=headers, params={"category": "auth"}).json()["items"]
    assert any(
        item["source"] == "系统"
        and any(peer["source"] == "用户" and peer["trace_id"] == item["trace_id"] for peer in logs)
        for item in logs
    )
    assert any(item["trace_id"] == "login-failed-trace" and item["level"] == "error" for item in logs)
    assert any(item["trace_id"] == "login-limited-trace" and item["level"] == "warn" for item in logs)
    serialized = json.dumps(logs, ensure_ascii=False)
    assert password not in serialized
    assert "wrong-password" not in serialized


def test_logs_isolated_between_users(client: TestClient, db: Session) -> None:
    headers_a, _ = _user(client, db, "logsisa")
    headers_b, _ = _user(client, db, "logsisb")
    owner = UserRepository().by_username(db, "logsisa")
    assert owner is not None
    db.add(CallLog(
        owner_user_id=owner.id,
        trace_id="private-trace",
        kind="llm",
        phase="translate",
        request_body="{}",
        response_body="{}",
    ))
    db.commit()

    own = client.get("/api/logs", headers=headers_a, params={"trace_id": "private-trace"})
    assert own.json()["total"] == 1
    other = client.get("/api/logs", headers=headers_b, params={"trace_id": "private-trace"})
    assert other.json()["total"] == 0


def test_export_contains_personal_data(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers, _ = _user(client, db, "exportone")
    _configure(client, db, headers)
    _run_analysis(client, db, "exportone", headers, monkeypatch)
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
    _configure(client, db, headers)
    _run_analysis(client, db, "deleteone", headers, monkeypatch)

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
