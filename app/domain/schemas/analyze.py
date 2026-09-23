"""判断结果的响应模型。字段宽松：面板项的形状随题型变化。"""

from __future__ import annotations

from pydantic import BaseModel, Field

from .auth import StrictModel


class ConversationRef(StrictModel):
    conversation_id: int = Field(ge=1)


class ReplyRequest(StrictModel):
    conversation_id: int = Field(ge=1)
    decision: dict = Field(default_factory=dict)


class EvaluateRequest(StrictModel):
    conversation_id: int = Field(ge=1)
    text: str = Field(min_length=1, max_length=2000)


class ClarifyRequest(StrictModel):
    conversation_id: int = Field(ge=1)


class ExplainRequest(StrictModel):
    conversation_id: int = Field(ge=1)
    decision: dict = Field(default_factory=dict)


class PolishRequest(StrictModel):
    text: str = Field(min_length=1, max_length=4000)
    kind: str = Field(default="chat", pattern="^(chat|reply|question)$")


class AnalyzeView(BaseModel):
    panel: list[dict] = Field(default_factory=list)
    more: list[dict] = Field(default_factory=list)
    high_danger: bool = False
    context_sufficient: bool = True
    sufficiency_percent: int = 0
    context_percent: int = 0
    trace_id: str = ""
    model: str = ""
    latency_ms: int = 0
    message_count: int = 0
    memory_count: int = 0
    context_truncated: bool = False
