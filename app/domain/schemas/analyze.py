"""判断结果的响应模型。字段宽松：面板项的形状随题型变化。"""

from __future__ import annotations

from pydantic import BaseModel, Field

from .auth import StrictModel


class ConversationRef(StrictModel):
    conversation_id: int = Field(ge=1)


class AnalyzeView(BaseModel):
    panel: list[dict] = Field(default_factory=list)
    more: list[dict] = Field(default_factory=list)
    high_danger: bool = False
    context_sufficient: bool = True
    trace_id: str = ""
    model: str = ""
    latency_ms: int = 0
    message_count: int = 0
    memory_count: int = 0
    context_truncated: bool = False
