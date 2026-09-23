"""Alembic 迁移环境。

要点：

- 数据库地址**从应用配置读取**（``app.core.config``），不在 alembic.ini 里写死
- 导入 ``app.repositories.models`` 以注册全部表到 metadata，供 autogenerate 比对
- **开启 ``render_as_batch``** —— SQLite 改表只能靠"建新表 + 搬数据"，
  不开批量模式会直接报错
"""

from __future__ import annotations

import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

# 让 alembic 能 import app.*
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.core.config import get_settings  # noqa: E402
from app.core.db import Base  # noqa: E402
from app.repositories import models  # noqa: F401,E402 导入即注册全部模型

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# 用应用配置覆盖 alembic.ini 的占位地址
_settings = get_settings()
config.set_main_option(
    "sqlalchemy.url", f"sqlite:///{Path(_settings.database_path).as_posix()}"
)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """离线模式：只生成 SQL，不连库。"""
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """在线模式：连库执行。"""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
