"""P3：复盘写入、对象隔离、QA 不覆盖、整单撤销、background 整句裁剪。"""

from __future__ import annotations

import json

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.domain.enums import UserRole
from app.repositories.auth_repo import UserRepository
from app.repositories.models import Memory, ProviderConfig, User
from app.services.context_service import dropped_count, render_background
from tests.provider_setup import mark_provider_tested


def _make_user(client: TestClient, db: Session, username: str) -> tuple[str, int]:
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
    return resp.json()["access_token"], user.id


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class _FakeResponse:
    def __init__(self, payload: dict) -> None:
        self.status_code = 200
        self._payload = payload
        self.text = json.dumps(payload)

    def json(self) -> dict:
        return self._payload


class _Llm:
    def __init__(self, changes: list[dict]) -> None:
        self.changes = changes

    def __enter__(self) -> "_Llm":
        return self

    def __exit__(self, *args) -> bool:
        return False

    def post(self, url, json=None, headers=None, timeout=None):  # noqa: A002
        content = {"changes": self.changes}
        user = ""
        if isinstance(json, dict):
            messages = json.get("messages") or []
            if messages and isinstance(messages[-1], dict):
                user = str(messages[-1].get("content") or "")
        if user.startswith("{") and '"lines"' in user:
            incoming = json_loads(user)
            content = {
                "lines": [
                    {"id": item["id"], "text": "She likes croissants."}
                    for item in incoming.get("lines", [])
                ]
            }
        body = {"choices": [{"message": {"content": json_dumps(content)}}]}
        if "systemone" in url:
            body = {"model": "jev", "answers": {"danger_level": {"score": 1}}}
        return _FakeResponse(body)


def json_loads(text: str) -> dict:
    return json.loads(text)


def json_dumps(value: dict) -> str:
    return json.dumps(value, ensure_ascii=False)


