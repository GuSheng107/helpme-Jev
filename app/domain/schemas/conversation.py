"""会话与消息的请求 / 响应模型。"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .auth import StrictModel


class ConversationCreate(StrictModel):
    title: str = Field(min_length=1, max_length=128)
    counterpart_name: str = Field(default="", max_length=64)
    relationship: str = Field(default="", max_length=64)
    scenario_id: int | None = None


class ConversationUpdate(StrictModel):
    title: str | None = Field(default=None, min_length=1, max_length=128)
    counterpart_name: str | None = Field(default=None, max_length=64)
    relationship: str | None = Field(default=None, max_length=64)


class ConversationView(BaseModel):
    id: int
    title: str
    counterpart_key: str
    counterpart_name: str
    relationship: str
    scenario_id: int | None
    message_count: int
    created_at: str
    updated_at: str


class MessageCreate(StrictModel):
    role: Literal["me", "other"]
    content: str = Field(default="", max_length=4000)
    attachments: list[dict] = Field(default_factory=list)


class MessageView(BaseModel):
    id: int
    seq: int
    role: str
    content: str
    attachments: list
    source: str
    created_at: str
