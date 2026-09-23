"""场景注册表：kind → 判断题包。

恋爱与职场共用一套面板渲染逻辑（present_answers），差异全部收在
JudgePack 里：题目、标题、标签、利害题的 key 与阈值、需求题的 key。
新增场景 = 加一个题目模块 + 在这里注册。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from .questions_romance import (
    HIGH_DANGER_LEVEL as _ROMANCE_RISK_THRESHOLD,
)
from .questions_romance import (
    INTENSITY_LABELS as _ROMANCE_INTENSITY,
)
from .questions_romance import (
    PANEL_KEYS as _ROMANCE_PANEL,
)
from .questions_romance import (
    QUESTION_TITLES as _ROMANCE_TITLES,
)
from .questions_romance import label_of as _romance_label_of
from .questions_romance import romance_questions
from .questions_workplace import (
    HIGH_STAKES_LEVEL as _WORKPLACE_RISK_THRESHOLD,
)
from .questions_workplace import (
    INTENSITY_LABELS as _WORKPLACE_INTENSITY,
)
from .questions_workplace import (
    PANEL_KEYS as _WORKPLACE_PANEL,
)
from .questions_workplace import (
    QUESTION_TITLES as _WORKPLACE_TITLES,
)
from .questions_workplace import label_of as _workplace_label_of
from .questions_workplace import workplace_questions

DEFAULT_KIND = "romance"


@dataclass(frozen=True)
class JudgePack:
    kind: str
    questions: Callable[[], dict]
    panel_keys: tuple[str, ...]
    question_titles: dict[str, str]
    label_of: Callable[[str, str], str]
    intensity_labels: tuple[str, ...]
    # 利害题（危险度 / 利害程度）：≥ 阈值时不建议直接落文字；空串 = 该场景无此题
    risk_key: str
    risk_threshold: int
    # 需求题的 key（恋爱沿用 she_needs，职场用 other_needs；空串 = 没有）
    needs_key: str
    risk_word: str
    # score 题的中文档位（如情绪强度 5 档）；key 不在表里则显示 x/N
    level_labels: dict[str, tuple[str, ...]] = field(default_factory=dict)


ROMANCE_PACK = JudgePack(
    kind="romance",
    questions=romance_questions,
    panel_keys=tuple(_ROMANCE_PANEL),
    question_titles=dict(_ROMANCE_TITLES),
    label_of=_romance_label_of,
    intensity_labels=tuple(_ROMANCE_INTENSITY),
    risk_key="danger_level",
    risk_threshold=_ROMANCE_RISK_THRESHOLD,
    needs_key="she_needs",
    risk_word="危险",
    level_labels={"emotion_intensity": tuple(_ROMANCE_INTENSITY)},
)

WORKPLACE_PACK = JudgePack(
    kind="workplace",
    questions=workplace_questions,
    panel_keys=tuple(_WORKPLACE_PANEL),
    question_titles=dict(_WORKPLACE_TITLES),
    label_of=_workplace_label_of,
    intensity_labels=tuple(_WORKPLACE_INTENSITY),
    risk_key="stakes_level",
    risk_threshold=_WORKPLACE_RISK_THRESHOLD,
    needs_key="other_needs",
    risk_word="利害",
    level_labels={"emotion_intensity": tuple(_WORKPLACE_INTENSITY)},
)

_PACKS: dict[str, JudgePack] = {
    ROMANCE_PACK.kind: ROMANCE_PACK,
    WORKPLACE_PACK.kind: WORKPLACE_PACK,
}


def pack_for(kind: str | None) -> JudgePack:
    """未知 kind 回落到恋爱包：旧会话没挂场景时保持原行为。"""
    return _PACKS.get(kind or "", _PACKS[DEFAULT_KIND])


def all_packs() -> dict[str, JudgePack]:
    return dict(_PACKS)
