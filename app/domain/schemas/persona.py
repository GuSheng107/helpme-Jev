"""人设与导入的请求体。"""

from __future__ import annotations

from pydantic import BaseModel, Field

from .auth import StrictModel


class PersonaBuildRequest(StrictModel):
    conversation_id: int = Field(ge=1)
    subject: str = Field(pattern="^(me|other)$")
    self_report: dict = Field(default_factory=dict)
    # 情境不传则按会话挂的场景推断；同一对象恋爱 / 职场各一份档案
    context: str | None = Field(default=None, pattern="^(romance|workplace)$")
    # 群聊里给"other"建档案时必填：目标成员 key；单人会话忽略
    member_key: str = Field(default="", max_length=64)


class ChatImportRequest(StrictModel):
    conversation_id: int = Field(ge=1)
    text: str = Field(min_length=1, max_length=200000)
    me_labels: list[str] = Field(default_factory=lambda: ["我"])
    # 对方不预设性别：她 / 他 / TA 都认
    other_labels: list[str] = Field(default_factory=lambda: ["她", "他", "TA"])


class QaImportRequest(StrictModel):
    conversation_id: int | None = Field(default=None, ge=1)
    raw: str = Field(min_length=2, max_length=200000)


# 人设库：昵称 / 头像 / 情境 / 题目作答
MAX_PROFILE_AVATAR_CHARS = 200_000  # base64 上限（前端压缩后约 20KB）


class PersonaProfileCreate(StrictModel):
    nickname: str = Field(min_length=1, max_length=64)
    avatar_base64: str = Field(default="", max_length=MAX_PROFILE_AVATAR_CHARS)
    context: str = Field(pattern="^(romance|workplace)$")
    # 题目 key → 作答（score 为数字档位，choice 为枚举值）
    answers: dict = Field(default_factory=dict)


class PersonaProfileUpdate(StrictModel):
    nickname: str | None = Field(default=None, min_length=1, max_length=64)
    avatar_base64: str | None = Field(default=None, max_length=MAX_PROFILE_AVATAR_CHARS)


class PersonaProfileView(BaseModel):
    id: int
    key: str
    nickname: str
    avatar_base64: str
    context: str
    traits: list
    summary: str
    confidence: int
    version: int
