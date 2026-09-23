"""职场场景判断题：与恋爱题同构，但维度按职场沟通重写。

设计原则（与 questions_romance 一致）：
- 英文 instructions 进 JEV，中文只放本地映射表，结果不回译；
- 人称一律用 the other person / 对方，不预设性别；
- 利害程度（stakes_level）替代危险度：职场里炸的不是关系，是承诺与信任。
"""

from __future__ import annotations

from .builders import choice, noul, score

# 面板主展示的五项（其余折叠在「更多」里），结构与恋爱面板对齐
PANEL_KEYS = (
    "stakes_level",
    "true_intent",
    "best_action",
    "other_needs",
    "emotion",
)

# 利害程度 ≥ 此档时，不建议直接落文字（先电话 / 当面 / 会议对齐）
HIGH_STAKES_LEVEL = 8

LABELS: dict[str, dict[str, str]] = {
    "literal_question": {"true": "字面意思", "false": "有潜台词"},
    "true_intent": {
        "assign_task": "在派活或要产出",
        "request_status": "在要进展",
        "push_deadline": "想改时间或宽限",
        "seek_opinion": "想要你的判断",
        "raise_concern": "在提示风险或问题",
        "vent_frustration": "在发泄不满",
        "test_responsibility": "在看你担不担责",
        "casual_chat": "随便聊聊",
        "close_topic": "想结束这个话题",
    },
    "best_action": {
        "confirm_details": "先对齐任务、范围和时间",
        "give_status": "如实汇报进展与卡点",
        "flag_risk": "提前亮出风险和选项",
        "propose_options": "给出具体可选方案",
        "acknowledge": "先接住对方的顾虑",
        "set_boundary": "礼貌地划清或重谈边界",
        "say_less": "少说，别给自己挖坑",
    },
    "other_needs": {
        "facts": "要事实和数据",
        "decision": "要一个明确决定",
        "commitment": "要一个能兑现的时间",
        "recognition": "要你看见他的付出",
        "nothing": "什么都不用",
    },
    "power_dynamic": {
        "superior": "对方是上级",
        "peer": "对方是平级",
        "subordinate": "对方是下级",
        "external": "对方是外部（客户 / 合作方）",
    },
    "tension_resolved": {"true": "已经化解", "false": "还没化解"},
    "should_reply_now": {"true": "下一条要有实质内容", "false": "先别上实质内容"},
    "emotion": {
        "calm": "平静",
        "pleased": "愉快",
        "expectant": "期待",
        "pressed": "被催促",
        "worried": "担忧",
        "frustrated": "恼火",
        "resentful": "不满",
        "disappointed": "失望",
        "defensive": "戒备",
        "tired": "疲惫",
    },
    "context_sufficient": {"true": "信息够判断", "false": "信息还不够"},
}

QUESTION_TITLES: dict[str, str] = {
    "literal_question": "是不是字面意思",
    "true_intent": "真实意图",
    "stakes_level": "利害程度",
    "should_reply_now": "下一条要不要有实质内容",
    "best_action": "最佳动作",
    "other_needs": "对方需要什么",
    "power_dynamic": "对方的位置",
    "tension_resolved": "紧张是否化解",
    "emotion": "情绪",
    "emotion_intensity": "情绪强度",
    "context_sufficient": "信息是否够判断",
}

INTENSITY_LABELS = ("几乎没有", "轻微", "中等", "明显", "强烈")


def label_of(key: str, value: str) -> str:
    """枚举值 → 中文。未知值原样返回，不猜测。"""
    return LABELS.get(key, {}).get(value, value)


