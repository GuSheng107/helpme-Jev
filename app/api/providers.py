"""提供方配置接口：CRUD + 连通性 / 冒烟测试。

安全要点：``apiKey`` **只进不出** —— 解密只为生成掩码，明文不出本模块。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..domain.schemas.provider import (
    ConnectionTestResult,
    ProviderCreate,
    ProviderUpdate,
    ProviderView,
)
from ..repositories.models import ProviderConfig, User
from ..services.provider_service import ProviderService, mask_envelope, to_view
from .deps import require_active_user

router = APIRouter(prefix="/api/providers", tags=["providers"])

_service = ProviderService()


def _view(row: ProviderConfig, *, reveal: bool) -> ProviderView:
    """列表只回固定掩码。单条写操作才解密，且明文只用于生成掩码。"""
    masked = _service.decrypt_key(row) if reveal else None
    view = to_view(row, masked)
    if not reveal:
        view["api_key_masked"] = mask_envelope(row.api_key_enc)
    return ProviderView(**view)


@router.get("", response_model=list[ProviderView])
def list_providers(
    kind: str | None = Query(default=None, pattern="^(jev|llm)$"),
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> list[ProviderView]:
    rows = _service.list_for_user(db, owner_user_id=user.id, kind=kind)
    return [_view(row, reveal=False) for row in rows]


@router.post("", response_model=ProviderView, status_code=201)
def create_provider(
    payload: ProviderCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> ProviderView:
    row = _service.create(db, owner_user_id=user.id, payload=payload)
    return _view(row, reveal=True)


@router.patch("/{provider_id}", response_model=ProviderView)
def update_provider(
    provider_id: int,
    payload: ProviderUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> ProviderView:
    row = _service.update(
        db, owner_user_id=user.id, provider_id=provider_id, payload=payload
    )
    return _view(row, reveal=True)


@router.delete("/{provider_id}", status_code=204)
def delete_provider(
    provider_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> Response:
    _service.delete(db, owner_user_id=user.id, provider_id=provider_id)
    return Response(status_code=204)


@router.post("/{provider_id}/test", response_model=ConnectionTestResult)
def test_provider(
    provider_id: int,
    with_smoke: bool = Query(default=True, description="JEV 是否顺带跑冒烟测试"),
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> ConnectionTestResult:
    """连通性测试。

    - ``kind=llm``：发一个最小 chat 请求验证 URL / Key / 模型
    - ``kind=jev``：先验协议连通，再跑 5 组标准用例得出**健康度**
    """
    return _service.test_connection(
        db, owner_user_id=user.id, provider_id=provider_id, with_smoke=with_smoke
    )
