"""会话与消息接口。

隔离要点：

- 每个查询都带 ``owner_user_id``
- 取不到时统一返回 **404「会话不存在」**，不区分"不存在"与"不属于你"，
  免得成了探测他人资源是否存在的探针
"""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.time import iso_utc
from ..domain.errors import DomainError, DomainErrorCode
from ..domain.schemas.conversation import (
    ConversationCreate,
    ConversationUpdate,
    ConversationView,
    MessageCreate,
    MessageView,
)
from ..repositories.conversations_repo import ConversationRepository, MessageRepository
from ..repositories.models import Conversation, Message, Scenario, User
from .deps import require_active_user

router = APIRouter(prefix="/api/conversations", tags=["conversations"])

_conversations = ConversationRepository()
_messages = MessageRepository()


def _counterpart_key(name: str, fallback: str) -> str:
    """对象标识：名字归一化。

    人设**按对象区分**（跨会话共用），所以这个 key 必须稳定。
    """
    key = "".join((name or "").split()).lower()
    return key or fallback.strip().lower()


def _conversation_view(db: Session, row: Conversation) -> ConversationView:
    kind = "romance"
    if row.scenario_id is not None:
        scenario = db.get(Scenario, row.scenario_id)
        kind = (scenario.kind if scenario else None) or "romance"
    return ConversationView(
        id=row.id,
        title=row.title,
        counterpart_key=row.counterpart_key,
        counterpart_name=row.counterpart_name,
        relationship=row.relationship,
        scenario_id=row.scenario_id,
        scenario_kind=kind,
        message_count=_messages.count(db, conversation_id=row.id),
        created_at=iso_utc(row.created_at) or "",
        updated_at=iso_utc(row.updated_at) or "",
    )


def _message_view(row: Message) -> MessageView:
    try:
        attachments = json.loads(row.attachments or "[]")
    except json.JSONDecodeError:
        attachments = []
    return MessageView(
        id=row.id,
        seq=row.seq,
        role=row.role,
        content=row.content,
        attachments=attachments,
        source=row.source,
        created_at=iso_utc(row.created_at) or "",
    )


def _require_conversation(
    db: Session, *, owner_user_id: int, conversation_id: int
) -> Conversation:
    row = _conversations.get(
        db, owner_user_id=owner_user_id, conversation_id=conversation_id
    )
    if row is None:
        raise DomainError(DomainErrorCode.NOT_FOUND, "会话不存在", status_code=404)
    return row


