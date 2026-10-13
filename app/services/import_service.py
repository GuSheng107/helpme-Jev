"""素材导入：聊天记录先预览、问答对校验、截图只交给支持看图的模型。"""

from __future__ import annotations

import base64
import json
import re

from sqlalchemy.orm import Session

from ..clients.llm_client import chat_json
from ..domain.errors import DomainError, DomainErrorCode
from ..domain.schemas.conversation import parse_members
from ..repositories.conversations_repo import MessageRepository
from ..repositories.models import Conversation, Material, Message, QaPair
from .analyze_service import AnalyzeService
from .image_service import ALLOWED_MIME, MAX_IMAGE_BYTES, save_image
from .model_log import record_model_call
from .provider_service import ProviderService

_messages = MessageRepository()
_analyze = AnalyzeService()
_providers = ProviderService()

_LINE = re.compile(r"^\s*([^:：]{1,12})\s*[:：]\s*(.+?)\s*$")
_MAX_QA = 200
_MAX_QA_CHARS = 20000
_MAX_IMAGE_BYTES = 4 * 1024 * 1024

# 识别聊天记录：一次最多几张截图、最多转写多少条
_MAX_EXTRACT_IMAGES = 4
_MAX_EXTRACT_ROWS = 100
_MAX_IMPORT_ROWS = 100

# 截图里「我」这一侧的常见落款
_ME_SENDER = {"我", "自己", "本人", "me"}

_EXTRACT_PROMPT = """You transcribe chat conversations from screenshots (given in chronological order).
Return JSON: {"messages": [{"from": "<sender name as shown>", "text": "<message text>"}], "skipped_media": <int>}
Rules:
- Transcribe verbatim in the original language; do not translate, summarize or correct typos.
- One item per text bubble, top-to-bottom order.
- "from" is the displayed sender name; use "我" for the user's own side when identifiable.
- Skip timestamps, system notices, and bubbles without readable text (stickers, images, voice);
  count those in skipped_media.
- Do not invent anything. At most 100 items."""


def parse_chat(
    text: str,
    me_labels: list[str],
    other_labels: list[str],
    members: dict[str, str] | None = None,
) -> list[dict]:
    """逐行解析粘贴的聊天记录。

    ``members``（成员名 → key）给了就走群聊模式：认不出的标签一律跳过，
    认出的成员行带 ``speaker``；单人模式与旧逻辑一致。
    """
    me = {item.strip() for item in me_labels if item.strip()} or {"我"}
    # 对方标签是"补充"而不是"替换"：默认的 她 / 他 / TA 始终认，
    # 否则用户填了"他"之后 TA 开头的行会被跳过（与输入框文案一致）
    other = {"她", "他", "TA"} | {item.strip() for item in other_labels if item.strip()}
    if members:
        other = set()
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
            role, speaker = "me", ""
        elif label in other:
            role, speaker = "other", ""
        elif members is not None and label in members:
            role, speaker = "other", members[label]
        else:
            skipped += 1
            continue
        if content:
            parsed.append({"role": role, "content": content, "label": label, "speaker": speaker})
    return parsed if not skipped else [*parsed, {"skipped": skipped}]


