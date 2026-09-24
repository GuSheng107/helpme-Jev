"""通用决策工作台：自由编题 → 翻译桥 → JEV → 三题型可视化。

与聊天判断共用「LLM 表达、Jev 决策」的分工：题目和上下文先译成英文
（Jev 对中文不友好），结果枚举 / 概率原样返回，由前端画成
noul 概率条 / choice 概率条形图 / score 刻度条。
"""

from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ..clients import jev_client
from ..clients.llm_client import chat_json
from ..domain.errors import DomainError, DomainErrorCode
from ..repositories.models import CallLog
from ..scenarios.builders import choice, noul, score
from .analyze_service import AnalyzeService
from .provider_service import ProviderService

_providers = ProviderService()
_analyze = AnalyzeService()

_TRANSLATE_PROMPT = """Translate a decision question into precise English for a decision model.
Return JSON: {"question": "...", "context": "...", "options": ["...", ...]}
Translate the question and context faithfully, preserving nuance; keep the options
in the same order and return an empty list when there are none. "context" is "" when not given."""

# 评分题默认 10 档（与危险度刻度一致，用户不必自己编档位）
DEFAULT_SCORE_LEVELS = [
    "Very low.",
    "Low.",
    "Somewhat low.",
    "Below average.",
    "Average.",
    "Above average.",
    "Somewhat high.",
    "High.",
    "Very high.",
    "Extreme.",
]

_QUESTION_KEY = "decision"


