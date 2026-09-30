"""人设档案与素材导入。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, Query, Request, Response, UploadFile
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..domain.errors import DomainError, DomainErrorCode
from ..domain.schemas.conversation import parse_members
from ..domain.schemas.persona import (
    ChatImportRequest,
    PersonaBuildRequest,
    PersonaProfileCreate,
    PersonaProfileUpdate,
    QaImportRequest,
)
from ..repositories.conversations_repo import ConversationRepository
from ..repositories.models import User
from ..services.import_service import ImportService
from ..services.persona_profile_service import PersonaProfileService
from ..services.persona_service import PersonaService
from .conversations import _require_bound_profiles
from .deps import require_active_user

router = APIRouter(tags=["personas"])

_personas = PersonaService()
_profiles = PersonaProfileService()
_imports = ImportService()
_conversations = ConversationRepository()


def _conversation_or_404(db: Session, *, owner_user_id: int, conversation_id: int):
    row = _conversations.get(db, owner_user_id=owner_user_id, conversation_id=conversation_id)
    if row is None:
        raise DomainError(DomainErrorCode.NOT_FOUND, "会话不存在", status_code=404)
    return row


def _member_label_map(conversation) -> dict[str, str] | None:
    """群聊导入用：成员名 → 成员 key。单人会话返回 None 走旧逻辑。"""
    if not conversation.is_group:
        return None
    return {member.name: member.key for member in parse_members(conversation.members)}


@router.get("/api/personas")
def get_persona(
    counterpart_key: str = Query(min_length=1),
    subject: str = Query(pattern="^(me|other)$"),
    context: str = Query(default="romance", pattern="^(romance|workplace)$"),
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    return _personas.get(
        db,
        owner_user_id=user.id,
        counterpart_key=counterpart_key,
        subject=subject,
        context=context,
    )


@router.get("/api/personas/profiles")
def list_profiles(
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> list[dict]:
    """人设库列表（聊天创建时选用）。"""
    return _profiles.list_for(db, owner_user_id=user.id)


@router.post("/api/personas/profiles", status_code=201)
def create_profile(
    payload: PersonaProfileCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    """建人设：昵称头像 + 场景题目作答 → LLM 生成速写。"""
    return _profiles.create(
        db, owner_user_id=user.id, payload=payload,
        trace_id=getattr(request.state, "trace_id", ""),
    )


@router.patch("/api/personas/profiles/{profile_id}")
def update_profile(
    profile_id: int,
    payload: PersonaProfileUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    return _profiles.update(
        db, owner_user_id=user.id, profile_id=profile_id, payload=payload
    )


@router.delete("/api/personas/profiles/{profile_id}", status_code=204)
def delete_profile(
    profile_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> Response:
    _profiles.delete(db, owner_user_id=user.id, profile_id=profile_id)
    return Response(status_code=204)


@router.get("/api/personas/batch")
def batch_personas(
    conversation_id: int = Query(ge=1),
    context: str = Query(default="", pattern="^(|romance|workplace)$"),
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    """批量获取一个会话里所有人的人设与上下文（群聊 = 每位成员 + 我）。

    ``context`` 不传则按会话挂的场景推断；前端切恋爱 / 职场时跟随传参。
    """
    conversation = _conversation_or_404(
        db, owner_user_id=user.id, conversation_id=conversation_id
    )
    return _personas.batch_for_conversation(
        db, owner_user_id=user.id, conversation=conversation,
        context=context or None,
    )


@router.post("/api/personas/build")
def build_persona(
    payload: PersonaBuildRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    conversation = _conversation_or_404(
        db, owner_user_id=user.id, conversation_id=payload.conversation_id
    )
    return _personas.build(
        db,
        owner_user_id=user.id,
        conversation=conversation,
        subject=payload.subject,
        self_report=payload.self_report,
        context=payload.context,
        trace_id=getattr(request.state, "trace_id", ""),
        member_key=payload.member_key,
    )


@router.get("/api/personas/usage")
def persona_usage(
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    return _personas.usage(db, owner_user_id=user.id)


@router.post("/api/import/chat/preview")
def preview_chat(
    payload: ChatImportRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    conversation = _conversation_or_404(
        db, owner_user_id=user.id, conversation_id=payload.conversation_id
    )
    return _imports.preview_chat(
        payload.text, payload.me_labels, payload.other_labels,
        members=_member_label_map(conversation),
    )


@router.post("/api/import/chat")
def commit_chat(
    payload: ChatImportRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    conversation = _conversation_or_404(
        db, owner_user_id=user.id, conversation_id=payload.conversation_id
    )
    # 人设前置：先定人设、再导入聊天上下文
    _require_bound_profiles(
        db,
        owner_user_id=user.id,
        keys=[member.key for member in parse_members(conversation.members)]
        if conversation.is_group
        else [conversation.counterpart_key],
    )
    return _imports.commit_chat(
        db,
        owner_user_id=user.id,
        conversation=conversation,
        text=payload.text,
        me_labels=payload.me_labels,
        other_labels=payload.other_labels,
        members=_member_label_map(conversation),
    )


@router.post("/api/import/qa")
def import_qa(
    payload: QaImportRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    conversation = None
    if payload.conversation_id is not None:
        conversation = _conversation_or_404(
            db, owner_user_id=user.id, conversation_id=payload.conversation_id
        )
    return _imports.import_qa(
        db, owner_user_id=user.id, conversation=conversation, raw=payload.raw
    )


@router.post("/api/materials/screenshot")
async def upload_screenshot(
    conversation_id: int = Form(ge=1),
    file: UploadFile = File(),
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    conversation = _conversation_or_404(
        db, owner_user_id=user.id, conversation_id=conversation_id
    )
    content = await file.read()
    return _imports.save_screenshot(
        db,
        owner_user_id=user.id,
        conversation=conversation,
        filename=file.filename or "screenshot",
        content=content,
        mime=file.content_type or "",
    )


@router.get("/api/materials/{material_id}/file")
def material_file(
    material_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
):
    """取图片原图（仅本人）。"""
    from fastapi.responses import FileResponse
    from pathlib import Path

    from ..repositories.models import Material

    row = db.get(Material, material_id)
    if row is None or row.owner_user_id != user.id:
        raise DomainError(DomainErrorCode.NOT_FOUND, "素材不存在", status_code=404)
    path = Path(row.file_path or "")
    if not path.is_file():
        raise DomainError(DomainErrorCode.NOT_FOUND, "原图已不存在", status_code=404)
    return FileResponse(str(path), media_type=row.mime or "application/octet-stream")
