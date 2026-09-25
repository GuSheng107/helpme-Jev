"""通用决策工作台：自由编题 → 翻译桥 → JEV → 三题型可视化。

与聊天判断共用「LLM 表达、Jev 决策」的分工：题目和上下文先译成英文
（Jev 对中文不友好），结果枚举 / 概率原样返回，由前端画成
noul 概率条 / choice 概率条形图 / score 刻度条。
"""

from __future__ import annotations

import json
import math
from collections.abc import Iterator

from sqlalchemy.orm import Session

from ..clients import jev_client
from ..clients.llm_client import UpstreamResult, chat_json
from ..domain.errors import DomainError, DomainErrorCode
from ..repositories.models import CallLog
from ..scenarios.builders import choice, noul, score
from .analyze_service import AnalyzeService
from .provider_service import ProviderService

_providers = ProviderService()
_analyze = AnalyzeService()


def _confidence(value: object) -> float | None:
    """JEV answers 里可选的置信度：合法浮点原样返回，其余按无值处理。"""
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and 0 <= number <= 1 else None

# 翻译桥提示词刻意写细：字段逐个交代、规则逐条列出、样例锚定格式。
# 指引越具体，模型越少自由发挥，实测比含糊指令更快、也更少触发重试。
_TRANSLATE_PROMPT = """You translate a decision question into English for a downstream reasoning engine. You only translate: never answer the question, never judge it, never add explanation.

Input: one JSON object with exactly these keys:
- question: string, never empty
- context: string, may be ""
- options: array of strings, may be []

Do this in order:
1. question: translate into clear, literal English. Keep it a question and keep its meaning and scope unchanged.
2. context: translate into English. If it is "", keep "".
3. options: translate each item into English, one by one, in the given order.

Rules:
- Translate field by field. Never merge fields, never move text between them.
- Keep the option count identical: never add, drop, reorder, or renumber options.
- Never return an empty question or an empty option. If a source field has content, its translation must have content.
- Keep short categorical answers short: 是/不是 translate to yes/no.
- Keep proper nouns (people, places, brands) as they are, or use their common English spelling.
- Keep numbers, units, and dates unchanged.
- No extra keys, no markdown, no code fence, no notes.

Output: exactly one JSON object with the same three keys in the same order, starting with { and ending with }:
{"question":"English question","context":"English context","options":["English option 1"]}

Example
Input: {"question":"这两个方案哪个更好？","context":"预算有限","options":["先做原型","先写文档"]}
Output: {"question":"Which of these two options is better?","context":"The budget is limited.","options":["Build a prototype first","Write the document first"]}"""


