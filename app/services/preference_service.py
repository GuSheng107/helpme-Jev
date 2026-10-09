"""用户偏好读取：自动翻译开关的统一入口。"""

from __future__ import annotations

from sqlalchemy.orm import Session

from ..repositories.models import User


def auto_translate_enabled(db: Session, owner_user_id: int) -> bool:
    """读用户的自动翻译开关。

    原生 JEV 对中文不友好，默认开启翻译桥；自训练中文 JEV 的用户可关。
    用户行不存在（理论不该发生）时按开启处理，保持原行为。
    """
    row = db.get(User, owner_user_id)
    return bool(row.auto_translate) if row is not None else True