# ------------------------------------------------------------------ 会话
@router.get("", response_model=list[ConversationView])
def list_conversations(
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> list[ConversationView]:
    rows = _conversations.list_all(db, owner_user_id=user.id)
    return [_conversation_view(db, row) for row in rows]


@router.post("", response_model=ConversationView, status_code=201)
def create_conversation(
    payload: ConversationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> ConversationView:
    if payload.scenario_id is not None:
        # 校验存在性 + 归属：预设场景（owner 为 NULL）人人可用，
        # 用户自建场景只有本人能用 —— 否则可以指向他人或不存在的场景
        scenario = db.get(Scenario, payload.scenario_id)
        if scenario is None or (
            scenario.owner_user_id is not None and scenario.owner_user_id != user.id
        ):
            raise DomainError(DomainErrorCode.NOT_FOUND, "场景不存在", status_code=404)

    row = Conversation(
        owner_user_id=user.id,
        scenario_id=payload.scenario_id,
        title=payload.title.strip(),
        counterpart_name=payload.counterpart_name.strip(),
        relationship=payload.relationship.strip(),
        counterpart_key=_counterpart_key(payload.counterpart_name, payload.title),
    )
    _conversations.add(db, row)
    db.commit()
    return _conversation_view(db, row)


@router.get("/{conversation_id}", response_model=ConversationView)
def get_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> ConversationView:
    row = _require_conversation(db, owner_user_id=user.id, conversation_id=conversation_id)
    return _conversation_view(db, row)


@router.patch("/{conversation_id}", response_model=ConversationView)
def update_conversation(
    conversation_id: int,
    payload: ConversationUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> ConversationView:
    row = _require_conversation(db, owner_user_id=user.id, conversation_id=conversation_id)
    if payload.title is not None:
        row.title = payload.title.strip()
    if payload.counterpart_name is not None:
        row.counterpart_name = payload.counterpart_name.strip()
        # counterpart_key **生成后冻结**：改名只影响显示名，不改对象标识。
        # 否则旧 key 下的人设档案（含 version 链）会变成孤儿。
        if not row.counterpart_key:
            row.counterpart_key = _counterpart_key(row.counterpart_name, row.title)
    if payload.relationship is not None:
        row.relationship = payload.relationship.strip()
    db.commit()
    return _conversation_view(db, row)


@router.delete("/{conversation_id}", status_code=204)
def delete_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> Response:
    row = _require_conversation(db, owner_user_id=user.id, conversation_id=conversation_id)
    _conversations.delete(db, row)  # 级联删除其消息
    db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------------ 消息
@router.get("/{conversation_id}/messages", response_model=list[MessageView])
def list_messages(
    conversation_id: int,
    limit: int = Query(default=100, ge=1, le=500),
    after_seq: int | None = Query(default=None, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> list[MessageView]:
    _require_conversation(db, owner_user_id=user.id, conversation_id=conversation_id)
    rows = _messages.list_by_conversation(
        db, conversation_id=conversation_id, limit=limit, after_seq=after_seq
    )
    return [_message_view(row) for row in rows]


@router.post("/{conversation_id}/images", status_code=201)
async def upload_image(
    conversation_id: int,
    file: UploadFile = File(),
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> dict:
    """会话内贴图：只有默认 LLM 支持看图时才可用（系统不做 OCR）。"""
    from ..services.analyze_service import AnalyzeService
    from ..services.image_service import save_image

    conversation = _require_conversation(
        db, owner_user_id=user.id, conversation_id=conversation_id
    )
    llm = AnalyzeService()._require_provider(db, owner_user_id=user.id, kind="llm")
    if not llm.supports_vision:
        raise DomainError(
            DomainErrorCode.VALIDATION_FAILED,
            "当前默认语言模型不支持看图，无法添加图片。可在设置里换用支持视觉的模型。",
            status_code=422,
        )
    content = await file.read()
    row = save_image(
        db,
        owner_user_id=user.id,
        conversation_id=conversation.id,
        content=content,
        mime=(file.content_type or "").split(";")[0].strip(),
    )
    return {"id": row.id, "mime": row.mime, "bytes": row.bytes}


@router.post("/{conversation_id}/messages", response_model=MessageView, status_code=201)
def append_message(
    conversation_id: int,
    payload: MessageCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_active_user),
) -> MessageView:
    conversation = _require_conversation(
        db, owner_user_id=user.id, conversation_id=conversation_id
    )
    attachments = _resolve_attachments(db, payload=payload, conversation=conversation, user=user)
    if not payload.content.strip() and not attachments:
        raise DomainError(
            DomainErrorCode.VALIDATION_FAILED, "消息内容不能为空", status_code=422
        )
    row = Message(
        conversation_id=conversation.id,
        seq=_messages.next_seq(db, conversation_id=conversation.id),
        role=payload.role,
        content=payload.content,
        attachments=json.dumps(attachments, ensure_ascii=False),
        source=payload.source,
    )
    try:
        _messages.add(db, row)
        db.commit()
    except IntegrityError as exc:
        # 并发 append 撞上 (conversation_id, seq) 唯一约束 —— 转成 409 而非 500
        db.rollback()
        raise DomainError(
            DomainErrorCode.CONFLICT, "消息序号冲突，请重试", status_code=409
        ) from exc
    return _message_view(row)


def _resolve_attachments(
    db: Session, *, payload: MessageCreate, conversation: Conversation, user: User
) -> list[dict]:
    """attachment_ids（图片素材）→ attachments JSON；校验归属与总数上限。"""
    from ..repositories.models import Material

    attachments = [dict(item) for item in payload.attachments if isinstance(item, dict)]
    if payload.attachment_ids:
        rows = {
            row.id: row
            for row in db.scalars(
                select(Material).where(
                    Material.id.in_(payload.attachment_ids),
                    Material.owner_user_id == user.id,
                )
            ).all()
        }
        for material_id in payload.attachment_ids:
            material = rows.get(material_id)
            if material is None or material.conversation_id != conversation.id:
                raise DomainError(
                    DomainErrorCode.VALIDATION_FAILED,
                    "图片不存在或不属于这个会话",
                    status_code=422,
                )
            attachments.append(
                {"type": "image", "id": material.id, "mime": material.mime or ""}
            )
    if len(attachments) > 9:
        raise DomainError(
            DomainErrorCode.VALIDATION_FAILED, "一条消息最多带 9 张图", status_code=422
        )
    return attachments