# 两个 JSON 契约的受约束解码 schema：网关支持就由解码器保证结构，
# 少一次"字段缺失 → 整请求重发"的往返（不支持时 chat_json 会自动降级）。
_TRANSLATE_SCHEMA = {
    "type": "object",
    "properties": {
        "question": {"type": "string"},
        "context": {"type": "string"},
        "options": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["question", "context", "options"],
    "additionalProperties": False,
}

_POLISH_SCHEMA = {
    "type": "object",
    "properties": {
        "question": {"type": "string"},
        "options": {"type": "array", "items": {"type": "string"}},
        "context": {"type": "string"},
    },
    "required": ["question", "options", "context"],
    "additionalProperties": False,
}

_POLISH_PROMPT = """Polish a decision form in the original language of each field.
Return exactly ONE valid JSON object with exactly these fields and no other text:
{"question":"polished question","options":["polished option"],"context":"polished context"}
Keep the question answerable without answering it. Correct wording and ambiguity, but preserve intent.
Preserve every option's meaning, order, count, and mutual exclusivity. Do not turn one choice into another.
Keep short categorical answers such as 是/不是 or yes/no unchanged.
Do not invent facts or add background. Keep every empty option and empty context empty.
Do not translate or add markdown. All fields must be strings except options, which is an array of strings."""

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
    def polish(
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
        if question_type != "choice" and options:
            raise DomainError(
                DomainErrorCode.VALIDATION_FAILED, "仅选择题可提交选项", status_code=422
            )
        source = {"question": question, "options": options, "context": context}
        llm = _analyze._require_provider(db, owner_user_id=owner_user_id, kind="llm")
        result: UpstreamResult | None = None
        polished: dict | None = None
        for attempt in range(2):
            result = chat_json(
                endpoint_url=llm.endpoint_url,
                api_key=_providers.decrypt_key(llm),
                model=llm.model,
                protocol=llm.protocol,
                response_schema=_POLISH_SCHEMA,
                messages=[
                    {"role": "system", "content": _POLISH_PROMPT},
                    {"role": "user", "content": json.dumps(source, ensure_ascii=False)},
                    *(
                        [{"role": "user", "content": "The previous response was invalid. Return only the required JSON object."}]
                        if attempt else []
                    ),
                ],
            )
            if result.ok:
                polished = self._polish_fields(result.payload, source)
                if polished is not None:
                    break
                result.ok = False
                result.detail = "润色结果字段不完整或选项数量不匹配"
                result.error_code = "PROTOCOL_MISMATCH"
            if result.error_code != "PROTOCOL_MISMATCH":
                break
        if result is None:
            raise DomainError(DomainErrorCode.LLM_UPSTREAM_ERROR, "润色未完成，请重试。", status_code=502)
        self._log(
            db, owner_user_id=owner_user_id, trace_id=trace_id,
            kind="llm", phase="polish", provider=llm, result=result,
            request={"question_type": question_type, **source},
        )
        db.commit()
        if polished is None:
            raise DomainError(DomainErrorCode.LLM_UPSTREAM_ERROR, "润色未完成，请重试。", status_code=502)
        return polished

    @staticmethod
    def _polish_fields(data: dict, source: dict) -> dict | None:
        if set(data) != {"question", "options", "context"}:
            return None
        question, options, context = data["question"], data["options"], data["context"]
        if not isinstance(question, str) or not question.strip() or len(question) > 2000:
            return None
        if not isinstance(context, str) or len(context) > 2000:
            return None
        if bool(source["context"].strip()) != bool(context.strip()):
            return None
        if not isinstance(options, list) or len(options) != len(source["options"]):
            return None
        for original, revised in zip(source["options"], options):
            if not isinstance(revised, str) or len(revised) > 2000:
                return None
            if bool(original.strip()) != bool(revised.strip()):
                return None
        return {
            "question": question.strip(),
            "options": [item.strip() for item in options],
            "context": context.strip(),
        }

    @staticmethod
    def validate(question_type: str, options: list[str]) -> list[str]:
        """清洗并校验选项，不合法时抛 422。

        单独可调用：流式接口要在开流前拿到校验结果，才能回真正的状态码。
        """
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
        return cleaned

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
        """非流式入口：把阶段事件跑到最后一步。"""
        for event in self.decide_events(
            db,
            owner_user_id=owner_user_id,
            question=question,
            question_type=question_type,
            options=options,
            context=context,
            trace_id=trace_id,
        ):
            if event["stage"] == "done":
                return event["payload"]
        raise DomainError(DomainErrorCode.INTERNAL_ERROR, "判断未完成，请重试。", status_code=500)

    def decide_events(
        self,
        db: Session,
        *,
        owner_user_id: int,
        question: str,
        question_type: str,
        options: list[str],
        context: str,
        trace_id: str,
    ) -> Iterator[dict]:
        """按阶段产出事件：plan → [translate_done] → done。

        先发 plan 交代这次要走几步（纯英文输入没有翻译桥，只剩决策一步），
        事件与真实进度一一对应，前端据此画分阶段 loading。
        """
        cleaned = self.validate(question_type, options)
        jev = _analyze._require_provider(db, owner_user_id=owner_user_id, kind="jev")

        payload = {
            "question": question.strip(),
            "context": context.strip(),
            "options": cleaned,
            "question_type": question_type,
        }
        bridge_input = {key: payload[key] for key in ("question", "context", "options")}
        # 英文输入直接交给 JEV；无意义的翻译请求曾产生多次 200 + 非 JSON 错误。
        needs_bridge = any(not text.isascii() for text in (
            payload["question"], payload["context"], *cleaned
        ))
        yield {"stage": "plan", "steps": ["translate", "decide"] if needs_bridge else ["decide"]}

        translated: UpstreamResult | None = None
        llm = None
        if needs_bridge:
            llm = _analyze._require_provider(db, owner_user_id=owner_user_id, kind="llm")
            question_en = context_en = ""
            options_en: list[str] = []
            for attempt in range(2):
                translated = chat_json(
                    endpoint_url=llm.endpoint_url,
                    api_key=_providers.decrypt_key(llm),
                    model=llm.model,
                    protocol=llm.protocol,
                    response_schema=_TRANSLATE_SCHEMA,
                    messages=[
                        {"role": "system", "content": _TRANSLATE_PROMPT},
                        {"role": "user", "content": json.dumps(bridge_input, ensure_ascii=False)},
                        *(
                            [
                                {
                                    "role": "user",
                                    "content": (
                                        "The previous answer was invalid: keys were missing or mistyped, "
                                        "or the option count changed. Return only the JSON object, with "
                                        "exactly the three keys and the same number of options as the input."
                                    ),
                                }
                            ]
                            if attempt else []
                        ),
                    ],
                )
                if translated.ok:
                    valid = self._translation_fields(translated.payload, bridge_input)
                    if valid is not None:
                        question_en, context_en, options_en = valid
                        break
                    translated.ok = False
                    translated.detail = "翻译结果字段不完整或类型不正确"
                    translated.error_code = "PROTOCOL_MISMATCH"
                if translated.error_code != "PROTOCOL_MISMATCH":
                    break
            if not question_en:
                self._log(
                    db, owner_user_id=owner_user_id, trace_id=trace_id,
                    kind="llm", phase="translate", provider=llm,
                    result=translated, request=bridge_input,
                )
                db.commit()
                raise DomainError(
                    DomainErrorCode.LLM_UPSTREAM_ERROR,
                    "问题转换未完成，请重试。", status_code=502,
                )
            yield {"stage": "translate_done"}
        else:
            question_en = payload["question"]
            context_en = payload["context"]
            options_en = cleaned

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
        presented: dict | None = None
        if result.ok:
            try:
                answer = result.answers.get(_QUESTION_KEY) or {}
                presented = self._present(question_type, answer, cleaned)
            except DomainError as exc:
                result.ok = False
                result.error_code = "PROTOCOL_MISMATCH"
                result.detail = exc.message
        if llm is not None and translated is not None:
            self._log(
                db, owner_user_id=owner_user_id, trace_id=trace_id,
                kind="llm", phase="translate", provider=llm,
                result=translated, request=bridge_input,
            )
        self._log(
            db, owner_user_id=owner_user_id, trace_id=trace_id,
            kind="jev", phase="decide", provider=jev, result=result,
            request={"state": state, "questions": questions, "user_input": payload},
            presented=presented,
        )
        db.commit()

        if not result.ok:
            code = (
                DomainErrorCode.PROTOCOL_MISMATCH
                if result.error_code == "PROTOCOL_MISMATCH"
                else DomainErrorCode.JEV_UPSTREAM_ERROR
            )
            raise DomainError(code, "判断未完成，请重试。", status_code=502)

        yield {
            "stage": "done",
            "payload": {
                "trace_id": trace_id,
                "model": result.model_reported,
                "latency_ms": result.latency_ms,
                "kind": question_type,
                "result": presented,
            },
        }

    @staticmethod
    def _translation_fields(
        data: dict, source: dict
    ) -> tuple[str, str, list[str]] | None:
        question = data.get("question")
        context = data.get("context")
        options = data.get("options")
        if not isinstance(question, str) or not question.strip():
            return None
        if not isinstance(context, str) or (source["context"] and not context.strip()):
            return None
        if not isinstance(options, list) or len(options) != len(source["options"]):
            return None
        if any(not isinstance(option, str) or not option.strip() for option in options):
            return None
        return question.strip(), context.strip(), [option.strip() for option in options]

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

    def _present(
        self, question_type: str, answer: dict, options: list[str],
    ) -> dict:
        if not isinstance(answer, dict) or not answer:
            raise DomainError(DomainErrorCode.PROTOCOL_MISMATCH, "判断结果无法解析", status_code=502)
        if question_type == "noul":
            try:
                prob = float(answer["noul"])
            except (KeyError, TypeError, ValueError) as exc:
                raise DomainError(DomainErrorCode.PROTOCOL_MISMATCH, "是非结果无法解析", status_code=502) from exc
            if not math.isfinite(prob) or not 0 <= prob <= 1:
                raise DomainError(DomainErrorCode.PROTOCOL_MISMATCH, "是非概率超出范围", status_code=502)
            return {
                "kind": "noul",
                "probability": prob,
                "percent": round(prob * 100),
                "text": "是" if prob >= 0.5 else "否",
            }
        if question_type == "choice":
            probabilities = answer.get("probabilities")
            bars = []
            if isinstance(probabilities, dict):
                for key, raw in probabilities.items():
                    suffix = str(key).removeprefix("option_")
                    if not str(key).startswith("option_") or not suffix.isdigit():
                        continue
                    index = int(suffix)
                    if not 0 <= index < len(options):
                        continue
                    try:
                        value = float(raw)
                    except (TypeError, ValueError):
                        continue
                    if math.isfinite(value) and 0 <= value <= 1:
                        bars.append({"key": str(key), "label": options[index], "value": value})
            if not bars and isinstance(answer.get("choice"), str):
                chosen = answer["choice"]
                suffix = chosen.removeprefix("option_")
                if chosen.startswith("option_") and suffix.isdigit():
                    index = int(suffix)
                    if 0 <= index < len(options):
                        bars = [{"key": chosen, "label": options[index], "value": 1.0}]
            if not bars:
                raise DomainError(DomainErrorCode.PROTOCOL_MISMATCH, "选择结果无法解析", status_code=502)
            bars.sort(key=lambda item: item["value"], reverse=True)
            # Jev 的 choice 才是它的答案：概率并列（如无信息时的 50/50）时不能再按首个最高概率选。
            chosen = answer.get("choice")
            top = next(
                (item["label"] for item in bars if item["key"] == chosen),
                bars[0]["label"],
            )
            return {"kind": "choice", "bars": bars, "top": top, "confidence": _confidence(answer.get("confidence"))}

        raw_max = len(DEFAULT_SCORE_LEVELS) - 1
        try:
            value = float(answer["score"])
        except (KeyError, TypeError, ValueError) as exc:
            raise DomainError(DomainErrorCode.PROTOCOL_MISMATCH, "评分结果无法解析", status_code=502) from exc
        if not math.isfinite(value) or not 0 <= value <= raw_max:
            raise DomainError(DomainErrorCode.PROTOCOL_MISMATCH, "评分超出档位范围", status_code=502)
        converted = round(value / raw_max * 10, 2)
        return {
            "kind": "score",
            "value": value,
            "scale_max": raw_max,
            "display_value": converted,
            "display_max": 10,
            "confidence": _confidence(answer.get("confidence")),
            "text": f"{converted:.2f}",
        }

    def _log(
        self, db, *, owner_user_id, trace_id, kind, phase, provider, result, request,
        presented: dict | None = None,
    ) -> None:
        from ..core.logging import dump_body, pick_level

        if kind == "jev":
            response = {"answers": getattr(result, "answers", {})}
            if presented is not None:
                response["presented"] = presented
            degradation = str(getattr(result, "degradation", ""))
            if degradation:
                response["degradation"] = degradation
            model = getattr(result, "model_reported", "") or provider.model
        else:
            response = getattr(result, "payload", {})
            model = provider.model
        request_body, request_cut = dump_body(request)
        response_body, response_cut = dump_body(response)
        truncated = request_cut or response_cut
        db.add(
            CallLog(
                owner_user_id=owner_user_id,
                trace_id=trace_id,
                kind=kind,
                phase=phase,
                level=pick_level(
                    ok=result.ok,
                    degraded=truncated or bool(getattr(result, "degraded", False)),
                ),
                endpoint_url=provider.endpoint_url,
                model=model,
                request_body=request_body,
                response_body=response_body,
                truncated=truncated,
                status_code=result.status_code,
                latency_ms=result.latency_ms,
                error="" if getattr(result, "ok", False) else str(getattr(result, "detail", "")),
            )
        )