class DecideService:
    def decide(
        self,
        db: Session,
        *,
        owner_user_id: int,
        question: str,
        question_type: str,
        options: list[str],
        context: str,
        trace_id: str,
    ) -> dict:
        cleaned = [item.strip() for item in options if item.strip()]
        if question_type == "choice":
            if len(cleaned) < 2:
                raise DomainError(
                    DomainErrorCode.VALIDATION_FAILED, "选择题至少要有两个选项", status_code=422
                )
            if len(set(cleaned)) != len(cleaned):
                raise DomainError(
                    DomainErrorCode.VALIDATION_FAILED, "选项不能重复", status_code=422
                )

        llm = _analyze._require_provider(db, owner_user_id=owner_user_id, kind="llm")
        jev = _analyze._require_provider(db, owner_user_id=owner_user_id, kind="jev")

        payload = {"question": question.strip(), "context": context.strip(), "options": cleaned}
        translated = chat_json(
            endpoint_url=llm.endpoint_url,
            api_key=_providers.decrypt_key(llm),
            model=llm.model,
            protocol=llm.protocol,
            messages=[
                {"role": "system", "content": _TRANSLATE_PROMPT},
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
            ],
        )
        question_en = context_en = ""
        options_en: list[str] = []
        if translated.ok:
            question_en = str(translated.payload.get("question") or "").strip()
            context_en = str(translated.payload.get("context") or "").strip()
            raw_options = translated.payload.get("options")
            if isinstance(raw_options, list):
                options_en = [str(item).strip() for item in raw_options]
        if not question_en or (question_type == "choice" and len(options_en) < len(cleaned)):
            self._log(
                db,
                owner_user_id=owner_user_id,
                trace_id=trace_id,
                kind="llm",
                phase="translate",
                provider=llm,
                result=translated,
                request=payload,
            )
            db.commit()
            raise DomainError(DomainErrorCode.LLM_UPSTREAM_ERROR, "问题转换未完成，请重试。", status_code=502)

        state: dict = {"question": question_en}
        if context_en:
            state["context"] = context_en
        questions = {_QUESTION_KEY: self._build_question(question_type, question_en, options_en)}
        result = jev_client.call_with_fallback(
            endpoint_url=jev.endpoint_url,
            api_key=_providers.decrypt_key(jev),
            model=jev.model,
            state=state,
            questions=questions,
        )
        self._log(
            db,
            owner_user_id=owner_user_id,
            trace_id=trace_id,
            kind="llm",
            phase="translate",
            provider=llm,
            result=translated,
            request=payload,
        )
        self._log(
            db,
            owner_user_id=owner_user_id,
            trace_id=trace_id,
            kind="jev",
            phase="decide",
            provider=jev,
            result=result,
            request={"state": state, "questions": questions},
        )
        db.commit()

        if not result.ok:
            code = (
                DomainErrorCode.PROTOCOL_MISMATCH
                if result.error_code == "PROTOCOL_MISMATCH"
                else DomainErrorCode.JEV_UPSTREAM_ERROR
            )
            raise DomainError(code, "判断未完成，请重试。", status_code=502)

        answer = result.answers.get(_QUESTION_KEY) or {}
        return {
            "trace_id": trace_id,
            "model": result.model_reported,
            "latency_ms": result.latency_ms,
            "kind": question_type,
            "result": self._present(question_type, answer, cleaned),
        }

    def _build_question(self, question_type: str, question_en: str, options_en: list[str]) -> dict:
        if question_type == "noul":
            return noul(
                f"Answer the question strictly from the given context and common sense: {question_en}",
                "The correct answer is yes / true.",
                "The correct answer is no / false.",
            )
        if question_type == "choice":
            return choice(
                f"Which option best answers the question: {question_en}",
                {f"option_{index}": text for index, text in enumerate(options_en)},
            )
        return score(f"Rate the answer on the scale: {question_en}", DEFAULT_SCORE_LEVELS)

    def _present(self, question_type: str, answer: dict, options: list[str]) -> dict:
        if not isinstance(answer, dict) or not answer:
            raise DomainError(DomainErrorCode.PROTOCOL_MISMATCH, "判断结果无法解析", status_code=502)
        if question_type == "noul":
            try:
                prob = float(answer.get("noul") or 0.0)
            except (TypeError, ValueError):
                prob = 0.0
            return {
                "kind": "noul",
                "probability": prob,
                "percent": round(max(0.0, min(1.0, prob)) * 100),
                "text": "是" if prob >= 0.5 else "否",
            }
        if question_type == "choice":
            probabilities = answer.get("probabilities")
            bars = []
            if isinstance(probabilities, dict):
                for key, value in probabilities.items():
                    index = int(str(key).rsplit("_", 1)[-1]) if str(key).startswith("option_") else -1
                    label = options[index] if 0 <= index < len(options) else str(key)
                    bars.append({"key": str(key), "label": label, "value": float(value or 0)})
            elif isinstance(answer.get("choice"), str):
                chosen = str(answer["choice"])
                index = int(chosen.rsplit("_", 1)[-1]) if chosen.startswith("option_") else -1
                bars = [
                    {
                        "key": chosen,
                        "label": options[index] if 0 <= index < len(options) else chosen,
                        "value": 1.0,
                    }
                ]
            if not bars:
                raise DomainError(DomainErrorCode.PROTOCOL_MISMATCH, "判断结果无法解析", status_code=502)
            bars.sort(key=lambda item: item["value"], reverse=True)
            return {"kind": "choice", "bars": bars, "top": bars[0]["label"]}
        # score
        try:
            value = float(answer.get("score") or 0.0)
        except (TypeError, ValueError):
            value = 0.0
        level = int(round(max(0.0, min(9.0, value))))
        return {
            "kind": "score",
            "value": level,
            "scale_max": len(DEFAULT_SCORE_LEVELS) - 1,
            "text": f"{level}/{len(DEFAULT_SCORE_LEVELS) - 1}",
        }

    def _log(self, db, *, owner_user_id, trace_id, kind, phase, provider, result, request) -> None:
        from ..core.logging import sanitize_log_value

        if kind == "jev":
            response = {"answers": getattr(result, "answers", {})}
            model = getattr(result, "model_reported", "") or provider.model
        else:
            response = getattr(result, "payload", {})
            model = provider.model
        db.add(
            CallLog(
                owner_user_id=owner_user_id,
                trace_id=trace_id,
                kind=kind,
                phase=phase,
                level="info" if result.ok else "error",
                endpoint_url=provider.endpoint_url,
                model=model,
                request_body=json.dumps(sanitize_log_value(request), ensure_ascii=False)[:65536],
                response_body=json.dumps(sanitize_log_value(response), ensure_ascii=False)[:65536],
                status_code=result.status_code,
                latency_ms=result.latency_ms,
                error="" if getattr(result, "ok", False) else str(getattr(result, "detail", "")),
            )
        )
