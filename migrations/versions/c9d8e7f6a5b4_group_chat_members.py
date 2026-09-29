"""group chat: conversation members and message speaker

Revision ID: c9d8e7f6a5b4
Revises: f6c0e9a2174b
Create Date: 2026-09-28 18:00:00.000000

聊天场景补充群聊：会话带 is_group + members（JSON 数组，不含"我"），
消息带 speaker（群聊里 role=other 的发言成员 key，单人会话恒为空）。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c9d8e7f6a5b4'
down_revision: Union[str, Sequence[str], None] = 'f6c0e9a2174b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('conversations', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('is_group', sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch_op.add_column(
            sa.Column('members', sa.Text(), nullable=False, server_default='[]')
        )
    with op.batch_alter_table('messages', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('speaker', sa.String(length=64), nullable=False, server_default='')
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('messages', schema=None) as batch_op:
        batch_op.drop_column('speaker')
    with op.batch_alter_table('conversations', schema=None) as batch_op:
        batch_op.drop_column('members')
        batch_op.drop_column('is_group')
