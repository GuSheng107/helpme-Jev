"""领域错误：统一错误码，供 API 层映射为 HTTP 响应。

前端按 ``code`` 给不同引导（见 DESIGN.md §10.2）。
"""

from __future__ import annotations

from enum import StrEnum


class DomainErrorCode(StrEnum):
    # ---------------------------------------------------------- 认证与权限
    UNAUTHORIZED = "UNAUTHORIZED"
    FORBIDDEN = "FORBIDDEN"
    RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED"
    INVALID_INVITATION = "INVALID_INVITATION"
    MUST_CHANGE_PASSWORD = "MUST_CHANGE_PASSWORD"

    # ---------------------------------------------------------- 校验与资源
    VALIDATION_FAILED = "VALIDATION_FAILED"
    NOT_FOUND = "NOT_FOUND"
    CONFLICT = "CONFLICT"
    PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE"

    # ---------------------------------------------------------- 上游依赖
    NOT_CONFIGURED = "NOT_CONFIGURED"
    JEV_NOT_CONFIGURED = "JEV_NOT_CONFIGURED"
    LLM_NOT_CONFIGURED = "LLM_NOT_CONFIGURED"
    PROTOCOL_MISMATCH = "PROTOCOL_MISMATCH"
    JEV_UPSTREAM_ERROR = "JEV_UPSTREAM_ERROR"
    LLM_UPSTREAM_ERROR = "LLM_UPSTREAM_ERROR"

    # ---------------------------------------------------------- 内部
    INTERNAL_ERROR = "INTERNAL_ERROR"
    SECRET_CRYPTO_ERROR = "SECRET_CRYPTO_ERROR"


class DomainError(Exception):
    """业务异常：携带错误码与目标 HTTP 状态码。"""

    def __init__(
        self,
        code: DomainErrorCode,
        message: str,
        *,
        status_code: int = 400,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code

    def __str__(self) -> str:  # pragma: no cover - 便于日志
        return f"[{self.code}] {self.message}"
