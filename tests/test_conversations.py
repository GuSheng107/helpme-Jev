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
from tests.profile_seed import seed_profile, user_id_by_name


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
    pid = seed_profile(db, user_id_by_name(db, "convuser"), "小美")

    created = client.post(
        "/api/conversations",
        json={"title": "和小美的聊天", "profile_id": pid, "relationship": "女朋友"},
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
        "/api/conversations",
        json={"title": "对话", "profile_id": seed_profile(db, user_id_by_name(db, "msguser"), "她")},
        headers=headers,
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
    conv_id = client.post(
        "/api/conversations",
        json={"title": "空", "profile_id": seed_profile(db, user_id_by_name(db, "emptyuser"), "她")},
        headers=headers,
    ).json()["id"]

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
    conv_id = client.post(
        "/api/conversations",
        json={"title": "级联", "profile_id": seed_profile(db, user_id_by_name(db, "cascadeuser"), "她")},
        headers=headers,
    ).json()["id"]

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
        json={
            "title": "A 的私密会话",
            "profile_id": seed_profile(db, user_id_by_name(db, "owner_a"), "某人"),
        },
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
        "/api/conversations",
        json={"title": "A 的", "profile_id": seed_profile(db, user_id_by_name(db, "list_a"), "某人")},
        headers=_auth(token_a),
    ).json()["id"]
    b_conv = client.post(
        "/api/conversations",
        json={"title": "B 的", "profile_id": seed_profile(db, user_id_by_name(db, "list_b"), "某人")},
        headers=_auth(token_b),
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
        json={
            "title": "对话",
            "profile_id": seed_profile(db, user_id_by_name(db, "keyuser"), "宝宝"),
        },
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
    conv_id = client.post(
        "/api/conversations",
        json={"title": "附件", "profile_id": seed_profile(db, user_id_by_name(db, "attachuser"), "她")},
        headers=headers,
    ).json()["id"]

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


# ------------------------------------------------------------------ 群聊
def test_group_conversation_and_speaker(client: TestClient, db: Session) -> None:
    """群聊：成员来自人设库、发言人必须认、单人会话不带 speaker。"""
    token = _make_user(client, db, "groupuser")
    headers = _auth(token)
    owner = user_id_by_name(db, "groupuser")
    lin = seed_profile(db, owner, "小林")
    hua = seed_profile(db, owner, "阿花")

    created = client.post(
        "/api/conversations",
        json={
            "title": "周五饭局",
            "relationship": "朋友",
            "member_profile_ids": [lin, lin, hua],
        },
        headers=headers,
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["is_group"] is True
    # 重复档案按 key 去重，key 归一化稳定
    assert [(m["key"], m["name"]) for m in body["members"]] == [("小林", "小林"), ("阿花", "阿花")]
    conv_id = body["id"]
    # 群聊没有单一对象：counterpart_key 取群名，人设记忆挂这里
    assert body["counterpart_key"] == "周五饭局"
    assert body["counterpart_name"] == ""

    # 群消息必须指认成员当发言人
    ok = client.post(
        f"/api/conversations/{conv_id}/messages",
        json={"role": "other", "content": "我先说，这周日有空。", "speaker": "小林"},
        headers=headers,
    )
    assert ok.status_code == 201, ok.text
    assert ok.json()["speaker"] == "小林"

    not_member = client.post(
        f"/api/conversations/{conv_id}/messages",
        json={"role": "other", "content": "冒充", "speaker": "路人"},
        headers=headers,
    )
    assert not_member.status_code == 422
    assert not_member.json()["error"]["code"] == "VALIDATION_FAILED"

    # 我方消息不接受 speaker；单人会话同样忽略
    mine = client.post(
        f"/api/conversations/{conv_id}/messages",
        json={"role": "me", "content": "好，那我订位子。", "speaker": "小林"},
        headers=headers,
    )
    assert mine.status_code == 201
    assert mine.json()["speaker"] == ""

    solo_conv = client.post(
        "/api/conversations",
        json={"title": "单聊", "profile_id": seed_profile(db, owner, "小美")},
        headers=headers,
    ).json()
    assert solo_conv["is_group"] is False
    solo_msg = client.post(
        f"/api/conversations/{solo_conv['id']}/messages",
        json={"role": "other", "content": "在吗", "speaker": "小林"},
        headers=headers,
    )
    assert solo_msg.status_code == 201
    assert solo_msg.json()["speaker"] == ""

    rows = client.get(f"/api/conversations/{conv_id}/messages", headers=headers).json()
    assert [(row["speaker"], row["content"]) for row in rows] == [
        ("小林", "我先说，这周日有空。"),
        ("", "好，那我订位子。"),
    ]


def test_group_hand_typed_members_rejected(client: TestClient, db: Session) -> None:
    """人设前置：群聊不再接受手填成员，长名（schema 拦）短名（handler 拦）一律 422。"""
    token = _make_user(client, db, "groupnameuser")
    headers = _auth(token)
    for name, with_envelope in (("a" * 65, False), ("a" * 64, True)):
        resp = client.post(
            "/api/conversations",
            json={"title": "手填群", "members": [name]},
            headers=headers,
        )
        assert resp.status_code == 422
        if with_envelope:
            assert resp.json()["error"]["code"] == "VALIDATION_FAILED"


def test_group_blank_members_rejected(client: TestClient, db: Session) -> None:
    """传了成员（哪怕是空白）：要 422，不能静默降级成单聊。"""
    token = _make_user(client, db, "blankmember")
    headers = _auth(token)
    resp = client.post(
        "/api/conversations",
        json={"title": "空白群", "members": ["  ", "　"]},
        headers=headers,
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "VALIDATION_FAILED"


def test_group_members_can_be_updated(client: TestClient, db: Session) -> None:
    """群聊可改成员表（成员须已建档）；单聊不能加成员；全空白拒绝。"""
    token = _make_user(client, db, "editmember")
    headers = _auth(token)
    owner = user_id_by_name(db, "editmember")
    lin = seed_profile(db, owner, "小林")
    hua = seed_profile(db, owner, "阿花")
    conv_id = client.post(
        "/api/conversations",
        json={"title": "可编辑群", "member_profile_ids": [lin]},
        headers=headers,
    ).json()["id"]

    updated = client.patch(
        f"/api/conversations/{conv_id}",
        json={"members": ["小林", "阿花", "  "]},
        headers=headers,
    )
    assert updated.status_code == 200, updated.text
    assert [m["key"] for m in updated.json()["members"]] == ["小林", "阿花"]

    blank = client.patch(
        f"/api/conversations/{conv_id}", json={"members": ["   "]}, headers=headers
    )
    assert blank.status_code == 422

    solo_id = client.post(
        "/api/conversations",
        json={"title": "单聊", "profile_id": seed_profile(db, owner, "小美")},
        headers=headers,
    ).json()["id"]
    refused = client.patch(
        f"/api/conversations/{solo_id}", json={"members": ["小林"]}, headers=headers
    )
    assert refused.status_code == 422


def test_group_member_cap(client: TestClient, db: Session) -> None:
    """档案成员 schema 上限 20：21 个直接 422；恰好 20 个可用；手填成员一律拒绝。"""
    token = _make_user(client, db, "cappedgroup")
    headers = _auth(token)
    owner = user_id_by_name(db, "cappedgroup")

    # 手填成员一律 422（哪怕只有 1 个）
    hand = client.post(
        "/api/conversations",
        json={"title": "手填群", "members": ["成员01"]},
        headers=headers,
    )
    assert hand.status_code == 422

    # 恰好 20 个档案成员：可用
    profile_ids = [seed_profile(db, owner, f"人设{i:02d}") for i in range(21)]
    ok = client.post(
        "/api/conversations",
        json={"title": "满员群", "member_profile_ids": profile_ids[:20]},
        headers=headers,
    )
    assert ok.status_code == 201, ok.text
    assert len(ok.json()["members"]) == 20

    # 21 个：schema 层（max_length=20）直接 422
    over = client.post(
        "/api/conversations",
        json={"title": "超大群", "member_profile_ids": profile_ids},
        headers=headers,
    )
    assert over.status_code == 422


# ------------------------------------------------------------------ 人设前置规则
def test_solo_requires_profile(client: TestClient, db: Session) -> None:
    """单聊不带 profile_id：422，不能再手填名字开聊。"""
    token = _make_user(client, db, "soloreq")
    headers = _auth(token)
    resp = client.post(
        "/api/conversations",
        json={"title": "和小美的聊天", "counterpart_name": "小美"},
        headers=headers,
    )
    assert resp.status_code == 422
    assert "请先从人设库选用档案" in resp.json()["error"]["message"]


def test_message_blocked_without_profile(client: TestClient, db: Session) -> None:
    """会话对象没有档案（如档案被删）时，不能新增消息。"""
    from app.core.db import SessionLocal
    from app.repositories.models import Conversation

    token = _make_user(client, db, "blockedmsg")
    headers = _auth(token)
    owner = user_id_by_name(db, "blockedmsg")

    session = SessionLocal()
    session.add(
        Conversation(
            owner_user_id=owner,
            title="和失踪者的聊天",
            counterpart_name="失踪者",
            counterpart_key="失踪者",
        )
    )
    session.commit()
    session.close()

    conv_id = client.get("/api/conversations", headers=headers).json()[0]["id"]
    resp = client.post(
        f"/api/conversations/{conv_id}/messages",
        json={"role": "other", "content": "还能发吗"},
        headers=headers,
    )
    assert resp.status_code == 422
    assert "建档" in resp.json()["error"]["message"]

    # 补上同名档案后即可继续（key 命中自动恢复）
    seed_profile(db, owner, "失踪者")
    ok = client.post(
        f"/api/conversations/{conv_id}/messages",
        json={"role": "other", "content": "恢复了"},
        headers=headers,
    )
    assert ok.status_code == 201, ok.text
