"""场景解析：会话 → 场景 → 判断题包。

- 内置场景（romance / workplace）的题目**唯一来源是代码**（scenarios/ 包）；
- 自定义场景（kind=custom）的题目存库，``custom_pack`` 动态构建题包；
- 会话没挂场景（旧数据 / 通用场景）时回落恋爱包，保持既有行为。
"""

from __future__ import annotations

import json
import math

from sqlalchemy.orm import Session

from ..repositories.models import Conversation, Scenario
from ..scenarios.packs import DEFAULT_KIND, JudgePack, pack_for
from ..scenarios.reply_prompts import builtin_draft_prompt

# 发给 JEV 的题目字段；展示字段和导入时的其他元数据不进入协议请求。
_JEV_KEYS = ("type", "instructions", "criteria")


def effective_prompt(scenario: Scenario) -> str:
    """返回场景实际用于生成回复的提示词。旧自定义场景按人设题回退。"""
    if scenario.is_builtin:
        return builtin_draft_prompt(scenario.kind)
    if scenario.system_prompt.strip():
        return scenario.system_prompt.strip()
    persona = _load_questions(scenario.persona_questions)
    return builtin_draft_prompt("workplace" if "disc" in persona else "romance")


def kind_of(db: Session, conversation: Conversation) -> str:
    if conversation.scenario_id is None:
        return DEFAULT_KIND
    scenario = db.get(Scenario, conversation.scenario_id)
    if scenario is None:
        return DEFAULT_KIND
    return scenario.kind or DEFAULT_KIND


def pack_of(db: Session, conversation: Conversation) -> JudgePack:
    if conversation.scenario_id is not None:
        scenario = db.get(Scenario, conversation.scenario_id)
        if scenario is not None and scenario.kind == "custom":
            return custom_pack(scenario)
    return pack_for(kind_of(db, conversation))


def custom_pack(scenario: Scenario) -> JudgePack:
    """自定义场景 → 动态题包。

    题集 JSON 里可以带展示性字段（title / labels / level_labels），
    发送 JEV 前剥掉。标题缺省用 key；利害题 / 需求题按 key 猜，
    猜不到就不启用对应的拦截逻辑（宁缺毋滥）。
    """
    raw = _load_questions(scenario.judge_questions)
    questions: dict = {}
    titles: dict[str, str] = {}
    labels: dict[str, dict[str, str]] = {}
    level_labels: dict[str, tuple[str, ...]] = {}
    for key, question in raw.items():
        questions[key] = {k: question[k] for k in _JEV_KEYS if k in question}
        titles[key] = str(question.get("title") or key)
        if isinstance(question.get("labels"), dict):
            labels[key] = {str(k): str(v) for k, v in question["labels"].items()}
        if isinstance(question.get("level_labels"), list):
            level_labels[key] = tuple(str(item) for item in question["level_labels"])

    risk_key = next(
        (
            key
            for key, question in questions.items()
            if question.get("type") == "score" and any(
                word in key.lower() for word in ("danger", "stakes", "risk")
            )
        ),
        "",
    )
    needs_key = next((key for key in questions if "need" in key.lower()), "")
    risk_levels = questions.get(risk_key, {}).get("criteria") if risk_key else None
    risk_threshold = (
        max(1, math.ceil((len(risk_levels) - 1) * 0.8))
        if isinstance(risk_levels, list) else 8
    )

    def _label_of(key: str, value: str) -> str:
        return labels.get(key, {}).get(value, value)

    return JudgePack(
        kind="custom",
        questions=lambda: questions,
        panel_keys=tuple(list(questions)[:5]),
        question_titles=titles,
        label_of=_label_of,
        intensity_labels=tuple(level_labels.get(next(iter(level_labels), ""), ())),
        risk_key=risk_key,
        risk_threshold=risk_threshold,
        needs_key=needs_key,
        risk_word="风险",
        level_labels=level_labels,
    )


def _load_questions(raw: str) -> dict:
    try:
        parsed = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {}
    if not isinstance(parsed, dict):
        return {}
    return {str(key): value for key, value in parsed.items() if isinstance(value, dict)}


def validate_questions(raw: str) -> dict:
    """自定义题集的 JSON 校验：结构合法才能落库。

    每道题：``type`` ∈ {noul, choice, score}，且按题型带齐 criteria；
    可选 ``title``（中文标题）/ ``labels``（枚举值 → 中文）/ ``level_labels``（score 档位中文）。
    """
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"不是合法的 JSON：{exc}") from exc
    if not isinstance(parsed, dict) or not parsed:
        raise ValueError("题目集必须是一个非空的 JSON 对象")
    if len(parsed) > 20:
        raise ValueError("题目数不得超过 20 道")

    for key, question in parsed.items():
        if not isinstance(key, str) or not key.strip():
            raise ValueError("题目 key 必须是非空字符串")
        if not isinstance(question, dict):
            raise ValueError(f"题目 {key} 必须是对象")
        qtype = question.get("type")
        if qtype not in {"noul", "choice", "score"}:
            raise ValueError(f"题目 {key} 的 type 必须是 noul / choice / score")
        criteria = question.get("criteria")
        if qtype == "noul":
            if not isinstance(criteria, dict) or set(criteria) != {"true", "false"}:
                raise ValueError(f"题目 {key}（noul）的 criteria 需要 true / false 两项")
            if any(not isinstance(value, str) or not value.strip() for value in criteria.values()):
                raise ValueError(f"题目 {key}（noul）的选项说明不能为空")
        elif qtype == "choice":
            if not isinstance(criteria, dict) or not 2 <= len(criteria) <= 255:
                raise ValueError(f"题目 {key}（choice）的 criteria 需要 2 到 255 个选项")
            if any(
                not isinstance(name, str) or not name.strip()
                or not isinstance(value, str) or not value.strip()
                for name, value in criteria.items()
            ):
                raise ValueError(f"题目 {key}（choice）的选项名和说明不能为空")
        else:
            if not isinstance(criteria, list) or not 2 <= len(criteria) <= 10:
                raise ValueError(f"题目 {key}（score）的 criteria 需要 2 到 10 个档位")
            if any(not isinstance(value, str) or not value.strip() for value in criteria):
                raise ValueError(f"题目 {key}（score）的档位说明不能为空")
        instructions = question.get("instructions")
        if not isinstance(instructions, str) or not instructions.strip():
            raise ValueError(f"题目 {key} 缺少 instructions（英文判别说明）")
    return parsed


def validate_persona_questions(raw: str) -> dict:
    """人设题必须包含证据充足度与至少一道可保存的特质题。"""
    questions = validate_questions(raw)
    sufficient = questions.get("evidence_sufficient")
    if not isinstance(sufficient, dict) or sufficient.get("type") != "noul":
        raise ValueError("人设题集需要 evidence_sufficient（noul）题")
    if not any(
        key != "evidence_sufficient" and question.get("type") in {"choice", "score"}
        for key, question in questions.items()
    ):
        raise ValueError("人设题集至少需要一道 choice 或 score 特质题")
    return questions


def strip_meta(questions: dict) -> dict:
    """剥掉展示性字段，得到发给 JEV 的纯题集。"""
    return {
        key: {k: question[k] for k in _JEV_KEYS if k in question}
        for key, question in questions.items()
    }
