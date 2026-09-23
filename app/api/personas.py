"""人设档案与素材导入。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..domain.errors import DomainError, DomainErrorCode
from ..domain.schemas.persona import (
    ChatImportRequest,
    PersonaBuildRequest,
    QaImportRequest,
)
from ..repositories.conversations_repo import ConversationRepository
from ..repositories.models import User
from ..services.import_service import ImportService
from ..services.persona_service import PersonaService
from .deps import require_active_user

router = APIRouter(tags=["personas"])

_personas = PersonaService()
_imports = ImportService()
_conversations = ConversationRepository()


def _conversation_or_404(db: Session, *, owner_user_id: int, conversation_id: int):
    row = _conversations.get(db, owner_user_id=owner_user_id, conversation_id=conversation_id)
    if row is None:
        raise DomainError(DomainErrorCode.NOT_FOUND, "会话不存在", status_code=404)
    return row


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


@router.post("/api/personas/build")
def build_persona(
    payload: PersonaBuildRequest,
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
    user: User = Depends(require_active_user),
) -> dict:
    del user
    return _imports.preview_chat(payload.text, payload.me_labels, payload.other_labels)


@router.post("/api/import/chat")
def commit_chat(
    payload: ChatImportRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    conversation = _conversation_or_404(
        db, owner_user_id=user.id, conversation_id=payload.conversation_id
    )
    return _imports.commit_chat(
        db,
        owner_user_id=user.id,
        conversation=conversation,
        text=payload.text,
        me_labels=payload.me_labels,
        other_labels=payload.other_labels,
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
