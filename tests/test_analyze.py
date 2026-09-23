"""P2：恋爱 10 题、注释翻译、/chat/analyze。上游一律 mock。"""

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
from app.scenarios.builders import BACKGROUND_NOTE
from app.scenarios.questions_romance import PANEL_KEYS, romance_questions
from app.services.analyze_service import present_answers


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


class _FakeResponse:
    def __init__(self, status_code: int, payload) -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = "" if payload is None else json.dumps(payload)

    def json(self):
        if self._payload is None:
            raise ValueError("not json")
        return self._payload


class _Router:
    """按 URL 分流：LLM 返回注释翻译，JEV 返回 10 题答案。"""

    def __init__(self, *, jev_status: int = 200, jev_body: dict | None = None) -> None:
        self.calls: list[dict] = []
        self.jev_status = jev_status
        self.jev_body = jev_body

    def __enter__(self) -> "_Router":
        return self

    def __exit__(self, *args) -> bool:
        return False

    def post(self, url, json=None, headers=None):  # noqa: A002
        self.calls.append({"url": url, "json": json, "headers": headers})
        if "systemone" in url:
            body = self.jev_body if self.jev_body is not None else _jev_answers()
            return _FakeResponse(self.jev_status, body)
        text = json["messages"][1]["content"]
        incoming = json_loads(text)
        lines = [
            {"id": item["id"], "text": "Nothing much. [short sentence; dismissive]"}
            for item in incoming["lines"]
        ]
        return _FakeResponse(
            200,
            {"choices": [{"message": {"content": json_dumps({"lines": lines})}}]},
        )


def json_loads(text: str) -> dict:
    return json.loads(text)


def json_dumps(value: dict) -> str:
    return json.dumps(value, ensure_ascii=False)


def _patch(monkeypatch: pytest.MonkeyPatch, router: _Router) -> None:
    monkeypatch.setattr(httpx, "Client", lambda *args, **kwargs: router)


def _jev_answers() -> dict:
    return {
        "model": "jev-1.13.0",
        "answers": {
            "literal_question": {"noul": 0.12},
            "true_intent": {
                "choice": "confirm_you_care",
                "confidence": 0.74,
                "probabilities": {"confirm_you_care": 0.74, "casual_chat": 0.2},
            },
            "danger_level": {"score": 4.2, "confidence": 0.6},
            "should_reply_now": {"noul": 0.3},
            "best_action": {"choice": "acknowledge", "confidence": 0.66, "probabilities": {}},
            "she_needs": {"choice": "care", "confidence": 0.8, "probabilities": {"care": 0.8}},
            "tension_resolved": {"noul": 0.2},
            "emotion": {"choice": "wronged", "confidence": 0.7, "probabilities": {"wronged": 0.7}},
            "emotion_intensity": {"score": 3},
            "context_sufficient": {"noul": 0.9},
        },
    }


def _configure(client: TestClient, headers: dict) -> None:
    for kind, url, model in (
        ("llm", "https://llm.example/v1/chat/completions", "gpt"),
        ("jev", "https://jev.example/v1/systemone", "jev-1.13.0"),
    ):
        resp = client.post(
            "/api/providers",
            json={
                "kind": kind,
                "name": kind,
                "endpoint_url": url,
                "api_key": "sk-abcdefghijklmnop",
                "model": model,
                "is_default": True,
            },
            headers=headers,
        )
        assert resp.status_code == 201, resp.text


