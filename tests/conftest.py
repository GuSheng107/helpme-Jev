"""pytest 夹具：隔离的临时数据库与测试密钥。

**必须在导入 app 之前**设置环境变量 —— ``app.core.db`` 在模块导入时就会建引擎。
"""

from __future__ import annotations

import base64
import os
import tempfile
from pathlib import Path

_TMP_DIR = Path(tempfile.mkdtemp(prefix="helpme-jev-test-"))

os.environ["DATABASE_PATH"] = str(_TMP_DIR / "test.db")
os.environ["APP_SECRET"] = base64.urlsafe_b64encode(b"x" * 32).decode().rstrip("=")
os.environ["SESSION_TTL_HOURS"] = "8"
os.environ["RETENTION_DAYS"] = "15"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.core.db import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.repositories.models import User  # noqa: E402
from app.services.bootstrap import ensure_default_admin, run_migrations  # noqa: E402


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
