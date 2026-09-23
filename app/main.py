"""FastAPI 应用入口：中间件、错误处理、路由装配。"""

from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .api import account, auth, chat, conversations, providers
from .core.config import get_settings
from .domain.errors import DomainError, DomainErrorCode
from .services.bootstrap import bootstrap

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("helpme_jev")

VERSION = "0.1.0"

# 可重试的错误码（前端据此给出"稍后重试"按钮）
RETRYABLE_CODES = {
    DomainErrorCode.RATE_LIMIT_EXCEEDED,
    DomainErrorCode.JEV_UPSTREAM_ERROR,
    DomainErrorCode.LLM_UPSTREAM_ERROR,
}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """启动时建表、校验 Schema、创建首启管理员。"""
    bootstrap()
    logger.info("HelpMe JEV 启动完成")
    yield


app = FastAPI(title="HelpMe JEV", version=VERSION, lifespan=lifespan)


@app.middleware("http")
async def trace_middleware(request: Request, call_next):
    """为每次业务操作注入 trace_id，并回写响应头。

    同一业务操作内的全部 JEV / LLM 调用都复用这个 trace_id，
    因此可以凭它拉出完整链路（见 DESIGN.md §7）。
    """
    trace_id = request.headers.get("x-trace-id") or uuid.uuid4().hex
    request.state.trace_id = trace_id
    response = await call_next(request)
    response.headers["X-Trace-Id"] = trace_id
    return response


@app.exception_handler(DomainError)
async def handle_domain_error(request: Request, exc: DomainError) -> JSONResponse:
    """统一错误模型：{error: {code, message, trace_id, retryable}}。"""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": exc.code.value,
                "message": exc.message,
                "trace_id": getattr(request.state, "trace_id", ""),
                "retryable": exc.code in RETRYABLE_CODES,
            }
        },
    )


@app.get("/api/health", tags=["meta"])
def health() -> dict[str, object]:
    return {"ok": True, "service": "helpme-jev", "version": VERSION}


app.include_router(auth.router)
app.include_router(account.router)
app.include_router(providers.router)
app.include_router(conversations.router)
app.include_router(chat.router)

# ---------------------------------------------------------------- 静态托管
# 生产模式下由后端托管前端构建产物（单端口部署）。
# 必须放在所有 API 路由**之后**，否则 mount("/") 会抢走 /api。
_dist = Path(get_settings().web_dist_dir)
if _dist.is_dir():
    app.mount("/", StaticFiles(directory=str(_dist), html=True), name="web")
    logger.info("已托管前端产物：%s", _dist.resolve())
else:
    logger.info("未发现前端产物（%s），仅提供 API", _dist)
