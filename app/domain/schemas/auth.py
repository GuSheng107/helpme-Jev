"""认证相关请求 / 响应模型。"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    """拒绝未声明字段 —— 免得字段名拼错时被静默吞掉。"""

    model_config = ConfigDict(extra="forbid")


class LoginRequest(StrictModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=512)


class RegisterRequest(StrictModel):
    """邀请码注册：**注册的唯一入口**。"""

    invitation_code: str = Field(min_length=1, max_length=64)
    username: str = Field(min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.\-]+$")
    display_name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=10, max_length=512)
    email: str | None = Field(default=None, max_length=255)


class PasswordChangeRequest(StrictModel):
    old_password: str = Field(min_length=1, max_length=512)
    new_password: str = Field(min_length=10, max_length=512)


class UserSummary(BaseModel):
    id: str
    username: str
    display_name: str
    role: str
    must_change_password: bool
    capabilities: list[str]
    email: str | None = None


class LoginResponse(UserSummary):
    access_token: str
    token_type: str = "bearer"
