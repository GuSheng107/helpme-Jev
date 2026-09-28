"""Unified activity log with legacy history backfill.

Revision ID: f6c0e9a2174b
Revises: e5a9c3d82b16
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f6c0e9a2174b"
down_revision: Union[str, Sequence[str], None] = "e5a9c3d82b16"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "activity_logs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("owner_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("trace_id", sa.String(64), nullable=False),
        sa.Column("category", sa.String(32), nullable=False),
        sa.Column("source", sa.String(32), nullable=False),
        sa.Column("level", sa.String(8), nullable=False),
        sa.Column("summary", sa.String(240), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False),
        sa.Column("status_code", sa.Integer()),
        sa.Column("latency_ms", sa.Integer(), nullable=False),
        sa.Column("error_code", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_activity_logs_owner_created", "activity_logs", ["owner_user_id", "created_at"])
    op.create_index("ix_activity_logs_owner_category_created", "activity_logs", ["owner_user_id", "category", "created_at"])
    op.create_index("ix_activity_logs_trace", "activity_logs", ["trace_id"])

    # 旧表仍供首页计数和决策历史使用；复制一份供统一日志页查询。
    op.execute("""
        INSERT INTO activity_logs
            (owner_user_id, trace_id, category, source, level, summary, detail,
             status_code, latency_ms, error_code, created_at, updated_at)
        SELECT owner_user_id, trace_id,
               CASE WHEN phase IN ('connect', 'vision') THEN 'settings' ELSE 'model' END,
               UPPER(kind), level, phase || ' 调用',
               '请求内容：' || request_body || char(10) || '响应内容：' || response_body ||
               CASE WHEN error = '' THEN '' ELSE char(10) || '错误：' || error END,
               status_code, latency_ms, '', created_at, updated_at
        FROM call_logs
    """)
    op.execute("""
        INSERT INTO activity_logs
            (owner_user_id, trace_id, category, source, level, summary, detail,
             status_code, latency_ms, error_code, created_at, updated_at)
        SELECT u.id, a.request_id,
               CASE
                   WHEN a.action IN ('login', 'login_failed', 'logout', 'registered', 'password_changed') THEN 'auth'
                   WHEN a.action LIKE 'invitation_%' OR a.action LIKE 'user_%' OR a.action = 'password_reset' THEN 'admin'
                   ELSE 'settings'
               END,
               '系统', CASE WHEN a.result = 'ok' THEN 'info' ELSE 'error' END,
               a.action, a.meta, NULL, 0, '', a.created_at, a.updated_at
        FROM audit_logs AS a
        LEFT JOIN users AS u ON u.id = COALESCE(a.actor_user_id, a.owner_user_id)
    """)


def downgrade() -> None:
    op.drop_index("ix_activity_logs_trace", table_name="activity_logs")
    op.drop_index("ix_activity_logs_owner_category_created", table_name="activity_logs")
    op.drop_index("ix_activity_logs_owner_created", table_name="activity_logs")
    op.drop_table("activity_logs")
