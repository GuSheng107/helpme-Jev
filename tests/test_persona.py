"""P5：人设建模与素材导入。上游一律 mock。"""

from __future__ import annotations

import json as _json

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.clients.http_client import reset_client
from app.core.security import hash_password
from app.domain.enums import UserRole
from app.repositories.auth_repo import UserRepository
from app.repositories.models import User
from tests.profile_seed import seed_profile, user_id_by_name
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


def _ready(client: TestClient, db: Session, username: str, headers: dict, *, vision: bool = False) -> int:
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
        json={
            "title": "她",
            "profile_id": seed_profile(db, user_id_by_name(db, username), "她"),
            "relationship": "恋人",
        },
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

    def post(self, url, json=None, headers=None, timeout=None):  # noqa: A002
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
        self.text = _json.dumps(payload)

    def json(self):
        return self._payload


def json_dumps(value) -> str:
    return _json.dumps(value, ensure_ascii=False)


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


def test_chat_import_previews_before_saving(
    client: TestClient, db: Session
) -> None:
    headers = _user(client, db, "importone")
    conv_id = _ready(client, db, "importone", headers)
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


def test_solo_import_labels_append_to_defaults(
    client: TestClient, db: Session
) -> None:
    """自定义对方标签是补充：默认的 她 / 他 / TA 始终认，不能被替换掉。"""
    headers = _user(client, db, "labelappend")
    conv_id = _ready(client, db, "labelappend", headers)
    preview = client.post(
        "/api/import/chat/preview",
        headers=headers,
        json={
            "conversation_id": conv_id,
            "text": "我: 好\n她: 嗯\nTA: 行\n小美: 明天见\n陌生人: 不认",
            "other_labels": ["小美"],
        },
    )
    assert preview.status_code == 200
    body = preview.json()
    assert body["count"] == 4
    assert body["skipped"] == 1
    labels = {(item["label"], item["role"]) for item in body["messages"]}
    assert labels == {
        ("我", "me"),
        ("她", "other"),
        ("TA", "other"),
        ("小美", "other"),
    }


def test_qa_rejects_invalid_json(client: TestClient, db: Session) -> None:
    headers = _user(client, db, "qaone")
    _ready(client, db, "qaone", headers)
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
    conv_id = _ready(client, db, "shotone", headers, vision=False)
    refused = client.post(
        "/api/materials/screenshot",
        headers=headers,
        data={"conversation_id": str(conv_id)},
        files={"file": ("a.png", b"png", "image/png")},
    )
    assert refused.status_code == 422


# ------------------------------------------------------------------ 群聊人设
class _EchoRouter(_Router):
    """翻译阶段按请求回显：群聊测试里消息不止一条。"""

    def post(self, url, json=None, headers=None, timeout=None):  # noqa: A002
        if "systemone" not in url:
            chat = (json or {}).get("messages", [{}])[-1].get("content", "{}")
            payload = _json.loads(chat)
            lines = [
                {"id": item["id"], "text": f"Echoed: {item['text']}"}
                for item in payload.get("lines", [])
            ]
            return _Response({"choices": [{"message": {"content": json_dumps({"lines": lines})}}]})
        return super().post(url, json=json, headers=headers, timeout=timeout)


def _group(client: TestClient, db: Session, username: str, headers: dict, *, with_messages: bool = True) -> int:
    created = client.post(
        "/api/conversations",
        headers=headers,
        json={
            "title": "项目小队",
            "relationship": "同事",
            "member_profile_ids": [
                seed_profile(db, user_id_by_name(db, username), "小林"),
                seed_profile(db, user_id_by_name(db, username), "阿花"),
            ],
        },
    )
    assert created.status_code == 201, created.text
    conv_id = created.json()["id"]
    if with_messages:
        for speaker, content in (
            ("小林", "这个需求我看悬，先说好做不完别赖我。"),
            ("阿花", "没事，我们一起拆一下任务就行。"),
            ("小林", "反正我按计划来，别临时加。"),
        ):
            resp = client.post(
                f"/api/conversations/{conv_id}/messages",
                headers=headers,
                json={"role": "other", "content": content, "speaker": speaker},
            )
            assert resp.status_code == 201, resp.text
    return conv_id


