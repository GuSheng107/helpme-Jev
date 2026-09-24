"""P5：人设建模与素材导入。上游一律 mock。"""

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
from tests.provider_setup import mark_provider_tested
from app.scenarios.persona_questions import romance_persona_questions


def _user(client: TestClient, db: Session, username: str) -> dict[str, str]:
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
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _ready(client: TestClient, headers: dict, *, vision: bool = False) -> int:
    for kind, url in (("llm", "https://llm.example/v1"), ("jev", "https://jev.example/v1/systemone")):
        created = client.post(
            "/api/providers",
            headers=headers,
            json={
                "kind": kind,
                "name": kind,
                "endpoint_url": url,
                "api_key": "sk-abcdefghijklmnop",
                "model": kind,
                "is_default": True,
                "supports_vision": vision and kind == "llm",
            },
        )
        assert created.status_code == 201, created.text
        mark_provider_tested(created.json()["id"])
    conv = client.post(
        "/api/conversations",
        headers=headers,
        json={"title": "她", "counterpart_name": "她", "relationship": "恋人"},
    )
    return conv.json()["id"]


class _Router:
    def __init__(self, *, sufficient: float = 0.8, confidence: float = 0.7) -> None:
        self.sufficient = sufficient
        self.confidence = confidence

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def post(self, url, json=None, headers=None):  # noqa: A002
        if "systemone" not in url:
            body = {"lines": [{"id": "1", "text": "Nothing much."}]}
            return _Response({"choices": [{"message": {"content": json_dumps(body)}}]})
        answers = {
            "attachment": {"choice": "anxious", "confidence": self.confidence},
            "love_language": {"choice": "time", "confidence": self.confidence},
            "conflict_style": {"choice": "avoiding", "confidence": self.confidence},
            "openness": {"score": 5},
            "evidence_sufficient": {"noul": self.sufficient},
        }
        return _Response({"model": "jev", "answers": answers})


class _Response:
    def __init__(self, payload) -> None:
        self.status_code = 200
        self._payload = payload
        self.text = json.dumps(payload)

    def json(self):
        return self._payload


def json_dumps(value) -> str:
    return json.dumps(value, ensure_ascii=False)


def test_romance_persona_questions_cover_the_frameworks() -> None:
    questions = romance_persona_questions("other")
    assert questions["openness"]["type"] == "score"
    assert set(questions["attachment"]["criteria"]) == {
        "secure",
        "anxious",
        "avoidant",
        "disorganized",
    }
    assert "mbti" not in questions


def test_low_confidence_does_not_overwrite(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers = _user(client, db, "personaone")
    conv_id = _ready(client, headers)
    client.post(
        f"/api/conversations/{conv_id}/messages",
        headers=headers,
        json={"role": "other", "content": "你是不是又忘了。"},
    )
    monkeypatch.setattr(httpx, "Client", lambda *args, **kwargs: _Router())
    first = client.post(
        "/api/personas/build",
        headers=headers,
        json={"conversation_id": conv_id, "subject": "other"},
    )
    assert first.status_code == 200, first.text
    assert first.json()["kept"] is False
    assert first.json()["traits"][0]["title"]
    monkeypatch.setattr(httpx, "Client", lambda *args, **kwargs: _Router(sufficient=0.1, confidence=0.2))
    second = client.post(
        "/api/personas/build",
        headers=headers,
        json={"conversation_id": conv_id, "subject": "other"},
    )
    assert second.json()["kept"] is True
    assert second.json()["version"] == 1


def test_chat_import_previews_before_saving(
    client: TestClient, db: Session
) -> None:
    headers = _user(client, db, "importone")
    conv_id = _ready(client, headers)
    text = "我: 在吗\n她: 没怎么\n路人: 不算\n坏行"
    preview = client.post(
        "/api/import/chat/preview",
        headers=headers,
        json={"conversation_id": conv_id, "text": text},
    )
    assert preview.status_code == 200
    assert preview.json()["count"] == 2
    assert preview.json()["skipped"] == 2
    saved = client.get(f"/api/conversations/{conv_id}/messages", headers=headers)
    assert saved.json() == []
    committed = client.post(
        "/api/import/chat",
        headers=headers,
        json={"conversation_id": conv_id, "text": text},
    )
    assert committed.json()["imported"] == 2
    stored = client.get(f"/api/conversations/{conv_id}/messages", headers=headers)
    assert stored.json()[0]["source"] == "import"


def test_qa_rejects_invalid_json(client: TestClient, db: Session) -> None:
    headers = _user(client, db, "qaone")
    _ready(client, headers)
    bad = client.post("/api/import/qa", headers=headers, json={"raw": "{不是数组"})
    assert bad.status_code == 422
    missing = client.post(
        "/api/import/qa", headers=headers, json={"raw": '[{"question":"只有问题"}]'}
    )
    assert missing.status_code == 422
    good = client.post(
        "/api/import/qa",
        headers=headers,
        json={"raw": '[{"question":"雷区？","answer":"不要提前任","tags":["雷区"]}]'},
    )
    assert good.status_code == 200
    assert good.json()["imported"] == 1


def test_screenshot_requires_vision(client: TestClient, db: Session) -> None:
    headers = _user(client, db, "shotone")
    conv_id = _ready(client, headers, vision=False)
    refused = client.post(
        "/api/materials/screenshot",
        headers=headers,
        data={"conversation_id": str(conv_id)},
        files={"file": ("a.png", b"png", "image/png")},
    )
    assert refused.status_code == 422
