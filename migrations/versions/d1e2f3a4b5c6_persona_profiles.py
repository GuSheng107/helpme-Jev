"""persona profiles: questionnaire-driven persona library

Revision ID: d1e2f3a4b5c6
Revises: c9d8e7f6a5b4
Create Date: 2026-09-29 11:00:00.000000

人设库：先选情境、填昵称头像、答场景人设题，LLM 生成速写；
聊天（单聊 / 群聊）创建时按档案选用。key 为归一化昵称，创建后冻结。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd1e2f3a4b5c6'
down_revision: Union[str, Sequence[str], None] = 'c9d8e7f6a5b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'persona_profiles',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('owner_user_id', sa.Integer(), nullable=False),
        sa.Column('key', sa.String(length=64), nullable=False),
        sa.Column('nickname', sa.String(length=64), nullable=False, server_default=''),
        sa.Column('avatar_base64', sa.Text(), nullable=False, server_default=''),
        sa.Column('context', sa.String(length=16), nullable=False, server_default='romance'),
        sa.Column('answers', sa.Text(), nullable=False, server_default='{}'),
        sa.Column('traits', sa.Text(), nullable=False, server_default='{}'),
        sa.Column('summary', sa.Text(), nullable=False, server_default=''),
        sa.Column('confidence', sa.Float(), nullable=False, server_default='0.9'),
        sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['owner_user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('owner_user_id', 'key', name='uq_persona_profiles_owner_key'),
    )
    op.create_index('ix_persona_profiles_owner_user_id', 'persona_profiles', ['owner_user_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_persona_profiles_owner_user_id', table_name='persona_profiles')
    op.drop_table('persona_profiles')
