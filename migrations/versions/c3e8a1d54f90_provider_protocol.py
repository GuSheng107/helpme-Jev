"""provider protocol openai or anthropic

Revision ID: c3e8a1d54f90
Revises: b7d1f4a83c20
Create Date: 2026-09-24 15:10:00.000000

已有配置一律视为 OpenAI Chat Completions。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c3e8a1d54f90"
down_revision: Union[str, Sequence[str], None] = "b7d1f4a83c20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("provider_configs", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("protocol", sa.String(length=16), nullable=False, server_default="openai")
        )


def downgrade() -> None:
    with op.batch_alter_table("provider_configs", schema=None) as batch_op:
        batch_op.drop_column("protocol")
