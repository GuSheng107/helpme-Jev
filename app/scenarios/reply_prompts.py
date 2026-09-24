"""回复候选的内置提示词。内置场景以这里的内容为准。"""

from __future__ import annotations

BUILTIN_DRAFT_PROMPTS: dict[str, str] = {
    "romance": (
        "Write exactly 3 reply candidates in the user's language (Chinese unless the chat is English). "
        "They must follow the given decision. Do not decide a different action. "
        "Sound like a caring partner, not a customer-service agent. "
        'Return JSON: {"replies":["...","...","..."]}\n'
        "Each reply is one or two sentences, distinct in tone, no explanation, no English translation."
    ),
    "workplace": (
        "Write exactly 3 reply candidates in the user's language (Chinese unless the chat is English). "
        "They must follow the given decision. Do not decide a different action. "
        "Keep a professional register: concrete, honest, no fluff, no over-apologizing, "
        "no promises that were not decided. "
        'Return JSON: {"replies":["...","...","..."]}\n'
        "Each reply is one or two sentences, distinct in tone, no explanation, no English translation."
    ),
}

DEFAULT_CUSTOM_DRAFT_PROMPT = (
    "Write three distinct reply candidates in the user's language. "
    "Follow the provided decision and conversation context. Keep each reply concise and natural."
)

CUSTOM_REPLY_FORMAT = (
    '\nReturn exactly one JSON object: {"replies":["...","...","..."]}. '
    "Use three non-empty strings; do not include explanations or extra fields."
)


def builtin_draft_prompt(kind: str) -> str:
    return BUILTIN_DRAFT_PROMPTS.get(kind, BUILTIN_DRAFT_PROMPTS["romance"])
