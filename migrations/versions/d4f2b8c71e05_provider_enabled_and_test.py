"""provider enabled flag and last test result

Revision ID: d4f2b8c71e05
Revises: c3e8a1d54f90
Create Date: 2026-09-24 17:40:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d4f2b8c71e05"
down_revision: Union[str, Sequence[str], None] = "c3e8a1d54f90"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("provider_configs", schema=None) as batch_op:
        batch_op.add_column(sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.true()))
        batch_op.add_column(sa.Column("last_test_ok", sa.Boolean(), nullable=True))
        batch_op.add_column(sa.Column("last_tested_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("provider_configs", schema=None) as batch_op:
        batch_op.drop_column("last_tested_at")
        batch_op.drop_column("last_test_ok")
        batch_op.drop_column("is_enabled")
