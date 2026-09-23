"""会话与消息的请求 / 响应模型。"""

from __future__ import annotations

import json
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .auth import StrictModel

# 附件上限：防止把任意大的 JSON 塞进 attachments
MAX_ATTACHMENTS = 8
MAX_ATTACHMENT_BYTES = 16 * 1024  # 单个附件 16KB


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
    # 场景 kind（romance / workplace / …），前端据此切面板文案与人设情境
    scenario_kind: str = "romance"
    message_count: int
    created_at: str
    updated_at: str


class MessageCreate(StrictModel):
    role: Literal["me", "other"]
    content: str = Field(default="", max_length=4000)
    attachments: list[dict] = Field(default_factory=list, max_length=MAX_ATTACHMENTS)
    # 图片素材 id：后端解析成 attachments JSON（type=image），
    # 上限 9 张（用户 2026-09-23 定）
    attachment_ids: list[int] = Field(default_factory=list, max_length=9)
    source: str = Field(default="manual", pattern="^(manual|candidate|rewrite|import)$")

    @field_validator("attachments")
    @classmethod
    def _limit_attachment_size(cls, value: list[dict]) -> list[dict]:
        for item in value:
            size = len(json.dumps(item, ensure_ascii=False).encode("utf-8"))
            if size > MAX_ATTACHMENT_BYTES:
                raise ValueError(
                    f"单个附件不得超过 {MAX_ATTACHMENT_BYTES // 1024}KB（当前 {size // 1024}KB）"
                )
        return value


class MessageView(BaseModel):
    id: int
    seq: int
    role: str
    content: str
    attachments: list
    source: str
    created_at: str
