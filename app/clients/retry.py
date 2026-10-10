"""上游 429 / 5xx / 连接瞬断的指数退避。4xx（除 429）不重试。"""

from __future__ import annotations

import time

import httpx

MAX_ATTEMPTS = 3
BASE_DELAY_SECONDS = 0.4

# 连接瞬断：端口重置、连不上、读中断等。免费网关偶发断连，一次失败不该直接打断分析。
# Read/Write 超时不在此列：请求已被服务端接受，慢响应重试只会拉长整体耗时。
NETWORK_ERRORS = (
    httpx.ConnectError,
    httpx.ConnectTimeout,
    httpx.ReadError,
    httpx.WriteError,
    httpx.RemoteProtocolError,
    httpx.PoolTimeout,
)


def post_with_backoff(
    client: httpx.Client,
    url: str,
    *,
    json: dict,
    headers: dict,
    timeout: float,
) -> httpx.Response:
    """最多 3 次。429 优先采用 Retry-After，否则按 0.4s、0.8s 退避。

    重试条件：5xx（除 501）、429、连接瞬断。4xx 其余不重试（业务错误重试无用）。
    """
    for attempt in range(MAX_ATTEMPTS):
        try:
            response = client.post(url, json=json, headers=headers, timeout=timeout)
        except NETWORK_ERRORS as exc:
            if attempt == MAX_ATTEMPTS - 1:
                raise
            time.sleep(BASE_DELAY_SECONDS * (2**attempt))
            continue
        if response.status_code not in (429, 500, 502, 503, 504):
            return response
        if attempt == MAX_ATTEMPTS - 1:
            return response
        time.sleep(_delay(response, attempt))
    raise AssertionError("unreachable")


def _delay(response: httpx.Response, attempt: int) -> float:
    if response.status_code == 429:
        raw = response.headers.get("retry-after")
        try:
            hinted = float(raw) if raw else 0
        except ValueError:
            hinted = 0
        if hinted > 0:
            return min(hinted, 8)
    return BASE_DELAY_SECONDS * (2**attempt)