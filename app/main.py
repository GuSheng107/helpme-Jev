"""FastAPI 应用入口：中间件、错误处理、路由装配。"""

from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from time import perf_counter

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .api import account, admin, auth, chat, conversations, decide, logs, personas, providers, scenarios
from .clients.http_client import close_client
from .core.config import get_settings
from .core.logging import redact_text
from .domain.errors import DomainError, error_body
from .services.activity_service import (
    TRACE_PATTERN,
    current_category,
    current_trace,
    record_request,
    request_category,
)
from .services.bootstrap import bootstrap
from .services.warmup import warm_providers_async

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("helpme_jev")

VERSION = "0.1.0"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """启动时建表、校验 Schema、创建首启管理员，并预热上游连接。"""
    bootstrap()
    if get_settings().startup_warmup:
        warm_providers_async()
    logger.info("HelpMe JEV 启动完成")
    try:
        yield
    finally:
        close_client()


app = FastAPI(title="HelpMe JEV", version=VERSION, lifespan=lifespan)


@app.middleware("http")
async def trace_middleware(request: Request, call_next):
    """为每次业务操作注入 trace_id，并回写响应头。

    同一业务操作内的全部 JEV / LLM 调用都复用这个 trace_id，
    因此可以凭它拉出完整链路。
    """
    supplied = request.headers.get("x-trace-id", "")
    trace_id = (
        supplied
        if TRACE_PATTERN.fullmatch(supplied) and redact_text(supplied) == supplied
        else uuid.uuid4().hex
    )
    request.state.trace_id = trace_id
    trace_token = current_trace.set(trace_id)
    category_token = current_category.set(request_category(request.url.path))
    started_at = perf_counter()

    def save_activity(status_code: int) -> None:
        try:
            record_request(request, status_code=status_code, started_at=started_at)
        except Exception as exc:
            # 业务写入可能已经提交；日志存储故障不应把成功响应改成失败。
            logger.warning("活动日志写入失败：%s", type(exc).__name__)

    try:
        try:
            response = await call_next(request)
        except Exception:
            save_activity(500)
            raise
        save_activity(response.status_code)
        response.headers["X-Trace-Id"] = trace_id
        return response
    finally:
        current_category.reset(category_token)
        current_trace.reset(trace_token)


@app.exception_handler(DomainError)
async def handle_domain_error(request: Request, exc: DomainError) -> JSONResponse:
    """统一错误模型：{error: {code, message, trace_id, retryable}}。"""
    request.state.activity_error_code = exc.code.value
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": error_body(exc, getattr(request.state, "trace_id", ""))},
    )


@app.get("/api/health", tags=["meta"])
def health() -> dict[str, object]:
    return {"ok": True, "service": "helpme-jev", "version": VERSION}


app.include_router(auth.router)
app.include_router(account.router)
app.include_router(admin.router)
app.include_router(providers.router)
app.include_router(scenarios.router)
app.include_router(conversations.router)
app.include_router(chat.router)
app.include_router(decide.router)
app.include_router(logs.router)
app.include_router(personas.router)

# ---------------------------------------------------------------- 静态托管
# 生产模式下由后端托管前端构建产物（单端口部署）。
# 必须放在所有 API 路由**之后**，否则 mount("/") 会抢走 /api。
_dist = Path(get_settings().web_dist_dir)
if _dist.is_dir():
    app.mount("/", StaticFiles(directory=str(_dist), html=True), name="web")
    logger.info("已托管前端产物：%s", _dist.resolve())
else:
    logger.info("未发现前端产物（%s），仅提供 API", _dist)
