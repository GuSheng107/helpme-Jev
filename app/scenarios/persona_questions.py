"""人设题：MBTI 四维度（恋爱与职场共用一套）。

2026-09-30 起人设问卷换成 MBTI 四个二选一维度（E/I、S/N、T/F、J/P），
把建档门槛从 7~8 题降到 4 题（用户决策，反转了旧设计「MBTI 不进档案」）。
MBTI 属弱科学框架：展示时必须带弱科学明示（WEAK_SCIENCE_TRAITS）。
旧的 OCEAN / 依恋 / 爱的语言 / DISC 标签保留，仅供历史档案行渲染。

同一对象可能同时出现在恋爱与职场情境 —— 人设按「对象 × 情境」分开建档、分开更新，
互不覆盖（PersonasService.context）。
"""

from __future__ import annotations

from .builders import choice, noul

OCEAN_LABELS = {
    "openness": "开放性",
    "conscientiousness": "尽责性",
    "extraversion": "外向性",
    "agreeableness": "宜人性",
    "emotional_stability": "情绪稳定",
}

ATTACHMENT_LABELS = {
    "secure": "安全型",
    "anxious": "焦虑型",
    "avoidant": "回避型",
    "disorganized": "混乱型",
}

LOVE_LANGUAGE_LABELS = {
    "words": "肯定的言辞",
    "time": "精心的时刻",
    "gifts": "接受礼物",
    "service": "服务的行动",
    "touch": "身体接触",
}

CONFLICT_LABELS = {
    "competing": "竞争",
    "collaborating": "协作",
    "compromising": "妥协",
    "avoiding": "回避",
    "accommodating": "迁就",
}

DISC_LABELS = {
    "dominance": "支配型（D）",
    "influence": "影响型（I）",
    "steadiness": "稳健型（S）",
    "conscientiousness": "严谨型（C）",
}

MBTI_LABELS = {
    "mbti_ei": "MBTI 精力取向",
    "mbti_sn": "MBTI 信息偏好",
    "mbti_tf": "MBTI 决策偏好",
    "mbti_jp": "MBTI 生活方式",
}

MBTI_OPTION_LABELS = {
    "mbti_ei": {"E": "外向（E）", "I": "内向（I）"},
    "mbti_sn": {"S": "实感（S）", "N": "直觉（N）"},
    "mbti_tf": {"T": "思考（T）", "F": "情感（F）"},
    "mbti_jp": {"J": "判断（J）", "P": "知觉（P）"},
}

TRAIT_LABELS = {
    **OCEAN_LABELS,
    "attachment": "依恋倾向",
    "love_language": "爱的语言",
    "conflict_style": "冲突风格",
    "sensitivity": "情绪敏感",
    "disc": "DISC 倾向",
    **MBTI_LABELS,
}

# 科学证据有限、仅供横向参考的框架（DESIGN.md §8.7：弱框架必须明示）
WEAK_SCIENCE_TRAITS = {"love_language", "disc", "mbti_ei", "mbti_sn", "mbti_tf", "mbti_jp"}


def mbti_persona_questions(subject: str = "other") -> dict:
    """MBTI 四题（每维度一道二选一）+ 证据充分性判断。

    subject 为 other 时从对话推断；为 me 时按自评答题。
    """
    who = "the user" if subject == "me" else "the other person"
    source = (
        "Use the self-report answers in state as the primary evidence."
        if subject == "me"
        else "Infer only from the conversation. Cite a concrete message when possible."
    )
    return {
        "mbti_ei": choice(
            f"Where does {who} get energy: from people and shared activity, or from quiet and solitude? {source}",
            {
                "E": "Outward: energized by people, action, and group settings.",
                "I": "Inward: energized by quiet, solo time, and small circles.",
            },
        ),
        "mbti_sn": choice(
            f"Does {who} focus on concrete facts and details, or on ideas and possibilities? {source}",
            {
                "S": "Concrete: trusts facts, details, and hands-on experience.",
                "N": "Abstract: drawn to ideas, patterns, and possibilities.",
            },
        ),
        "mbti_tf": choice(
            f"When deciding, does {who} weigh logic and consistency first, or people's feelings and harmony first? {source}",
            {
                "T": "Logic-first: weighs pros, cons, and what is objectively right.",
                "F": "People-first: weighs feelings, values, and relationships.",
            },
        ),
        "mbti_jp": choice(
            f"Does {who} prefer plans and closure, or flexibility and keeping options open? {source}",
            {
                "J": "Planner: likes decisions made and schedules kept.",
                "P": "Flexible: prefers options open and adapts on the fly.",
            },
        ),
        "evidence_sufficient": noul(
            f"Is there enough evidence to pin down all four MBTI preferences of {who} without guessing?",
            "Each of the four preferences has at least one concrete signal.",
            "One or more preferences would be a pure guess on this record.",
        ),
    }


def persona_questions_for(context: str, subject: str = "other") -> dict:
    """人设题：恋爱与职场共用同一套 MBTI 四题；情境只影响档案归类与展示。未知情境同套。"""
    return mbti_persona_questions(subject)


def trait_text(key: str, value: object) -> str:
    if key in OCEAN_LABELS or key == "sensitivity":
        try:
            level = int(round(float(value)))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return "—"
        return f"{level}/8"
    labels = {
        "attachment": ATTACHMENT_LABELS,
        "love_language": LOVE_LANGUAGE_LABELS,
        "conflict_style": CONFLICT_LABELS,
        "disc": DISC_LABELS,
        **MBTI_OPTION_LABELS,
    }.get(key, {})
    return labels.get(str(value), str(value or "—"))
