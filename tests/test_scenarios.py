"""P6：场景体系 —— 内置场景播种、职场判断链路、人设按情境分档、去性别默认。上游一律 mock。"""

from __future__ import annotations

import json
from types import SimpleNamespace

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
        mark_provider_tested(created.json()["id"])


def _scenario_id(client: TestClient, headers: dict, kind: str) -> int:
    rows = client.get("/api/scenarios", headers=headers).json()
    return next(row["id"] for row in rows if row["kind"] == kind)


def test_question_generation_failure_has_same_trace_model_detail(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers = _user(client, db, "generatefail")
    _configure(client, headers)
    monkeypatch.setattr(
        "app.services.scenario_generation_service.chat_json",
        lambda **_kwargs: SimpleNamespace(
            ok=False, payload={}, detail="上游不可用", status_code=502, latency_ms=8,
        ),
    )
    response = client.post(
        "/api/scenarios/generate-questions", headers=headers,
        json={"kind": "judge", "name": "自定义场景"},
    )
    assert response.status_code == 502
    logs = client.get(
        "/api/logs", headers=headers,
        params={"trace_id": response.headers["x-trace-id"]},
    ).json()["items"]
    assert any(item["source"] == "用户" and item["level"] == "error" for item in logs)
    assert any(item["source"] == "LLM" and item["level"] == "error" for item in logs)


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

    def post(self, url, json=None, headers=None, timeout=None):  # noqa: A002
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

    def post(self, url, json=None, headers=None, timeout=None):  # noqa: A002
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
    # 内置提示词是中文文案，编辑器里不应回显内部英文机器文案
    assert "回复候选" in workplace["system_prompt"]
# ------------------------------------------------------------------ 去性别默认
def test_import_accepts_male_and_gender_free_labels(
    client: TestClient, db: Session
) -> None:
    headers = _user(client, db, "genderfree")
    _configure(client, headers)
    conv_id = client.post(
        "/api/conversations",
        headers=headers,
        json={"title": "聊天", "profile_id": seed_profile(db, user_id_by_name(db, "genderfree"), "阿明"), "relationship": "朋友"},
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


# ------------------------------------------------------------------ 系统级场景
def _admin_headers(client: TestClient, db: Session) -> dict[str, str]:
    from tests.test_auth_flow import _activate_admin

    token = _activate_admin(client, db)
    return {"Authorization": f"Bearer {token}"}


_MIN_JUDGE = json.dumps({
    "risk_level": {
        "type": "score",
        "instructions": "Rate the risk of the latest exchange.",
        "criteria": ["low", "medium", "high"],
    },
}, ensure_ascii=False)
_MIN_PERSONA = json.dumps({
    "evidence_sufficient": {
        "type": "noul",
        "instructions": "True when the conversation has enough evidence.",
        "criteria": {"true": "Enough evidence.", "false": "Not enough."},
    },
    "communication_style": {
        "type": "choice",
        "instructions": "How does the other person communicate?",
        "criteria": {"direct": "Straight to the point.", "tactful": "Indirect."},
    },
}, ensure_ascii=False)


def test_admin_created_scenario_is_system_level(
    client: TestClient, db: Session
) -> None:
    """管理员新建的场景即系统级：所有人可见，普通用户只读，管理员可维护。"""
    admin = _admin_headers(client, db)
    user = _user(client, db, "scenreader")

    created = client.post(
        "/api/scenarios", headers=admin,
        json={
            "name": "客服对话",
            "description": "系统级客服场景",
            "judge_questions": _MIN_JUDGE,
            "persona_questions": _MIN_PERSONA,
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["is_system"] is True

    # 普通用户可见、可复制，但不能改删
    rows = client.get("/api/scenarios", headers=user).json()
    assert any(row["id"] == body["id"] for row in rows)
    denied_patch = client.patch(
        f"/api/scenarios/{body['id']}", headers=user, json={"name": "改名"},
    )
    assert denied_patch.status_code == 404, denied_patch.text
    denied_delete = client.delete(f"/api/scenarios/{body['id']}", headers=user)
    assert denied_delete.status_code == 404, denied_delete.text

    # 管理员可改可删
    patched = client.patch(
        f"/api/scenarios/{body['id']}", headers=admin, json={"description": "已修订"},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["description"] == "已修订"
    assert client.delete(f"/api/scenarios/{body['id']}", headers=admin).status_code == 204


def test_admin_can_edit_and_delete_builtin_scenario(
    client: TestClient, db: Session
) -> None:
    """内置场景落库后以数据库为准：管理员可改可删，普通用户不行。"""
    from app.repositories.models import Scenario
    from app.services.bootstrap import ensure_builtin_scenarios

    admin = _admin_headers(client, db)
    user = _user(client, db, "builtinreader")
    romance_id = _scenario_id(client, admin, "romance")

    denied = client.patch(
        f"/api/scenarios/{romance_id}", headers=user, json={"name": "改掉恋爱助手"},
    )
    assert denied.status_code == 404, denied.text

    patched = client.patch(
        f"/api/scenarios/{romance_id}", headers=admin,
        json={"name": "恋爱顾问", "description": "管理员改过的说明"},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["name"] == "恋爱顾问"
    assert patched.json()["is_builtin"] is True

    ensure_builtin_scenarios(db)
    db.expire_all()
    row = db.get(Scenario, romance_id)
    assert row is not None
    assert row.name == "恋爱顾问"
    assert row.description == "管理员改过的说明"

    assert client.delete(f"/api/scenarios/{romance_id}", headers=user).status_code == 404
    assert client.delete(f"/api/scenarios/{romance_id}", headers=admin).status_code == 204
    ensure_builtin_scenarios(db)
    db.expire_all()
    assert db.get(Scenario, romance_id) is None


def test_user_created_scenario_stays_personal(
    client: TestClient, db: Session
) -> None:
    headers = _user(client, db, "scenowner")
    created = client.post(
        "/api/scenarios", headers=headers,
        json={
            "name": "我的场景",
            "judge_questions": _MIN_JUDGE,
            "persona_questions": _MIN_PERSONA,
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["is_system"] is False


# ------------------------------------------------------------------ 提示词生成
def test_generate_prompt_success_and_failure(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers = _user(client, db, "promptgen")
    _configure(client, headers)
    monkeypatch.setattr(
        "app.services.scenario_generation_service.chat_json",
        lambda **_kwargs: SimpleNamespace(
            ok=True, payload={"prompt": "Sound like a patient support agent."},
            status_code=200, latency_ms=5,
        ),
    )
    ok = client.post(
        "/api/scenarios/generate-prompt", headers=headers,
        json={"name": "客服", "requirements": "亲切但不油腻"},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["prompt"] == "Sound like a patient support agent."

    monkeypatch.setattr(
        "app.services.scenario_generation_service.chat_json",
        lambda **_kwargs: SimpleNamespace(
            ok=True, payload={}, status_code=200, latency_ms=5,
        ),
    )
    empty = client.post("/api/scenarios/generate-prompt", headers=headers, json={"name": "客服"})
    assert empty.status_code == 422, empty.text

    monkeypatch.setattr(
        "app.services.scenario_generation_service.chat_json",
        lambda **_kwargs: SimpleNamespace(
            ok=False, payload={}, detail="上游不可用", status_code=502, latency_ms=8,
        ),
    )
    failed = client.post("/api/scenarios/generate-prompt", headers=headers, json={"name": "客服"})
    assert failed.status_code == 502, failed.text
