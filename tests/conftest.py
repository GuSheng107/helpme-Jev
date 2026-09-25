"""pytest 夹具：隔离的临时数据库与测试密钥。

**必须在导入 app 之前**设置环境变量 —— ``app.core.db`` 在模块导入时就会建引擎。
"""

from __future__ import annotations

import base64
import os
import tempfile
from collections.abc import Iterator
from pathlib import Path

_TMP_DIR = Path(tempfile.mkdtemp(prefix="helpme-jev-test-"))

os.environ["DATABASE_PATH"] = str(_TMP_DIR / "test.db")
os.environ["APP_SECRET"] = base64.urlsafe_b64encode(b"x" * 32).decode().rstrip("=")
os.environ["SESSION_TTL_HOURS"] = "8"
os.environ["RETENTION_DAYS"] = "15"
# 关掉启动预热：用例里配置的上游都是假地址，真去连既无意义也会扰乱替身注入
os.environ["STARTUP_WARMUP"] = "false"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.clients.http_client import reset_client  # noqa: E402
from app.core.db import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.repositories.models import User  # noqa: E402
from app.services.bootstrap import ensure_default_admin, run_migrations  # noqa: E402


@pytest.fixture(autouse=True)
def _isolate_http_client(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """逐用例隔离共享 httpx 客户端。

    用例普遍 monkeypatch ``httpx.Client`` 造假日上游，而共享客户端是进程级单例：
    不重置会把上一个用例的假日上游带进来。退出时 lifespan 也会 close 客户端，
    而替身没有 ``close``，故一并挡掉。
    """
    monkeypatch.setattr("app.main.close_client", lambda: None)
    reset_client()
    yield
    reset_client()


@pytest.fixture(scope="session", autouse=True)
def _init_db() -> None:
    """整个测试会话只迁移一次。

    用迁移建库而**不是** ``create_all`` —— 这样迁移脚本本身每次跑测试都被验证一次，
    避免"迁移写错了但没人发现"。
    """
    run_migrations()


@pytest.fixture
def db() -> Session:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture
def client() -> TestClient:
    # TestClient 会触发 lifespan（bootstrap），因此默认管理员随之创建
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def admin(db: Session) -> User:
    """确保默认管理员存在（强制改密状态）。"""
    user = ensure_default_admin(db)
    if user is None:
        from app.repositories.auth_repo import UserRepository

        user = UserRepository().by_username(db, "admin")
    assert user is not None
    return user
