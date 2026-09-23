"""恋爱场景判断题：Jarvis 已校准的 7 题 + 情绪 / 强度 / 信息充足度。

前 7 题的英文 instructions 与 criteria **原样移植**自 jev-chat-jarvis
（那是跑过真实对话校准的措辞）。后 3 题来自 AI-Relationship-Copilot 的情绪引擎，
但情绪标签改成英文 key，中文只放在本地映射表里 —— 结果不回译。
"""

from __future__ import annotations

from .builders import choice, noul, score

# 面板主展示的五项（其余折叠在「更多」里）
PANEL_KEYS = (
    "danger_level",
    "true_intent",
    "best_action",
    "she_needs",
    "emotion",
)

# 危险度 ≥ 此档时，面板首屏改为人文提示，而不是催用户去生成回复
HIGH_DANGER_LEVEL = 8

# ------------------------------------------------------------------ 中文标签
# 枚举本就是英文，展示走这张表，**不调用 LLM 回译**。
LABELS: dict[str, dict[str, str]] = {
    "literal_question": {"true": "字面意思", "false": "有潜台词"},
    "true_intent": {
        "confirm_you_care": "想确认你在不在意",
        "vent_anger": "在发泄不满",
        "request_action": "想要你做一件具体的事",
        "seek_explanation": "想要一个解释",
        "casual_chat": "随便聊聊",
        "close_topic": "想结束这个话题",
    },
    "best_action": {
        "check_history": "先翻记录，别装记得",
        "apologize": "先道歉",
        "give_commitment": "给出明确承诺",
        "explain": "解释发生了什么",
        "acknowledge": "先承认你听出来了",
        "say_less": "少说",
        "make_plan": "约具体的事",
    },
    "she_needs": {
        "apology": "道歉",
        "action": "一件具体的事",
        "explanation": "解释",
        "care": "在意",
        "nothing": "什么都不用",
    },
    "tension_resolved": {"true": "已经化解", "false": "还没化解"},
    "should_reply_now": {"true": "下一条要有实质内容", "false": "先别上实质内容"},
    "emotion": {
        "happy": "开心",
        "excited": "兴奋",
        "expectant": "期待",
        "calm": "平静",
        "confused": "疑惑",
        "awkward": "尴尬",
        "shy": "害羞",
        "wronged": "委屈",
        "disappointed": "失望",
        "sad": "难过",
        "angry": "生气",
        "anxious": "焦虑",
        "cold": "冷淡",
        "irritated": "烦躁",
        "coquettish": "撒娇",
        "flirty": "暧昧",
        "resigned": "无奈",
        "tired": "疲惫",
    },
    "context_sufficient": {"true": "信息够判断", "false": "信息还不够"},
}

QUESTION_TITLES: dict[str, str] = {
    "literal_question": "是不是字面意思",
    "true_intent": "真实意图",
    "danger_level": "危险度",
    "should_reply_now": "下一条要不要有实质内容",
    "best_action": "最佳动作",
    "she_needs": "她需要什么",
    "tension_resolved": "紧张是否化解",
    "emotion": "情绪",
    "emotion_intensity": "情绪强度",
    "context_sufficient": "信息是否够判断",
}

# 情绪强度 5 档的中文（score 下标 0–4）
INTENSITY_LABELS = ("几乎没有", "轻微", "中等", "明显", "强烈")


def label_of(key: str, value: str) -> str:
    """枚举值 → 中文。未知值原样返回，不猜测。"""
    return LABELS.get(key, {}).get(value, value)


