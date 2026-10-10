"""persona profile subject and gender

Revision ID: c3f6a9b1d7e2
Revises: b8e2f5c7d1a4
Create Date: 2026-10-10 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c3f6a9b1d7e2"
down_revision: Union[str, Sequence[str], None] = "b8e2f5c7d1a4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("persona_profiles", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("subject", sa.String(length=8), nullable=False, server_default="other")
        )
        batch_op.add_column(
            sa.Column("gender", sa.String(length=16), nullable=False, server_default="")
        )


def downgrade() -> None:
    with op.batch_alter_table("persona_profiles", schema=None) as batch_op:
        batch_op.drop_column("gender")
        batch_op.drop_column("subject")
