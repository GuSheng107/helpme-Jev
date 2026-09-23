"""人设与导入的请求体。"""

from __future__ import annotations

from pydantic import Field

from .auth import StrictModel


class PersonaBuildRequest(StrictModel):
    conversation_id: int = Field(ge=1)
    subject: str = Field(pattern="^(me|other)$")
    self_report: dict = Field(default_factory=dict)
    # 情境不传则按会话挂的场景推断；同一对象恋爱 / 职场各一份档案
    context: str | None = Field(default=None, pattern="^(romance|workplace)$")


class ChatImportRequest(StrictModel):
    conversation_id: int = Field(ge=1)
    text: str = Field(min_length=1, max_length=200000)
    me_labels: list[str] = Field(default_factory=lambda: ["我"])
    # 对方不预设性别：她 / 他 / TA 都认
    other_labels: list[str] = Field(default_factory=lambda: ["她", "他", "TA"])


class QaImportRequest(StrictModel):
    conversation_id: int | None = Field(default=None, ge=1)
    raw: str = Field(min_length=2, max_length=200000)
