"""提供方配置用例：CRUD（apiKey 信封加密）+ 连通性 / 冒烟测试。"""

from __future__ import annotations

from sqlalchemy.orm import Session

from ..clients import jev_client, llm_client
from ..core.constants import PURPOSE_PROVIDER_APIKEY
from ..core.security import SecretCryptoError, decrypt_secret, encrypt_secret
from ..core.time import iso_utc
from ..domain.errors import DomainError, DomainErrorCode
from ..domain.schemas.provider import (
    ConnectionTestResult,
    ProviderCreate,
    ProviderUpdate,
    SmokeCaseView,
    SmokeReportView,
)
from ..repositories.models import ProviderConfig
from ..repositories.providers_repo import ProviderRepository

# 健康度达标的门槛（低于此值建议前端锁死排序条数为 3，见 §17）
SMOKE_HEALTH_THRESHOLD = 80


def mask_api_key(plaintext: str) -> str:
    """只露头尾，中间一律打码 —— **绝不回明文**。"""
    if not plaintext:
        return ""
    if len(plaintext) <= 8:
        return "••••••"
    return f"{plaintext[:4]}••••{plaintext[-4:]}"


class ProviderService:
    def __init__(self) -> None:
        self.repo = ProviderRepository()

    # ------------------------------------------------------------ 读
    def list_for_user(
        self, db: Session, *, owner_user_id: int, kind: str | None = None
    ) -> list[ProviderConfig]:
        return self.repo.list_all(db, owner_user_id=owner_user_id, kind=kind)

    def get_or_404(self, db: Session, *, owner_user_id: int, provider_id: int) -> ProviderConfig:
        row = self.repo.get(db, owner_user_id=owner_user_id, provider_id=provider_id)
        if row is None:
            raise DomainError(DomainErrorCode.NOT_FOUND, "配置不存在", status_code=404)
        return row

    def decrypt_key(self, row: ProviderConfig) -> str:
        """取出明文 Key（仅内部调用上游时使用，不得回给前端）。"""
        try:
            return decrypt_secret(row.api_key_enc, PURPOSE_PROVIDER_APIKEY)
        except SecretCryptoError as exc:
            raise DomainError(
                DomainErrorCode.SECRET_CRYPTO_ERROR,
                "该配置的密钥无法解密（APP_SECRET 可能已更换），请重新填写 Key",
                status_code=409,
            ) from exc

    # ------------------------------------------------------------ 写
    def create(
        self, db: Session, *, owner_user_id: int, payload: ProviderCreate
    ) -> ProviderConfig:
        if payload.is_default:
            self.repo.clear_default(db, owner_user_id=owner_user_id, kind=payload.kind)

        row = ProviderConfig(
            owner_user_id=owner_user_id,
            kind=payload.kind,
            name=payload.name.strip(),
            endpoint_url=payload.endpoint_url.strip(),
            api_key_enc=encrypt_secret(payload.api_key, PURPOSE_PROVIDER_APIKEY),
            model=payload.model.strip(),
            supports_vision=payload.supports_vision,
            context_window_tokens=payload.context_window_tokens,
            is_default=payload.is_default,
        )
        self.repo.add(db, row)
        db.commit()
        return row

    def update(
        self,
        db: Session,
        *,
        owner_user_id: int,
        provider_id: int,
        payload: ProviderUpdate,
    ) -> ProviderConfig:
        row = self.get_or_404(db, owner_user_id=owner_user_id, provider_id=provider_id)
        fields = payload.model_dump(exclude_unset=True)

        if fields.get("is_default") is True:
            self.repo.clear_default(db, owner_user_id=owner_user_id, kind=row.kind)

        if "name" in fields and fields["name"] is not None:
            row.name = fields["name"].strip()
        if "endpoint_url" in fields and fields["endpoint_url"] is not None:
            row.endpoint_url = fields["endpoint_url"].strip()
        if "model" in fields and fields["model"] is not None:
            row.model = fields["model"].strip()
        if "supports_vision" in fields and fields["supports_vision"] is not None:
            row.supports_vision = fields["supports_vision"]
        if "context_window_tokens" in fields and fields["context_window_tokens"] is not None:
            row.context_window_tokens = fields["context_window_tokens"]
        if "is_default" in fields and fields["is_default"] is not None:
            row.is_default = fields["is_default"]
        # api_key 传了才替换；传 None 视为保持原值
        if fields.get("api_key"):
            row.api_key_enc = encrypt_secret(fields["api_key"], PURPOSE_PROVIDER_APIKEY)

        db.commit()
        return row

    def delete(self, db: Session, *, owner_user_id: int, provider_id: int) -> None:
        row = self.get_or_404(db, owner_user_id=owner_user_id, provider_id=provider_id)
        self.repo.delete(db, row)
        db.commit()

    # ------------------------------------------------------------ 测试
    def test_connection(
        self, db: Session, *, owner_user_id: int, provider_id: int, with_smoke: bool = True
    ) -> ConnectionTestResult:
        """连通性测试；JEV 额外跑冒烟测试得出**健康度**。"""
        row = self.get_or_404(db, owner_user_id=owner_user_id, provider_id=provider_id)
        api_key = self.decrypt_key(row)

        if row.kind == "llm":
            result = llm_client.test_connection(
                endpoint_url=row.endpoint_url, api_key=api_key, model=row.model
            )
            return ConnectionTestResult(
                ok=result.ok,
                detail=result.detail,
                latency_ms=result.latency_ms,
                error_code=result.error_code,
            )

        # JEV：先连通，再冒烟
        conn = jev_client.test_connection(
            endpoint_url=row.endpoint_url, api_key=api_key, model=row.model
        )
        if not conn.ok:
            return ConnectionTestResult(
                ok=False,
                detail=conn.detail,
                latency_ms=conn.latency_ms,
                error_code=conn.error_code,
            )

        if not with_smoke:
            return ConnectionTestResult(
                ok=True,
                detail=conn.detail,
                latency_ms=conn.latency_ms,
                model_reported=conn.model_reported,
            )

        report, last = jev_client.run_smoke_test(
            endpoint_url=row.endpoint_url, api_key=api_key, model=row.model
        )
        if report is None:
            return ConnectionTestResult(
                ok=False,
                detail=f"协议连通，但冒烟测试无法完成：{last.detail}",
                latency_ms=last.latency_ms,
                error_code=last.error_code,
                model_reported=last.model_reported,
            )

        health = report.health
        verdict = "达标" if health >= SMOKE_HEALTH_THRESHOLD else "偏低"
        return ConnectionTestResult(
            ok=True,
            detail=(
                f"{conn.detail}；冒烟测试 {report.passed}/{report.total} 通过，"
                f"健康度 {health}%（{verdict}，门槛 {SMOKE_HEALTH_THRESHOLD}%）"
            ),
            latency_ms=conn.latency_ms,
            model_reported=conn.model_reported,
            smoke=SmokeReportView(
                total=report.total,
                passed=report.passed,
                health=health,
                outcomes=[
                    SmokeCaseView(
                        name=item.name,
                        passed=item.passed,
                        expected=item.expected,
                        actual=item.actual,
                    )
                    for item in report.outcomes
                ],
            ),
        )


def to_view(row: ProviderConfig, plaintext_key: str | None) -> dict:
    """转成响应字典。``plaintext_key`` 仅用于生成掩码后即丢弃。"""
    return {
        "id": row.id,
        "kind": row.kind,
        "name": row.name,
        "endpoint_url": row.endpoint_url,
        "model": row.model,
        "supports_vision": row.supports_vision,
        "context_window_tokens": row.context_window_tokens,
        "is_default": row.is_default,
        "api_key_masked": mask_api_key(plaintext_key or ""),
        "created_at": iso_utc(row.created_at) or "",
        "updated_at": iso_utc(row.updated_at) or "",
    }
