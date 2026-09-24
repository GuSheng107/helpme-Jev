"""认证流程端到端测试：首启管理员、强制改密闸门、邀请码注册、登录、越权隔离。"""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient
import pytest
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import generate_invitation_code, hash_password
from app.domain.enums import UserRole
from app.repositories.auth_repo import InvitationRepository, UserRepository
from app.repositories.models import InvitationCode, User

ADMIN_DEFAULT_PASSWORD = get_settings().default_admin_password
ADMIN_NEW_PASSWORD = "Adm1n!NewPassw0rd"


def _login(client: TestClient, username: str, password: str) -> dict:
    return client.post("/api/auth/login", json={"username": username, "password": password})


def _activate_admin(client: TestClient, db: Session) -> str:
    """确保默认 admin 已激活，返回可用 token。

    **幂等**：测试共享同一个库，前序用例可能已经改过密码。
    """
    # 已激活过 → 直接登录
    resp = _login(client, "admin", ADMIN_NEW_PASSWORD)
    if resp.status_code == 200:
        return resp.json()["access_token"]

    # 首次：用默认密码走一遍强制改密
    resp = _login(client, "admin", ADMIN_DEFAULT_PASSWORD)
    assert resp.status_code == 200, resp.text
    token = resp.json()["access_token"]
    assert resp.json()["must_change_password"] is True

    changed = client.post(
        "/api/account/password",
        json={"old_password": ADMIN_DEFAULT_PASSWORD, "new_password": ADMIN_NEW_PASSWORD},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert changed.status_code == 200, changed.text
    return token


def _new_invitation(db: Session, admin_id: int, *, max_uses: int = 1) -> str:
    code = generate_invitation_code()
    InvitationRepository().add(
        db,
        InvitationCode(
            code=code,
            max_uses=max_uses,
            used_count=0,
            created_by_user_id=admin_id,
        ),
    )
    db.commit()
    return code


# ------------------------------------------------------------------ 基础
def test_health(client: TestClient) -> None:
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    assert "X-Trace-Id" in resp.headers  # trace 中间件生效


def test_default_admin_exists_and_must_change_password(client: TestClient, admin) -> None:
    resp = _login(client, "admin", ADMIN_DEFAULT_PASSWORD)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["must_change_password"] is True
    assert body["role"] == UserRole.ADMIN.value
    # 受限会话只应有改密能力
    assert body["capabilities"] == ["account:password_change"]


def test_force_password_change_gate_blocks_other_endpoints(
    client: TestClient, db: Session
) -> None:
    """强制改密状态下，白名单之外的受保护端点必须 403。

    自造一个受限用户，避免依赖 admin 的全局状态。
    """
    user = User(
        username="gateuser",
        display_name="Gate",
        password_hash=hash_password("Gate!Passw0rd"),
        role=UserRole.USER.value,
        must_change_password=True,
        is_active=True,
    )
    UserRepository().add(db, user)
    db.commit()

    resp = _login(client, "gateuser", "Gate!Passw0rd")
    assert resp.status_code == 200, resp.text
    token = resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 白名单端点 → 放行
    assert client.get("/api/auth/me", headers=headers).status_code == 200

    # 非白名单的受保护端点 → 闸门拦截
    blocked = client.get("/api/providers", headers=headers)
    assert blocked.status_code == 403, blocked.text
    assert blocked.json()["error"]["code"] == "MUST_CHANGE_PASSWORD"

    # 改密后即可通行
    changed = client.post(
        "/api/account/password",
        json={"old_password": "Gate!Passw0rd", "new_password": "Gate!NewPassw0rd"},
        headers=headers,
    )
    assert changed.status_code == 200, changed.text
    assert client.get("/api/providers", headers=headers).status_code == 200


def test_after_password_change_capabilities_expand(client: TestClient, db: Session) -> None:
    _activate_admin(client, db)
    resp = _login(client, "admin", ADMIN_NEW_PASSWORD)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["must_change_password"] is False
    assert "invitation:manage" in body["capabilities"]
    assert "user:manage" in body["capabilities"]
    # 关键：**不存在**查看他人日志的能力
    assert not any("log" in cap and "own" not in cap for cap in body["capabilities"])


def test_admin_delete_user_removes_uploaded_files(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from app.services import image_service

    headers = {"Authorization": f"Bearer {_activate_admin(client, db)}"}
    created = client.post(
        "/api/admin/users",
        json={"username": "fileowner", "display_name": "文件用户", "password": "FileOwner!123"},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    user_id = created.json()["id"]
    monkeypatch.setattr(image_service, "MATERIALS_DIR", tmp_path)
    folder = tmp_path / str(user_id)
    folder.mkdir()
    (folder / "image.png").write_bytes(b"image")

    deleted = client.delete(f"/api/admin/users/{user_id}", headers=headers)
    assert deleted.status_code == 204, deleted.text
    assert not folder.exists()


# ------------------------------------------------------------------ 登录
def test_login_wrong_password(client: TestClient, db: Session) -> None:
    _activate_admin(client, db)
    resp = _login(client, "admin", "definitely-wrong")
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "UNAUTHORIZED"


def test_me_requires_token(client: TestClient) -> None:
    assert client.get("/api/auth/me").status_code in (401, 403)


# ------------------------------------------------------------------ 邀请码注册
def test_register_with_invitation_code(client: TestClient, db: Session) -> None:
    _activate_admin(client, db)
    admin = UserRepository().by_username(db, "admin")
    assert admin is not None
    code = _new_invitation(db, admin.id, max_uses=1)

    resp = client.post(
        "/api/auth/register",
        json={
            "invitation_code": code,
            "username": "alice",
            "display_name": "Alice",
            "password": "Al1ce!Passw0rd",
        },
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["username"] == "alice"
    assert resp.json()["role"] == UserRole.USER.value

    # 新用户可正常登录
    assert _login(client, "alice", "Al1ce!Passw0rd").status_code == 200


def test_blank_display_name_does_not_consume_invitation(client: TestClient, db: Session) -> None:
    headers = {"Authorization": f"Bearer {_activate_admin(client, db)}"}
    invitation = client.post("/api/admin/invitations", json={}, headers=headers)
    assert invitation.status_code == 201, invitation.text
    code = invitation.json()["code"]

    rejected = client.post(
        "/api/auth/register",
        json={
            "invitation_code": code,
            "username": "blankname",
            "display_name": "   ",
            "password": "BlankName!123",
        },
    )

    assert rejected.status_code == 422
    assert client.get("/api/admin/invitations", headers=headers).json()[0]["used_count"] == 0


def test_invitation_cannot_be_reused_beyond_max_uses(client: TestClient, db: Session) -> None:
    _activate_admin(client, db)
    admin = UserRepository().by_username(db, "admin")
    assert admin is not None
    code = _new_invitation(db, admin.id, max_uses=1)

    first = client.post(
        "/api/auth/register",
        json={
            "invitation_code": code,
            "username": "bob1",
            "display_name": "Bob1",
            "password": "B0b!Passw0rd",
        },
    )
    assert first.status_code == 201, first.text

    second = client.post(
        "/api/auth/register",
        json={
            "invitation_code": code,
            "username": "bob2",
            "display_name": "Bob2",
            "password": "B0b!Passw0rd",
        },
    )
    assert second.status_code == 400
    assert second.json()["error"]["code"] == "INVALID_INVITATION"


def test_register_rejects_invalid_invitation(client: TestClient, db: Session) -> None:
    resp = client.post(
        "/api/auth/register",
        json={
            "invitation_code": "NOPE-NOPE-NOPE-NOPE",
            "username": "carol",
            "display_name": "Carol",
            "password": "C4rol!Passw0rd",
        },
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "INVALID_INVITATION"


def test_register_rejects_weak_password(client: TestClient, db: Session) -> None:
    _activate_admin(client, db)
    admin = UserRepository().by_username(db, "admin")
    assert admin is not None
    code = _new_invitation(db, admin.id)

    resp = client.post(
        "/api/auth/register",
        json={
            "invitation_code": code,
            "username": "weakuser",
            "display_name": "Weak",
            "password": "alllowercase",  # 缺数字与符号
        },
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "VALIDATION_FAILED"


def test_duplicate_username_rejected(client: TestClient, db: Session) -> None:
    _activate_admin(client, db)
    admin = UserRepository().by_username(db, "admin")
    assert admin is not None

    code_a = _new_invitation(db, admin.id)
    first = client.post(
        "/api/auth/register",
        json={
            "invitation_code": code_a,
            "username": "dupuser",
            "display_name": "Dup",
            "password": "Dup!Passw0rd1",
        },
    )
    assert first.status_code == 201, first.text

    code_b = _new_invitation(db, admin.id)
    second = client.post(
        "/api/auth/register",
        json={
            "invitation_code": code_b,
            "username": "dupuser",
            "display_name": "Dup2",
            "password": "Dup!Passw0rd2",
        },
    )
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "CONFLICT"


# ------------------------------------------------------------------ 越权隔离
def test_tokens_are_bound_to_their_own_user(client: TestClient, db: Session) -> None:
    """A 的 token 只能拿到 A 的身份。"""
    _activate_admin(client, db)
    admin = UserRepository().by_username(db, "admin")
    assert admin is not None
    code = _new_invitation(db, admin.id)

    assert (
        client.post(
            "/api/auth/register",
            json={
                "invitation_code": code,
                "username": "zoe",
                "display_name": "Zoe",
                "password": "Z0e!Passw0rd",
            },
        ).status_code
        == 201
    )

    admin_token = _login(client, "admin", ADMIN_NEW_PASSWORD).json()["access_token"]
    zoe_token = _login(client, "zoe", "Z0e!Passw0rd").json()["access_token"]

    admin_me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {admin_token}"})
    zoe_me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {zoe_token}"})

    assert admin_me.json()["username"] == "admin"
    assert zoe_me.json()["username"] == "zoe"
    assert admin_me.json()["id"] != zoe_me.json()["id"]


def test_logout_revokes_token(client: TestClient, db: Session) -> None:
    _activate_admin(client, db)
    token = _login(client, "admin", ADMIN_NEW_PASSWORD).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    assert client.post("/api/auth/logout", headers=headers).status_code == 204
    assert client.get("/api/auth/me", headers=headers).status_code == 401
