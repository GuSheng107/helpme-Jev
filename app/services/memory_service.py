"""记忆复盘：LLM 读最近对话，产出 ADD / UPDATE / INVALIDATE / NOOP，可整单撤销。

记录在分析之后自动进行，不另设手动入口。
冲突时不覆盖：QA 来源的条目，UPDATE / INVALIDATE 一律跳过。
撤销只能从最新一次尚未撤销的记录开始，避免把已被后续复盘改过的内容写回去。
"""

from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ..clients.llm_client import chat_json
from ..core.time import utc_now
from ..domain.enums import MemoryOp
from ..domain.errors import DomainError, DomainErrorCode
from ..repositories.conversations_repo import MessageRepository
from ..repositories.memories_repo import MemoryRepository, ReflectionRepository
from ..repositories.models import Conversation, Memory, MemoryReflection
from .provider_service import ProviderService

_MAX_CHANGES = 12
_SUBJECTS = {"me", "other", "relation"}
_OPS = {item.value for item in MemoryOp}

_PROMPT = """You review a chat and maintain a small memory list for the next judgment.
Return JSON: {"changes":[{"op":"ADD|UPDATE|INVALIDATE|NOOP","memory_id":0,"subject":"me|other|relation","category":"偏好|雷区|事件|情绪模式|其他","content":"..."}]}

Rules:
- Only facts that would change how to reply next time. No personality scores. No advice.
- subject=other is about the counterpart; me is about the user; relation is about the pair.
- ADD for a new fact. UPDATE only to correct an existing memory (set memory_id). INVALIDATE when a fact is no longer true (set memory_id). NOOP when nothing should change.
- content is one short Chinese sentence. At most 12 changes. If nothing new, return {"changes":[]}.
- Do not invent facts that are not in the chat or the existing memories."""

_messages = MessageRepository()
_memories = MemoryRepository()
_reflections = ReflectionRepository()
_providers = ProviderService()


def _clean_change(raw: object, *, known_ids: set[int]) -> dict | None:
    if not isinstance(raw, dict):
        return None
    op = str(raw.get("op") or "").upper()
    if op not in _OPS:
        return None
    subject = str(raw.get("subject") or "")
    if subject not in _SUBJECTS:
        subject = "relation"
    content = " ".join(str(raw.get("content") or "").split())[:240]
    category = str(raw.get("category") or "其他")[:32] or "其他"
    memory_id = raw.get("memory_id")
    memory_id = memory_id if isinstance(memory_id, int) and memory_id in known_ids else None
    if op in (MemoryOp.UPDATE.value, MemoryOp.INVALIDATE.value) and memory_id is None:
        return None
    if op == MemoryOp.ADD.value and not content:
        return None
    if op == MemoryOp.NOOP.value:
        return {"op": op}
    return {
        "op": op,
        "memory_id": memory_id,
        "subject": subject,
        "category": category,
        "content": content,
    }


