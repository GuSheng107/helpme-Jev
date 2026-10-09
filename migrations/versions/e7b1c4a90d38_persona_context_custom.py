"""persona context: 档位放开为可扩展 + 自定义档位显示名

Revision ID: e7b1c4a90d38
Revises: d1e2f3a4b5c6
Create Date: 2026-10-09 15:40:00.000000

人设档位原先只有 romance / workplace 两档。放开为可扩展档位后：
- ``context`` 由 String(16) 放宽到 String(32)，容纳自定义档位 slug；
- 新增 ``context_label``：自定义档位的中文显示名（内置档位留空，前端按 slug 取名）。

两处改动都是增量且向后兼容，旧数据不受影响。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e7b1c4a90d38'
down_revision: Union[str, Sequence[str], None] = 'd1e2f3a4b5c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('personas', schema=None) as batch_op:
        batch_op.alter_column(
            'context', existing_type=sa.String(length=16),
            type_=sa.String(length=32), existing_nullable=False,
            existing_server_default='romance',
        )
        batch_op.add_column(
            sa.Column('context_label', sa.String(length=32), nullable=False, server_default='')
        )
    with op.batch_alter_table('persona_profiles', schema=None) as batch_op:
        batch_op.alter_column(
            'context', existing_type=sa.String(length=16),
            type_=sa.String(length=32), existing_nullable=False,
            existing_server_default='romance',
        )
        batch_op.add_column(
            sa.Column('context_label', sa.String(length=32), nullable=False, server_default='')
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('persona_profiles', schema=None) as batch_op:
        batch_op.drop_column('context_label')
        batch_op.alter_column(
            'context', existing_type=sa.String(length=32),
            type_=sa.String(length=16), existing_nullable=False,
            existing_server_default='romance',
        )
    with op.batch_alter_table('personas', schema=None) as batch_op:
        batch_op.drop_column('context_label')
        batch_op.alter_column(
            'context', existing_type=sa.String(length=32),
            type_=sa.String(length=16), existing_nullable=False,
            existing_server_default='romance',
        )
