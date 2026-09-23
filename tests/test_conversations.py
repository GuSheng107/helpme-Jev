"""会话与消息接口测试。

重点是 **P0 必测项：跨用户越权回归** —— 任何查询都不能拿到他人的数据。
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.domain.enums import UserRole
from app.repositories.auth_repo import UserRepository
from app.repositories.models import User


def _make_user(client: TestClient, db: Session, username: str) -> str:
    """造一个**已激活**用户并登录，返回 token。"""
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


# ------------------------------------------------------------------ 会话 CRUD
def test_conversation_crud(client: TestClient, db: Session) -> None:
    token = _make_user(client, db, "convuser")
    headers = _auth(token)

    created = client.post(
        "/api/conversations",
        json={"title": "和小美的聊天", "counterpart_name": "小美", "relationship": "女朋友"},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    body = created.json()
    conv_id = body["id"]
    assert body["title"] == "和小美的聊天"
    assert body["counterpart_key"] == "小美"  # 归一化后的对象标识
    assert body["message_count"] == 0

    # 列表
    listed = client.get("/api/conversations", headers=headers)
    assert listed.status_code == 200
    assert any(item["id"] == conv_id for item in listed.json())

    # 改名
    renamed = client.patch(
        f"/api/conversations/{conv_id}", json={"title": "和小美（改名）"}, headers=headers
    )
    assert renamed.status_code == 200
    assert renamed.json()["title"] == "和小美（改名）"

    # 详情
    detail = client.get(f"/api/conversations/{conv_id}", headers=headers)
    assert detail.status_code == 200

    # 删除
    assert client.delete(f"/api/conversations/{conv_id}", headers=headers).status_code == 204
    assert client.get(f"/api/conversations/{conv_id}", headers=headers).status_code == 404


def test_message_append_and_list(client: TestClient, db: Session) -> None:
    token = _make_user(client, db, "msguser")
    headers = _auth(token)

    conv_id = client.post(
        "/api/conversations", json={"title": "对话", "counterpart_name": "她"}, headers=headers
    ).json()["id"]

    first = client.post(
        f"/api/conversations/{conv_id}/messages",
        json={"role": "other", "content": "没怎么"},
        headers=headers,
    )
    assert first.status_code == 201, first.text
    assert first.json()["seq"] == 1

    second = client.post(
        f"/api/conversations/{conv_id}/messages",
        json={"role": "me", "content": "怎么了呀"},
        headers=headers,
    )
    assert second.json()["seq"] == 2  # seq 自增

    rows = client.get(f"/api/conversations/{conv_id}/messages", headers=headers)
    assert rows.status_code == 200
    assert [row["content"] for row in rows.json()] == ["没怎么", "怎么了呀"]

    # 增量拉取
    incremental = client.get(
        f"/api/conversations/{conv_id}/messages", params={"after_seq": 1}, headers=headers
    )
    assert [row["content"] for row in incremental.json()] == ["怎么了呀"]

    # 会话的 message_count 应同步
    assert client.get(f"/api/conversations/{conv_id}", headers=headers).json()["message_count"] == 2


def test_empty_message_rejected(client: TestClient, db: Session) -> None:
    token = _make_user(client, db, "emptyuser")
    headers = _auth(token)
    conv_id = client.post("/api/conversations", json={"title": "空"}, headers=headers).json()["id"]

    resp = client.post(
        f"/api/conversations/{conv_id}/messages",
        json={"role": "other", "content": "   "},
        headers=headers,
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "VALIDATION_FAILED"


def test_delete_conversation_cascades_messages(client: TestClient, db: Session) -> None:
    token = _make_user(client, db, "cascadeuser")
    headers = _auth(token)
    conv_id = client.post("/api/conversations", json={"title": "级联"}, headers=headers).json()["id"]

    client.post(
        f"/api/conversations/{conv_id}/messages",
        json={"role": "other", "content": "x"},
        headers=headers,
    )
    assert client.delete(f"/api/conversations/{conv_id}", headers=headers).status_code == 204
    # 会话没了，其消息也应随之消失（再取 → 404）
    assert client.get(f"/api/conversations/{conv_id}/messages", headers=headers).status_code == 404


# ------------------------------------------------------------------ 越权隔离（P0 必测）
def test_user_cannot_read_others_conversation(client: TestClient, db: Session) -> None:
    """A 建的会话，B 必须拿不到 —— 且错误信息不泄露其存在性。"""
    token_a = _make_user(client, db, "owner_a")
    token_b = _make_user(client, db, "owner_b")

    conv_id = client.post(
        "/api/conversations",
        json={"title": "A 的私密会话", "counterpart_name": "某人"},
        headers=_auth(token_a),
    ).json()["id"]

    # B 读 A 的会话 → 404（不是 403，避免探测存在性）
    as_b = client.get(f"/api/conversations/{conv_id}", headers=_auth(token_b))
    assert as_b.status_code == 404
    assert as_b.json()["error"]["code"] == "NOT_FOUND"

    # B 改 A 的会话 → 404
    assert (
        client.patch(
            f"/api/conversations/{conv_id}", json={"title": "篡改"}, headers=_auth(token_b)
        ).status_code
        == 404
    )

    # B 删 A 的会话 → 404
    assert client.delete(f"/api/conversations/{conv_id}", headers=_auth(token_b)).status_code == 404

    # B 读 A 的消息 → 404
    assert (
        client.get(f"/api/conversations/{conv_id}/messages", headers=_auth(token_b)).status_code
        == 404
    )

    # B 往 A 的会话里塞消息 → 404
    assert (
        client.post(
            f"/api/conversations/{conv_id}/messages",
            json={"role": "other", "content": "注入"},
            headers=_auth(token_b),
        ).status_code
        == 404
    )

    # A 自己仍然一切正常
    assert client.get(f"/api/conversations/{conv_id}", headers=_auth(token_a)).status_code == 200


def test_conversation_list_is_scoped_to_owner(client: TestClient, db: Session) -> None:
    """列表接口只返回自己的会话。"""
    token_a = _make_user(client, db, "list_a")
    token_b = _make_user(client, db, "list_b")

    a_conv = client.post(
        "/api/conversations", json={"title": "A 的"}, headers=_auth(token_a)
    ).json()["id"]
    b_conv = client.post(
        "/api/conversations", json={"title": "B 的"}, headers=_auth(token_b)
    ).json()["id"]

    a_ids = {item["id"] for item in client.get("/api/conversations", headers=_auth(token_a)).json()}
    b_ids = {item["id"] for item in client.get("/api/conversations", headers=_auth(token_b)).json()}

    assert a_conv in a_ids and b_conv not in a_ids
    assert b_conv in b_ids and a_conv not in b_ids


def test_conversations_require_auth(client: TestClient) -> None:
    assert client.get("/api/conversations").status_code in (401, 403)


def test_counterpart_key_frozen_after_creation(client: TestClient, db: Session) -> None:
    """改名**不应**改变 counterpart_key。

    人设档案按 counterpart_key 索引（含 version 链），一旦重算，
    旧 key 下的整份人设就会变成孤儿（皇上审阅意见第 3 条）。
    """
    token = _make_user(client, db, "keyuser")
    headers = _auth(token)

    created = client.post(
        "/api/conversations",
        json={"title": "对话", "counterpart_name": "宝宝"},
        headers=headers,
    ).json()
    original_key = created["counterpart_key"]
    assert original_key == "宝宝"

    renamed = client.patch(
        f"/api/conversations/{created['id']}",
        json={"counterpart_name": "小美"},
        headers=headers,
    ).json()

    assert renamed["counterpart_name"] == "小美"  # 显示名跟着改
    assert renamed["counterpart_key"] == original_key  # 对象标识保持不变


# ------------------------------------------------------------------ 审核意见回归
def test_nonexistent_scenario_rejected(client: TestClient, db: Session) -> None:
    """指向不存在的场景应 404（审核意见第 1 条）。"""
    token = _make_user(client, db, "scenuser")
    resp = client.post(
        "/api/conversations",
        json={"title": "带场景", "scenario_id": 999999},
        headers=_auth(token),
    )
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_others_scenario_rejected(client: TestClient, db: Session) -> None:
    """指向**他人**的场景应 404（预设场景 owner 为 NULL 时才人人可用）。"""
    from app.domain.enums import ScenarioKind
    from app.repositories.models import Scenario

    owner = _make_user(client, db, "scen_owner")
    other = _make_user(client, db, "scen_other")
    assert owner and other  # token 仅为确保用户存在

    # 直接建一条属于「别人的」场景
    owner_user = UserRepository().by_username(db, "scen_owner")
    assert owner_user is not None
    scenario = Scenario(
        owner_user_id=owner_user.id,
        slug="private-scenario",
        name="别人的场景",
        kind=ScenarioKind.CUSTOM.value,
        judge_questions="{}",
        persona_questions="{}",
        system_prompt="",
    )
    db.add(scenario)
    db.commit()
    db.refresh(scenario)

    resp = client.post(
        "/api/conversations",
        json={"title": "借用他人场景", "scenario_id": scenario.id},
        headers=_auth(other),
    )
    assert resp.status_code == 404


def test_attachments_limits(client: TestClient, db: Session) -> None:
    """附件条数与单条体积都应被限制（审核意见第 4 条）。"""
    token = _make_user(client, db, "attachuser")
    headers = _auth(token)
    conv_id = client.post("/api/conversations", json={"title": "附件"}, headers=headers).json()["id"]

    # 超过 8 条 → 422
    too_many = client.post(
        f"/api/conversations/{conv_id}/messages",
        json={"role": "other", "content": "x", "attachments": [{"i": i} for i in range(9)]},
        headers=headers,
    )
    assert too_many.status_code == 422

    # 单条超过 16KB → 422
    huge = client.post(
        f"/api/conversations/{conv_id}/messages",
        json={"role": "other", "content": "x", "attachments": [{"blob": "a" * 20000}]},
        headers=headers,
    )
    assert huge.status_code == 422

    # 正常范围内 → 201
    ok = client.post(
        f"/api/conversations/{conv_id}/messages",
        json={"role": "other", "content": "x", "attachments": [{"kind": "image", "n": 1}]},
        headers=headers,
    )
    assert ok.status_code == 201
    assert ok.json()["attachments"] == [{"kind": "image", "n": 1}]
