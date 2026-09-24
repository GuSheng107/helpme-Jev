"""使用当前用户已启用的表达模型生成可编辑的场景题集。"""

from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ..clients.llm_client import chat_json
from ..domain.errors import DomainError, DomainErrorCode
from .analyze_service import AnalyzeService
from .provider_service import ProviderService
from .scenario_service import validate_persona_questions, validate_questions

_ANALYZE = AnalyzeService()
_PROVIDERS = ProviderService()

_BASE_PROMPT = """Generate a System One / JEV question set for the user's scenario.
Return ONE JSON object. Its root keys are unique snake_case question ids; each value has:
- type: "noul", "choice", or "score";
- instructions: a clear English judgment instruction grounded in conversation evidence;
- criteria: {"true":"...","false":"..."} for noul, 2-6 named English options for choice, or 2-10 ordered English level descriptions for score;
- title: a short Chinese display label;
- labels: for choice, map every option key to a Chinese label; for score, add level_labels as a Chinese list matching criteria length.
Keep the set small and useful. Do not add markdown, examples, or commentary.
"""
_KIND_PROMPTS = {
    "judge": (
        "Generate 4 to 6 judgment questions about the latest exchange, its intent, risk, "
        "best next action, and what the other person needs. Prefer the keys true_intent, "
        "best_action, other_needs, and risk_level where relevant. Include an actionable choice question."
    ),
    "persona": (
        "Generate 3 to 5 profile trait questions using choice or score, plus a required "
        "evidence_sufficient noul question that checks whether there is enough evidence "
        "in the conversation. Keep instructions neutral for both the user and the other person."
    ),
}


def generate_question_set(
    db: Session,
    *,
    owner_user_id: int,
    kind: str,
    name: str,
    description: str,
    requirements: str,
) -> str:
    llm = _ANALYZE._require_provider(db, owner_user_id=owner_user_id, kind="llm")
    result = chat_json(
        endpoint_url=llm.endpoint_url,
        api_key=_PROVIDERS.decrypt_key(llm),
        model=llm.model,
        protocol=llm.protocol,
        max_output_tokens=4096,
        messages=[
            {"role": "system", "content": _BASE_PROMPT + _KIND_PROMPTS[kind]},
            {"role": "user", "content": json.dumps({
                "scene_name": name,
                "scene_description": description,
                "additional_requirements": requirements,
            }, ensure_ascii=False)},
        ],
    )
    if not result.ok:
        raise DomainError(
            DomainErrorCode.LLM_UPSTREAM_ERROR,
            f"题集生成失败：{result.detail}",
            status_code=502,
        )
    questions = result.payload.get("questions", result.payload)
    raw = json.dumps(questions, ensure_ascii=False)
    try:
        if kind == "persona":
            validate_persona_questions(raw)
        else:
            validate_questions(raw)
    except ValueError as exc:
        raise DomainError(
            DomainErrorCode.VALIDATION_FAILED,
            f"模型返回的题集不符合格式：{exc}",
            status_code=422,
        ) from exc
    return json.dumps(questions, ensure_ascii=False, indent=2)
