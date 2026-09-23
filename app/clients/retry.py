"""上游 429 / 5xx 的指数退避。4xx（除 429）不重试。"""

from __future__ import annotations

import time

import httpx

MAX_ATTEMPTS = 3
BASE_DELAY_SECONDS = 0.4


def post_with_backoff(
    client: httpx.Client,
    url: str,
    *,
    json: dict,
    headers: dict,
) -> httpx.Response:
    """最多 3 次。429 优先采用 Retry-After，否则按 0.4s、0.8s 退避。"""
    last: httpx.Response | None = None
    for attempt in range(MAX_ATTEMPTS):
        response = client.post(url, json=json, headers=headers)
        last = response
        if response.status_code not in (429, 500, 502, 503, 504):
            return response
        if attempt == MAX_ATTEMPTS - 1:
            return response
        delay = _delay(response, attempt)
        time.sleep(delay)
    assert last is not None
    return last


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