def _conversation(client: TestClient, headers: dict) -> int:
    created = client.post(
        "/api/conversations",
        json={"title": "和小美", "counterpart_name": "小美", "relationship": "女朋友"},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    return created.json()["id"]


# ------------------------------------------------------------------ 题目
def test_romance_questions_shape() -> None:
    questions = romance_questions()
    assert set(questions) == {
        "literal_question",
        "true_intent",
        "danger_level",
        "should_reply_now",
        "best_action",
        "she_needs",
        "tension_resolved",
        "emotion",
        "emotion_intensity",
        "context_sufficient",
    }
    assert questions["danger_level"]["type"] == "score"
    assert len(questions["danger_level"]["criteria"]) == 10
    assert questions["emotion"]["type"] == "choice"
    assert len(questions["emotion"]["criteria"]) == 18
    assert questions["true_intent"]["instructions"].endswith(BACKGROUND_NOTE)
    for key in PANEL_KEYS:
        assert key in questions


def test_present_answers_uses_local_labels_and_high_danger() -> None:
    view = present_answers(_jev_answers()["answers"])
    intent = next(item for item in view["panel"] if item["key"] == "true_intent")
    assert intent["text"] == "想确认你在不在意"
    danger = next(item for item in view["panel"] if item["key"] == "danger_level")
    assert danger["value"] == 4
    assert danger["tone"] == "warning"
    assert view["high_danger"] is False
    assert view["context_sufficient"] is True

    hot = dict(_jev_answers()["answers"])
    hot["danger_level"] = {"score": 8.6}
    assert present_answers(hot)["high_danger"] is True


# ------------------------------------------------------------------ 接口
def test_analyze_translates_then_judges(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    token = _make_user(client, db, "judgeuser")
    headers = _auth(token)
    _configure(client, headers)
    conv_id = _conversation(client, headers)
    posted = client.post(
        f"/api/conversations/{conv_id}/messages",
        json={"role": "other", "content": "没怎么。"},
        headers=headers,
    )
    assert posted.status_code == 201

    router = _Router()
    _patch(monkeypatch, router)
    judged = client.post("/api/chat/analyze", json={"conversation_id": conv_id}, headers=headers)
    assert judged.status_code == 200, judged.text
    body = judged.json()
    assert body["panel"][0]["key"] == "danger_level"
    assert any(item["text"] == "想确认你在不在意" for item in body["panel"])
    assert "sk-abcdefghijklmnop" not in judged.text

    jev_call = next(call for call in router.calls if "systemone" in call["url"])
    sent = jev_call["json"]["state"]["chat"]["messages"][0]["text"]
    assert sent.startswith("Nothing much.")
    assert "[short sentence; dismissive]" in sent
    assert "没怎么" not in sent
    assert set(jev_call["json"]["questions"]) == set(romance_questions())
    assert "Authorization" in jev_call["headers"]


def test_analyze_skips_translation_for_english(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    token = _make_user(client, db, "enuser")
    headers = _auth(token)
    _configure(client, headers)
    conv_id = _conversation(client, headers)
    client.post(
        f"/api/conversations/{conv_id}/messages",
        json={"role": "other", "content": "Nothing much."},
        headers=headers,
    )
    router = _Router()
    _patch(monkeypatch, router)
    judged = client.post("/api/chat/analyze", json={"conversation_id": conv_id}, headers=headers)
    assert judged.status_code == 200, judged.text
    assert all("systemone" in call["url"] for call in router.calls)
    sent = router.calls[0]["json"]["state"]["chat"]["messages"][0]["text"]
    assert sent == "Nothing much."


def test_analyze_requires_providers(client: TestClient, db: Session) -> None:
    token = _make_user(client, db, "noconfig")
    headers = _auth(token)
    conv_id = _conversation(client, headers)
    client.post(
        f"/api/conversations/{conv_id}/messages",
        json={"role": "other", "content": "没怎么。"},
        headers=headers,
    )
    resp = client.post("/api/chat/analyze", json={"conversation_id": conv_id}, headers=headers)
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "JEV_NOT_CONFIGURED"


def test_analyze_empty_conversation(client: TestClient, db: Session) -> None:
    token = _make_user(client, db, "emptyconv")
    headers = _auth(token)
    _configure(client, headers)
    conv_id = _conversation(client, headers)
    resp = client.post("/api/chat/analyze", json={"conversation_id": conv_id}, headers=headers)
    assert resp.status_code == 422


def test_analyze_hides_other_users(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = _auth(_make_user(client, db, "ownerjudge"))
    stranger = _auth(_make_user(client, db, "strangerjudge"))
    _configure(client, owner)
    conv_id = _conversation(client, owner)
    client.post(
        f"/api/conversations/{conv_id}/messages",
        json={"role": "other", "content": "没怎么。"},
        headers=owner,
    )
    _patch(monkeypatch, _Router())
    resp = client.post(
        "/api/chat/analyze", json={"conversation_id": conv_id}, headers=stranger
    )
    assert resp.status_code == 404


def test_analyze_upstream_failure_does_not_crash(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    token = _make_user(client, db, "failjudge")
    headers = _auth(token)
    _configure(client, headers)
    conv_id = _conversation(client, headers)
    client.post(
        f"/api/conversations/{conv_id}/messages",
        json={"role": "me", "content": "在吗"},
        headers=headers,
    )
    _patch(monkeypatch, _Router(jev_status=401, jev_body={"error": "nope"}))
    resp = client.post("/api/chat/analyze", json={"conversation_id": conv_id}, headers=headers)
    assert resp.status_code == 502
    assert resp.json()["error"]["code"] == "JEV_UPSTREAM_ERROR"
    assert resp.json()["error"]["retryable"] is True
