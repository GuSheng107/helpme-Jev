"""P6：通用决策工作台与自定义场景。上游一律 mock。"""

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
        mark_provider_tested(created.json()["id"])


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


class _DecideRouter:
    """LLM：题目翻译；JEV：按收到的题型返回对应答案形态。"""

    def __init__(self) -> None:
        self.calls: list[dict] = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def post(self, url, json=None, headers=None):  # noqa: A002
        self.calls.append({"url": url, "json": json})
        if "systemone" not in url:
            incoming = json_loads(json["messages"][1]["content"])
            return _Response(
                {
                    "choices": [
                        {
                            "message": {
                                "content": json_dumps(
                                    {
                                        "question": "EN: " + incoming["question"],
                                        "context": "EN: " + incoming["context"] if incoming.get("context") else "",
                                        "options": ["EN: " + item for item in incoming["options"]],
                                    }
                                )
                            }
                        }
                    ]
                }
            )
        questions = (json or {}).get("questions") or {}
        question = questions.get("decision") or {}
        if question.get("type") == "noul":
            answers = {"decision": {"noul": 0.72}}
        elif question.get("type") == "choice":
            answers = {
                "decision": {
                    "choice": "option_1",
                    "probabilities": {"option_0": 0.25, "option_1": 0.6, "option_2": 0.15},
                }
            }
        else:
            answers = {"decision": {"score": 6.4}}
        return _Response({"model": "jev-1.13.0", "answers": answers})


def json_dumps(value) -> str:
    return json.dumps(value, ensure_ascii=False)


def json_loads(text: str) -> dict:
    return json.loads(text)