class ImportService:
    def preview_chat(
        self,
        text: str,
        me_labels: list[str],
        other_labels: list[str],
        members: dict[str, str] | None = None,
    ) -> dict:
        rows = parse_chat(text, me_labels, other_labels, members)
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
        members: dict[str, str] | None = None,
    ) -> dict:
        preview = self.preview_chat(text, me_labels, other_labels, members)
        if preview["count"] == 0:
            raise DomainError(DomainErrorCode.VALIDATION_FAILED, "没有认出任何一条对话", status_code=422)
        seq = _messages.next_seq(db, conversation_id=conversation.id)
        for item in parse_chat(text, me_labels, other_labels, members):
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
                    speaker=item.get("speaker", ""),
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

    # ------------------------------------------------------------ 识别聊天记录
    def extract_chat_images(
        self,
        db: Session,
        *,
        owner_user_id: int,
        conversation: Conversation,
        blobs: list[tuple[bytes, str]],
        trace_id: str = "",
    ) -> dict:
        """截图 → 多模态模型转写成聊天记录（预览）；只有这个入口按
        「读出文字」理解图片，贴图消息仍走 describe（当表情包看语境）。

        截图本身不落库：识别的是内容，不是素材。
        """
        if not blobs:
            raise DomainError(
                DomainErrorCode.VALIDATION_FAILED, "请先添加聊天截图", status_code=422
            )
        if len(blobs) > _MAX_EXTRACT_IMAGES:
            raise DomainError(
                DomainErrorCode.VALIDATION_FAILED,
                f"一次最多识别 {_MAX_EXTRACT_IMAGES} 张截图",
                status_code=422,
            )
        llm = _analyze._require_provider(db, owner_user_id=owner_user_id, kind="llm")
        if not llm.supports_vision:
            raise DomainError(
                DomainErrorCode.VALIDATION_FAILED,
                "当前默认语言模型不支持看图，无法识别聊天记录。可在设置里换用支持视觉的模型。",
                status_code=422,
            )
        urls = []
        for content, mime in blobs:
            if mime not in ALLOWED_MIME:
                raise DomainError(
                    DomainErrorCode.VALIDATION_FAILED, "截图只接受 PNG、JPEG 或 WEBP", status_code=422
                )
            if len(content) > MAX_IMAGE_BYTES:
                raise DomainError(
                    DomainErrorCode.PAYLOAD_TOO_LARGE, "截图超过 4MB", status_code=413
                )
            urls.append(
                f"data:{mime or 'image/png'};base64,"
                f"{base64.b64encode(content).decode('ascii')}"
            )
        result = chat_json(
            endpoint_url=llm.endpoint_url,
            api_key=_providers.decrypt_key(llm),
            model=llm.model,
            protocol=llm.protocol,
            messages=[
                {"role": "system", "content": _EXTRACT_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Transcribe the chat from these screenshots."},
                        *(
                            {"type": "image_url", "image_url": {"url": url}}
                            for url in urls
                        ),
                    ],
                },
            ],
        )
        raw_rows = result.payload.get("messages") if result.ok else None
        rows: list[dict] = []
        skipped_media = 0
        if isinstance(raw_rows, list):
            for item in raw_rows:
                if not isinstance(item, dict):
                    continue
                text = str(item.get("text") or "").strip()
                sender = str(item.get("from") or "").strip()
                if not text:
                    continue
                mapped = self._map_sender(conversation, sender)
                if mapped is None:
                    skipped_media += 1
                    continue
                role, speaker = mapped
                rows.append(
                    {"role": role, "content": text[:4000], "speaker": speaker, "label": sender or "我"}
                )
        try:
            skipped_media += max(0, int(result.payload.get("skipped_media") or 0))
        except (TypeError, ValueError):
            pass
        record_model_call(
            db, owner_user_id=owner_user_id, trace_id=trace_id, kind="llm",
            phase="import_image", provider=llm, result=result,
            request={"images": len(urls), "conversation_id": conversation.id},
            response=result.payload, ok=bool(rows),
        )
        db.commit()
        if not result.ok or not isinstance(raw_rows, list):
            raise DomainError(
                DomainErrorCode.LLM_UPSTREAM_ERROR, "识别未完成，请重试。", status_code=502
            )
        return {
            "count": len(rows[:_MAX_EXTRACT_ROWS]),
            "skipped": skipped_media,
            "messages": rows[:_MAX_EXTRACT_ROWS],
        }

    def _map_sender(self, conversation: Conversation, sender: str) -> tuple[str, str] | None:
        """截图落款 → (role, speaker)。认不出的群成员返回 None 计入跳过。"""
        if sender in _ME_SENDER:
            return "me", ""
        if not conversation.is_group:
            return "other", ""
        for member in parse_members(conversation.members):
            if sender == member.name or sender == member.key:
                return "other", member.key
        return None

    def commit_rows(
        self,
        db: Session,
        *,
        owner_user_id: int,
        conversation: Conversation,
        rows: list[dict],
    ) -> dict:
        """把识别（或外部解析）出的消息写入会话：校验与手写消息同一套规则。"""
        if not rows:
            raise DomainError(
                DomainErrorCode.VALIDATION_FAILED, "没有可导入的内容", status_code=422
            )
        if len(rows) > _MAX_IMPORT_ROWS:
            raise DomainError(
                DomainErrorCode.VALIDATION_FAILED,
                f"一次最多导入 {_MAX_IMPORT_ROWS} 条",
                status_code=422,
            )
        member_keys = {member.key for member in parse_members(conversation.members)}
        cleaned: list[Message] = []
        seq = _messages.next_seq(db, conversation_id=conversation.id)
        for item in rows:
            role = str(item.get("role") or "")
            content = str(item.get("content") or "").strip()
            speaker = str(item.get("speaker") or "").strip()
            if role not in ("me", "other") or not content:
                raise DomainError(
                    DomainErrorCode.VALIDATION_FAILED, "导入的内容不合法", status_code=422
                )
            if conversation.is_group and role == "other" and speaker not in member_keys:
                raise DomainError(
                    DomainErrorCode.VALIDATION_FAILED,
                    "导入内容里有不属于本群的发言人，请重新识别",
                    status_code=422,
                )
            cleaned.append(
                Message(
                    conversation_id=conversation.id,
                    seq=seq,
                    role=role,
                    content=content[:4000],
                    source="import",
                    speaker=speaker if conversation.is_group else "",
                )
            )
            seq += 1
        for row in cleaned:
            _messages.add(db, row)
        db.add(
            Material(
                owner_user_id=owner_user_id,
                conversation_id=conversation.id,
                kind="chat_import",
                parsed_count=len(cleaned),
            )
        )
        db.commit()
        return {"imported": len(cleaned), "skipped": 0}