class MemoryService:
    def reflect(
        self,
        db: Session,
        *,
        owner_user_id: int,
        conversation: Conversation,
        trace_id: str,
    ) -> MemoryReflection:
        rows = _messages.list_by_conversation(db, conversation_id=conversation.id, limit=30)
        if not rows:
            raise DomainError(
                DomainErrorCode.VALIDATION_FAILED, "暂无可记录的内容", status_code=422
            )
        llm = self._llm(db, owner_user_id=owner_user_id)
        existing = _memories.active_for(
            db, owner_user_id=owner_user_id, counterpart_key=conversation.counterpart_key
        )
        known = {row.id: row for row in existing}
        payload = {
            "counterpart": conversation.counterpart_name,
            "relationship": conversation.relationship,
            "messages": [
                {"seq": row.seq, "from": row.role, "text": row.content} for row in rows
            ],
            "memories": [
                {
                    "id": row.id,
                    "subject": row.subject,
                    "category": row.category,
                    "content": row.content,
                    "source": row.source,
                }
                for row in existing
            ],
        }
        result = chat_json(
            endpoint_url=llm.endpoint_url,
            api_key=_providers.decrypt_key(llm),
            model=llm.model,
            protocol=llm.protocol,
            messages=[
                {"role": "system", "content": _PROMPT},
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
            ],
        )
        self._log(
            db,
            owner_user_id=owner_user_id,
            trace_id=trace_id,
            llm=llm,
            request=payload,
            result=result,
        )
        if not result.ok:
            db.commit()
            raise DomainError(
                DomainErrorCode.LLM_UPSTREAM_ERROR,
                "记录未完成，请重试。",
                status_code=502,
            )

        proposed = result.payload.get("changes")
        if not isinstance(proposed, list):
            proposed = []
        changes = []
        for item in proposed[:_MAX_CHANGES]:
            cleaned = _clean_change(item, known_ids=set(known))
            if cleaned is not None:
                changes.append(cleaned)

        applied = self._apply(db, owner_user_id=owner_user_id, conversation=conversation, changes=changes, known=known)
        reflection = MemoryReflection(
            owner_user_id=owner_user_id,
            trace_id=trace_id,
            scope=f"conversation:{conversation.id}:upto:{rows[-1].seq}",
            changes=json.dumps(applied, ensure_ascii=False),
            applied=True,
            model=llm.model,
        )
        _reflections.add(db, reflection)
        db.commit()
        return reflection

    def revert(self, db: Session, *, owner_user_id: int, reflection_id: int) -> MemoryReflection:
        reflection = _reflections.get(db, owner_user_id=owner_user_id, reflection_id=reflection_id)
        if reflection is None:
            raise DomainError(DomainErrorCode.NOT_FOUND, "记录不存在", status_code=404)
        if reflection.reverted_at is not None:
            raise DomainError(DomainErrorCode.CONFLICT, "该记录已撤销", status_code=409)
        newer = _reflections.newer_open(db, owner_user_id=owner_user_id, reflection_id=reflection.id)
        if newer is not None:
            raise DomainError(
                DomainErrorCode.CONFLICT,
                "请先撤销更新的记录",
                status_code=409,
            )
        try:
            changes = json.loads(reflection.changes or "[]")
        except json.JSONDecodeError:
            changes = []
        now = utc_now()
        for change in reversed(changes):
            if not isinstance(change, dict):
                continue
            op = change.get("op")
            if op == MemoryOp.ADD.value and isinstance(change.get("created_id"), int):
                row = _memories.get(db, owner_user_id=owner_user_id, memory_id=change["created_id"])
                if row is not None and row.valid_to is None:
                    row.valid_to = now
            elif op == MemoryOp.UPDATE.value and isinstance(change.get("memory_id"), int):
                row = _memories.get(db, owner_user_id=owner_user_id, memory_id=change["memory_id"])
                if row is not None and "previous" in change:
                    row.content = change["previous"].get("content", row.content)
                    row.category = change["previous"].get("category", row.category)
            elif op == MemoryOp.INVALIDATE.value and isinstance(change.get("memory_id"), int):
                row = _memories.get(db, owner_user_id=owner_user_id, memory_id=change["memory_id"])
                if row is not None:
                    row.valid_to = None
        reflection.reverted_at = now
        db.commit()
        return reflection

    def list_active(self, db: Session, *, owner_user_id: int, counterpart_key: str) -> list[Memory]:
        return _memories.active_for(
            db, owner_user_id=owner_user_id, counterpart_key=counterpart_key
        )

    def forget(self, db: Session, *, owner_user_id: int, memory_id: int) -> None:
        row = _memories.get(db, owner_user_id=owner_user_id, memory_id=memory_id)
        if row is None or row.valid_to is not None:
            raise DomainError(DomainErrorCode.NOT_FOUND, "记录不存在", status_code=404)
        row.valid_to = utc_now()
        db.commit()

    def list_reflections(self, db: Session, *, owner_user_id: int) -> list[MemoryReflection]:
        return _reflections.list_for(db, owner_user_id=owner_user_id, limit=10)

    def list_all_active(
        self, db: Session, *, owner_user_id: int, limit: int = 50, offset: int = 0
    ) -> tuple[list[Memory], int]:
        return _memories.list_active(
            db, owner_user_id=owner_user_id, limit=limit, offset=offset
        )

    def _log(self, db: Session, *, owner_user_id: int, trace_id: str, llm, request: dict, result) -> None:
        import json as _json

        from ..core.logging import sanitize_log_value
        from ..repositories.models import CallLog

        db.add(
            CallLog(
                owner_user_id=owner_user_id,
                trace_id=trace_id,
                kind="llm",
                phase="reflect",
                level="info" if result.ok else "error",
                endpoint_url=llm.endpoint_url,
                model=llm.model,
                request_body=_json.dumps(sanitize_log_value(request), ensure_ascii=False)[:65536],
                response_body=_json.dumps(sanitize_log_value(result.payload), ensure_ascii=False)[:65536],
                status_code=result.status_code,
                latency_ms=result.latency_ms,
                error="" if result.ok else result.detail,
            )
        )

    def _apply(
        self,
        db: Session,
        *,
        owner_user_id: int,
        conversation: Conversation,
        changes: list[dict],
        known: dict[int, Memory],
    ) -> list[dict]:
        applied: list[dict] = []
        now = utc_now()
        for change in changes:
            op = change["op"]
            if op == MemoryOp.NOOP.value:
                applied.append(change)
                continue
            if op == MemoryOp.ADD.value:
                key = conversation.counterpart_key if change["subject"] == "other" else ""
                row = Memory(
                    owner_user_id=owner_user_id,
                    subject=change["subject"],
                    counterpart_key=key,
                    category=change["category"],
                    content=change["content"],
                    valid_from=now,
                    confidence=0.6,
                    source="reflection",
                    evidence=json.dumps({"conversation_id": conversation.id}, ensure_ascii=False),
                )
                _memories.add(db, row)
                applied.append({**change, "created_id": row.id})
                continue

            target = known.get(change["memory_id"])
            if target is None or target.valid_to is not None:
                continue
            # QA 直给的事实不让复盘覆盖
            if target.source == "qa":
                applied.append({**change, "skipped": "qa"})
                continue
            if op == MemoryOp.UPDATE.value:
                previous = {"content": target.content, "category": target.category}
                if change["content"]:
                    target.content = change["content"]
                target.category = change["category"]
                applied.append({**change, "previous": previous})
            elif op == MemoryOp.INVALIDATE.value:
                target.valid_to = now
                applied.append(change)
        return applied

    def _llm(self, db: Session, *, owner_user_id: int):
        chosen = _providers.repo.default_of_kind(db, owner_user_id=owner_user_id, kind="llm")
        if chosen is None:
            rows = _providers.list_for_user(db, owner_user_id=owner_user_id, kind="llm")
            chosen = rows[0] if rows else None
        if chosen is None:
            raise DomainError(
                DomainErrorCode.LLM_NOT_CONFIGURED,
                "尚未配置语言模型，请前往设置填写地址与密钥。",
                status_code=409,
            )
        if not chosen.is_enabled:
            raise DomainError(
                DomainErrorCode.NOT_CONFIGURED,
                "表达模型已停用，请在设置里启用。",
                status_code=409,
            )
        return chosen