def romance_questions() -> dict:
    """恋爱场景 10 题。每次返回新字典，调用方可以改。"""
    return {
        "literal_question": noul(
            "Is the other person's latest message meant purely literally, with no subtext? "
            "Judge from the whole thread, not one sentence in isolation.",
            "The latest message is a straightforward statement, question, or plan "
            "with no implied accusation, test, sarcasm, hint, or unsaid request.",
            "There is subtext: a test of whether you remember or care, sarcasm, "
            "an implied complaint, a hint they will not say outright, a trap question, "
            "an accusation dressed as a question, or a cold/short line that really means blame.",
        ),
        "true_intent": choice(
            "What is the other person's true intent in the latest message, given the full conversation? "
            "Prefer tone and context over surface wording. "
            "If they are checking whether you remember something or still care, choose confirm_you_care "
            "even if the words look like a request to 'say it' or to do something. "
            "If they already accepted and closed the matter peacefully, choose close_topic. "
            "Ending the relationship, deleting you, or 'don't talk to me' is vent_anger, never close_topic.",
            {
                "confirm_you_care": (
                    "They are testing whether you remember, pay attention, or still care. "
                    "Signals: 'did you forget again', 'then say it', 'you better', sarcastic 'busy person', "
                    "asking you to prove you know a past conversation. "
                    "If they mainly want a new deliverable or a yes on a time, do not use this."
                ),
                "vent_anger": (
                    "They are angry or hurt and mainly want the feeling acknowledged. "
                    "They are blaming or raising the temperature; a specific plan is not the main point yet."
                ),
                "request_action": (
                    "They want a concrete action, time, deliverable, or commitment from you now, "
                    "and this is a real ask, not a loyalty test."
                ),
                "seek_explanation": (
                    "They want a factual explanation of why something happened. "
                    "They asked why or what is going on, not mainly for an apology or a new plan."
                ),
                "casual_chat": (
                    "Light talk, banter, sharing, teasing with a laugh, or friendly logistics "
                    "with no emotional test and no conflict. A friend suggesting a meal time can be this "
                    "if the thread is warm."
                ),
                "close_topic": (
                    "Peaceful wrap-up only: they accepted an apology, confirmed a happy plan, said thanks, "
                    "or clearly signaled they need nothing more. "
                    "Not a breakup, not 'don't contact me', not sarcastic 'I'm used to it'."
                ),
            },
        ),
        "danger_level": score(
            "How close is this conversation to a fight or to hurting the relationship? "
            "Match the current scene. "
            "If they genuinely accepted an apology or confirmed a happy plan, score the cooled-down present, "
            "not an earlier complaint. "
            "If an ultimatum (break up, report to the boss, stop covering for you) is still in force "
            "and has not been withdrawn, stay in that high bin even if the latest line names a specific task.",
            [
                "Light chat or joking; no complaint, no test, no deadline.",
                "Mild tease or a small reminder that is easy to laugh off; a clumsy reply would only feel slightly awkward.",
                "A mild complaint or 'please remember next time' said without heat; they still send warm or practical follow-ups.",
                "Noticeable unhappiness; they mention being forgotten, ignored, or kept waiting, but still give you a chance to make it right.",
                "Sarcasm, cold short replies, or 'you better'; they are testing you, and a sloppy or fake-confident reply will escalate.",
                "Openly upset; they accuse you of not listening or not caring; they expect a real response, not a joke.",
                "Clearly angry and blaming you; a wrong reply will turn this into a fight.",
                "Last-chance warning. They will not cover for you, do not want to keep talking unless this changes, "
                "or tell you to finish a named checklist yourself because trust is almost gone.",
                "An ultimatum is already on the table even if they also give a practical next step: "
                "break up if you forget again, report you tonight, or stop working together if you miss this.",
                "Active rupture: they said it is over, told you not to reply, deleted you, or are exploding.",
            ],
        ),
        "should_reply_now": noul(
            "Should your next message contain substantive content? "
            "Substantive means: admitting a specific known fault, giving a concrete time/plan/deliverable, "
            "explaining facts you actually know, or reciting the recalled content they asked you to say. "
            "This is NOT 'should you send any message'. Timing is irrelevant. "
            "Answer FALSE if the thing they want you to recite or prove is not present in this snippet "
            "(you would be guessing). 'Then say it' / 'you better' while you are stalling is FALSE. "
            "Answer FALSE if they already accepted and closed the topic. "
            "Answer true only if the needed fact, plan, or named fault is already in this snippet.",
            "The needed fact, named fault, or named time/place is already in this snippet, "
            "and they are waiting for that substance now.",
            "Do not put substance in the next message: the recalled content is not in this snippet, "
            "they are testing whether you remember, a holding line is enough, "
            "saying less is safer, or they already closed the topic.",
        ),
        "best_action": choice(
            "What type of next action is best? Do not decide whether to send a message immediately. "
            "Ignore timing. Choose only the action type. "
            "If they asked you to recall a specific past message or event and you have not shown that you actually remember it, "
            "choose check_history — do not apologize or invent a plan instead.",
            {
                "check_history": (
                    "Look up prior chat or facts before taking a position. "
                    "Use when they ask you to repeat, recall, or prove you remember something specific."
                ),
                "apologize": (
                    "Lead with a sincere apology for a real mistake or hurt already identified. "
                    "Not for an unnamed forgotten thing when you should first find out what it was."
                ),
                "give_commitment": (
                    "Give a concrete promise, deadline, or arrangement they asked for "
                    "in a conflict or work-pressure setting."
                ),
                "explain": "Explain what happened or why, without leading with apology or a new plan.",
                "acknowledge": (
                    "Show you heard them and care, without new facts, an apology, or a plan. "
                    "Use for light chat or when they mainly need to feel seen."
                ),
                "say_less": (
                    "Keep it short or add nothing. Extra words would over-explain, reopen a closed topic, "
                    "or pour fuel on an ultimatum that told you not to talk."
                ),
                "make_plan": (
                    "Propose or confirm logistics (time, place, task) for a non-conflict request "
                    "such as a meal or a meeting."
                ),
            },
        ),
        "she_needs": choice(
            "What does the other person need from you right now? Judge the LATEST message first. "
            "If they genuinely accepted (thanks / got it / 没事了 / 那就这样 / 收到了 / 过去了), "
            "you MUST choose nothing, even if earlier they wanted action or an apology. "
            "Sarcastic 'I'm used to it', 'whatever', 'I don't want to hear it', 'don't bother coming' "
            "is NOT genuine satisfaction — do not choose nothing. "
            "If they asked you to recap a named time/place/date, choose action. "
            "If they are testing whether you remember or still care, and the content is unnamed, choose care.",
            {
                "apology": "They need a sincere apology for hurt or a mistake, and they have not accepted one yet.",
                "action": (
                    "They need a concrete action, time, commitment, recap of a named fact, or follow-through, "
                    "and they have not yet accepted one."
                ),
                "explanation": "They need a clear explanation of what happened or why, and have not received it.",
                "care": (
                    "They need proof you remember, listen, or care — a loyalty or attention test — "
                    "not yet a plan or an apology. Sarcastic 'I am used to it' belongs here, not nothing."
                ),
                "nothing": (
                    "They need nothing further. Genuine acceptance, a peaceful closed topic, "
                    "warm casual chat with no ask, or a rupture where they told you not to reply. "
                    "Not sarcasm pretending to be fine."
                ),
            },
        ),
        "tension_resolved": noul(
            "Has interpersonal tension already been resolved? "
            "Answer true only if there was never tension, or the other person has clearly accepted, "
            "cooled down, joked again, or said it is fine. "
            "A sarcastic 'you better', an unanswered test, leftover blame, or an open ultimatum means false.",
            "No remaining tension: they accepted, joked again, said it's fine, "
            "confirmed a happy plan, or the chat was never tense.",
            "Tension is still present: they are waiting, testing, angry, sarcastic, "
            "issuing an ultimatum, or the issue is open.",
        ),
        "emotion": choice(
            "Given the whole conversation (order, wording, emoji, punctuation), "
            "what is the other person's dominant emotion in the latest message? "
            "Do not judge from a single word alone.",
            {
                "happy": "Cheerful, positive feeling shown openly.",
                "excited": "High energy, eager to share.",
                "expectant": "Looking forward to something, waiting for a response.",
                "calm": "Steady, no obvious swing.",
                "confused": "Does not understand, waiting for an explanation.",
                "awkward": "Slightly uncomfortable, the moment is clumsy.",
                "shy": "Flattered or teased, holding back.",
                "wronged": "Feels overlooked or slightly hurt, wants to be cared for.",
                "disappointed": "An expectation fell through; mood is dropping.",
                "sad": "Clearly low or hurt.",
                "angry": "Clearly displeased, blaming or sharp.",
                "anxious": "Worried, checking again and again.",
                "cold": "Distant, few words, does not want to talk.",
                "irritated": "Impatient, easy to set off.",
                "coquettish": "Playing at being upset, wants to be coaxed.",
                "flirty": "Deliberately closing the distance.",
                "resigned": "Accepting it with a little resentment.",
                "tired": "Worn out, needs looking after.",
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
