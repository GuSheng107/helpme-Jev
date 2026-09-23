"""P5 补充：会话贴图 —— 上传门控、消息附件、多模态读图进分析。上游一律 mock。"""

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

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"0" * 64


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


def _configure(client: TestClient, headers: dict, *, vision: bool) -> None:
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
                "supports_vision": vision and kind == "llm",
            },
        )
        assert created.status_code == 201, created.text


def _conversation(client: TestClient, headers: dict) -> int:
    return client.post(
        "/api/conversations",
        headers=headers,
        json={"title": "聊天", "counterpart_name": "小林"},
    ).json()["id"]


class _Response:
    def __init__(self, payload) -> None:
        self.status_code = 200
        self._payload = payload
        self.text = json.dumps(payload)

    def json(self):
        return self._payload


class _VisionRouter:
    """LLM：文本走注释翻译、图片走 describe（content 是数组）；JEV：回 10 题答案。"""

    def __init__(self) -> None:
        self.calls: list[dict] = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def post(self, url, json=None, headers=None):  # noqa: A002
        self.calls.append({"url": url, "json": json})
        if "systemone" not in url:
            content = json["messages"][1]["content"]
            if isinstance(content, list):
                # 多模态读图：确认带了 image_url，而不是系统自己 OCR
                assert any(part.get("type") == "image_url" for part in content)
                return _Response(
                    {"choices": [{"message": {"content": json_dumps({"description": "A screenshot where the counterpart says they are upset."})}}]}
                )
            if content.startswith("{"):
                incoming = json.loads(content)
                if "lines" in incoming:
                    lines = [
                        {"id": item["id"], "text": "Nothing much. [short; dismissive]"}
                        for item in incoming["lines"]
                    ]
                    return _Response({"choices": [{"message": {"content": json_dumps({"lines": lines})}}]})
            return _Response({"choices": [{"message": {"content": json_dumps({"text": content})}}]})
        answers = {
            "literal_question": {"noul": 0.2},
            "true_intent": {"choice": "confirm_you_care", "confidence": 0.7},
            "danger_level": {"score": 4},
            "should_reply_now": {"noul": 0.4},
            "best_action": {"choice": "acknowledge", "confidence": 0.7},
            "she_needs": {"choice": "care", "confidence": 0.8},
            "tension_resolved": {"noul": 0.3},
            "emotion": {"choice": "wronged", "confidence": 0.7},
            "emotion_intensity": {"score": 3},
            "context_sufficient": {"noul": 0.9},
        }
        return _Response({"model": "jev-1.13.0", "answers": answers})


def json_dumps(value) -> str:
    return json.dumps(value, ensure_ascii=False)


def _upload(client: TestClient, headers: dict, conv_id: int, *, mime: str = "image/png"):
    return client.post(
        f"/api/conversations/{conv_id}/images",
        headers=headers,
        files={"file": ("shot.png", PNG_BYTES, mime)},
    )


def test_image_upload_requires_vision(client: TestClient, db: Session) -> None:
    headers = _user(client, db, "imgnovision")
    _configure(client, headers, vision=False)
    conv_id = _conversation(client, headers)
    refused = _upload(client, headers, conv_id)
    assert refused.status_code == 422
    assert "看图" in refused.json()["error"]["message"]


def test_image_upload_validates_mime_and_size(client: TestClient, db: Session) -> None:
    headers = _user(client, db, "imgbad")
    _configure(client, headers, vision=True)
    conv_id = _conversation(client, headers)
    bad_mime = client.post(
        f"/api/conversations/{conv_id}/images",
        headers=headers,
        files={"file": ("a.gif", b"GIF89a", "image/gif")},
    )
    assert bad_mime.status_code == 422
    too_big = client.post(
        f"/api/conversations/{conv_id}/images",
        headers=headers,
        files={"file": ("big.png", b"\x89PNG" + b"0" * (4 * 1024 * 1024 + 1), "image/png")},
    )
    assert too_big.status_code == 413


def test_message_with_images_and_multimodal_analysis(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers = _user(client, db, "imgflow")
    _configure(client, headers, vision=True)
    conv_id = _conversation(client, headers)

    uploaded = _upload(client, headers, conv_id)
    assert uploaded.status_code == 201, uploaded.text
    material_id = uploaded.json()["id"]

    # 纯图消息（无文字）也应能保存
    saved = client.post(
        f"/api/conversations/{conv_id}/messages",
        headers=headers,
        json={"role": "other", "content": "", "attachment_ids": [material_id]},
    )
    assert saved.status_code == 201, saved.text
    assert saved.json()["attachments"][0]["type"] == "image"

    # 原图只能本人取
    fetched = client.get(f"/api/materials/{material_id}/file", headers=headers)
    assert fetched.status_code == 200
    assert fetched.content == PNG_BYTES

    # 换一个人取不到
    stranger = _user(client, db, "imgstranger")
    assert client.get(f"/api/materials/{material_id}/file", headers=stranger).status_code == 404

    router = _VisionRouter()
    monkeypatch.setattr(httpx, "Client", lambda *args, **kwargs: router)
    judged = client.post("/api/chat/analyze", json={"conversation_id": conv_id}, headers=headers)
    assert judged.status_code == 200, judged.text

    # JEV 收到的文本应包含读图描述（描述来自多模态 LLM，不是系统 OCR）
    jev_call = next(call for call in router.calls if "systemone" in call["url"])
    first_text = jev_call["json"]["state"]["chat"]["messages"][0]["text"]
    assert "[attached image:" in first_text
    assert "upset" in first_text


def test_attachment_must_belong_to_conversation(client: TestClient, db: Session) -> None:
    headers = _user(client, db, "imgcross")
    _configure(client, headers, vision=True)
    conv_a = _conversation(client, headers)
    conv_b = client.post(
        "/api/conversations",
        headers=headers,
        json={"title": "另一个", "counterpart_name": "阿明"},
    ).json()["id"]
    uploaded = _upload(client, headers, conv_a)
    material_id = uploaded.json()["id"]
    rejected = client.post(
        f"/api/conversations/{conv_b}/messages",
        headers=headers,
        json={"role": "other", "content": "hi", "attachment_ids": [material_id]},
    )
    assert rejected.status_code == 422
    assert "不属于" in rejected.json()["error"]["message"]
