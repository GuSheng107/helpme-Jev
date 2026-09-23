"""P6：场景体系 —— 内置场景播种、职场判断链路、人设按情境分档、去性别默认。上游一律 mock。"""

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
from app.scenarios.persona_questions import workplace_persona_questions
from app.scenarios.questions_workplace import workplace_questions


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
    for kind in ("llm", "jev"):
        url = (
            "https://llm.example/v1/chat/completions"
            if kind == "llm"
            else "https://jev.example/v1/systemone"
        )
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


def _scenario_id(client: TestClient, headers: dict, kind: str) -> int:
    rows = client.get("/api/scenarios", headers=headers).json()
    return next(row["id"] for row in rows if row["kind"] == kind)


class _Response:
    def __init__(self, payload) -> None:
        self.status_code = 200
        self._payload = payload
        self.text = json.dumps(payload)

    def json(self):
        return self._payload


class _Router:
    """按 URL 分流：LLM 返回翻译，JEV 返回职场题答案。"""

    def __init__(self, *, stakes: float = 3.0) -> None:
        self.stakes = stakes
        self.calls: list[dict] = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def post(self, url, json=None, headers=None):  # noqa: A002
        self.calls.append({"url": url, "json": json})
        if "systemone" not in url:
            body = {"lines": [{"id": "1", "text": "Where are we on this?"}]}
            return _Response({"choices": [{"message": {"content": json_dumps(body)}}]})
        answers = {
            "literal_question": {"noul": 0.9},
            "true_intent": {
                "choice": "request_status",
                "confidence": 0.8,
                "probabilities": {"request_status": 0.8, "assign_task": 0.2},
            },
            "stakes_level": {"score": self.stakes, "confidence": 0.7},
            "should_reply_now": {"noul": 0.7},
            "best_action": {"choice": "give_status", "confidence": 0.75},
            "other_needs": {"choice": "facts", "confidence": 0.8},
            "power_dynamic": {"choice": "superior", "confidence": 0.6},
            "tension_resolved": {"noul": 0.8},
            "emotion": {"choice": "pressed", "confidence": 0.7},
            "emotion_intensity": {"score": 2},
            "context_sufficient": {"noul": 0.9},
        }
        return _Response({"model": "jev-1.13.0", "answers": answers})


def json_dumps(value) -> str:
    return json.dumps(value, ensure_ascii=False)


class _PersonaRouter:
    """人设建模：恋爱与职场题共用一个应答器，按收到的题集回答案。"""

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def post(self, url, json=None, headers=None):  # noqa: A002
        if "systemone" not in url:
            body = {"lines": [{"id": "1", "text": "Nothing much."}]}
            return _Response({"choices": [{"message": {"content": json_dumps(body)}}]})
        questions = (json or {}).get("questions") or {}
        if "disc" in questions:
            answers = {
                "disc": {"choice": "conscientiousness", "confidence": 0.7},
                "conflict_style": {"choice": "collaborating", "confidence": 0.7},
                "conscientiousness": {"score": 7},
                "evidence_sufficient": {"noul": 0.8},
            }
        else:
            answers = {
                "attachment": {"choice": "anxious", "confidence": 0.7},
                "love_language": {"choice": "time", "confidence": 0.7},
                "conflict_style": {"choice": "avoiding", "confidence": 0.7},
                "openness": {"score": 5},
                "evidence_sufficient": {"noul": 0.8},
            }
        return _Response({"model": "jev", "answers": answers})


# ------------------------------------------------------------------ 题目与播种
def test_workplace_questions_shape() -> None:
    questions = workplace_questions()
    assert questions["stakes_level"]["type"] == "score"
    assert len(questions["stakes_level"]["criteria"]) == 10
    assert set(questions["power_dynamic"]["criteria"]) == {
        "superior",
        "peer",
        "subordinate",
        "external",
    }
    # 职场题里不该有恋爱专属维度
    assert "she_needs" not in questions
    assert "danger_level" not in questions


def test_workplace_persona_questions_frameworks() -> None:
    questions = workplace_persona_questions("other")
    assert set(questions["disc"]["criteria"]) == {
        "dominance",
        "influence",
        "steadiness",
        "conscientiousness",
    }
    # 依恋与爱的语言是亲密关系维度，不进职场档案；MBTI 不进任何档案
    assert "attachment" not in questions
    assert "love_language" not in questions
    assert "mbti" not in questions


def test_builtin_scenarios_seeded(client: TestClient, db: Session) -> None:
    headers = _user(client, db, "scenariolist")
    rows = client.get("/api/scenarios", headers=headers).json()
    kinds = {row["kind"] for row in rows}
    assert {"romance", "workplace"} <= kinds
    workplace = next(row for row in rows if row["kind"] == "workplace")
    assert workplace["name"] == "职场助手"
    assert workplace["is_builtin"] is True


