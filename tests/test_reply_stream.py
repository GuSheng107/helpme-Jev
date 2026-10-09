"""自动回复流式管线：解读 → 评分 → 起草 → 排序。上游一律 mock。"""

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
from tests.profile_seed import seed_profile, user_id_by_name
from tests.provider_setup import mark_provider_tested


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


def _configure(client: TestClient, headers: dict) -> None:
    for kind, url in (
        ("llm", "https://llm.example/v1/chat/completions"),
        ("jev", "https://jev.example/v1/systemone"),
    ):
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
            },
        )
        assert created.status_code == 201, created.text
        mark_provider_tested(created.json()["id"])


class _Router:
    """按 URL 分流：LLM 出注释翻译与候选草稿，JEV 出评分与排序。"""

    def __init__(
        self,
        *,
        jev_scores: dict | None = None,
        draft_ok: bool = True,
        rank_ok: bool = True,
    ) -> None:
        self.calls: list[dict] = []
        self.jev_scores = jev_scores
        self.draft_ok = draft_ok
        self.rank_ok = rank_ok

    def __enter__(self) -> "_Router":
        return self

    def __exit__(self, *args) -> bool:
        return False

    def post(self, url, json=None, headers=None, timeout=None):  # noqa: A002
        self.calls.append({"url": url, "json": json})
        if "systemone" in url:
            questions = (json or {}).get("questions") or {}
            if "best_reply" in questions:
                body = (
                    {
                        "model": "jev-1.13.0",
                        "answers": {
                            "best_reply": {
                                "choice": "reply_b",
                                "probabilities": {
                                    "reply_a": 0.2, "reply_b": 0.5, "reply_c": 0.3,
                                },
                            }
                        },
                    }
                    if self.rank_ok
                    else {"detail": "jev down"}
                )
                return _FakeResponse(200 if self.rank_ok else 500, body)
            return _FakeResponse(200, self.jev_scores or _jev_scores())
        system = json["messages"][0]["content"]
        incoming = json_loads(json["messages"][1]["content"])
        if "replies" in system or "候选" in system or "回复候选" in system:
            body = (
                {"replies": ["我在。", "怎么了？", "想说就说。"]}
                if self.draft_ok
                else {"replies": "不行"}
            )
            return _FakeResponse(200, {"choices": [{"message": {"content": json_dumps(body)}}]})
        if "lines" in incoming:
            lines = [
                {"id": item["id"], "text": "Nothing much. [short; dismissive]"}
                for item in incoming["lines"]
            ]
            return _FakeResponse(
                200,
                {"choices": [{"message": {"content": json_dumps({"lines": lines})}}]},
            )
        # 读图等其余 LLM 调用一律原样放行
        return _FakeResponse(
            200,
            {"choices": [{"message": {"content": json_dumps({"text": str(incoming)})}}]},
        )


class _FakeResponse:
    def __init__(self, status_code: int, payload) -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = "" if payload is None else json_dumps(payload)

    def json(self):
        return self._payload


def json_loads(text: str) -> dict:
    return json.loads(text)


def json_dumps(value: dict) -> str:
    return json.dumps(value, ensure_ascii=False)


def _jev_scores() -> dict:
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


def _high_danger_scores() -> dict:
    scores = _jev_scores()
    scores["answers"]["danger_level"] = {"score": 9.5, "confidence": 0.9}
    return scores


