"""共享 httpx 客户端：复用连接池，避免每次上游调用都重做 TCP/TLS 握手。

同步路由下 ``httpx.Client`` 线程安全，因此全进程共用一个实例。
超时按请求传入（不同调用方超时不同），所以客户端只兜默认值。
"""

from __future__ import annotations

import httpx

DEFAULT_TIMEOUT_SECONDS = 60
MAX_CONNECTIONS = 20
MAX_KEEPALIVE_CONNECTIONS = 10
# 空闲连接保留时间：长于一次会话内的提问间隔，避免反复重新握手
KEEPALIVE_EXPIRY_SECONDS = 300.0

_client: httpx.Client | None = None


def get_client() -> httpx.Client:
    """取共享客户端，首次调用时创建。"""
    global _client
    if _client is None:
        _client = httpx.Client(
            timeout=DEFAULT_TIMEOUT_SECONDS,
            limits=httpx.Limits(
                max_connections=MAX_CONNECTIONS,
                max_keepalive_connections=MAX_KEEPALIVE_CONNECTIONS,
                keepalive_expiry=KEEPALIVE_EXPIRY_SECONDS,
            ),
        )
    return _client


def reset_client() -> None:
    """只丢弃引用，不关连接 —— 供测试隔离使用（假客户端没有 close）。"""
    global _client
    _client = None


def close_client() -> None:
    """关停并丢弃共享客户端（应用退出）。"""
    global _client
    if _client is not None:
        _client.close()
        _client = None
