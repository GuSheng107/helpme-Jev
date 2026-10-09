"""人设与导入的请求体。"""

from __future__ import annotations

from typing import Annotated

from pydantic import AfterValidator, BaseModel, Field

from .auth import StrictModel

# 人设档位：内置档位用固定 slug，自定义档位由前端生成 cx_xxxxxx 形式的 slug。
# 只允许小写字母开头的 slug，避免中文与空白混进索引键。
CONTEXT_PATTERN = r"^[a-z][a-z0-9_]{0,31}$"
CONTEXT_LABEL_MAX = 32
DIMENSION_KEY_PATTERN = r"^[a-z_]{1,32}$"
MAX_DIMENSIONS = 20


class PersonaBuildRequest(StrictModel):
    conversation_id: int = Field(ge=1)
    subject: str = Field(pattern="^(me|other)$")
    self_report: dict = Field(default_factory=dict)
    # 档位不传则按会话挂的场景推断；同一对象各档位一份档案，互不覆盖
    context: str | None = Field(default=None, pattern=CONTEXT_PATTERN)
    # 自定义档位的显示名（内置档位留空）
    context_label: str = Field(default="", max_length=CONTEXT_LABEL_MAX)
    # 自定义档位勾选的维度 key；内置档位留空即按预设取
    dimension_keys: list[Annotated[str, Field(pattern=DIMENSION_KEY_PATTERN)]] = Field(
        default_factory=list, max_length=MAX_DIMENSIONS
    )
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


def _check_avatar(value: str) -> str:
    """允许空串或 data:image/ 开头的 data URL；其余拒绝，避免垃圾数据进库。"""
    if value and not value.startswith("data:image/"):
        raise ValueError("头像需要是 data:image/ 开头的图片数据")
    return value


AvatarData = Annotated[
    str, Field(max_length=MAX_PROFILE_AVATAR_CHARS), AfterValidator(_check_avatar)
]


class PersonaProfileCreate(StrictModel):
    nickname: str = Field(min_length=1, max_length=64)
    avatar_base64: AvatarData = ""
    context: str = Field(pattern=CONTEXT_PATTERN)
    context_label: str = Field(default="", max_length=CONTEXT_LABEL_MAX)
    # 自定义档位勾选的维度 key；内置档位留空即按预设取
    dimension_keys: list[Annotated[str, Field(pattern=DIMENSION_KEY_PATTERN)]] = Field(
        default_factory=list, max_length=MAX_DIMENSIONS
    )
    # 题目 key → 作答（score 为数字档位，choice 为枚举值）
    answers: dict = Field(default_factory=dict)


class PersonaProfileUpdate(StrictModel):
    nickname: str | None = Field(default=None, min_length=1, max_length=64)
    avatar_base64: AvatarData | None = None


class PersonaProfileView(BaseModel):
    id: int
    key: str
    nickname: str
    avatar_base64: str
    context: str
    context_label: str = ""
    traits: list
    summary: str
    confidence: int
    version: int
