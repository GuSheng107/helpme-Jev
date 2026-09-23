"""场景解析：会话 → 场景 kind → 判断题包。

会话没挂场景（旧数据 / 通用场景）时回落恋爱包，保持既有行为。
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from ..repositories.models import Conversation, Scenario
from ..scenarios.packs import DEFAULT_KIND, JudgePack, pack_for


def kind_of(db: Session, conversation: Conversation) -> str:
    if conversation.scenario_id is None:
        return DEFAULT_KIND
    scenario = db.get(Scenario, conversation.scenario_id)
    if scenario is None:
        return DEFAULT_KIND
    return scenario.kind or DEFAULT_KIND


def pack_of(db: Session, conversation: Conversation) -> JudgePack:
    return pack_for(kind_of(db, conversation))
