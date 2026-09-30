"""回复候选的内置提示词。内置场景以这里的内容为准。"""

from __future__ import annotations

BUILTIN_DRAFT_PROMPTS: dict[str, str] = {
    "romance": (
        "用用户的语言（聊天是英文则用英文，否则用中文）写出恰好 3 个回复候选。"
        "必须遵循已给出的决策，不得改判别的行动。"
        "语气像体贴的伴侣，不要客服腔。"
        '返回 JSON：{"replies":["...","...","..."]}\n'
        "每条回复一两句话，语气各有区分，不解释，不附英文翻译。"
    ),
    "workplace": (
        "用用户的语言（聊天是英文则用英文，否则用中文）写出恰好 3 个回复候选。"
        "必须遵循已给出的决策，不得改判别的行动。"
        "保持职场语域：具体、诚实、不废话、不过度道歉、不许诺未定的安排。"
        '返回 JSON：{"replies":["...","...","..."]}\n'
        "每条回复一两句话，语气各有区分，不解释，不附英文翻译。"
    ),
}

DEFAULT_CUSTOM_DRAFT_PROMPT = (
    "用用户的语言写出 3 个互不重复的回复候选，"
    "遵循给定的决策与对话上下文，每条回复简洁自然。"
)

CUSTOM_REPLY_FORMAT = (
    '\nReturn exactly one JSON object: {"replies":["...","...","..."]}. '
    "Use three non-empty strings; do not include explanations or extra fields."
)

# 历史版本的英文内置提示词 → 对应中文文案。这些英文串曾会被原样存进
# 场景行并回显在编辑器里；启动时把仍与旧文案完全一致的行（即从未被
# 管理员改过）一次性刷新为中文，改过的行原样保留。
PROMPT_REFRESH: dict[str, str] = {
    (
        "Write exactly 3 reply candidates in the user's language (Chinese unless the chat is English). "
        "They must follow the given decision. Do not decide a different action. "
        "Sound like a caring partner, not a customer-service agent. "
        'Return JSON: {"replies":["...","...","..."]}\n'
        "Each reply is one or two sentences, distinct in tone, no explanation, no English translation."
    ): BUILTIN_DRAFT_PROMPTS["romance"],
    (
        "Write exactly 3 reply candidates in the user's language (Chinese unless the chat is English). "
        "They must follow the given decision. Do not decide a different action. "
        "Keep a professional register: concrete, honest, no fluff, no over-apologizing, "
        "no promises that were not decided. "
        'Return JSON: {"replies":["...","...","..."]}\n'
        "Each reply is one or two sentences, distinct in tone, no explanation, no English translation."
    ): BUILTIN_DRAFT_PROMPTS["workplace"],
    (
        "Write three distinct reply candidates in the user's language. "
        "Follow the provided decision and conversation context. Keep each reply concise and natural."
    ): DEFAULT_CUSTOM_DRAFT_PROMPT,
}


def builtin_draft_prompt(kind: str) -> str:
    return BUILTIN_DRAFT_PROMPTS.get(kind, BUILTIN_DRAFT_PROMPTS["romance"])
