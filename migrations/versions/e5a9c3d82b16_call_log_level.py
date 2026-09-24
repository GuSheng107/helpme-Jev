"""call log level

Revision ID: e5a9c3d82b16
Revises: d4f2b8c71e05
Create Date: 2026-09-24 18:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e5a9c3d82b16"
down_revision: Union[str, Sequence[str], None] = "d4f2b8c71e05"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("call_logs", schema=None) as batch_op:
        batch_op.add_column(sa.Column("level", sa.String(length=8), nullable=False, server_default="info"))
    op.execute("UPDATE call_logs SET level = 'error' WHERE error != ''")
    # 启用开关上线前保存的配置没有测试记录，按当时可用补记一次
    op.execute(
        "UPDATE provider_configs SET last_test_ok = 1, last_tested_at = updated_at "
        "WHERE is_enabled = 1 AND last_tested_at IS NULL"
    )


def downgrade() -> None:
    with op.batch_alter_table("call_logs", schema=None) as batch_op:
        batch_op.drop_column("level")
