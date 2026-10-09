"""把业务请求、模型调用与既有操作记录写入同一活动日志。"""

from __future__ import annotations

import json
import logging
import re
from contextvars import ContextVar
from time import perf_counter

from fastapi import Request
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from ..core.db import SessionLocal
from ..core.logging import dump_body, redact_text
from ..domain.enums import ActivityCategory, CallLogLevel
from ..repositories.models import ActivityLog, AuditLog, CallLog, User


current_trace: ContextVar[str] = ContextVar("activity_trace", default="")
current_category: ContextVar[str] = ContextVar("activity_category", default="")
logger = logging.getLogger("helpme_jev.activity")

TRACE_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

# 只记录业务动作。GET 读取、历史详情、健康检查和日志查询不产生新日志。
ACTION_LABELS: dict[tuple[str, str], str] = {
    ("POST", "/api/auth/register"): "注册账号",
    ("POST", "/api/auth/login"): "登录",
    ("POST", "/api/auth/logout"): "退出登录",
    ("POST", "/api/account/password"): "修改密码",
    ("PATCH", "/api/account/profile"): "修改昵称",
    ("PATCH", "/api/account/avatar"): "修改头像",
    ("GET", "/api/account/export"): "导出数据",
    ("DELETE", "/api/account"): "注销账号",
    ("POST", "/api/conversations"): "新建会话",
    ("PATCH", "/api/conversations/{conversation_id}"): "编辑会话",
    ("DELETE", "/api/conversations/{conversation_id}"): "删除会话",
    ("POST", "/api/conversations/{conversation_id}/images"): "上传聊天图片",
    ("POST", "/api/conversations/{conversation_id}/messages"): "发送消息",
    ("POST", "/api/chat/analyze"): "发起聊天判断",
    ("POST", "/api/chat/reply"): "生成候选回复",
    ("POST", "/api/chat/reply/stream"): "生成候选回复",
    ("POST", "/api/chat/evaluate"): "评价候选回复",
    ("POST", "/api/chat/clarify"): "生成澄清问题",
    ("POST", "/api/chat/explain"): "解释判断",
    ("POST", "/api/chat/polish"): "润色消息",
    ("POST", "/api/chat/reflect"): "记忆复盘",
    ("POST", "/api/chat/reflect/{reflection_id}/revert"): "撤销记忆复盘",
    ("DELETE", "/api/chat/memories/{memory_id}"): "删除记忆",
    ("POST", "/api/decide"): "发起决策判断",
    ("POST", "/api/decide/stream"): "发起决策判断",
    ("POST", "/api/decide/polish"): "润色决策题目",
    ("POST", "/api/personas/build"): "生成人设",
    ("POST", "/api/import/chat/preview"): "预览聊天导入",
    ("POST", "/api/import/chat"): "导入聊天",
    ("POST", "/api/import/qa"): "导入问答",
    ("POST", "/api/materials/screenshot"): "上传截图",
    ("POST", "/api/scenarios/generate-questions"): "生成场景题目",
    ("POST", "/api/scenarios"): "新建场景",
    ("PATCH", "/api/scenarios/{scenario_id}"): "保存场景",
    ("DELETE", "/api/scenarios/{scenario_id}"): "删除场景",
    ("POST", "/api/providers"): "添加模型配置",
    ("PATCH", "/api/providers/{provider_id}"): "修改模型配置",
    ("DELETE", "/api/providers/{provider_id}"): "删除模型配置",
    ("POST", "/api/providers/{provider_id}/test"): "测试模型连接",
    ("POST", "/api/admin/users"): "创建用户",
    ("POST", "/api/admin/users/{user_id}/active"): "变更用户状态",
    ("POST", "/api/admin/users/{user_id}/reset-password"): "重置用户密码",
    ("DELETE", "/api/admin/users/{user_id}"): "删除用户",
    ("POST", "/api/admin/invitations"): "生成邀请码",
    ("POST", "/api/admin/invitations/{invitation_id}/revoke"): "作废邀请码",
}

PHASE_LABELS = {
    "translate": "翻译",
    "analyze": "聊天判断",
    "describe": "读图",
    "decide": "决策判断",
    "connect": "连通测试",
    "vision": "看图测试",
    "reflect": "记忆复盘",
    "summarize": "摘要",
    "polish": "润色",
    "draft": "候选回复生成",
    "rank": "候选回复排序",
    "evaluate": "回复评价",
    "clarify": "澄清问题生成",
    "explain": "判断解释",
    "generate_questions": "场景题目生成",
    "persona": "人设建模",
}

AUDIT_LABELS = {
    "login": "登录",
    "logout": "退出登录",
    "registered": "注册账号",
    "password_changed": "修改密码",
    "user_created": "创建用户",
    "user_disabled": "停用用户",
    "user_enabled": "启用用户",
    "password_reset": "重置密码",
    "invitation_created": "生成邀请码",
    "invitation_updated": "修改邀请码",
    "invitation_revoked": "作废邀请码",
    "invitation_deleted": "删除邀请码",
    "provider_created": "添加模型配置",
    "provider_updated": "修改模型配置",
    "provider_deleted": "删除模型配置",
    "account_deleted": "注销账号",
    "data_exported": "导出数据",
}


def request_category(path: str) -> str:
    if path.startswith("/api/auth/") or path == "/api/account/password":
        return ActivityCategory.AUTH.value
    if path.startswith(("/api/chat", "/api/conversations")):
        return ActivityCategory.CHAT.value
    if path.startswith("/api/decide"):
        return ActivityCategory.DECISION.value
    if path.startswith(("/api/personas", "/api/import", "/api/materials")):
        return ActivityCategory.PERSONA.value
    if path.startswith("/api/scenarios"):
        return ActivityCategory.SCENARIO.value
    if path.startswith("/api/admin"):
        return ActivityCategory.ADMIN.value
    return ActivityCategory.SETTINGS.value


