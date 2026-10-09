"""user auto_translate preference

Revision ID: b8e2f5c7d1a4
Revises: e7b1c4a90d38
Create Date: 2026-10-09 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b8e2f5c7d1a4"
down_revision: Union[str, Sequence[str], None] = "e7b1c4a90d38"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("auto_translate", sa.Boolean(), nullable=False, server_default=sa.true())
        )


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("auto_translate")
