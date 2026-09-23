"""System One 题目构造器。

三种题型：``noul``（是非概率）/ ``choice``（分类 + 概率）/ ``score``（评分）。
每道题的 instructions 末尾追加 ``BACKGROUND_NOTE``（抄 Jarvis）：
让 background 里的事实被当成给定上下文，而不是跑题。
"""

from __future__ import annotations

BACKGROUND_NOTE = " Facts given in background are provided context, not off-topic."


def noul(instructions: str, true_criteria: str, false_criteria: str) -> dict:
    return {
        "type": "noul",
        "instructions": instructions + BACKGROUND_NOTE,
        "criteria": {"true": true_criteria, "false": false_criteria},
    }


def choice(instructions: str, criteria: dict[str, str]) -> dict:
    if not criteria:
        raise ValueError("choice 至少需要一个选项")
    if len(criteria) > 255:
        raise ValueError("choice 选项不得超过 255 个")
    return {
        "type": "choice",
        "instructions": instructions + BACKGROUND_NOTE,
        "criteria": dict(criteria),
    }


def score(instructions: str, levels: list[str]) -> dict:
    if not 2 <= len(levels) <= 10:
        raise ValueError("score 档位必须在 2 到 10 之间")
    return {
        "type": "score",
        "instructions": instructions + BACKGROUND_NOTE,
        "criteria": list(levels),
    }