def should_record(method: str, path: str) -> bool:
    return path.startswith("/api/") and not path.startswith("/api/logs") and (
        method in {"POST", "PATCH", "PUT", "DELETE"}
        or (method == "GET" and path == "/api/account/export")
    )


def _body(raw: str) -> object:
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return redact_text(raw or "")


@event.listens_for(Session, "before_flush")
def mirror_existing_logs(db: Session, _flush_context, _instances) -> None:  # noqa: ANN001
    """沿用服务内现有写点，和原日志在同一事务中写入活动明细。"""
    for row in list(db.new):
        if isinstance(row, CallLog):
            detail, _ = dump_body({
                "phase": row.phase,
                "model": row.model,
                "request": _body(row.request_body),
                "response": _body(row.response_body),
                "error": redact_text(row.error or ""),
                "truncated": row.truncated,
            })
            db.add(ActivityLog(
                owner_user_id=row.owner_user_id,
                trace_id=row.trace_id or current_trace.get(),
                category=current_category.get() or ActivityCategory.MODEL.value,
                source=row.kind.upper(),
                level=row.level,
                summary=f"{PHASE_LABELS.get(row.phase, row.phase or '模型')}调用"
                        f"{'失败' if row.level == CallLogLevel.ERROR.value else '降级' if row.level == CallLogLevel.WARN.value else '完成'}",
                detail=detail,
                status_code=row.status_code,
                latency_ms=row.latency_ms,
            ))
        elif isinstance(row, AuditLog):
            detail, _ = dump_body({
                "action": row.action,
                "resource_type": row.resource_type,
                "resource_id": row.resource_id,
                "meta": _body(row.meta),
            })
            db.add(ActivityLog(
                owner_user_id=row.actor_user_id or row.owner_user_id,
                trace_id=row.request_id or current_trace.get(),
                category=current_category.get() or request_category_for_audit(row.action),
                source="系统",
                level="info" if row.result == "ok" else "error",
                summary=f"{AUDIT_LABELS.get(row.action, row.action)}{'成功' if row.result == 'ok' else '失败'}",
                detail=detail,
            ))


def request_category_for_audit(action: str) -> str:
    if action in {"login", "login_failed", "logout", "registered", "password_changed"}:
        return ActivityCategory.AUTH.value
    if action.startswith(("user_", "invitation_")) or action == "password_reset":
        return ActivityCategory.ADMIN.value
    return ActivityCategory.SETTINGS.value


def record_request(request: Request, *, status_code: int, started_at: float) -> None:
    """独立事务保留失败动作；只写路由模板和状态，不读取请求或响应正文。"""
    method = request.method.upper()
    path = request.url.path
    if not should_record(method, path):
        return
    route = request.scope.get("route")
    template = getattr(route, "path", "<unknown>")
    label = ACTION_LABELS.get((method, template), "业务操作")
    error_code = str(getattr(request.state, "activity_error_code", ""))[:64]
    outcome = "限流" if status_code == 429 else "成功" if status_code < 400 else "失败"
    level = "warn" if status_code == 429 else "info" if status_code < 400 else "error"
    owner = getattr(request.state, "user", None)
    owner_id = getattr(owner, "id", None)
    username = getattr(request.state, "activity_username", "")
    detail, _ = dump_body({"method": method, "path": template, "status_code": status_code, "error_code": error_code})
    with SessionLocal() as db:
        if owner_id is not None and db.get(User, owner_id) is None:
            owner_id = None
        if owner_id is None and username:
            owner_id = db.scalar(select(User.id).where(User.username == username.strip().lower()))
        if owner_id is not None and status_code < 400:
            call_levels = db.scalars(select(CallLog.level).where(
                CallLog.owner_user_id == owner_id,
                CallLog.trace_id == request.state.trace_id,
            )).all()
            if CallLogLevel.ERROR.value in call_levels and template.endswith("/test"):
                outcome, level = "失败", "error"
            elif CallLogLevel.ERROR.value in call_levels or CallLogLevel.WARN.value in call_levels:
                outcome, level = "降级", "warn"
        db.add(ActivityLog(
            owner_user_id=owner_id,
            trace_id=request.state.trace_id,
            category=request_category(path),
            source="用户",
            level=level,
            summary=f"{label}{outcome}",
            detail=detail,
            status_code=status_code,
            latency_ms=max(0, round((perf_counter() - started_at) * 1000)),
            error_code=error_code,
        ))
        db.commit()


def mark_stream_result(
    trace_id: str, owner_user_id: int, *, level: str, error_code: str = "",
    label: str = "发起决策判断",
) -> None:
    """流式响应发出 200 后发生的降级或失败，回写请求摘要。"""
    if level == "info":
        return
    try:
        with SessionLocal() as db:
            row = db.scalar(select(ActivityLog).where(
                ActivityLog.trace_id == trace_id,
                ActivityLog.owner_user_id == owner_user_id,
                ActivityLog.source == "用户",
            ).order_by(ActivityLog.id.desc()))
            if row is not None:
                row.level = level
                row.summary = f"{label}失败" if level == "error" else f"{label}降级"
                row.error_code = error_code[:64]
                db.commit()
    except Exception as exc:
        logger.warning("流式活动日志更新失败：%s", type(exc).__name__)
