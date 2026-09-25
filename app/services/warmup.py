"""启动预热：把共享连接池先和已启用的上游连上。

只建连、不消耗 token —— 上游模型冷启动不在此列（那需要真实推理请求）。
预热失败一律静默：它只是省掉首个请求的 TCP/TLS 握手，不该影响启动。
"""

from __future__ import annotations

import logging
import threading

from sqlalchemy import select

from ..clients.http_client import get_client
from ..clients.llm_client import endpoint_for
from ..core.db import SessionLocal
from ..repositories.models import ProviderConfig

logger = logging.getLogger("helpme_jev")

TIMEOUT_SECONDS = 5.0


def warm_providers_async() -> None:
    """后台线程预热，不阻塞启动。"""
    threading.Thread(target=_warm, name="provider-warmup", daemon=True).start()


def _target_url(row: ProviderConfig) -> str:
    """JEV 直接用配置里的端点；LLM 要按协议补上具体路径。"""
    if row.kind == "jev":
        return row.endpoint_url
    return endpoint_for(row.endpoint_url, row.protocol)


def _warm() -> None:
    try:
        db = SessionLocal()
        try:
            rows = list(
                db.scalars(select(ProviderConfig).where(ProviderConfig.is_enabled.is_(True)))
            )
        finally:
            db.close()

        endpoints = {_target_url(row) for row in rows}
        if not endpoints:
            return

        client = get_client()
        for url in endpoints:
            try:
                client.get(url, timeout=TIMEOUT_SECONDS)
            except Exception:  # noqa: BLE001 —— 端点不可达不该拖累其余端点
                continue
        logger.info("已预热 %d 个上游端点", len(endpoints))
    except Exception:  # noqa: BLE001 —— 预热是最佳努力，失败只记日志
        logger.warning("上游预热未完成（不影响启动）", exc_info=True)