def workplace_questions() -> dict:
    """职场场景 10 题。每次返回新字典，调用方可以改。"""
    return {
        "literal_question": noul(
            "Is the other person's latest message meant purely literally, with no subtext? "
            "Judge from the whole thread, not one sentence in isolation.",
            "A straightforward instruction, question, status update, or pleasantry "
            "with no hidden pressure, blame, irony, or unsaid expectation.",
            "There is subtext: pressure dressed as a reminder, blame dressed as a question, "
            "irony about your speed or quality, a test of whether you own the outcome, "
            "or a short cold line that really means displeasure.",
        ),
        "true_intent": choice(
            "What is the other person's true intent in the latest message, given the full conversation? "
            "Prefer tone and context over surface wording. "
            "If they are checking whether you take ownership of an outcome, choose test_responsibility "
            "even if the words look like a status request. "
            "If the matter is settled and they are wrapping up politely, choose close_topic.",
            {
                "assign_task": "Delegating work or asking for a deliverable.",
                "request_status": "Asking where things stand, when it will be done.",
                "push_deadline": "Wants a schedule change, extension, or renegotiated scope.",
                "seek_opinion": "Genuinely wants your judgment or input before deciding.",
                "raise_concern": "Signaling a problem, risk, or dissatisfaction with quality.",
                "vent_frustration": "Blowing off steam; not yet asking for a specific action.",
                "test_responsibility": (
                    "Checking whether you own the outcome — a late-night ping, "
                    "a forwarded complaint, or 'I assume you handled it'."
                ),
                "casual_chat": "Pleasantries, small talk, no work ask.",
                "close_topic": "Matter settled; politely ending the exchange.",
            },
        ),
        "stakes_level": score(
            "How much does the outcome of this exchange matter? "
            "Consider missed commitments, blame landing on you, damaged trust, "
            "or visible failure in front of others.",
            [
                "Trivial.",
                "Minor.",
                "Somewhat minor.",
                "Noteworthy.",
                "Moderate.",
                "Meaningful.",
                "Serious.",
                "High.",
                "Very high.",
                "Critical.",
            ],
        ),
        "should_reply_now": noul(
            "Does the next message need substance (facts, a decision, a commitment), "
            "or would substance be premature right now?",
            "Substance is expected now: they asked for a status, a decision, or a promise "
            "and hedging would read as evasion.",
            "Substance would be premature: first acknowledge, ask a clarifying question, "
            "or check facts before committing to anything.",
        ),
        "best_action": choice(
            "What is the best next move for you, given the other person's intent and the stakes? "
            "Follow the decided action; do not pick a softer one to avoid discomfort.",
            {
                "confirm_details": (
                    "Restate task, scope, deadline, or owner to align before doing work. "
                    "Use when the ask is vague or shifting."
                ),
                "give_status": (
                    "Report honest progress, including blockers and what you are doing about them."
                ),
                "flag_risk": (
                    "Surface a risk or delay early, with impact and options, "
                    "before it becomes a surprise."
                ),
                "propose_options": (
                    "Offer two or three concrete alternatives with trade-offs, "
                    "and let them choose."
                ),
                "acknowledge": (
                    "Show you heard the concern or effort, without new facts or promises yet."
                ),
                "set_boundary": (
                    "Politely decline or renegotiate scope, hours, or ownership."
                ),
                "say_less": (
                    "Keep it short or add nothing. Extra words would over-explain, "
                    "reopen a settled matter, or volunteer liability."
                ),
            },
        ),
        "other_needs": choice(
            "What does the other person need from you right now? Judge the LATEST message first. "
            "If they already accepted an answer (收到 / 那就这么定 / 辛苦了), choose nothing. "
            "A sarcastic 'fine, whatever' is NOT satisfaction. "
            "If they keep pinging for updates, they likely need commitment, not facts.",
            {
                "facts": "Concrete data, status, or evidence they can pass along.",
                "decision": "A clear yes/no or a choice between named options.",
                "commitment": "A deadline or promise they can rely on and repeat to others.",
                "recognition": "Acknowledgment of their effort, concern, or pressure.",
                "nothing": (
                    "Nothing further. Genuine acceptance, a closed matter, "
                    "or pure pleasantry with no ask."
                ),
            },
        ),
        "power_dynamic": choice(
            "Who is the other person relative to you in this exchange? "
            "Infer from address, tone, and what they can decide. If unclear, choose peer.",
            {
                "superior": "They can direct your work or evaluate you.",
                "peer": "Colleague at a similar level; cooperation without authority.",
                "subordinate": "You can direct their work or evaluate them.",
                "external": "Client, vendor, or partner outside your organization.",
            },
        ),
        "tension_resolved": noul(
            "Has the workplace tension already been resolved? "
            "Answer true only if there was never tension, or the matter is clearly settled "
            "with acceptance on both sides. A 'fine' that still smells of complaint means false.",
            "No remaining tension: matter settled, thanks given, jokes resumed, or never tense.",
            "Tension is still present: waiting, chasing, sarcasm, blame, or an open escalation.",
        ),
        "emotion": choice(
            "Given the whole conversation (order, wording, punctuation), "
            "what is the other person's dominant emotion in the latest message? "
            "Do not judge from a single word alone.",
            {
                "calm": "Steady, businesslike.",
                "pleased": "Satisfied, appreciative.",
                "expectant": "Waiting for something promised or decided.",
                "pressed": "Under time pressure, pushing for speed.",
                "worried": "Concerned about a risk or outcome.",
                "frustrated": "Annoyed at blockers or slowness.",
                "resentful": "Feeling burdened or treated unfairly.",
                "disappointed": "An expectation fell through.",
                "defensive": "Guarding against blame.",
                "tired": "Worn out, low energy.",
            },
        ),
        "emotion_intensity": score(
            "How intense is the other person's emotion right now?",
            [
                "Almost none.",
                "Slight.",
                "Moderate.",
                "Clear.",
                "Strong.",
            ],
        ),
        "context_sufficient": noul(
            "Is there enough context in this conversation to judge the other person's "
            "intent and emotion reliably? Answer false if the thread is too short or ambiguous.",
            "There is enough context for a reliable judgment.",
            "The context is too thin or ambiguous; more information is needed.",
        ),
    }
