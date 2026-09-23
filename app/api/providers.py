"""提供方配置接口。

P0 阶段只落「列表」端点：它是**强制改密闸门**的可测入口
（非白名单的受保护端点）。完整 CRUD 与连通性测试见 P1。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..repositories.models import User
from .deps import require_active_user

router = APIRouter(prefix="/api/providers", tags=["providers"])


@router.get("")
def list_providers(
    _db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict[str, object]:
    """列出当前用户的 JEV / LLM 配置（apiKey **只回掩码**，绝不回明文）。"""
    return {"items": [], "owner": user.username}