# ------------------------------------------------------------------ 职场判断链路
def test_workplace_conversation_uses_workplace_pack(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers = _user(client, db, "workplaceone")
    _configure(client, headers)
    created = client.post(
        "/api/conversations",
        headers=headers,
        json={
            "title": "和张主管的聊天",
            "counterpart_name": "张主管",
            "relationship": "上级",
            "scenario_id": _scenario_id(client, headers, "workplace"),
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["scenario_kind"] == "workplace"
    conv_id = created.json()["id"]
    client.post(
        f"/api/conversations/{conv_id}/messages",
        headers=headers,
        json={"role": "other", "content": "进度怎么样了？"},
    )

    router = _Router()
    monkeypatch.setattr(httpx, "Client", lambda *args, **kwargs: router)
    judged = client.post("/api/chat/analyze", json={"conversation_id": conv_id}, headers=headers)
    assert judged.status_code == 200, judged.text
    body = judged.json()
    assert body["panel"][0]["key"] == "stakes_level"
    assert any(item["text"] == "在要进展" for item in body["panel"])
    assert body["high_danger"] is False

    jev_call = next(call for call in router.calls if "systemone" in call["url"])
    sent_questions = set(jev_call["json"]["questions"])
    assert "stakes_level" in sent_questions
    assert "danger_level" not in sent_questions


def test_workplace_high_stakes_blocks_draft(
    client: TestClient, db: Session
) -> None:
    headers = _user(client, db, "workplacehigh")
    _configure(client, headers)
    conv_id = client.post(
        "/api/conversations",
        headers=headers,
        json={
            "title": "和张主管的聊天",
            "counterpart_name": "张主管",
            "relationship": "上级",
            "scenario_id": _scenario_id(client, headers, "workplace"),
        },
    ).json()["id"]
    client.post(
        f"/api/conversations/{conv_id}/messages",
        headers=headers,
        json={"role": "other", "content": "这事怎么漏到现在才说？"},
    )
    blocked = client.post(
        "/api/chat/reply",
        headers=headers,
        json={
            "conversation_id": conv_id,
            "decision": {"stakes_level": {"value": 9}, "best_action": {"text": "如实汇报进展与卡点"}},
        },
    )
    assert blocked.status_code == 422
    assert "利害" in blocked.json()["error"]["message"]


def test_romance_high_danger_keeps_romance_copy(
    client: TestClient, db: Session
) -> None:
    headers = _user(client, db, "romancehigh")
    _configure(client, headers)
    conv_id = client.post(
        "/api/conversations",
        headers=headers,
        json={"title": "聊天", "counterpart_name": "小林", "relationship": "恋人"},
    ).json()["id"]
    client.post(
        f"/api/conversations/{conv_id}/messages",
        headers=headers,
        json={"role": "other", "content": "我们谈谈吧。"},
    )
    blocked = client.post(
        "/api/chat/reply",
        headers=headers,
        json={"conversation_id": conv_id, "decision": {"danger_level": {"value": 9}}},
    )
    assert blocked.status_code == 422
    assert "当面" in blocked.json()["error"]["message"]


# ------------------------------------------------------------------ 人设按情境分档
def test_same_counterpoint_keeps_two_context_personas(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers = _user(client, db, "dualcontext")
    _configure(client, headers)
    # 同一个人「小林」：一个恋爱会话、一个职场会话，counterpart_key 相同
    love_id = client.post(
        "/api/conversations",
        headers=headers,
        json={"title": "和小林的聊天", "counterpart_name": "小林", "relationship": "恋人"},
    ).json()["id"]
    work_id = client.post(
        "/api/conversations",
        headers=headers,
        json={
            "title": "和小林的工作沟通",
            "counterpart_name": "小林",
            "relationship": "同事",
            "scenario_id": _scenario_id(client, headers, "workplace"),
        },
    ).json()["id"]
    for conv_id in (love_id, work_id):
        client.post(
            f"/api/conversations/{conv_id}/messages",
            headers=headers,
            json={"role": "other", "content": "这件事你怎么看？"},
        )

    router = _PersonaRouter()
    monkeypatch.setattr(httpx, "Client", lambda *args, **kwargs: router)
    built_love = client.post(
        "/api/personas/build",
        headers=headers,
        json={"conversation_id": love_id, "subject": "other"},
    )
    assert built_love.status_code == 200, built_love.text
    built_work = client.post(
        "/api/personas/build",
        headers=headers,
        json={"conversation_id": work_id, "subject": "other"},
    )
    assert built_work.status_code == 200, built_work.text

    key = built_love.json()["counterpart_key"]
    assert key == built_work.json()["counterpart_key"]

    love_view = client.get(
        "/api/personas",
        headers=headers,
        params={"counterpart_key": key, "subject": "other", "context": "romance"},
    ).json()
    work_view = client.get(
        "/api/personas",
        headers=headers,
        params={"counterpart_key": key, "subject": "other", "context": "workplace"},
    ).json()
    love_traits = {item["key"] for item in love_view["traits"]}
    work_traits = {item["key"] for item in work_view["traits"]}
    assert "attachment" in love_traits
    assert "disc" in work_traits
    # 两份档案各自独立，版本互不影响
    assert love_view["version"] == 1
    assert work_view["version"] == 1
    # 弱科学框架必须明示
    love_weak = {item["key"] for item in love_view["traits"] if item["weak_science"]}
    work_weak = {item["key"] for item in work_view["traits"] if item["weak_science"]}
    assert love_weak == {"love_language"}
    assert work_weak == {"disc"}


# ------------------------------------------------------------------ 去性别默认
def test_import_accepts_male_and_gender_free_labels(
    client: TestClient, db: Session
) -> None:
    headers = _user(client, db, "genderfree")
    _configure(client, headers)
    conv_id = client.post(
        "/api/conversations",
        headers=headers,
        json={"title": "聊天", "counterpart_name": "阿明", "relationship": "朋友"},
    ).json()["id"]
    preview = client.post(
        "/api/import/chat/preview",
        headers=headers,
        json={
            "conversation_id": conv_id,
            "text": "我: 在吗\n他: 在忙\nTA: 一会儿说",
        },
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["count"] == 3
    assert preview.json()["skipped"] == 0


def test_panel_titles_do_not_hardcode_gender() -> None:
    from app.scenarios.questions_romance import QUESTION_TITLES

    assert QUESTION_TITLES["she_needs"] == "对方需要什么"
