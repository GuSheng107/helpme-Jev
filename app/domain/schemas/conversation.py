"""会话与消息的请求 / 响应模型。"""

from __future__ import annotations

import json
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .auth import StrictModel

# 附件上限：防止把任意大的 JSON 塞进 attachments
MAX_ATTACHMENTS = 8
MAX_ATTACHMENT_BYTES = 16 * 1024  # 单个附件 16KB

# 群聊成员上限（不含"我"）
MAX_GROUP_MEMBERS = 20


class GroupMember(BaseModel):
    """群聊成员：key 是人设档案的 ``counterpart_key``，必须稳定。"""

    key: str
    name: str


def normalize_member_names(names: list[str]) -> list[GroupMember]:
    """名字去空白、去重、归一化成成员。

    key 规则与会话 ``_counterpart_key`` 一致：去所有空白后 lower，
    保证同一成员跨会话复用同一份人设。
    """
    seen: dict[str, GroupMember] = {}
    for raw in names:
        name = "".join(str(raw).split())
        if not name:
            continue
        key = name.lower()
        if key not in seen:
            seen[key] = GroupMember(key=key, name=name)
    return list(seen.values())[:MAX_GROUP_MEMBERS]


def parse_members(raw: str) -> list[GroupMember]:
    """从会话存的 JSON 里读成员；坏数据一律当空群处理。"""
    try:
        payload = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return []
    if not isinstance(payload, list):
        return []
    members: list[GroupMember] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        key = str(item.get("key") or "").strip()
        if name and key:
            members.append(GroupMember(key=key, name=name))
    return members


class ConversationCreate(StrictModel):
    title: str = Field(min_length=1, max_length=128)
    counterpart_name: str = Field(default="", max_length=64)
    relationship: str = Field(default="", max_length=64)
    scenario_id: int | None = None
    # 群聊成员名字列表；非空即按群聊建立
    members: list[str] = Field(default_factory=list, max_length=MAX_GROUP_MEMBERS)


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
    is_group: bool = False
    members: list[GroupMember] = Field(default_factory=list)
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
    # 群聊里 role=other 时必填：发言成员 key；单人会话忽略
    speaker: str = Field(default="", max_length=64)

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
    speaker: str = ""
    created_at: str
