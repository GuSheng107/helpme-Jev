"""时间工具：统一 naive UTC 存储、带时区输出。

约定：数据库一律存 **naive UTC**（SQLite 友好），对外 API 一律返回
``...Z`` 结尾的 ISO 8601 字符串。
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone


def utc_now() -> datetime:
    """当前 UTC（naive）。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def to_naive_utc(value: datetime | None) -> datetime | None:
    """把带时区的输入转成 naive UTC；naive 输入原样返回。"""
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def iso_utc(value: datetime | None) -> str | None:
    """输出 ISO 8601（UTC，Z 结尾）。"""
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


def utc_after_hours(hours: int) -> datetime:
    return utc_now() + timedelta(hours=hours)


def utc_after_days(days: int) -> datetime:
    return utc_now() + timedelta(days=days)