def _conversation(client: TestClient, db: Session, username: str, headers: dict) -> int:
    pid = seed_profile(db, user_id_by_name(db, username), "小美")
    # 占位档案 traits 为空会被摘要跳过；补一条特质让人设行进得了起草请求
    from app.repositories.models import PersonaProfile

    row = db.get(PersonaProfile, pid)
    row.traits = json_dumps({"_schema": "custom_v1", "values": {"style": "long"}})
    db.commit()
    created = client.post(
        "/api/conversations",
        json={"title": "和小美", "profile_id": pid, "relationship": "女朋友"},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    return created.json()["id"]


def _save_other(client: TestClient, headers: dict, conversation_id: int, text: str) -> None:
    saved = client.post(
        f"/api/conversations/{conversation_id}/messages",
        headers=headers,
        json={"role": "other", "content": text, "source": "manual"},
    )
    assert saved.status_code == 201, saved.text


def _events(response) -> list[dict]:
    return [
        json.loads(line.removeprefix("data: "))
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]


def test_reply_stream_runs_full_pipeline(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers = _user(client, db, "replystream")
    _configure(client, headers)
    conversation_id = _conversation(client, db, "replystream", headers)
    _save_other(client, headers, conversation_id, "也没什么。")
    router = _Router()
    monkeypatch.setattr(httpx, "Client", lambda *args, **kwargs: router)

    streamed = client.post(
        "/api/chat/reply/stream",
        headers=headers,
        json={"conversation_id": conversation_id},
    )
    assert streamed.status_code == 200, streamed.text
    events = _events(streamed)
    assert [event["stage"] for event in events] == [
        "plan", "translate_done", "score_done", "draft_done", "done",
    ]
    assert events[0]["steps"] == ["translate", "score", "draft", "rank"]
    assert events[2]["scores"][0]["title"]
    payload = events[-1]["payload"]
    assert payload["blocked"] is None
    assert payload["ranked"] is True
    assert [item["text"] for item in payload["candidates"]] == ["怎么了？", "想说就说。", "我在。"]
    assert payload["candidates"][0]["percent"] == 50
    # 人设摘要进了起草请求体（人设前置：会话必有档案）
    draft_bodies = [
        call["json"]["messages"][1]["content"]
        for call in router.calls
        if isinstance(call["json"], dict)
        and call["json"].get("messages")
        and "judgments" in call["json"]["messages"][1]["content"]
    ]
    assert draft_bodies, "起草请求应包含判断结果"
    assert "人设" in draft_bodies[0]


def test_reply_stream_skips_translate_when_auto_translate_off(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers = _user(client, db, "replynotrans")
    _configure(client, headers)
    # 关掉自动翻译（自训练中文 JEV）
    toggled = client.patch(
        "/api/account/translation", headers=headers, json={"auto_translate": False}
    )
    assert toggled.status_code == 200, toggled.text
    conversation_id = _conversation(client, db, "replynotrans", headers)
    _save_other(client, headers, conversation_id, "也没什么。")
    router = _Router()
    monkeypatch.setattr(httpx, "Client", lambda *args, **kwargs: router)

    streamed = client.post(
        "/api/chat/reply/stream",
        headers=headers,
        json={"conversation_id": conversation_id},
    )
    assert streamed.status_code == 200, streamed.text
    events = _events(streamed)
    # plan 里没有解读一步，也没有 translate_done 事件
    assert [event["stage"] for event in events] == [
        "plan", "score_done", "draft_done", "done",
    ]
    assert events[0]["steps"] == ["score", "draft", "rank"]
    payload = events[-1]["payload"]
    assert payload["ranked"] is True
    assert [item["text"] for item in payload["candidates"]] == ["怎么了？", "想说就说。", "我在。"]
    # 全程没有注释翻译调用：LLM 只剩起草，中文原文直通 JEV
    llm_calls = [call for call in router.calls if "systemone" not in call["url"]]
    assert llm_calls, "起草仍要走语言模型"
    for call in llm_calls:
        incoming = json_loads(call["json"]["messages"][1]["content"])
        assert "lines" not in incoming
    analyze_call = next(
        call for call in router.calls
        if "systemone" in call["url"] and "best_reply" not in ((call["json"] or {}).get("questions") or {})
    )
    assert analyze_call["json"]["state"]["chat"]["messages"][0]["text"] == "也没什么。"


def test_reply_stream_blocks_high_danger(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers = _user(client, db, "replyblock")
    _configure(client, headers)
    conversation_id = _conversation(client, db, "replyblock", headers)
    _save_other(client, headers, conversation_id, "我们分手吧。")
    router = _Router(jev_scores=_high_danger_scores())
    monkeypatch.setattr(httpx, "Client", lambda *args, **kwargs: router)

    streamed = client.post(
        "/api/chat/reply/stream",
        headers=headers,
        json={"conversation_id": conversation_id},
    )
    assert streamed.status_code == 200, streamed.text
    events = _events(streamed)
    # 高危不进入起草：评分后直接拦截收尾
    assert [event["stage"] for event in events] == [
        "plan", "translate_done", "score_done", "done",
    ]
    payload = events[-1]["payload"]
    assert payload["blocked"]
    assert payload["candidates"] == []
    draft_bodies = [
        call["json"]["messages"][1]["content"]
        for call in router.calls
        if isinstance(call["json"], dict)
        and call["json"].get("messages")
        and "judgments" in call["json"]["messages"][1]["content"]
    ]
    assert draft_bodies == []


def test_reply_stream_degrades_when_rank_fails(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers = _user(client, db, "replyrank")
    _configure(client, headers)
    conversation_id = _conversation(client, db, "replyrank", headers)
    _save_other(client, headers, conversation_id, "也没什么。")
    router = _Router(rank_ok=False)
    monkeypatch.setattr(httpx, "Client", lambda *args, **kwargs: router)

    streamed = client.post(
        "/api/chat/reply/stream",
        headers=headers,
        json={"conversation_id": conversation_id},
    )
    assert streamed.status_code == 200, streamed.text
    events = _events(streamed)
    payload = events[-1]["payload"]
    # 排序失败只是降级：候选保留起草顺序，不显示匹配度
    assert payload["ranked"] is False
    assert [item["text"] for item in payload["candidates"]] == ["我在。", "怎么了？", "想说就说。"]
    assert all(item["percent"] == 0 for item in payload["candidates"])


def test_reply_stream_errors_when_draft_fails(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers = _user(client, db, "replydraft")
    _configure(client, headers)
    conversation_id = _conversation(client, db, "replydraft", headers)
    _save_other(client, headers, conversation_id, "也没什么。")
    router = _Router(draft_ok=False)
    monkeypatch.setattr(httpx, "Client", lambda *args, **kwargs: router)

    streamed = client.post(
        "/api/chat/reply/stream",
        headers=headers,
        json={"conversation_id": conversation_id},
    )
    assert streamed.status_code == 200, streamed.text
    events = _events(streamed)
    assert events[-1]["stage"] == "error"
    assert events[-1]["error"]["message"]


def test_reply_stream_404_before_opening_stream(
    client: TestClient, db: Session
) -> None:
    headers = _user(client, db, "replymissing")
    missing = client.post(
        "/api/chat/reply/stream",
        headers=headers,
        json={"conversation_id": 9999},
    )
    assert missing.status_code == 404


def test_reply_stream_requires_messages(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers = _user(client, db, "replyempty")
    _configure(client, headers)
    conversation_id = _conversation(client, db, "replyempty", headers)
    router = _Router()
    monkeypatch.setattr(httpx, "Client", lambda *args, **kwargs: router)

    streamed = client.post(
        "/api/chat/reply/stream",
        headers=headers,
        json={"conversation_id": conversation_id},
    )
    assert streamed.status_code == 200, streamed.text
    events = _events(streamed)
    assert events[-1]["stage"] == "error"
    assert "保存" in events[-1]["error"]["message"]
