"""领域枚举：角色、能力、调用类型、记忆操作、场景种类等。"""

from __future__ import annotations

from enum import StrEnum


class UserRole(StrEnum):
    ADMIN = "admin"
    USER = "user"


class Capability(StrEnum):
    """细粒度能力。

    ``must_change_password`` 为真时**只发放** ``ACCOUNT_PASSWORD_CHANGE``，
    其余能力一律不下发（这就是"强制改密闸门"，见 DESIGN.md §5）。
    """

    ACCOUNT_PASSWORD_CHANGE = "account:password_change"
    ACCOUNT_PROFILE_UPDATE = "account:profile_update"

    PROVIDER_MANAGE = "provider:manage"
    SCENARIO_MANAGE = "scenario:manage"
    CHAT_USE = "chat:use"
    DECISION_USE = "decision:use"
    MEMORY_MANAGE = "memory:manage"
    PERSONA_MANAGE = "persona:manage"
    IMPORT_USE = "import:use"
    LOG_VIEW_OWN = "log:view_own"
    DATA_EXPORT = "data:export"

    # 管理侧（注意：**没有** 查看他人日志的能力 —— 皇上明令 admin 也不可看）
    INVITATION_MANAGE = "invitation:manage"
    USER_MANAGE = "user:manage"


class CallKind(StrEnum):
    JEV = "jev"
    LLM = "llm"


class MemoryOp(StrEnum):
    """记忆写入决策（借鉴 Mem0）。"""

    ADD = "ADD"
    UPDATE = "UPDATE"
    INVALIDATE = "INVALIDATE"
    NOOP = "NOOP"


class MemorySubject(StrEnum):
    ME = "me"
    OTHER = "other"
    RELATION = "relation"


class ScenarioKind(StrEnum):
    ROMANCE = "romance"
    WORKPLACE = "workplace"
    GENERAL = "general"
    CUSTOM = "custom"


class InvitationStatus(StrEnum):
    ACTIVE = "active"
    REVOKED = "revoked"
    EXPIRED = "expired"
    EXHAUSTED = "exhausted"


class MessageRole(StrEnum):
    ME = "me"
    OTHER = "other"


class MaterialKind(StrEnum):
    SCREENSHOT = "screenshot"
    CHAT_IMPORT = "chat_import"


class AuditAction(StrEnum):
    LOGIN = "login"
    LOGIN_FAILED = "login_failed"
    LOGOUT = "logout"
    REGISTERED = "registered"
    PASSWORD_CHANGED = "password_changed"
    USER_CREATED = "user_created"
    USER_DISABLED = "user_disabled"
    USER_ENABLED = "user_enabled"
    PASSWORD_RESET = "password_reset"
    INVITATION_CREATED = "invitation_created"
    INVITATION_UPDATED = "invitation_updated"
    INVITATION_REVOKED = "invitation_revoked"
    INVITATION_DELETED = "invitation_deleted"
    PROVIDER_CREATED = "provider_created"
    PROVIDER_UPDATED = "provider_updated"
    PROVIDER_DELETED = "provider_deleted"
    ACCOUNT_DELETED = "account_deleted"
    DATA_EXPORTED = "data_exported"
