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
    first_logs = client.get(
        "/api/logs", headers=headers,
        params={"trace_id": first.headers["x-trace-id"]},
    ).json()["items"]
    assert {item["source"] for item in first_logs} >= {"用户", "JEV"}
    monkeypatch.setattr(httpx, "Client", lambda *args, **kwargs: _Router(sufficient=0.1, confidence=0.2))
    # 共享客户端是进程级单例，换假上游前要先丢弃，否则第二次仍走上一个替身
    reset_client()
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


def test_solo_import_labels_append_to_defaults(
    client: TestClient, db: Session
) -> None:
    """自定义对方标签是补充：默认的 她 / 他 / TA 始终认，不能被替换掉。"""
    headers = _user(client, db, "labelappend")
    conv_id = _ready(client, headers)
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


def _group(client: TestClient, headers: dict, *, with_messages: bool = True) -> int:
    created = client.post(
        "/api/conversations",
        headers=headers,
        json={"title": "项目小队", "relationship": "同事", "members": ["小林", "阿花"]},
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
    """群聊：批量取全员人设与上下文；按成员建档；成员校验。"""
    headers = _user(client, db, "grouppersona")
    _ready(client, headers)
    conv_id = _group(client, headers)

    monkeypatch.setattr(httpx, "Client", lambda *args, **kwargs: _EchoRouter())
    built = client.post(
        "/api/personas/build",
        headers=headers,
        json={"conversation_id": conv_id, "subject": "other", "member_key": "小林"},
    )
    assert built.status_code == 200, built.text
    assert built.json()["counterpart_key"] == "小林"

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
    # 建过档的小林有特质，其他参与者是空档案占位
    assert keys["小林"]["persona"]["version"] == 1
    assert keys["小林"]["persona"]["traits"]
    assert keys["阿花"]["persona"]["version"] == 0
    assert keys["me"]["subject"] == "me"


def test_group_import_maps_member_labels(client: TestClient, db: Session) -> None:
    """群聊导入：成员名当标签，行归属到对应发言人。"""
    headers = _user(client, db, "groupimport")
    conv_id = _group(client, headers, with_messages=False)

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
    conv_id = _group(client, headers, with_messages=False)

    stranger = _user(client, db, "batchstranger")
    peeked = client.get(
        "/api/personas/batch", headers=stranger, params={"conversation_id": conv_id}
    )
    assert peeked.status_code == 404
    assert peeked.json()["error"]["code"] == "NOT_FOUND"
