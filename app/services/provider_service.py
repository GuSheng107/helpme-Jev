"""提供方配置用例：CRUD（apiKey 信封加密）+ 连通性 / 冒烟测试。"""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy.orm import Session

from ..clients import jev_client, llm_client
from ..core.constants import PURPOSE_PROVIDER_APIKEY
from ..core.logging import dump_body, pick_level
from ..core.security import SecretCryptoError, decrypt_secret, encrypt_secret
from ..core.time import iso_utc, utc_now
from ..domain.enums import CallLogLevel
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


def mask_envelope(envelope: str) -> str:
    """从信封前缀生成固定掩码，列表接口不必逐条解密。"""
    del envelope
    return "••••••••"


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
        existing = self.repo.list_all(db, owner_user_id=owner_user_id, kind=payload.kind)
        if existing:
            label = "表达模型" if payload.kind == "llm" else "决策模型"
            raise DomainError(
                DomainErrorCode.CONFLICT, f"{label}只能配置一个，请直接修改现有的", status_code=409
            )
        if payload.is_default:
            self.repo.clear_default(db, owner_user_id=owner_user_id, kind=payload.kind)

        row = ProviderConfig(
            owner_user_id=owner_user_id,
            kind=payload.kind,
            protocol=payload.protocol if payload.kind == "llm" else "openai",
            name=payload.name.strip(),
            endpoint_url=payload.endpoint_url.strip(),
            api_key_enc=encrypt_secret(payload.api_key, PURPOSE_PROVIDER_APIKEY),
            model=payload.model.strip(),
            supports_vision=payload.supports_vision,
            context_window_tokens=payload.context_window_tokens,
            is_default=payload.is_default,
            is_enabled=False,
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
        if fields.get("is_enabled") is True and row.last_test_ok is not True:
            raise DomainError(
                DomainErrorCode.VALIDATION_FAILED, "连通性测试通过后才能启用", status_code=422
            )
        if fields.get("name") is not None:
            name = fields["name"].strip()
            if not name:
                raise DomainError(
                    DomainErrorCode.VALIDATION_FAILED, "名称不能为空", status_code=422
                )
            row.name = name
        if fields.get("context_window_tokens") is not None:
            if row.kind != "llm":
                raise DomainError(
                    DomainErrorCode.VALIDATION_FAILED,
                    "只有表达模型可设置上下文窗口", status_code=422,
                )
            row.context_window_tokens = fields["context_window_tokens"]
        if fields.get("is_enabled") is not None:
            row.is_enabled = fields["is_enabled"]
        # 这些字段不改变连通性；保留已有测试状态和启用状态。
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
            trace_id = uuid4().hex
            result = llm_client.test_connection(
                endpoint_url=row.endpoint_url,
                api_key=api_key,
                model=row.model,
                protocol=row.protocol,
                timeout=llm_client.TIMEOUT_SECONDS,
            )
            self._log_test(db, owner_user_id=owner_user_id, row=row, trace_id=trace_id, phase="connect", result=result)
            if result.ok and row.supports_vision:
                vision = llm_client.test_connection(
                    endpoint_url=row.endpoint_url,
                    api_key=api_key,
                    model=row.model,
                    protocol=row.protocol,
                    vision=True,
                    timeout=llm_client.VISION_TIMEOUT_SECONDS,
                )
                self._log_test(db, owner_user_id=owner_user_id, row=row, trace_id=trace_id, phase="vision", result=vision)
                result = vision
            row.last_test_ok = result.ok
            row.last_tested_at = utc_now()
            row.is_enabled = result.ok
            db.commit()
            return ConnectionTestResult(
                ok=result.ok,
                detail=result.detail,
                latency_ms=result.latency_ms,
                error_code=result.error_code,
            )

        # JEV：先连通，再冒烟；每条返回路径都写回测试状态。
        # 连通日志延后到冒烟结束再写 —— 健康度偏低要记 warn，得先知道结果。
        trace_id = uuid4().hex
        conn = jev_client.test_connection(
            endpoint_url=row.endpoint_url, api_key=api_key, model=row.model
        )
        if not conn.ok:
            self._log_test(db, owner_user_id=owner_user_id, row=row, trace_id=trace_id, phase="connect", result=conn)
            self._record_test_state(db, row, ok=False)
            return ConnectionTestResult(
                ok=False,
                detail=conn.detail,
                latency_ms=conn.latency_ms,
                error_code=conn.error_code,
            )

        if not with_smoke:
            self._log_test(db, owner_user_id=owner_user_id, row=row, trace_id=trace_id, phase="connect", result=conn)
            self._record_test_state(db, row, ok=True)
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
            note = f"冒烟测试无法完成：{last.detail}"
            self._log_test(
                db, owner_user_id=owner_user_id, row=row, trace_id=trace_id,
                phase="connect", result=conn, level=CallLogLevel.ERROR.value,
                note=note, error_note=note,
            )
            self._record_test_state(db, row, ok=False)
            return ConnectionTestResult(
                ok=False,
                detail=f"协议连通，但{note}",
                latency_ms=last.latency_ms,
                error_code=last.error_code,
                model_reported=last.model_reported,
            )

        health = report.health
        verdict = "达标" if health >= SMOKE_HEALTH_THRESHOLD else "偏低"
        # 连通正常但健康度不达标：接口能用、判断质量存疑 → warn（不阻断使用）
        self._log_test(
            db, owner_user_id=owner_user_id, row=row, trace_id=trace_id,
            phase="connect", result=conn,
            level=(
                CallLogLevel.INFO.value
                if health >= SMOKE_HEALTH_THRESHOLD
                else CallLogLevel.WARN.value
            ),
            note=(
                f"冒烟测试 {report.passed}/{report.total} 通过，"
                f"健康度 {health}%（{verdict}，门槛 {SMOKE_HEALTH_THRESHOLD}%）"
            ),
        )
        self._record_test_state(db, row, ok=True)
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

    @staticmethod
    def _record_test_state(db: Session, row: ProviderConfig, *, ok: bool) -> None:
        row.last_test_ok = ok
        row.last_tested_at = utc_now()
        row.is_enabled = ok
        db.commit()

    def _log_test(
        self,
        db,
        *,
        owner_user_id: int,
        row: ProviderConfig,
        trace_id: str,
        phase: str,
        result,
        level: str | None = None,
        note: str = "",
        error_note: str | None = None,
    ) -> None:
        """连通测试写入调用日志，凭据不入库。

        ``level`` 缺省按调用本身成败定级；JEV 的连通日志会显式传入级别，
        以便把冒烟健康度偏低记为 warn、把冒烟跑不完记为 error。
        """
        from ..repositories.models import CallLog

        request_body, request_cut = dump_body(
            {"protocol": row.protocol, "model": row.model, "vision": phase == "vision"}
        )
        response: dict = {
            "detail": result.detail,
            "reply": getattr(result, "payload", {}).get("reply", ""),
        }
        if note:
            response["note"] = note
        response_body, response_cut = dump_body(response)
        truncated = request_cut or response_cut
        ok = bool(result.ok)
        db.add(
            CallLog(
                owner_user_id=owner_user_id,
                trace_id=trace_id,
                kind=row.kind,
                phase=phase,
                level=level or pick_level(ok=ok, degraded=truncated),
                endpoint_url=row.endpoint_url,
                model=row.model,
                request_body=request_body,
                response_body=response_body,
                truncated=truncated,
                status_code=result.status_code,
                latency_ms=result.latency_ms,
                error=(
                    error_note if error_note is not None
                    else ("" if ok else result.detail)
                ),
            )
        )


def to_view(row: ProviderConfig, plaintext_key: str | None) -> dict:
    """转成响应字典。``plaintext_key`` 仅用于生成掩码后即丢弃。"""
    return {
        "id": row.id,
        "kind": row.kind,
        "protocol": row.protocol,
        "name": row.name,
        "endpoint_url": row.endpoint_url,
        "model": row.model,
        "supports_vision": row.supports_vision,
        "context_window_tokens": row.context_window_tokens,
        "is_default": row.is_default,
        "is_enabled": row.is_enabled,
        "last_test_ok": row.last_test_ok,
        "last_tested_at": iso_utc(row.last_tested_at) or "",
        "api_key_masked": mask_api_key(plaintext_key or ""),
        "created_at": iso_utc(row.created_at) or "",
        "updated_at": iso_utc(row.updated_at) or "",
    }
