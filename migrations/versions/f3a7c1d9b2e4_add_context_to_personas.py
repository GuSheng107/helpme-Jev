"""add context to personas (romance / workplace)

Revision ID: f3a7c1d9b2e4
Revises: 2c8820b050ba
Create Date: 2026-09-23 21:40:00.000000

同一对象可能同时出现在恋爱与职场情境，人设按「对象 × 情境」分档：
context = romance | workplace，旧数据一律回落 romance。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f3a7c1d9b2e4'
down_revision: Union[str, Sequence[str], None] = '2c8820b050ba'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('personas', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('context', sa.String(length=16), nullable=False, server_default='romance')
        )
    op.create_index('ix_personas_context', 'personas', ['context'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_personas_context', table_name='personas')
    with op.batch_alter_table('personas', schema=None) as batch_op:
        batch_op.drop_column('context')