def _configure(client: TestClient, headers: dict) -> None:
    resp = client.post(
        "/api/providers",
        json={
            "kind": "llm",
            "name": "llm",
            "endpoint_url": "https://llm.example/v1/chat/completions",
            "api_key": "sk-abcdefghijklmnop",
            "model": "gpt",
            "is_default": True,
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    mark_provider_tested(resp.json()["id"])


def _conversation(client: TestClient, headers: dict, name: str = "小美") -> int:
    created = client.post(
        "/api/conversations",
        json={"title": name, "counterpart_name": name, "relationship": "女朋友"},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    conv_id = created.json()["id"]
    posted = client.post(
        f"/api/conversations/{conv_id}/messages",
        json={"role": "other", "content": "我最喜欢可颂。"},
        headers=headers,
    )
    assert posted.status_code == 201
    return conv_id


def test_revert_requires_latest_first(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    token, _user_id = _make_user(client, db, "orderuser")
    headers = _auth(token)
    _configure(client, headers)
    conv_id = _conversation(client, headers)
    first_body = None
    for content in ("她喜欢可颂", "她不吃香菜"):
        monkeypatch.setattr(
            httpx,
            "Client",
            lambda *args, content=content, **kwargs: _Llm(
                [{"op": "ADD", "subject": "other", "category": "偏好", "content": content}]
            ),
        )
        reflected = client.post("/api/chat/reflect", json={"conversation_id": conv_id}, headers=headers)
        assert reflected.status_code == 200, reflected.text
        if first_body is None:
            first_body = reflected.json()
    blocked = client.post(f"/api/chat/reflect/{first_body['id']}/revert", headers=headers)
    assert blocked.status_code == 409


def test_reflect_rejects_disabled_llm(client: TestClient, db: Session) -> None:
    token, _user_id = _make_user(client, db, "disabledmemory")
    headers = _auth(token)
    _configure(client, headers)
    conv_id = _conversation(client, headers)
    provider = db.query(ProviderConfig).filter_by(owner_user_id=_user_id, kind="llm").one()
    provider.is_enabled = False
    db.commit()

    reflected = client.post("/api/chat/reflect", json={"conversation_id": conv_id}, headers=headers)

    assert reflected.status_code == 409
    assert reflected.json()["error"]["code"] == "NOT_CONFIGURED"


def test_forget_hides_one_memory(client: TestClient, db: Session) -> None:
    token, user_id = _make_user(client, db, "forgetuser")
    headers = _auth(token)
    row = Memory(
        owner_user_id=user_id,
        subject="relation",
        category="雷区",
        content="不要提前任",
        source="reflection",
    )
    db.add(row)
    db.commit()
    removed = client.delete(f"/api/chat/memories/{row.id}", headers=headers)
    assert removed.status_code == 204
    listed = client.get("/api/chat/memories", headers=headers)
    assert listed.json()["total"] == 0


def test_sensitive_memory_is_packed_first() -> None:
    from app.services.context_service import render_background

    rows = [
        Memory(id=1, subject="other", category="偏好", content="喜欢可颂"),
        Memory(id=2, subject="other", category="雷区", content="不要提前任"),
    ]
    # 仓储按雷区优先排序后再交给装配
    ordered = sorted(rows, key=lambda item: (0 if item.category == "雷区" else 1, -item.id))
    text = render_background(ordered, budget=16)
    assert "前任" in text
    assert "可颂" not in text


def test_memories_are_paged(client: TestClient, db: Session) -> None:
    token, user_id = _make_user(client, db, "pageuser")
    headers = _auth(token)
    for index in range(3):
        db.add(
            Memory(
                owner_user_id=user_id,
                subject="relation",
                category="事件",
                content=f"第{index}条",
                source="reflection",
            )
        )
    db.commit()
    page = client.get("/api/chat/memories?limit=2&offset=0", headers=headers)
    assert page.status_code == 200, page.text
    body = page.json()
    assert body["total"] == 3
    assert len(body["items"]) == 2


def test_reflect_adds_and_revert_hides_it(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    token, _user_id = _make_user(client, db, "memuser")
    headers = _auth(token)
    _configure(client, headers)
    conv_id = _conversation(client, headers)
    monkeypatch.setattr(
        httpx,
        "Client",
        lambda *args, **kwargs: _Llm(
            [{"op": "ADD", "subject": "other", "category": "偏好", "content": "她喜欢可颂"}]
        ),
    )
    reflected = client.post("/api/chat/reflect", json={"conversation_id": conv_id}, headers=headers)
    assert reflected.status_code == 200, reflected.text
    body = reflected.json()
    assert body["changes"][0]["op"] == "ADD"
    assert body["changes"][0]["created_id"]

    monkeypatch.setattr(
        httpx,
        "Client",
        lambda *args, **kwargs: _Llm(
            [
                {
                    "op": "UPDATE",
                    "memory_id": body["changes"][0]["created_id"],
                    "subject": "other",
                    "category": "偏好",
                    "content": "她喜欢草莓蛋糕",
                }
            ]
        ),
    )
    # 撤销后这条记忆不再有效
    reverted = client.post(f"/api/chat/reflect/{body['id']}/revert", headers=headers)
    assert reverted.status_code == 200, reverted.text
    assert reverted.json()["reverted_at"]

    again = client.post(f"/api/chat/reflect/{body['id']}/revert", headers=headers)
    assert again.status_code == 409


def test_reflect_does_not_overwrite_qa(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    token, user_id = _make_user(client, db, "qauser")
    headers = _auth(token)
    _configure(client, headers)
    conv_id = _conversation(client, headers)
    qa = Memory(
        owner_user_id=user_id,
        subject="other",
        counterpart_key="小美",
        category="雷区",
        content="不要提前任",
        source="qa",
        confidence=1,
    )
    db.add(qa)
    db.commit()
    monkeypatch.setattr(
        httpx,
        "Client",
        lambda *args, **kwargs: _Llm(
            [
                {
                    "op": "INVALIDATE",
                    "memory_id": qa.id,
                    "subject": "other",
                    "category": "雷区",
                    "content": "",
                }
            ]
        ),
    )
    reflected = client.post("/api/chat/reflect", json={"conversation_id": conv_id}, headers=headers)
    assert reflected.status_code == 200, reflected.text
    assert reflected.json()["changes"][0]["skipped"] == "qa"
    db.refresh(qa)
    assert qa.valid_to is None


def test_other_memory_does_not_leak_across_counterparts(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    token, user_id = _make_user(client, db, "leakuser")
    headers = _auth(token)
    _configure(client, headers)
    jev = client.post(
        "/api/providers",
        json={
            "kind": "jev",
            "name": "jev",
            "endpoint_url": "https://jev.example/v1/systemone",
            "api_key": "sk-abcdefghijklmnop",
            "model": "jev",
            "is_default": True,
        },
        headers=headers,
    )
    assert jev.status_code == 201, jev.text
    mark_provider_tested(jev.json()["id"])
    db.add(
        Memory(
            owner_user_id=user_id,
            subject="other",
            counterpart_key="别人",
            category="偏好",
            content="她喜欢火锅",
            source="reflection",
        )
    )
    db.commit()
    conv_id = _conversation(client, headers, name="小美")
    seen: dict = {}

    class _Capture(_Llm):
        def post(self, url, json=None, headers=None, timeout=None):  # noqa: A002
            seen["body"] = json
            return super().post(url, json=json, headers=headers)

    monkeypatch.setattr(httpx, "Client", lambda *args, **kwargs: _Capture([]))
    judged = client.post("/api/chat/analyze", json={"conversation_id": conv_id}, headers=headers)
    assert judged.status_code == 200, judged.text
    assert "background" not in seen["body"]["state"]
    assert judged.json()["memory_count"] == 0


def test_summary_is_dropped_before_memories() -> None:
    rows = [Memory(subject="relation", category="事件", content="记得这件事")]
    text = render_background(rows, summary="甲" * 80, budget=40)
    assert "记得这件事" in text
    assert "更早" not in text


def test_background_drops_oldest_whole_lines() -> None:
    rows = [
        Memory(subject="other", category="偏好", content="甲" * 30),
        Memory(subject="other", category="偏好", content="乙" * 30),
        Memory(subject="other", category="偏好", content="丙" * 30),
    ]
    text = render_background(rows, budget=80)
    assert "甲" in text
    assert "丙" not in text
    assert dropped_count(rows, budget=80) == 1
    # 没有半句：每一行要么整句在，要么整句不在
    assert all(line.endswith("。") or "：" in line for line in text.splitlines())
