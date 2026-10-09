"""人设库：先选情境、填昵称头像、答场景人设题，LLM 生成速写。

与推断档案（personas 表）的区别： traits 来自**用户作答**而非对话推断，
key 是归一化昵称且创建后冻结，聊天（单聊 / 群聊）创建时按档案选用。
判断链路里 key 命中档案时优先于推断档案（见 PersonaService.member_persona_lines）。
"""

from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..core.time import iso_utc
from ..domain.errors import DomainError, DomainErrorCode
from ..domain.schemas.persona import PersonaProfileCreate, PersonaProfileUpdate
from ..repositories.models import PersonaProfile
from ..scenarios.persona_questions import persona_questions_for
from .analyze_service import AnalyzeService
from .model_log import record_model_call
from .persona_service import _stored_traits, trait_items
from .provider_service import ProviderService

_providers = ProviderService()
_analyze = AnalyzeService()

_SUMMARY_PROMPT = """You draft a short Chinese persona sketch from questionnaire answers.
Return JSON: {"summary":"..."}
At most 80 Chinese characters. Plain third-person description of this person; no advice, no diagnosis."""


def _normalize_answers(answers: dict, questions: dict) -> dict:
    """把前端作答清洗成 traits values：score 取整数档位，choice 取枚举值。"""
    values: dict = {}
    for key, raw in answers.items():
        question = questions.get(key)
        if not isinstance(question, dict):
            raise DomainError(
                DomainErrorCode.VALIDATION_FAILED, f"未知的人设题目：{key}", status_code=422
            )
        criteria = question.get("criteria")
        if question.get("type") == "score":
            try:
                value = int(raw)  # type: ignore[arg-type]
            except (TypeError, ValueError):
                raise DomainError(
                    DomainErrorCode.VALIDATION_FAILED, f"题目 {key} 需要数字档位", status_code=422
                ) from None
            top = len(criteria) - 1 if isinstance(criteria, list) and criteria else 9
            if not 0 <= value <= top:
                raise DomainError(
                    DomainErrorCode.VALIDATION_FAILED, f"题目 {key} 的档位超出范围", status_code=422
                )
            values[key] = value
        elif question.get("type") == "choice":
            value = str(raw or "").strip()
            # choice 的 criteria 可能是「枚举值 → 描述」字典，也可能就是枚举列表
            options = list(criteria) if isinstance(criteria, dict) else (
                criteria if isinstance(criteria, list) else []
            )
            if value not in options:
                raise DomainError(
                    DomainErrorCode.VALIDATION_FAILED, f"题目 {key} 的选项无效", status_code=422
                )
            values[key] = value
        else:
            raise DomainError(
                DomainErrorCode.VALIDATION_FAILED, f"题目 {key} 不支持作答", status_code=422
            )
    if not values:
        raise DomainError(DomainErrorCode.VALIDATION_FAILED, "请至少回答一道题", status_code=422)
    return values


def _is_placeholder(row: PersonaProfile) -> bool:
    """启动迁移补的占位档案：没作答、没 traits，等待用户走向导补全。"""
    return row.answers in ("{}", "") and row.traits in ("{}", "")


