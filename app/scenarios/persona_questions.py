"""人设题：恋爱情境与职场情境各一套。

大五用 IPIP Big-Five Factor Markers 的公开维度（Goldberg, 1992，公有领域）。
依恋、爱的语言、冲突风格、DISC 按各自公开定义写成判断题，不是照搬受版权保护的问卷原文。
MBTI 不进任何档案：设计已标明其科学性弱。

同一对象可能同时出现在恋爱与职场情境 —— 人设按「对象 × 情境」分开建档、分开更新，
互不覆盖（PersonasService.context）。
"""

from __future__ import annotations

from .builders import choice, noul, score

OCEAN_LEVELS = [
    "Very low.",
    "Low.",
    "Somewhat low.",
    "Slightly below average.",
    "Average.",
    "Slightly above average.",
    "Somewhat high.",
    "High.",
    "Very high.",
]

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

TRAIT_LABELS = {
    **OCEAN_LABELS,
    "attachment": "依恋倾向",
    "love_language": "爱的语言",
    "conflict_style": "冲突风格",
    "sensitivity": "情绪敏感",
    "disc": "DISC 倾向",
}

# 科学证据有限、仅供横向参考的框架（DESIGN.md §8.7：弱框架必须明示）
WEAK_SCIENCE_TRAITS = {"love_language", "disc"}


def romance_persona_questions(subject: str = "other") -> dict:
    """subject 为 other 时从对话推断；为 me 时按自评答题。"""
    who = "the user" if subject == "me" else "the other person"
    source = (
        "Use the self-report answers in state as the primary evidence."
        if subject == "me"
        else "Infer only from the conversation. Cite a concrete message when possible."
    )
    return {
        "openness": score(
            f"How open to new ideas and experiences is {who}? {source}",
            OCEAN_LEVELS,
        ),
        "conscientiousness": score(
            f"How organized, reliable, and duty-bound is {who}? {source}",
            OCEAN_LEVELS,
        ),
        "extraversion": score(
            f"How outgoing and energized by people is {who}? {source}",
            OCEAN_LEVELS,
        ),
        "agreeableness": score(
            f"How warm, cooperative, and considerate is {who}? {source}",
            OCEAN_LEVELS,
        ),
        "emotional_stability": score(
            f"How steady is {who} under stress, as opposed to easily upset? {source}",
            OCEAN_LEVELS,
        ),
        "attachment": choice(
            f"Which attachment pattern best fits {who} in this relationship? {source}",
            {
                "secure": "Comfortable with closeness and with independence; repairs conflict.",
                "anxious": "Seeks reassurance and fears being left or not cared about.",
                "avoidant": "Pulls back when closeness or emotion increases.",
                "disorganized": "Swings between seeking closeness and pushing it away.",
            },
        ),
        "love_language": choice(
            f"Which way of receiving care matters most to {who}? {source}",
            {
                "words": "Spoken or written appreciation and reassurance.",
                "time": "Undivided attention and shared time.",
                "gifts": "Thoughtful tangible tokens.",
                "service": "Helpful actions that lighten their load.",
                "touch": "Physical closeness and comfort.",
            },
        ),
        "conflict_style": choice(
            f"How does {who} usually handle disagreement? {source}",
            {
                "competing": "Pushes their own position.",
                "collaborating": "Looks for a solution that meets both sides.",
                "compromising": "Splits the difference.",
                "avoiding": "Withdraws or delays the issue.",
                "accommodating": "Gives in to keep the peace.",
            },
        ),
        "sensitivity": score(
            f"How strongly does ordinary emotion or criticism affect {who}? {source}",
            OCEAN_LEVELS,
        ),
        "evidence_sufficient": noul(
            f"Is there enough evidence to update {who}'s persona without guessing?",
            "Several distinct signals support the same reading.",
            "The record is too short, mixed, or only one ambiguous line.",
        ),
    }


def workplace_persona_questions(subject: str = "other") -> dict:
    """职场情境人设：大五 + DISC + 冲突风格（WORKFLOW.md 场景表）。

    依恋与爱的语言不进职场档案——那是亲密关系的维度；
    MBTI 同样不进：科学性弱（DESIGN.md §8.6）。
    """
    who = "the user" if subject == "me" else "the other person"
    source = (
        "Use the self-report answers in state as the primary evidence."
        if subject == "me"
        else "Infer only from workplace communication. Cite a concrete message when possible."
    )
    return {
        "openness": score(
            f"How open is {who} to new ideas, tools, and process changes at work? {source}",
            OCEAN_LEVELS,
        ),
        "conscientiousness": score(
            f"How organized, reliable, and deadline-driven is {who} at work? {source}",
            OCEAN_LEVELS,
        ),
        "extraversion": score(
            f"How outgoing and energized is {who} in group settings at work? {source}",
            OCEAN_LEVELS,
        ),
        "agreeableness": score(
            f"How cooperative and considerate is {who} toward colleagues? {source}",
            OCEAN_LEVELS,
        ),
        "emotional_stability": score(
            f"How steady is {who} under work pressure, as opposed to easily upset? {source}",
            OCEAN_LEVELS,
        ),
        "disc": choice(
            f"Which DISC profile best fits {who}'s work style? {source}",
            {
                "dominance": "Direct, fast, results first; impatient with slow processes.",
                "influence": "Warm, talkative, persuasive; energizes people and sells ideas.",
                "steadiness": "Patient, steady, loyal; values stable rhythm and team calm.",
                "conscientiousness": "Careful, precise, rule-bound; checks details twice.",
            },
        ),
        "conflict_style": choice(
            f"How does {who} usually handle disagreement at work? {source}",
            {
                "competing": "Pushes their own position, invokes authority or facts.",
                "collaborating": "Looks for a solution that meets both sides.",
                "compromising": "Splits the difference to close the matter.",
                "avoiding": "Defers, delays, or takes it offline.",
                "accommodating": "Gives in to keep the working relationship smooth.",
            },
        ),
        "evidence_sufficient": noul(
            f"Is there enough evidence to update {who}'s workplace persona without guessing?",
            "Several distinct signals support the same reading.",
            "The record is too short, mixed, or only one ambiguous line.",
        ),
    }


def persona_questions_for(context: str, subject: str = "other") -> dict:
    """按情境（romance / workplace）取人设题；未知情境回落恋爱。"""
    if context == "workplace":
        return workplace_persona_questions(subject)
    return romance_persona_questions(subject)


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
    }.get(key, {})
    return labels.get(str(value), str(value or "—"))
