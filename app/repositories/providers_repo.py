"""提供方配置数据访问（JEV / LLM）。"""

from __future__ import annotations

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .models import ProviderConfig


class ProviderRepository:
    def get(self, db: Session, *, owner_user_id: int, provider_id: int) -> ProviderConfig | None:
        stmt = select(ProviderConfig).where(
            ProviderConfig.id == provider_id,
            ProviderConfig.owner_user_id == owner_user_id,
        )
        return db.scalars(stmt).first()

    def list_all(
        self, db: Session, *, owner_user_id: int, kind: str | None = None
    ) -> list[ProviderConfig]:
        stmt = select(ProviderConfig).where(ProviderConfig.owner_user_id == owner_user_id)
        if kind:
            stmt = stmt.where(ProviderConfig.kind == kind)
        return list(db.scalars(stmt.order_by(ProviderConfig.kind, ProviderConfig.id)))

    def default_of_kind(
        self, db: Session, *, owner_user_id: int, kind: str
    ) -> ProviderConfig | None:
        stmt = select(ProviderConfig).where(
            ProviderConfig.owner_user_id == owner_user_id,
            ProviderConfig.kind == kind,
            ProviderConfig.is_default.is_(True),
        )
        return db.scalars(stmt).first()

    def add(self, db: Session, row: ProviderConfig) -> ProviderConfig:
        db.add(row)
        db.flush()
        return row

    def clear_default(self, db: Session, *, owner_user_id: int, kind: str) -> None:
        """把该用户该类型的默认标记全部清掉（保证同一 kind 只有一个默认）。"""
        db.execute(
            update(ProviderConfig)
            .where(
                ProviderConfig.owner_user_id == owner_user_id,
                ProviderConfig.kind == kind,
                ProviderConfig.is_default.is_(True),
            )
            .values(is_default=False)
        )

    def delete(self, db: Session, row: ProviderConfig) -> None:
        db.delete(row)
        db.flush()