class PersonaProfileService:
    # ------------------------------------------------------------ 读
    def list_for(self, db: Session, *, owner_user_id: int) -> list[dict]:
        rows = list(
            db.scalars(
                select(PersonaProfile)
                .where(PersonaProfile.owner_user_id == owner_user_id)
                .order_by(PersonaProfile.updated_at.desc())
            )
        )
        return [self._view(row) for row in rows]

    def get_or_404(
        self, db: Session, *, owner_user_id: int, profile_id: int
    ) -> PersonaProfile:
        row = db.get(PersonaProfile, profile_id)
        if row is None or row.owner_user_id != owner_user_id:
            raise DomainError(DomainErrorCode.NOT_FOUND, "人设不存在", status_code=404)
        return row

    def _view(self, row: PersonaProfile) -> dict:
        return {
            "id": row.id,
            "key": row.key,
            "nickname": row.nickname,
            "avatar_base64": row.avatar_base64 or "",
            "context": row.context,
            "traits": trait_items(row.traits),
            "summary": row.summary or "",
            "confidence": round(row.confidence * 100),
            "version": row.version,
            "updated_at": iso_utc(row.updated_at),
        }

    # ------------------------------------------------------------ 写
    def create(
        self,
        db: Session,
        *,
        owner_user_id: int,
        payload: PersonaProfileCreate,
        trace_id: str = "",
    ) -> dict:
        nickname = payload.nickname.strip()
        key = "".join(nickname.split()).lower()
        if not key:
            raise DomainError(
                DomainErrorCode.VALIDATION_FAILED, "昵称不能全是空白", status_code=422
            )
        existing = db.scalars(
            select(PersonaProfile).where(
                PersonaProfile.owner_user_id == owner_user_id, PersonaProfile.key == key
            )
        ).first()
        if existing is not None and not _is_placeholder(existing):
            raise DomainError(
                DomainErrorCode.CONFLICT, "已有同名人设，请换一个昵称", status_code=409
            )

        questions = persona_questions_for(payload.context, "other")
        values = _normalize_answers(payload.answers, questions)
        # 与推断档案同格式存储（带展示 meta），判断链路可直接复用
        traits = _stored_traits(values, questions)

        llm = _analyze._require_provider(db, owner_user_id=owner_user_id, kind="llm")
        summary = self._summarize(
            db, owner_user_id=owner_user_id, trace_id=trace_id, llm=llm,
            questions=questions, values=values, nickname=nickname,
        )

        if existing is not None:
            # 占位档案原地升级：key 与 id 冻结（会话靠 key 关联），回填向导内容
            row = existing
            row.nickname = nickname
            row.avatar_base64 = payload.avatar_base64 or row.avatar_base64
            row.context = payload.context
            row.answers = json.dumps(values, ensure_ascii=False)
            row.traits = json.dumps(traits, ensure_ascii=False)
            row.summary = summary
            row.confidence = 0.9  # 作答来源，置信度按自评口径
            row.version += 1
        else:
            row = PersonaProfile(
                owner_user_id=owner_user_id,
                key=key,
                nickname=nickname,
                avatar_base64=payload.avatar_base64 or "",
                context=payload.context,
                # 存清洗后的作答（score 为档位整数、choice 为枚举值），
                # 不存原始 payload —— 将来校验放宽也不会把未消毒值写进库
                answers=json.dumps(values, ensure_ascii=False),
                traits=json.dumps(traits, ensure_ascii=False),
                summary=summary,
                confidence=0.9,  # 作答来源，置信度按自评口径
                version=1,
            )
            db.add(row)
        try:
            db.commit()
        except IntegrityError as exc:
            # 与前面的查重之间存在并发窗口，撞唯一约束时按 409 处理而非 500
            db.rollback()
            raise DomainError(
                DomainErrorCode.CONFLICT, "已有同名人设，请换一个昵称", status_code=409
            ) from exc
        db.refresh(row)
        return self._view(row)

    def update(
        self,
        db: Session,
        *,
        owner_user_id: int,
        profile_id: int,
        payload: PersonaProfileUpdate,
    ) -> dict:
        row = self.get_or_404(db, owner_user_id=owner_user_id, profile_id=profile_id)
        if payload.nickname is not None:
            # 只改显示名；key 冻结，否则会话与历史消息关联会变孤儿
            nickname = payload.nickname.strip()
            if not nickname:
                # schema 的 min_length=1 挡不住全空白，这里兜底
                raise DomainError(
                    DomainErrorCode.VALIDATION_FAILED, "昵称不能全是空白", status_code=422
                )
            row.nickname = nickname
        if payload.avatar_base64 is not None:
            row.avatar_base64 = payload.avatar_base64
        db.commit()
        db.refresh(row)
        return self._view(row)

    def delete(self, db: Session, *, owner_user_id: int, profile_id: int) -> None:
        row = self.get_or_404(db, owner_user_id=owner_user_id, profile_id=profile_id)
        db.delete(row)
        db.commit()

    # ------------------------------------------------------------ LLM
    def _summarize(
        self, db: Session, *, owner_user_id: int, trace_id: str, llm,
        questions: dict, values: dict, nickname: str,
    ) -> str:
        """答题 → LLM 生成中文速写。失败视为建模未完成（可重试）。"""
        from ..clients.llm_client import chat_json

        lines = []
        for key, value in values.items():
            question = questions.get(key) or {}
            criteria = question.get("criteria")
            if question.get("type") == "score" and isinstance(criteria, list):
                try:
                    text = criteria[min(max(int(value), 0), len(criteria) - 1)]
                except (TypeError, ValueError):
                    text = str(value)
            else:
                text = (question.get("labels") or {}).get(value, value)
            lines.append(f"{key}: {text}")
        result = chat_json(
            endpoint_url=llm.endpoint_url,
            api_key=_providers.decrypt_key(llm),
            model=llm.model,
            protocol=llm.protocol,
            messages=[
                {"role": "system", "content": _SUMMARY_PROMPT},
                {
                    "role": "user",
                    "content": json.dumps(
                        {"nickname": nickname, "answers": lines}, ensure_ascii=False
                    ),
                },
            ],
        )
        summary = str(result.payload.get("summary") or "").strip() if result.ok else ""
        record_model_call(
            db, owner_user_id=owner_user_id, trace_id=trace_id, kind="llm",
            phase="persona_summary", provider=llm, result=result,
            request={"nickname": nickname, "answers": lines},
            response=result.payload, ok=bool(summary),
        )
        if not summary:
            raise DomainError(
                DomainErrorCode.LLM_UPSTREAM_ERROR, "人设生成未完成，请重试。", status_code=502
            )
        return summary[:300]