# ------------------------------------------------------------------ 决策工作台
def test_decide_choice_translates_and_ranks(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers = _user(client, db, "decideone")
    _configure(client, headers)
    router = _DecideRouter()
    monkeypatch.setattr(httpx, "Client", lambda *args, **kwargs: router)
    answered = client.post(
        "/api/decide",
        headers=headers,
        json={
            "question": "这两个方案哪个更可能让老板满意？",
            "question_type": "choice",
            "options": ["先做原型快速验证", "先把方案文档写全"],
            "context": "老板时间紧",
        },
    )
    assert answered.status_code == 200, answered.text
    body = answered.json()
    assert body["kind"] == "choice"
    bars = body["result"]["bars"]
    assert bars[0]["label"] == "先把方案文档写全"
    assert bars[0]["value"] == pytest.approx(0.6)
    # 题目先译成英文再进 JEV
    jev_call = next(call for call in router.calls if "systemone" in call["url"])
    assert jev_call["json"]["state"]["question"].startswith("EN:")
    assert set(jev_call["json"]["questions"]["decision"]["criteria"]) == {"option_0", "option_1"}


def test_decide_noul_and_score(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers = _user(client, db, "decidewo")
    _configure(client, headers)
    router = _DecideRouter()
    monkeypatch.setattr(httpx, "Client", lambda *args, **kwargs: router)

    noul = client.post(
        "/api/decide",
        headers=headers,
        json={"question": "现在适合提加薪吗？", "question_type": "noul"},
    )
    assert noul.json()["result"]["text"] == "是"
    assert noul.json()["result"]["percent"] == 72

    score = client.post(
        "/api/decide",
        headers=headers,
        json={"question": "发布会翻车风险多大？", "question_type": "score"},
    )
    # 评分题给原始档位值 + 换算到 10 分制的展示值（6.4 / 9 → 7.11 / 10）
    assert score.json()["result"]["value"] == pytest.approx(6.4)
    assert score.json()["result"]["scale_max"] == 9
    assert score.json()["result"]["display_value"] == pytest.approx(7.11)
    assert score.json()["result"]["display_max"] == 10
    assert score.json()["result"]["text"] == "7.11"


def test_decide_choice_requires_two_options(client: TestClient, db: Session) -> None:
    headers = _user(client, db, "decidethree")
    _configure(client, headers)
    bad = client.post(
        "/api/decide",
        headers=headers,
        json={"question": "选哪个？", "question_type": "choice", "options": ["只有一个"]},
    )
    assert bad.status_code == 422


# ------------------------------------------------------------------ 自定义场景
def test_copy_edit_and_use_custom_scenario(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers = _user(client, db, "customone")
    _configure(client, headers)
    romance_id = _scenario_id(client, headers, "romance")

    copied = client.post(
        "/api/scenarios",
        headers=headers,
        json={"name": "我的恋爱题", "base_scenario_id": romance_id},
    )
    assert copied.status_code == 201, copied.text
    scenario = copied.json()
    assert scenario["kind"] == "custom"
    assert scenario["is_builtin"] is False
    # 复制内置场景时自动带上中文标题
    judge = json.loads(scenario["judge_questions"])
    assert judge["danger_level"]["title"] == "危险度"
    assert judge["true_intent"]["labels"]["confirm_you_care"] == "想确认你在不在意"

    # 改题：换成一道自定义判断题
    patched = client.patch(
        f"/api/scenarios/{scenario['id']}",
        headers=headers,
        json={
            "judge_questions": json_dumps(
                {
                    "my_danger": {
                        "type": "score",
                        "title": "危险度",
                        "instructions": "How risky is this exchange? Judge from the thread.",
                        "criteria": [f"Level {i}." for i in range(10)],
                    },
                    "my_intent": {
                        "type": "choice",
                        "title": "真实意图",
                        "instructions": "What is the true intent?",
                        "criteria": {"a": "Testing you.", "b": "Plain request."},
                        "labels": {"a": "在试探", "b": "就是字面意思"},
                    },
                }
            )
        },
    )
    assert patched.status_code == 200, patched.text

    # 非法题集被拒
    invalid = client.patch(
        f"/api/scenarios/{scenario['id']}",
        headers=headers,
        json={"judge_questions": "{不是JSON"},
    )
    assert invalid.status_code == 422
    broken = client.patch(
        f"/api/scenarios/{scenario['id']}",
        headers=headers,
        json={"judge_questions": json_dumps({"bad": {"type": "noul", "criteria": {}}})},
    )
    assert broken.status_code == 422

    # 挂到会话上 → 分析走自定义题集，标题用题集里的 title
    conv_id = client.post(
        "/api/conversations",
        headers=headers,
        json={
            "title": "聊天",
            "counterpart_name": "小林",
            "scenario_id": scenario["id"],
        },
    ).json()["id"]
    client.post(
        f"/api/conversations/{conv_id}/messages",
        headers=headers,
        json={"role": "other", "content": "你是不是又忘了。"},
    )

    class _CustomRouter(_DecideRouter):
        def post(self, url, json=None, headers=None):  # noqa: A002
            self.calls.append({"url": url, "json": json})
            if "systemone" not in url:
                return _Response(
                    {
                        "choices": [
                            {"message": {"content": json_dumps({"lines": [{"id": "1", "text": "Again? [short; blame]"}]})}}
                        ]
                    }
                )
            return _Response(
                {
                    "model": "jev-1.13.0",
                    "answers": {
                        "my_danger": {"score": 3},
                        "my_intent": {
                            "choice": "a",
                            "confidence": 0.7,
                            "probabilities": {"a": 0.7, "b": 0.3},
                        },
                    },
                }
            )

    router = _CustomRouter()
    monkeypatch.setattr(httpx, "Client", lambda *args, **kwargs: router)
    judged = client.post("/api/chat/analyze", json={"conversation_id": conv_id}, headers=headers)
    assert judged.status_code == 200, judged.text
    body = judged.json()
    titles = {item["title"] for item in body["panel"] + body["more"]}
    assert titles == {"危险度", "真实意图"}
    assert any(item["text"] == "在试探" for item in body["panel"] + body["more"])
    # 发给 JEV 的题不带展示性字段
    jev_call = next(call for call in router.calls if "systemone" in call["url"])
    sent = jev_call["json"]["questions"]
    assert "title" not in sent["my_danger"]
    assert "labels" not in sent["my_intent"]


def test_builtin_scenarios_cannot_be_modified(client: TestClient, db: Session) -> None:
    headers = _user(client, db, "customtwo")
    romance_id = _scenario_id(client, headers, "romance")
    patched = client.patch(
        f"/api/scenarios/{romance_id}",
        headers=headers,
        json={"name": "改名"},
    )
    assert patched.status_code == 404
    deleted = client.delete(f"/api/scenarios/{romance_id}", headers=headers)
    assert deleted.status_code == 404


def test_delete_custom_scenario_frees_conversations(
    client: TestClient, db: Session
) -> None:
    headers = _user(client, db, "customthree")
    _configure(client, headers)
    romance_id = _scenario_id(client, headers, "romance")
    scenario = client.post(
        "/api/scenarios",
        headers=headers,
        json={"name": "临时场景", "base_scenario_id": romance_id},
    ).json()
    conv_id = client.post(
        "/api/conversations",
        headers=headers,
        json={"title": "聊天", "counterpart_name": "小林", "scenario_id": scenario["id"]},
    ).json()["id"]
    removed = client.delete(f"/api/scenarios/{scenario['id']}", headers=headers)
    assert removed.status_code == 204
    view = client.get(f"/api/conversations/{conv_id}", headers=headers).json()
    assert view["scenario_id"] is None
    assert view["scenario_kind"] == "romance"
