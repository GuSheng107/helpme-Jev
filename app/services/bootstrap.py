"""启动引导：数据库迁移、Schema 自检、首启管理员。

Schema 的**唯一来源是 Alembic 迁移**（``migrations/``）——
不再用 ``create_all`` 建表，避免"迁移历史"与"实际表结构"两条线。

> 为什么不用 ``create_all``：一旦有已部署实例，绕过迁移直接改模型会让
> 它们变成"迁移地狱"（皇上审阅意见第 4 条）。
"""

from __future__ import annotations

import logging
from pathlib import Path

from sqlalchemy import inspect, select
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


def purge_stale_sessions(db: Session) -> int:
    """清理**已过期**或**已撤销**的会话行。

    否则 ``auth_sessions`` 只增不清，长期运行会无限膨胀
    （审核意见第 6 条）。
    """
    from sqlalchemy import delete, or_

    from ..core.time import utc_now
    from ..repositories.models import AuthSession

    moment = utc_now()
    result = db.execute(
        delete(AuthSession).where(
            or_(AuthSession.expires_at <= moment, AuthSession.revoked_at.is_not(None))
        )
    )
    db.commit()
    purged = int(result.rowcount or 0)
    if purged:
        logger.info("已清理过期/撤销会话 %d 条", purged)
    return purged


def purge_old_call_logs(db: Session) -> int:
    """``call_logs`` 滚动清理（默认 15 天，皇上定的保留期）。

    只清调用日志：``messages`` 不按天数清 —— 只清"已被滚动摘要覆盖"的旧消息，
    保证人设 evidence、情绪轨迹、复盘原料不断档（DESIGN.md 已定事项 23）。
    """
    from datetime import timedelta

    from sqlalchemy import delete

    from ..core.config import get_settings
    from ..core.time import utc_now
    from ..repositories.models import CallLog

    cutoff = utc_now() - timedelta(days=get_settings().retention_days)
    result = db.execute(delete(CallLog).where(CallLog.created_at < cutoff))
    db.commit()
    purged = int(result.rowcount or 0)
    if purged:
        logger.info("已清理 %d 天前的调用日志 %d 条", get_settings().retention_days, purged)
    return purged


def ensure_builtin_scenarios(db: Session) -> None:
    """内置场景（恋爱 / 职场）播种：题目快照来自代码，幂等。

    题目的**唯一来源是代码**（scenarios/ 包），场景行只是身份 + 快照；
    判断 / 建模时按 ``kind`` 回代码取题，快照仅供导出与后续自定义编辑。
    """
    import json

    from ..repositories.models import Scenario
    from ..scenarios.packs import all_packs
    from ..scenarios.persona_questions import persona_questions_for

    names = {
        "romance": ("恋爱助手", "亲密关系沟通：意图、需求、情绪与危险度。"),
        "workplace": ("职场助手", "职场沟通：同事 / 上下级 / 客户的意图、利害与最佳动作。"),
    }
    for pack in all_packs().values():
        name, description = names.get(pack.kind, (pack.kind, ""))
        judge = json.dumps(pack.questions(), ensure_ascii=False)
        persona = json.dumps(persona_questions_for(pack.kind, "other"), ensure_ascii=False)
        row = (
            db.scalars(
                select(Scenario).where(
                    Scenario.owner_user_id.is_(None), Scenario.slug == pack.kind
                )
            ).first()
        )
        if row is None:
            db.add(
                Scenario(
                    owner_user_id=None,
                    slug=pack.kind,
                    name=name,
                    kind=pack.kind,
                    description=description,
                    judge_questions=judge,
                    persona_questions=persona,
                    is_builtin=True,
                )
            )
        elif row.judge_questions != judge:
            # 代码里的题目改了 → 刷新快照（内置场景只读，不会丢用户编辑）
            row.judge_questions = judge
            row.persona_questions = persona
    db.commit()


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
        purge_stale_sessions(db)
        purge_old_call_logs(db)
        ensure_default_admin(db)
        ensure_builtin_scenarios(db)
