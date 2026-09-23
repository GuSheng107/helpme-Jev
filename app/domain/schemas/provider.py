"""提供方配置的请求 / 响应模型。

安全要点：``api_key`` **只进不出** —— 响应里只有掩码（``ProviderView.api_key_masked``）。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .auth import StrictModel

# 上下文窗口的合法范围（LLM 侧；JEV 侧用字符预算，见 §8.5）
MIN_CONTEXT_TOKENS = 1_000
MAX_CONTEXT_TOKENS = 2_000_000


class ProviderCreate(StrictModel):
    kind: Literal["jev", "llm"]
    name: str = Field(min_length=1, max_length=64)
    endpoint_url: str = Field(min_length=1, max_length=512)
    api_key: str = Field(min_length=1, max_length=512)
    model: str = Field(min_length=1, max_length=128)
    supports_vision: bool = False
    context_window_tokens: int = Field(
        default=64_000, ge=MIN_CONTEXT_TOKENS, le=MAX_CONTEXT_TOKENS
    )
    is_default: bool = False


class ProviderUpdate(StrictModel):
    """更新配置。``api_key`` 传 ``None`` 表示**保持原值**。

    刻意不提供"清空 Key"的语义 —— 避免空字符串承担隐含含义
    （对齐 human-llm-gateway 的表单纪律）。
    """

    name: str | None = Field(default=None, min_length=1, max_length=64)
    endpoint_url: str | None = Field(default=None, min_length=1, max_length=512)
    api_key: str | None = Field(default=None, min_length=1, max_length=512)
    model: str | None = Field(default=None, min_length=1, max_length=128)
    supports_vision: bool | None = None
    context_window_tokens: int | None = Field(
        default=None, ge=MIN_CONTEXT_TOKENS, le=MAX_CONTEXT_TOKENS
    )
    is_default: bool | None = None


class ProviderView(BaseModel):
    id: int
    kind: str
    name: str
    endpoint_url: str
    model: str
    supports_vision: bool
    context_window_tokens: int
    is_default: bool
    # 只回掩码：形如 sk-…abcd；**绝不回明文**
    api_key_masked: str
    created_at: str
    updated_at: str


class SmokeCaseView(BaseModel):
    name: str
    passed: bool
    expected: str
    actual: str


class SmokeReportView(BaseModel):
    total: int
    passed: int
    health: int
    outcomes: list[SmokeCaseView]


class ConnectionTestResult(BaseModel):
    ok: bool
    detail: str
    latency_ms: int
    error_code: str = ""
    model_reported: str = ""
    # 仅 JEV 会带：冒烟测试报告（健康度）
    smoke: SmokeReportView | None = None
