"""尚未通过专用服务落调用日志的模型流程共用此写入点。"""

from __future__ import annotations

from sqlalchemy.orm import Session

from ..core.logging import dump_body, pick_level
from ..repositories.models import CallLog


def record_model_call(
    db: Session, *, owner_user_id: int, trace_id: str, kind: str,
    phase: str, provider, result, request: object, response: object,
    ok: bool,
) -> None:
    request_body, request_cut = dump_body(request)
    response_body, response_cut = dump_body(response)
    truncated = request_cut or response_cut
    db.add(CallLog(
        owner_user_id=owner_user_id,
        trace_id=trace_id,
        kind=kind,
        phase=phase,
        level=pick_level(ok=ok, degraded=truncated or bool(getattr(result, "degraded", False))),
        endpoint_url=provider.endpoint_url,
        model=provider.model,
        request_body=request_body,
        response_body=response_body,
        truncated=truncated,
        status_code=getattr(result, "status_code", None),
        latency_ms=getattr(result, "latency_ms", 0),
        error="" if ok else str(getattr(result, "detail", "") or "输出格式不正确"),
    ))
    db.commit()