def test_group_persona_batch_and_member_build(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """群聊：批量取全员人设与上下文；成员校验；占位档案被建模吸收补全。"""
    headers = _user(client, db, "grouppersona")
    _ready(client, db, "grouppersona", headers)
    conv_id = _group(client, db, "grouppersona", headers)

    monkeypatch.setattr(httpx, "Client", lambda *args, **kwargs: _EchoRouter())
    # 小林是占位档案：建模直接吸收补全（不再 409）
    built = client.post(
        "/api/personas/build",
        headers=headers,
        json={"conversation_id": conv_id, "subject": "other", "member_key": "小林"},
    )
    assert built.status_code == 200, built.text
    assert built.json()["counterpart_key"] == "小林"
    assert built.json()["kept"] is False

    # 成员不存在 → 422
    missing = client.post(
        "/api/personas/build",
        headers=headers,
        json={"conversation_id": conv_id, "subject": "other", "member_key": "路人"},
    )
    assert missing.status_code == 422

    batch = client.get(
        "/api/personas/batch", headers=headers, params={"conversation_id": conv_id}
    )
    assert batch.status_code == 200, batch.text
    body = batch.json()
    assert body["is_group"] is True
    # 会话没挂场景：人设情境回落恋爱档（情境跟场景走，不看关系字段）
    assert body["context"] == "romance"
    keys = {item["key"]: item for item in body["participants"]}
    assert set(keys) == {"小林", "阿花", "me"}
    # 小林的档案被吸收补全（占位 v1 → v2）；阿花仍是空占位
    assert keys["小林"]["persona"]["version"] == 2
    assert keys["小林"]["persona"]["traits"]
    assert keys["阿花"]["persona"]["version"] == 1
    assert keys["阿花"]["persona"]["traits"] == []
    assert keys["me"]["subject"] == "me"


def test_group_import_maps_member_labels(client: TestClient, db: Session) -> None:
    """群聊导入：成员名当标签，行归属到对应发言人。"""
    headers = _user(client, db, "groupimport")
    conv_id = _group(client, db, "groupimport", headers, with_messages=False)

    preview = client.post(
        "/api/import/chat/preview",
        headers=headers,
        json={
            "conversation_id": conv_id,
            "text": "小林: 周三评审别忘\n阿花: 收到\n路人: 冒充\n我: 好",
        },
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["count"] == 3
    assert body["skipped"] == 1
    labels = {(item["label"], item["role"]) for item in body["messages"]}
    assert labels == {("小林", "other"), ("阿花", "other"), ("我", "me")}

    saved = client.post(
        "/api/import/chat",
        headers=headers,
        json={
            "conversation_id": conv_id,
            "text": "小林: 周三评审别忘\n阿花: 收到\n我: 好",
        },
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["imported"] == 3
    rows = client.get(f"/api/conversations/{conv_id}/messages", headers=headers).json()
    assert [(row["speaker"], row["role"]) for row in rows] == [
        ("小林", "other"),
        ("阿花", "other"),
        ("", "me"),
    ]


def test_member_persona_lines_respects_budget(client: TestClient, db: Session) -> None:
    """群聊背景的人设摘要受字符预算约束，不能把记忆挤出去。"""
    import json as _json

    from app.repositories.models import Conversation, Persona
    from app.services.persona_service import (
        PERSONA_LINES_BUDGET_CHARS,
        PersonaService,
    )

    password = "budgetuser!Passw0rd"
    UserRepository().add(
        db,
        User(
            username="budgetuser",
            display_name="budgetuser",
            password_hash=hash_password(password),
            role=UserRole.USER.value,
            must_change_password=False,
            is_active=True,
        ),
    )
    db.commit()
    resp = client.post("/api/auth/login", json={"username": "budgetuser", "password": password})
    owner = int(resp.json()["id"])

    members = [{"key": f"m{i:02d}", "name": f"成员{i:02d}"} for i in range(20)]
    conv = Conversation(
        owner_user_id=owner,
        title="预算群",
        counterpart_key="预算群",
        is_group=True,
        members=_json.dumps(members, ensure_ascii=False),
    )
    db.add(conv)
    db.flush()
    # 每条档案带一段长文本，确保预算真的会截断
    traits = _json.dumps(
        {
            "_schema": "custom_v1",
            "values": {"style": "long"},
            "meta": {"style": {"title": "风格", "labels": {"long": "详" * 60}}},
        },
        ensure_ascii=False,
    )
    for member in members:
        db.add(
            Persona(
                owner_user_id=owner,
                counterpart_key=member["key"],
                subject="other",
                context="romance",
                traits=traits,
                evidence="[]",
                confidence=0.8,
                version=1,
            )
        )
    db.commit()

    lines = PersonaService().member_persona_lines(db, owner_user_id=owner, conversation=conv)
    assert 0 < len(lines) < 20  # 预算装不下全部 20 人
    assert sum(len(line) + 1 for line in lines) <= PERSONA_LINES_BUDGET_CHARS + len(lines[0])


def test_batch_accepts_explicit_context(client: TestClient, db: Session) -> None:
    """batch 带 context 参数：面板情境跟随前端恋爱 / 职场切换。"""
    import json as _json

    from app.repositories.models import Conversation, Persona

    password = "batchctx!Passw0rd"
    UserRepository().add(
        db,
        User(
            username="batchctx",
            display_name="batchctx",
            password_hash=hash_password(password),
            role=UserRole.USER.value,
            must_change_password=False,
            is_active=True,
        ),
    )
    db.commit()
    resp = client.post("/api/auth/login", json={"username": "batchctx", "password": password})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}
    owner = int(resp.json()["id"])

    conv = Conversation(
        owner_user_id=owner,
        title="情境群",
        counterpart_key="情境群",
        is_group=True,
        members=_json.dumps([{"key": "小林", "name": "小林"}], ensure_ascii=False),
    )
    db.add(conv)
    db.flush()
    db.add(
        Persona(
            owner_user_id=owner,
            counterpart_key="小林",
            subject="other",
            context="workplace",
            traits=_json.dumps({"disc": "steadiness"}, ensure_ascii=False),
            evidence="[]",
            confidence=0.8,
            version=1,
        )
    )
    db.commit()

    default = client.get(
        "/api/personas/batch", headers=headers, params={"conversation_id": conv.id}
    ).json()
    assert default["context"] == "romance"  # 没挂场景，回落恋爱
    assert default["participants"][0]["persona"]["version"] == 0

    workplace = client.get(
        "/api/personas/batch",
        headers=headers,
        params={"conversation_id": conv.id, "context": "workplace"},
    ).json()
    assert workplace["context"] == "workplace"
    assert workplace["participants"][0]["persona"]["version"] == 1


def test_group_summary_keeps_speaker_names(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """群聊滚动摘要的 payload 按发言人归属，不再是 other。"""
    from app.repositories.models import Conversation, Message
    from app.services import context_service

    password = "summaryg!Passw0rd"
    UserRepository().add(
        db,
        User(
            username="summaryg",
            display_name="summaryg",
            password_hash=hash_password(password),
            role=UserRole.USER.value,
            must_change_password=False,
            is_active=True,
        ),
    )
    db.commit()
    resp = client.post("/api/auth/login", json={"username": "summaryg", "password": password})
    owner = int(resp.json()["id"])

    conv = Conversation(
        owner_user_id=owner,
        title="摘要群",
        counterpart_key="摘要群",
        is_group=True,
        members=_json.dumps([{"key": "小林", "name": "小林"}], ensure_ascii=False),
    )
    db.add(conv)
    db.flush()
    for seq in range(1, 32):  # 31 条：pending = 31 - 10 = 21 ≥ SUMMARY_GAP(20)
        db.add(
            Message(
                conversation_id=conv.id,
                seq=seq,
                role="other",
                content=f"第{seq}条",
                speaker="小林",
            )
        )
    db.commit()

    captured: dict = {}

    class _Result:
        ok = True
        payload = {"summary": "摘要"}
        status_code = 200
        latency_ms = 1
        detail = ""

    def _fake_chat_json(**kwargs):
        captured["messages"] = kwargs["messages"][1]["content"]
        return _Result()

    monkeypatch.setattr(context_service, "chat_json", _fake_chat_json)
    context_service.ensure_summary(
        db, conversation=conv, owner_user_id=owner,
        endpoint_url="https://llm.example/v1", api_key="k", model="m",
    )
    body = _json.loads(captured["messages"])
    assert body["messages"][0]["from"] == "小林"


def test_batch_hidden_from_other_users(client: TestClient, db: Session) -> None:
    """批量接口的越权隔离：别人的会话一律 404。"""
    headers = _user(client, db, "batchowner")
    conv_id = _group(client, db, "batchowner", headers, with_messages=False)

    stranger = _user(client, db, "batchstranger")
    peeked = client.get(
        "/api/personas/batch", headers=stranger, params={"conversation_id": conv_id}
    )
    assert peeked.status_code == 404
    assert peeked.json()["error"]["code"] == "NOT_FOUND"


# ------------------------------------------------------------------ 人设库
class _SummaryRouter:
    """LLM 返回固定速写；记录请求供断言。"""

    def __init__(self) -> None:
        self.calls: list[dict] = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def post(self, url, json=None, headers=None, timeout=None):  # noqa: A002
        self.calls.append({"url": url, "json": json})
        return _Response(
            {"choices": [{"message": {"content": _json.dumps({"summary": "做事有计划，容易焦虑，需要被肯定。"})}}]}
        )


_PROFILE_ANSWERS = {
    "openness": 7,
    "conscientiousness": 7,
    "extraversion": 4,
    "agreeableness": 7,
    "emotional_stability": 1,
    "attachment": "anxious",
    "love_language": "words",
    "conflict_style": "avoiding",
}


def test_profile_create_maps_answers_and_summarizes(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """答题 → traits 落库 + LLM 生成速写；同名人设 409；非法作答 422。"""
    headers = _user(client, db, "profilelib")
    _ready(client, db, "profilelib", headers)
    router = _SummaryRouter()
    monkeypatch.setattr(httpx, "Client", lambda *args, **kwargs: router)

    created = client.post(
        "/api/personas/profiles",
        headers=headers,
        json={"nickname": "小美", "context": "romance", "answers": _PROFILE_ANSWERS},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["key"] == "小美"
    assert body["summary"] == "做事有计划，容易焦虑，需要被肯定。"
    traits = {item["key"]: item for item in body["traits"]}
    assert traits["openness"]["value"] == 7
    assert traits["attachment"]["text"] == "焦虑型"
    assert traits["love_language"]["weak_science"] is True

    # answers 列存的是清洗后的作答（档位整数 / 枚举值），不是原始 payload
    import json as _json

    from sqlalchemy import select

    from app.core.db import SessionLocal
    from app.repositories.models import PersonaProfile

    session = SessionLocal()
    stored = session.scalars(
        select(PersonaProfile).where(
            PersonaProfile.owner_user_id == user_id_by_name(db, "profilelib"),
            PersonaProfile.key == "小美",
        )
    ).first()
    stored_answers = _json.loads(stored.answers)
    session.close()
    assert stored_answers == _PROFILE_ANSWERS
    assert stored_answers["openness"] == 7

    duplicate = client.post(
        "/api/personas/profiles",
        headers=headers,
        json={"nickname": " 小美 ", "context": "workplace", "answers": {"disc": "dominance"}},
    )
    assert duplicate.status_code == 409

    blank = client.post(
        "/api/personas/profiles",
        headers=headers,
        json={"nickname": "   ", "context": "romance", "answers": {"openness": 7}},
    )
    assert blank.status_code == 422
    bad_avatar = client.post(
        "/api/personas/profiles",
        headers=headers,
        json={
            "nickname": "小华", "context": "romance",
            "avatar_base64": "<script>alert(1)</script>",
            "answers": {"openness": 7},
        },
    )
    assert bad_avatar.status_code == 422

    bad = client.post(
        "/api/personas/profiles",
        headers=headers,
        json={"nickname": "小华", "context": "romance", "answers": {"openness": 99}},
    )
    assert bad.status_code == 422
    unknown = client.post(
        "/api/personas/profiles",
        headers=headers,
        json={"nickname": "小华", "context": "romance", "answers": {"mbti": "INTJ"}},
    )
    assert unknown.status_code == 422

    # LLM 失败 → 502，且不落库
    def _boom(*args, **kwargs):
        raise AssertionError("not used")

    class _FailRouter:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, json=None, headers=None, timeout=None):  # noqa: A002
            return _Response({"choices": [{"message": {"content": "not json"}}]})

    monkeypatch.setattr(httpx, "Client", lambda *args, **kwargs: _FailRouter())
    reset_client()
    failed = client.post(
        "/api/personas/profiles",
        headers=headers,
        json={"nickname": "小华", "context": "romance", "answers": _PROFILE_ANSWERS},
    )
    assert failed.status_code == 502
    listed = client.get("/api/personas/profiles", headers=headers).json()
    nicknames = [item["nickname"] for item in listed]
    assert "小美" in nicknames and "小华" not in nicknames  # 502 的不落库；_ready 播种的「她」不在断言内


def test_conversation_selects_profiles(client: TestClient, db: Session) -> None:
    """聊天创建选人设：单聊整档带入，群聊成员全部来自档案（重复 key 去重），跨用户 404。"""
    import json as _json

    from sqlalchemy import select

    from app.core.db import SessionLocal
    from app.repositories.models import PersonaProfile

    password = "chatprofile!Passw0rd"
    UserRepository().add(
        db,
        User(
            username="chatprofile",
            display_name="chatprofile",
            password_hash=hash_password(password),
            role=UserRole.USER.value,
            must_change_password=False,
            is_active=True,
        ),
    )
    db.commit()
    resp = client.post("/api/auth/login", json={"username": "chatprofile", "password": password})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}
    owner = int(resp.json()["id"])

    session = SessionLocal()
    for nickname, context in (("小美", "romance"), ("阿花", "workplace")):
        session.add(
            PersonaProfile(
                owner_user_id=owner,
                key=nickname,
                nickname=nickname,
                context=context,
                traits=_json.dumps({"openness": 5}, ensure_ascii=False),
            )
        )
    session.commit()
    profiles = {
        p.nickname: p.id
        for p in session.scalars(
            select(PersonaProfile).where(PersonaProfile.owner_user_id == owner)
        )
    }
    session.close()

    solo = client.post(
        "/api/conversations",
        headers=headers,
        json={"title": "和小美的聊天", "profile_id": profiles["小美"]},
    )
    assert solo.status_code == 201, solo.text
    assert solo.json()["counterpart_key"] == "小美"
    assert solo.json()["counterpart_name"] == "小美"
    assert solo.json()["is_group"] is False

    # 群聊成员全部来自档案：重复选同一档案按 key 去重
    group = client.post(
        "/api/conversations",
        headers=headers,
        json={
            "title": "项目组",
            "member_profile_ids": [profiles["小美"], profiles["阿花"], profiles["小美"]],
        },
    )
    assert group.status_code == 201, group.text
    keys = [m["key"] for m in group.json()["members"]]
    assert keys == ["小美", "阿花"]
    assert group.json()["is_group"] is True
    assert group.json()["counterpart_key"] == "项目组"

    # 手填成员一律拒绝，即使和档案同名也不行
    hand = client.post(
        "/api/conversations",
        headers=headers,
        json={
            "title": "手填群",
            "member_profile_ids": [profiles["小美"]],
            "members": ["小美", "小林"],
        },
    )
    assert hand.status_code == 422
    assert "全部从人设库选择" in hand.json()["error"]["message"]

    missing = client.post(
        "/api/conversations", headers=headers, json={"title": "x", "profile_id": 99999}
    )
    assert missing.status_code == 404


def test_placeholder_profile_upgraded_by_wizard(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """迁移占位档案：向导用同名昵称提交时原地补全（保留 id/key）；完整档案仍 409。"""
    headers = _user(client, db, "upgradeuser")
    owner = user_id_by_name(db, "upgradeuser")
    placeholder_id = seed_profile(db, owner, "小马")
    _ready(client, db, "upgradeuser", headers)  # 配好语言模型，向导才能生成速写

    router = _SummaryRouter()
    monkeypatch.setattr(httpx, "Client", lambda *args, **kwargs: router)
    upgraded = client.post(
        "/api/personas/profiles",
        headers=headers,
        json={"nickname": "小马", "context": "workplace", "answers": {"disc": "dominance"}},
    )
    assert upgraded.status_code == 201, upgraded.text
    body = upgraded.json()
    assert body["id"] == placeholder_id  # id 与 key 冻结
    assert body["summary"]
    assert body["traits"]

    again = client.post(
        "/api/personas/profiles",
        headers=headers,
        json={"nickname": "小马", "context": "workplace", "answers": {"disc": "steadiness"}},
    )
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "CONFLICT"


def test_bootstrap_migration_seeds_legacy_profiles(client: TestClient, db: Session) -> None:
    """启动迁移给历史会话补占位档案：solo 与群成员都补，且幂等。"""
    import json as _json

    from sqlalchemy import select

    from app.core.db import SessionLocal
    from app.repositories.models import Conversation, PersonaProfile
    from app.services.bootstrap import ensure_profiles_for_legacy_conversations

    headers = _user(client, db, "legacyowner")
    owner = user_id_by_name(db, "legacyowner")

    session = SessionLocal()
    session.add(
        Conversation(
            owner_user_id=owner,
            title="和旧人的聊天",
            counterpart_name="旧人",
            counterpart_key="旧人",
        )
    )
    session.add(
        Conversation(
            owner_user_id=owner,
            title="旧群",
            counterpart_key="旧群",
            is_group=True,
            members=_json.dumps([{"key": "旧成员", "name": "旧成员"}], ensure_ascii=False),
        )
    )
    session.commit()
    session.close()

    ensure_profiles_for_legacy_conversations(db)
    keys = {
        row.key
        for row in db.scalars(
            select(PersonaProfile).where(PersonaProfile.owner_user_id == owner)
        )
    }
    assert {"旧人", "旧成员"} <= keys

    before = len(list(db.scalars(select(PersonaProfile))))
    ensure_profiles_for_legacy_conversations(db)
    after = len(list(db.scalars(select(PersonaProfile))))
    assert before == after


def test_import_blocked_without_profile(client: TestClient, db: Session) -> None:
    """无档案会话不能导入聊天记录——先定人设，再导上下文。"""
    from app.core.db import SessionLocal
    from app.repositories.models import Conversation

    headers = _user(client, db, "noimport")
    owner = user_id_by_name(db, "noimport")
    session = SessionLocal()
    session.add(
        Conversation(
            owner_user_id=owner,
            title="和黑户的聊天",
            counterpart_name="黑户",
            counterpart_key="黑户",
        )
    )
    session.commit()
    session.close()

    conv_id = client.get("/api/conversations", headers=headers).json()[0]["id"]
    resp = client.post(
        "/api/import/chat",
        headers=headers,
        json={"conversation_id": conv_id, "text": "我: 在吗\n她: 嗯"},
    )
    assert resp.status_code == 422
    assert "建档" in resp.json()["error"]["message"]


def test_member_persona_lines_prefers_profiles(client: TestClient, db: Session) -> None:
    """判断背景：人设库档案优先于推断档案；单聊也并入。"""
    import json as _json

    from app.repositories.models import Conversation, Persona, PersonaProfile
    from app.services.persona_service import PersonaService

    password = "proflines!Passw0rd"
    UserRepository().add(
        db,
        User(
            username="proflines",
            display_name="proflines",
            password_hash=hash_password(password),
            role=UserRole.USER.value,
            must_change_password=False,
            is_active=True,
        ),
    )
    db.commit()
    resp = client.post("/api/auth/login", json={"username": "proflines", "password": password})
    owner = int(resp.json()["id"])

    conv = Conversation(
        owner_user_id=owner,
        title="单聊会话",
        counterpart_name="小美",
        counterpart_key="小美",
    )
    db.add(conv)
    db.flush()
    # 推断档案（应被档案库覆盖）
    db.add(
        Persona(
            owner_user_id=owner,
            counterpart_key="小美",
            subject="other",
            context="romance",
            traits=_json.dumps({"openness": 1}, ensure_ascii=False),
            evidence="[]",
            confidence=0.5,
            version=1,
        )
    )
    db.add(
        PersonaProfile(
            owner_user_id=owner,
            key="小美",
            nickname="小美",
            context="romance",
            traits=_json.dumps(
                {"_schema": "custom_v1",
                 "values": {"attachment": "anxious"},
                 "meta": {"attachment": {"title": "依恋倾向", "labels": {"anxious": "焦虑型"}}}},
                ensure_ascii=False,
            ),
        )
    )
    db.commit()

    lines = PersonaService().member_persona_lines(db, owner_user_id=owner, conversation=conv)
    assert len(lines) == 1
    assert lines[0].startswith("小美的人设：")
    assert "焦虑型" in lines[0]
    assert "1/8" not in lines[0]  # 推断档案的裸分没有出现


def test_member_persona_lines_skips_empty_profile_traits(
    client: TestClient, db: Session
) -> None:
    """档案 traits 为空（历史脏数据）：跳过该成员，不能报错也不能复用上一行。"""
    import json as _json

    from app.repositories.models import Conversation, Persona, PersonaProfile
    from app.services.persona_service import PersonaService

    password = "emptytraits!Passw0rd"
    UserRepository().add(
        db,
        User(
            username="emptytraits",
            display_name="emptytraits",
            password_hash=hash_password(password),
            role=UserRole.USER.value,
            must_change_password=False,
            is_active=True,
        ),
    )
    db.commit()
    resp = client.post("/api/auth/login", json={"username": "emptytraits", "password": password})
    owner = int(resp.json()["id"])

    conv = Conversation(
        owner_user_id=owner,
        title="空档案群",
        counterpart_key="空档案群",
        is_group=True,
        members=_json.dumps(
            [
                {"key": "空档案", "name": "空档案"},
                {"key": "有档案", "name": "有档案"},
            ],
            ensure_ascii=False,
        ),
    )
    db.add(conv)
    db.flush()
    db.add(
        PersonaProfile(
            owner_user_id=owner,
            key="空档案",
            nickname="空档案",
            context="romance",
            traits=_json.dumps({}),
        )
    )
    db.add(
        Persona(
            owner_user_id=owner,
            counterpart_key="有档案",
            subject="other",
            context="romance",
            traits=_json.dumps({"openness": 5}, ensure_ascii=False),
            evidence="[]",
            confidence=0.6,
            version=1,
        )
    )
    db.commit()

    lines = PersonaService().member_persona_lines(db, owner_user_id=owner, conversation=conv)
    assert len(lines) == 1
    assert lines[0].startswith("有档案的人设：")


def test_profile_patch_and_delete(client: TestClient, db: Session) -> None:
    """档案改名 / 删除：key 冻结、跨用户 404、删除后列表消失。"""
    import json as _json

    from sqlalchemy import select

    from app.core.db import SessionLocal
    from app.repositories.models import PersonaProfile

    password = "patchdel!Passw0rd"
    UserRepository().add(
        db,
        User(
            username="patchdel",
            display_name="patchdel",
            password_hash=hash_password(password),
            role=UserRole.USER.value,
            must_change_password=False,
            is_active=True,
        ),
    )
    db.commit()
    resp = client.post("/api/auth/login", json={"username": "patchdel", "password": password})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}
    owner = int(resp.json()["id"])

    session = SessionLocal()
    session.add(
        PersonaProfile(
            owner_user_id=owner, key="小雪", nickname="小雪",
            context="romance", avatar_base64="data:image/jpeg;base64,AAAA",
            traits=_json.dumps({"openness": 5}, ensure_ascii=False),
        )
    )
    session.commit()
    profile_id = session.scalars(
        select(PersonaProfile).where(PersonaProfile.owner_user_id == owner)
    ).first().id
    session.close()

    renamed = client.patch(
        f"/api/personas/profiles/{profile_id}", headers=headers, json={"nickname": "小雪雪"}
    )
    assert renamed.status_code == 200, renamed.text
    body = renamed.json()
    assert body["nickname"] == "小雪雪"
    assert body["key"] == "小雪"  # key 冻结
    assert body["avatar_base64"].startswith("data:image/jpeg")

    blank = client.patch(
        f"/api/personas/profiles/{profile_id}", headers=headers, json={"nickname": "   "}
    )
    assert blank.status_code == 422
    bad_avatar = client.patch(
        f"/api/personas/profiles/{profile_id}", headers=headers, json={"avatar_base64": "http://x/y.png"}
    )
    assert bad_avatar.status_code == 422

    stranger = _user(client, db, "patchstranger")
    forbidden = client.patch(
        f"/api/personas/profiles/{profile_id}", headers=stranger, json={"nickname": "冒充"}
    )
    assert forbidden.status_code == 404

    deleted = client.delete(f"/api/personas/profiles/{profile_id}", headers=headers)
    assert deleted.status_code == 204
    listed = client.get("/api/personas/profiles", headers=headers).json()
    assert listed == []
    again = client.delete(f"/api/personas/profiles/{profile_id}", headers=headers)
    assert again.status_code == 404


def test_profile_blocks_inference(client: TestClient, db: Session) -> None:
    """已有**完整**人设库档案的成员：从对话推断 409，避免推断档案被判断链路无视。"""
    import json as _json

    from sqlalchemy import select

    from app.core.db import SessionLocal
    from app.repositories.models import PersonaProfile

    headers = _user(client, db, "blockinfer")
    conv_id = _group(client, db, "blockinfer", headers, with_messages=False)

    # 把迁移占位档案补成完整档案
    session = SessionLocal()
    profile = session.scalars(
        select(PersonaProfile).where(
            PersonaProfile.owner_user_id == user_id_by_name(db, "blockinfer"),
            PersonaProfile.key == "小林",
        )
    ).one()
    profile.traits = _json.dumps({"disc": "steadiness"}, ensure_ascii=False)
    session.commit()
    session.close()

    blocked = client.post(
        "/api/personas/build",
        headers=headers,
        json={"conversation_id": conv_id, "subject": "other", "member_key": "小林"},
    )
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "CONFLICT"
    # 完整档案挡推断保持「先删除」口径
    assert "已有人设库档案" in blocked.json()["error"]["message"]


def test_placeholder_profile_absorbs_build(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """迁移占位档案：自评/推断直接吸收补全（id/key 冻结），补全后同名向导 409。"""
    headers = _user(client, db, "absorbuser")
    conv_id = _ready(client, db, "absorbuser", headers)
    owner = user_id_by_name(db, "absorbuser")
    client.post(
        f"/api/conversations/{conv_id}/messages",
        headers=headers,
        json={"role": "other", "content": "你是不是又忘了。"},
    )
    monkeypatch.setattr(httpx, "Client", lambda *args, **kwargs: _Router())

    built = client.post(
        "/api/personas/build",
        headers=headers,
        json={
            "conversation_id": conv_id,
            "subject": "other",
            "self_report": {"openness": 7, "attachment": "anxious"},
        },
    )
    assert built.status_code == 200, built.text
    body = built.json()
    assert body["kept"] is False
    assert body["counterpart_key"] == "她"
    assert body["traits"]

    # 档案行被原地补全：traits 落库、自评作答存档、id 不变
    from sqlalchemy import select

    from app.core.db import SessionLocal
    from app.repositories.models import PersonaProfile

    session = SessionLocal()
    profile = session.scalars(
        select(PersonaProfile).where(
            PersonaProfile.owner_user_id == owner, PersonaProfile.key == "她"
        )
    ).one()
    session.close()
    assert profile.traits != "{}"
    assert _json.loads(profile.answers) == {"openness": 7, "attachment": "anxious"}
    assert profile.confidence > 0

    # 补全后的档案是完整档案：同名向导 409
    router = _SummaryRouter()
    monkeypatch.setattr(httpx, "Client", lambda *args, **kwargs: router)
    again = client.post(
        "/api/personas/profiles",
        headers=headers,
        json={"nickname": "她", "context": "romance", "answers": {"openness": 7}},
    )
    assert again.status_code == 409


def test_batch_prefers_profiles(client: TestClient, db: Session) -> None:
    """批量面板与人设库同源：档案成员显示档案 traits，而非『还没有档案』。"""
    import json as _json

    from sqlalchemy import select

    from app.core.db import SessionLocal
    from app.repositories.models import PersonaProfile

    headers = _user(client, db, "batchprofile")
    conv_id = _group(client, db, "batchprofile", headers, with_messages=False)

    resp = client.post("/api/auth/login", json={
        "username": "batchprofile", "password": "batchprofile!Passw0rd",
    })
    owner = int(resp.json()["id"])
    session = SessionLocal()
    profile = session.scalars(
        select(PersonaProfile).where(
            PersonaProfile.owner_user_id == owner, PersonaProfile.key == "小林"
        )
    ).one()
    profile.traits = _json.dumps(
        {"_schema": "custom_v1",
         "values": {"disc": "steadiness"},
         "meta": {"disc": {"title": "DISC 倾向", "labels": {"steadiness": "稳健型（S）"}}}},
        ensure_ascii=False,
    )
    session.commit()
    session.close()

    body = client.get(
        "/api/personas/batch", headers=headers, params={"conversation_id": conv_id}
    ).json()
    xiaolin = next(item for item in body["participants"] if item["key"] == "小林")
    assert xiaolin["persona"]["version"] == 1
    assert xiaolin["persona"]["traits"][0]["text"] == "稳健型（S）"
