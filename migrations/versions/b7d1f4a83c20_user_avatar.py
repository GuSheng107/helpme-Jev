"""user avatar path

Revision ID: b7d1f4a83c20
Revises: a8c4e2b91d07
Create Date: 2026-09-24 14:20:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b7d1f4a83c20"
down_revision: Union[str, Sequence[str], None] = "a8c4e2b91d07"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("avatar_base64", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("avatar_base64")
