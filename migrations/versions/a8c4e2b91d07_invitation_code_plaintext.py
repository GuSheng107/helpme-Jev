"""invitation codes stored in plaintext

Revision ID: a8c4e2b91d07
Revises: f3a7c1d9b2e4
Create Date: 2026-09-24 13:10:00.000000

邀请码改为固定前缀的明文，便于管理员反复复制。旧的哈希码无法还原，清空后重新生成。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a8c4e2b91d07"
down_revision: Union[str, Sequence[str], None] = "f3a7c1d9b2e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DELETE FROM invitation_codes")
    with op.batch_alter_table("invitation_codes", schema=None) as batch_op:
        batch_op.drop_index("ix_invitation_codes_code_hash")
        batch_op.drop_index("ix_invitation_codes_code_prefix")
    with op.batch_alter_table("invitation_codes", schema=None) as batch_op:
        batch_op.add_column(sa.Column("code", sa.String(length=32), nullable=False, server_default=""))
    with op.batch_alter_table("invitation_codes", schema=None) as batch_op:
        batch_op.create_index("ix_invitation_codes_code", ["code"], unique=True)


def downgrade() -> None:
    # 新邀请码的旧哈希无法还原，回退时同样清空后恢复旧约束。
    op.execute("DELETE FROM invitation_codes")
    with op.batch_alter_table("invitation_codes", schema=None) as batch_op:
        batch_op.drop_index("ix_invitation_codes_code")
        batch_op.drop_column("code")
        batch_op.create_index("ix_invitation_codes_code_hash", ["code_hash"], unique=True)
        batch_op.create_index("ix_invitation_codes_code_prefix", ["code_prefix"])
