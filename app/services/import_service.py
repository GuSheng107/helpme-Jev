"""素材导入：聊天记录先预览、问答对校验、截图只交给支持看图的模型。"""

from __future__ import annotations

import json
import re

from sqlalchemy.orm import Session

from ..domain.errors import DomainError, DomainErrorCode
from ..repositories.conversations_repo import MessageRepository
from ..repositories.models import Conversation, Material, Message, QaPair
from .analyze_service import AnalyzeService
from .image_service import save_image

_messages = MessageRepository()
_analyze = AnalyzeService()

_LINE = re.compile(r"^\s*([^:：]{1,12})\s*[:：]\s*(.+?)\s*$")
_MAX_QA = 200
_MAX_QA_CHARS = 20000
_MAX_IMAGE_BYTES = 4 * 1024 * 1024


def parse_chat(text: str, me_labels: list[str], other_labels: list[str]) -> list[dict]:
    me = {item.strip() for item in me_labels if item.strip()} or {"我"}
    other = {item.strip() for item in other_labels if item.strip()} or {"她", "他", "TA"}
    parsed: list[dict] = []
    skipped = 0
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        matched = _LINE.match(line)
        if matched is None:
            skipped += 1
            continue
        label, content = matched.group(1).strip(), matched.group(2).strip()
        if label in me:
            role = "me"
        elif label in other:
            role = "other"
        else:
            skipped += 1
            continue
        if content:
            parsed.append({"role": role, "content": content, "label": label})
    return parsed if not skipped else [*parsed, {"skipped": skipped}]


class ImportService:
    def preview_chat(self, text: str, me_labels: list[str], other_labels: list[str]) -> dict:
        rows = parse_chat(text, me_labels, other_labels)
        skipped = 0
        messages = []
        for row in rows:
            if "skipped" in row:
                skipped = int(row["skipped"])
            else:
                messages.append(row)
        return {"count": len(messages), "skipped": skipped, "messages": messages[:50]}

    def commit_chat(
        self,
        db: Session,
        *,
        owner_user_id: int,
        conversation: Conversation,
        text: str,
        me_labels: list[str],
        other_labels: list[str],
    ) -> dict:
        preview = self.preview_chat(text, me_labels, other_labels)
        if preview["count"] == 0:
            raise DomainError(DomainErrorCode.VALIDATION_FAILED, "没有认出任何一条对话", status_code=422)
        seq = _messages.next_seq(db, conversation_id=conversation.id)
        for item in parse_chat(text, me_labels, other_labels):
            if "skipped" in item:
                continue
            _messages.add(
                db,
                Message(
                    conversation_id=conversation.id,
                    seq=seq,
                    role=item["role"],
                    content=item["content"],
                    source="import",
                ),
            )
            seq += 1
        db.add(
            Material(
                owner_user_id=owner_user_id,
                conversation_id=conversation.id,
                kind="chat_import",
                parsed_count=preview["count"],
            )
        )
        db.commit()
        return {"imported": preview["count"], "skipped": preview["skipped"]}

    def import_qa(
        self,
        db: Session,
        *,
        owner_user_id: int,
        conversation: Conversation | None,
        raw: str,
    ) -> dict:
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise DomainError(DomainErrorCode.VALIDATION_FAILED, "问答对不是合法的 JSON", status_code=422) from exc
        if not isinstance(payload, list):
            raise DomainError(DomainErrorCode.VALIDATION_FAILED, "问答对必须是数组", status_code=422)
        if len(payload) > _MAX_QA:
            raise DomainError(DomainErrorCode.VALIDATION_FAILED, "问答对超过 200 条", status_code=422)
        total = 0
        cleaned = []
        for item in payload:
            if not isinstance(item, dict) or not str(item.get("question") or "").strip() or not str(item.get("answer") or "").strip():
                raise DomainError(DomainErrorCode.VALIDATION_FAILED, "每一项都要有问题和回答", status_code=422)
            question = str(item["question"]).strip()
            answer = str(item["answer"]).strip()
            total += len(question) + len(answer)
            cleaned.append((question, answer, item.get("tags") or []))
        if total > _MAX_QA_CHARS:
            raise DomainError(DomainErrorCode.VALIDATION_FAILED, "问答对总字数超限", status_code=422)
        for question, answer, tags in cleaned:
            db.add(
                QaPair(
                    owner_user_id=owner_user_id,
                    conversation_id=conversation.id if conversation else None,
                    question=question,
                    answer=answer,
                    tags=json.dumps(tags, ensure_ascii=False),
                )
            )
        db.commit()
        return {"imported": len(cleaned)}

    def save_screenshot(
        self,
        db: Session,
        *,
        owner_user_id: int,
        conversation: Conversation,
        filename: str,
        content: bytes,
        mime: str,
    ) -> dict:
        llm = _analyze._require_provider(db, owner_user_id=owner_user_id, kind="llm")
        if not llm.supports_vision:
            raise DomainError(
                DomainErrorCode.VALIDATION_FAILED,
                "当前模型不能读取图片，截图入口不可用。",
                status_code=422,
            )
        row = save_image(
            db,
            owner_user_id=owner_user_id,
            conversation_id=conversation.id,
            content=content,
            mime=mime,
        )
        return {
            "id": row.id,
            "bytes": row.bytes,
            "note": "原图仅供支持看图的模型读取，系统不做文字识别。",
        }
