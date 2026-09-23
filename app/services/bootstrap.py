"""启动引导：数据库迁移、Schema 自检、首启管理员。

Schema 的**唯一来源是 Alembic 迁移**（``migrations/``）——
不再用 ``create_all`` 建表，避免"迁移历史"与"实际表结构"两条线。

> 为什么不用 ``create_all``：一旦有已部署实例，绕过迁移直接改模型会让
> 它们变成"迁移地狱"（皇上审阅意见第 4 条）。
"""

from __future__ import annotations

import logging
from pathlib import Path

from sqlalchemy import inspect
from sqlalchemy.orm import Session

from ..core.config import get_settings
from ..core.constants import SCHEMA_VERSION
from ..core.db import SessionLocal, engine
from ..core.security import SecretCryptoError, app_secret_bytes, hash_password
from ..domain.enums import UserRole
from ..repositories.auth_repo import UserRepository
from ..repositories.models import User

logger = logging.getLogger("helpme_jev.bootstrap")

PROJECT_ROOT = Path(__file__).resolve().parents[2]

# 期望存在的表（自检用）
EXPECTED_TABLES = {
    "users",
    "auth_sessions",
    "invitation_codes",
    "provider_configs",
    "scenarios",
    "conversations",
    "messages",
    "session_summaries",
    "clarifications",
    "memories",
    "memory_reflections",
    "personas",
    "qa_pairs",
    "materials",
    "call_logs",
    "audit_logs",
}


def run_migrations() -> None:
    """执行 Alembic 迁移到 head。"""
    from alembic import command
    from alembic.config import Config as AlembicConfig

    alembic_cfg = AlembicConfig(str(PROJECT_ROOT / "alembic.ini"))
    alembic_cfg.set_main_option("script_location", str(PROJECT_ROOT / "migrations"))
    command.upgrade(alembic_cfg, "head")


def verify_schema() -> None:
    """表集合自检：缺表即报错（防止跑在半个库上）。"""
    inspector = inspect(engine)
    present = set(inspector.get_table_names())
    missing = EXPECTED_TABLES - present
    if missing:
        raise RuntimeError(f"Schema 不完整，缺少表：{sorted(missing)}")
    logger.info(
        "Schema v%s 校验通过，共 %d 张表", SCHEMA_VERSION, len(EXPECTED_TABLES)
    )


def ensure_default_admin(db: Session) -> User | None:
    """首启创建默认管理员，**强制改密**。仅在库里一个用户都没有时执行。"""
    settings = get_settings()
    users = UserRepository()
    if users.count(db) > 0:
        return None

    admin = User(
        username=settings.default_admin_username.strip().lower(),
        display_name="管理员",
        password_hash=hash_password(settings.default_admin_password),
        role=UserRole.ADMIN.value,
        must_change_password=True,
        is_active=True,
    )
    users.add(db, admin)
    db.commit()
    logger.warning(
        "已创建默认管理员「%s」，首次登录将强制改密（请尽快修改默认密码）",
        settings.default_admin_username,
    )
    return admin


def bootstrap() -> None:
    """应用启动时的引导流程。"""
    # APP_SECRET 必须在启动时就校验，避免运行到一半才炸
    try:
        app_secret_bytes()
    except SecretCryptoError as exc:
        raise RuntimeError(str(exc)) from exc

    run_migrations()
    verify_schema()

    with SessionLocal() as db:
        ensure_default_admin(db)
