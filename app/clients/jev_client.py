"""JEV（TypeSafe System One）客户端：连通性测试 + 冒烟测试（健康度）。

协议硬约束（见 DESIGN.md §9.1）：

- 请求体 ``{model, state, questions}``
- 题型限 ``noul`` / ``choice`` / ``score``
- 响应 ``{model, answers, usage?}``

**为什么要有冒烟测试**：用户自配的 JEV 端点质量参差，
单验"协议通不通"不足以说明"判断靠不靠谱"。
故内置几组标准 case，连通测试时顺带跑出**健康度**
（审核意见排期项；健康度未达标前，排序条数 UI 锁死 3 条）。
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import httpx

TIMEOUT_SECONDS = 45

# 冒烟用例里的固定题目 key（与业务题目解耦，只用于体检）
_KEY_NEGATIVE = "is_negative"
_KEY_RISK = "is_high_risk"

_PROBE_QUESTIONS = {
    _KEY_NEGATIVE: {
        "type": "noul",
        "instructions": "Is the speaker unhappy, upset or dissatisfied?",
    }
}


@dataclass
class JevResult:
    ok: bool
    status_code: int | None = None
    latency_ms: int = 0
    detail: str = ""
    answers: dict = field(default_factory=dict)
    model_reported: str = ""
    error_code: str = ""


@dataclass
class SmokeCase:
    name: str
    state: str
    questions: dict
    # 断言：(answer_key, 取值字段, 比较符, 阈值)
    expectations: list[tuple[str, str, str, float]]


@dataclass
class SmokeOutcome:
    name: str
    passed: bool
    expected: str
    actual: str


@dataclass
class SmokeReport:
    total: int
    passed: int
    outcomes: list[SmokeOutcome]

    @property
    def health(self) -> int:
        """健康度百分比（0-100）。"""
        if self.total == 0:
            return 0
        return round(self.passed * 100 / self.total)


# ------------------------------------------------------------------ 标准用例
SMOKE_CASES: list[SmokeCase] = [
    SmokeCase(
        name="明显负面情绪",
        state="The speaker says: 'I don't want to talk to you anymore. Stop bothering me.'",
        questions={_KEY_NEGATIVE: _PROBE_QUESTIONS[_KEY_NEGATIVE]},
        expectations=[(_KEY_NEGATIVE, "noul", ">", 0.7)],
    ),
    SmokeCase(
        name="明显正面情绪",
        state="The speaker says: 'Thank you so much! I'm really happy today.'",
        questions={_KEY_NEGATIVE: _PROBE_QUESTIONS[_KEY_NEGATIVE]},
        expectations=[(_KEY_NEGATIVE, "noul", "<", 0.3)],
    ),
    SmokeCase(
        name="中性事务沟通",
        state="The speaker says: 'The meeting is at 3pm tomorrow, remember to bring the documents.'",
        questions={_KEY_NEGATIVE: _PROBE_QUESTIONS[_KEY_NEGATIVE]},
        expectations=[(_KEY_NEGATIVE, "noul", "<", 0.5)],
    ),
    SmokeCase(
        name="高风险关系信号",
        state="The speaker says: 'Let's take a break. I'm seriously considering breaking up.'",
        questions={
            _KEY_RISK: {
                "type": "noul",
                "instructions": "Does this message indicate a serious risk to the relationship?",
            }
        },
        expectations=[(_KEY_RISK, "noul", ">", 0.7)],
    ),
    SmokeCase(
        name="低风险日常闲聊",
        state="The speaker says: 'Hot pot or barbecue for dinner tonight?'",
        questions={
            _KEY_RISK: {
                "type": "noul",
                "instructions": "Does this message indicate a serious risk to the relationship?",
            }
        },
        expectations=[(_KEY_RISK, "noul", "<", 0.3)],
    ),
]


def _explain_status(status: int, body_text: str) -> str:
    snippet = (body_text or "").strip()[:300]
    hints = {
        400: "请求被拒绝 —— 常见于题型或字段不合规",
        401: "鉴权失败 —— 请检查 API Key",
        403: "无权访问该模型或端点",
        404: "端点不存在 —— 请检查 URL 是否填错（应为完整路径）",
        422: "参数校验失败 —— 端点可能不是 System One 协议",
        429: "触发限流",
        500: "上游内部错误",
        502: "上游网关错误",
        503: "上游服务不可用",
        504: "上游超时",
    }
    hint = hints.get(status, "未预期的状态码")
    return f"HTTP {status}：{hint}" + (f"；响应摘要：{snippet}" if snippet else "")


def call_systemone(
    *,
    endpoint_url: str,
    api_key: str,
    model: str,
    state: str,
    questions: dict,
    timeout: int = TIMEOUT_SECONDS,
) -> JevResult:
    """调用一次 System One。返回结构化结果，不抛异常。"""
    started = time.perf_counter()
    body = {"model": model, "state": state, "questions": questions}
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.post(endpoint_url, json=body, headers=headers)
    except httpx.TimeoutException:
        return JevResult(
            ok=False,
            latency_ms=int((time.perf_counter() - started) * 1000),
            detail=f"连接超时（>{timeout}s）—— 请检查 URL 与网络",
            error_code="JEV_UPSTREAM_ERROR",
        )
    except httpx.HTTPError as exc:
        return JevResult(
            ok=False,
            latency_ms=int((time.perf_counter() - started) * 1000),
            detail=f"网络错误：{type(exc).__name__}",
            error_code="JEV_UPSTREAM_ERROR",
        )

    latency = int((time.perf_counter() - started) * 1000)

    if response.status_code >= 400:
        return JevResult(
            ok=False,
            status_code=response.status_code,
            latency_ms=latency,
            detail=_explain_status(response.status_code, response.text),
            error_code="JEV_UPSTREAM_ERROR",
        )

    try:
        data = response.json()
    except ValueError:
        return JevResult(
            ok=False,
            status_code=response.status_code,
            latency_ms=latency,
            detail="返回内容不是 JSON —— 该端点可能不是 System One 协议",
            error_code="PROTOCOL_MISMATCH",
        )

    if not isinstance(data, dict) or not isinstance(data.get("answers"), dict):
        return JevResult(
            ok=False,
            status_code=response.status_code,
            latency_ms=latency,
            detail="响应缺少 answers 字段 —— 该端点可能不是 System One 协议",
            error_code="PROTOCOL_MISMATCH",
        )

    return JevResult(
        ok=True,
        status_code=response.status_code,
        latency_ms=latency,
        detail=f"协议连通；作答模型 {data.get('model', '—')}",
        answers=data["answers"],
        model_reported=str(data.get("model", "")),
    )


def test_connection(
    *, endpoint_url: str, api_key: str, model: str, timeout: int = TIMEOUT_SECONDS
) -> JevResult:
    """最小连通测试：一次 noul 请求 + 结构校验。"""
    result = call_systemone(
        endpoint_url=endpoint_url,
        api_key=api_key,
        model=model,
        state="The speaker says: 'Nothing much.'",
        questions=_PROBE_QUESTIONS,
        timeout=timeout,
    )
    if not result.ok:
        return result

    answer = result.answers.get(_KEY_NEGATIVE)
    if not isinstance(answer, dict) or "noul" not in answer:
        return JevResult(
            ok=False,
            status_code=result.status_code,
            latency_ms=result.latency_ms,
            detail="answers 结构不符合 System One 规范（缺少 noul 值）",
            error_code="PROTOCOL_MISMATCH",
        )

    try:
        prob = float(answer["noul"])
    except (TypeError, ValueError):
        return JevResult(
            ok=False,
            status_code=result.status_code,
            latency_ms=result.latency_ms,
            detail="noul 值不是数字",
            error_code="PROTOCOL_MISMATCH",
        )

    if not 0.0 <= prob <= 1.0:
        return JevResult(
            ok=False,
            status_code=result.status_code,
            latency_ms=result.latency_ms,
            detail=f"noul 值超出 [0,1] 范围：{prob}",
            error_code="PROTOCOL_MISMATCH",
        )

    result.detail = f"{result.detail}；探测题 {_KEY_NEGATIVE}={prob:.2f}"
    return result


def run_smoke_test(
    *,
    endpoint_url: str,
    api_key: str,
    model: str,
    timeout: int = TIMEOUT_SECONDS,
) -> tuple[SmokeReport | None, JevResult]:
    """跑标准用例并算健康度。

    返回 ``(报告, 最后一次调用结果)``：报告为 ``None`` 表示首个用例就调用失败
    （多半是配置或协议问题，而非判断质量问题）。
    """
    outcomes: list[SmokeOutcome] = []
    last: JevResult | None = None

    for case in SMOKE_CASES:
        result = call_systemone(
            endpoint_url=endpoint_url,
            api_key=api_key,
            model=model,
            state=case.state,
            questions=case.questions,
            timeout=timeout,
        )
        last = result
        if not result.ok:
            # 调用失败 → 整体判定为"体检无法完成"
            return None, result

        for key, field_name, operator, threshold in case.expectations:
            raw = (result.answers.get(key) or {}).get(field_name)
            try:
                actual = float(raw)
            except (TypeError, ValueError):
                outcomes.append(
                    SmokeOutcome(
                        name=case.name,
                        passed=False,
                        expected=f"{key}.{field_name} {operator} {threshold}",
                        actual=f"无法解析（{raw!r}）",
                    )
                )
                continue

            passed = actual > threshold if operator == ">" else actual < threshold
            outcomes.append(
                SmokeOutcome(
                    name=case.name,
                    passed=passed,
                    expected=f"{key} {operator} {threshold}",
                    actual=f"{actual:.2f}",
                )
            )

    assert last is not None
    report = SmokeReport(
        total=len(outcomes),
        passed=sum(1 for item in outcomes if item.passed),
        outcomes=outcomes,
    )
    return report, last
