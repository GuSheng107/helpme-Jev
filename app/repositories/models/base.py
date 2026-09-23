"""ORM 公共设施：统一 UTC 时间与时间戳 mixin。

``utc_now`` 的唯一定义在 ``app.core.time``，此处仅做转出以方便模型层引用。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime
from sqlalchemy.orm import Mapped, mapped_column

from ...core.time import utc_now

__all__ = ["TimestampMixin", "utc_now"]


class TimestampMixin:
    """创建 / 更新时间，所有表共用。"""

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utc_now, onupdate=utc_now, nullable=False
    )
