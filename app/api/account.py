"""账户接口：改密、数据导出、账号注销。"""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Request, Response
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.time import iso_utc, utc_now
from ..domain.errors import DomainError, DomainErrorCode
from ..domain.schemas.auth import PasswordChangeRequest, StrictModel, UserSummary
from ..repositories.auth_repo import AuditRepository
from ..repositories.models import (
    User,
    Persona,
    QaPair,
    Material,
    CallLog,
    Conversation,
    Memory,
    Message,
)
from ..services.auth_service import AuthService, verify_password
from .auth import to_summary
from .deps import require_active_user

router = APIRouter(prefix="/api/account", tags=["account"])

_audit = AuditRepository()


@router.post("/password", response_model=UserSummary)
def change_password(
    payload: PasswordChangeRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> UserSummary:
    """改密。

    强制改密状态下**也能调用**（属白名单端点）；
    改密成功后会把该用户的其余会话全部撤销，只保留当前会话。
    """
    token = getattr(request.state, "token", "")
    session = AuthService().session_by_token(db, token)
    try:
        AuthService().change_password(
            db,
            user,
            old_password=payload.old_password,
            new_password=payload.new_password,
            keep_session_id=session.id if session is not None else None,
        )
    except DomainError:
        db.rollback()
        raise
    db.commit()
    return to_summary(user)


class AccountDeleteRequest(StrictModel):
    password: str = Field(min_length=1, max_length=128)


@router.delete("", status_code=204)
def delete_account(
    payload: AccountDeleteRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> Response:
    """账号注销：密码确认后删除全部数据（级联），不可恢复。

    审计记录在删除前落库（owner 置 NULL 保留痕迹），然后删用户行。
    """
    if not verify_password(payload.password, user.password_hash):
        raise DomainError(DomainErrorCode.VALIDATION_FAILED, "密码不正确", status_code=422)
    _audit.add(
        db,
        action="account_deleted",
        owner_user_id=user.id,
        actor_user_id=user.id,
        resource_type="user",
        resource_id=str(user.id),
        meta=json.dumps({"username": user.username}, ensure_ascii=False),
    )
    db.flush()
    db.delete(user)  # 级联：会话、消息、记忆、人设、日志……全部带走
    db.commit()
    return Response(status_code=204)


@router.get("/export")
def export_data(
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    """导出本人全部数据（不含密钥明文）。"""
    conversations = db.scalars(
        select(Conversation).where(Conversation.owner_user_id == user.id)
    ).all()

    def _conversation_view(row: Conversation) -> dict:
        messages = db.scalars(
            select(Message).where(Message.conversation_id == row.id).order_by(Message.seq)
        ).all()
        return {
            "id": row.id,
            "title": row.title,
            "counterpart_name": row.counterpart_name,
            "counterpart_key": row.counterpart_key,
            "relationship": row.relationship,
            "scenario_id": row.scenario_id,
            "created_at": iso_utc(row.created_at),
            "messages": [
                {
                    "seq": message.seq,
                    "role": message.role,
                    "content": message.content,
                    "attachments": json.loads(message.attachments or "[]"),
                    "source": message.source,
                    "created_at": iso_utc(message.created_at),
                }
                for message in messages
            ],
        }

    memories = db.scalars(select(Memory).where(Memory.owner_user_id == user.id)).all()
    personas = db.scalars(select(Persona).where(Persona.owner_user_id == user.id)).all()
    qa_pairs = db.scalars(select(QaPair).where(QaPair.owner_user_id == user.id)).all()
    materials = db.scalars(select(Material).where(Material.owner_user_id == user.id)).all()
    call_logs = db.scalars(
        select(CallLog).where(CallLog.owner_user_id == user.id).order_by(CallLog.id)
    ).all()

    _audit.add(
        db,
        action="data_exported",
        owner_user_id=user.id,
        actor_user_id=user.id,
        resource_type="user",
        resource_id=str(user.id),
    )
    db.commit()

    return {
        "exported_at": iso_utc(utc_now()),
        "user": {
            "username": user.username,
            "display_name": user.display_name,
            "created_at": iso_utc(user.created_at),
        },
        "conversations": [_conversation_view(row) for row in conversations],
        "memories": [
            {
                "subject": row.subject,
                "counterpart_key": row.counterpart_key,
                "category": row.category,
                "content": row.content,
                "confidence": row.confidence,
                "source": row.source,
                "created_at": iso_utc(row.created_at),
            }
            for row in memories
        ],
        "personas": [
            {
                "counterpart_key": row.counterpart_key,
                "subject": row.subject,
                "context": row.context,
                "traits": json.loads(row.traits or "{}"),
                "evidence": json.loads(row.evidence or "[]"),
                "confidence": row.confidence,
                "version": row.version,
                "updated_at": iso_utc(row.updated_at),
            }
            for row in personas
        ],
        "qa_pairs": [
            {"question": row.question, "answer": row.answer, "tags": json.loads(row.tags or "[]")}
            for row in qa_pairs
        ],
        "materials": [
            {"kind": row.kind, "mime": row.mime, "bytes": row.bytes, "created_at": iso_utc(row.created_at)}
            for row in materials
        ],
        "call_logs": [
            {
                "trace_id": row.trace_id,
                "kind": row.kind,
                "phase": row.phase,
                "model": row.model,
                "status_code": row.status_code,
                "latency_ms": row.latency_ms,
                "created_at": iso_utc(row.created_at),
            }
            for row in call_logs
        ],
    }
