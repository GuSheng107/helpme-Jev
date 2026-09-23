"""启动引导：建表、首启管理员、Schema 自检。

约定（沿用参考项目）：**不用迁移工具**，靠 ``SCHEMA_VERSION`` 常量 + 启动自检；
表结构由 ``Base.metadata.create_all`` 保证（本项目为新库，尚无演进包袱）。
"""

from __future__ import annotations

import logging

from sqlalchemy import inspect
from sqlalchemy.orm import Session

from ..core.config import get_settings
from ..core.constants import SCHEMA_VERSION
from ..core.db import Base, SessionLocal, engine
from ..core.security import SecretCryptoError, app_secret_bytes, hash_password
from ..domain.enums import UserRole
from ..repositories.auth_repo import UserRepository
from ..repositories.models import User

logger = logging.getLogger("helpme_jev.bootstrap")

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


def create_all() -> None:
    """确保全部模型已注册后建表。"""
    from ..repositories import models  # noqa: F401  导入即注册

    Base.metadata.create_all(bind=engine)


def verify_schema() -> None:
    """表集合自检：缺表即报错（防止跑在半个库上）。"""
    inspector = inspect(engine)
    present = set(inspector.get_table_names())
    missing = EXPECTED_TABLES - present
    if missing:
        raise RuntimeError(f"Schema 不完整，缺少表：{sorted(missing)}")
    logger.info(
        "Schema v%s 校验通过，共 %d 张表", SCHEMA_VERSION, len(present)
    )


def ensure_default_admin(db: Session) -> User | None:
    """首启创建默认管理员，**强制改密**。

    仅在库里一个用户都没有时执行。
    """
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

    create_all()
    verify_schema()

    with SessionLocal() as db:
        ensure_default_admin(db)
