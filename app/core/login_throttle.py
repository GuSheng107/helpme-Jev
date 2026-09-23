"""登录 / 注册限流（内存计数）。

key = ``client_ip|username`` —— 反代场景下 ``request.client.host`` 是代理 IP，
纯 IP 计数会把全部用户聚合成一个桶（10 次失败即 DoS 全站）；
组合 key 下同 IP 的不同用户名各自计数，针对单个用户名的爆破仍被窗口上限拦住。
"""

from __future__ import annotations

import threading
import time

WINDOW_SECONDS = 60
MAX_ATTEMPTS = 10
MAX_KEYS = 50_000

_lock = threading.Lock()
_attempts: dict[str, list[float]] = {}


def _prune(now: float) -> None:
    """清掉过期桶；桶数超限时按最旧优先淘汰。"""
    for key in [k for k, hits in _attempts.items() if not hits or now - hits[-1] > WINDOW_SECONDS]:
        _attempts.pop(key, None)
    if len(_attempts) > MAX_KEYS:
        overflow = len(_attempts) - MAX_KEYS
        oldest = sorted(_attempts.items(), key=lambda item: item[1][-1])[:overflow]
        for key, _hits in oldest:
            _attempts.pop(key, None)


def allow(key: str) -> bool:
    """窗口内是否仍允许尝试。"""
    now = time.monotonic()
    with _lock:
        _prune(now)
        hits = [t for t in _attempts.get(key, []) if now - t <= WINDOW_SECONDS]
        _attempts[key] = hits
        return len(hits) < MAX_ATTEMPTS


def record_failure(key: str) -> None:
    """记一次失败。"""
    now = time.monotonic()
    with _lock:
        hits = [t for t in _attempts.get(key, []) if now - t <= WINDOW_SECONDS]
        hits.append(now)
        _attempts[key] = hits


def reset(key: str) -> None:
    """成功时清零。"""
    with _lock:
        _attempts.pop(key, None)


def clear_all() -> None:
    """仅测试用。"""
    with _lock:
        _attempts.clear()
