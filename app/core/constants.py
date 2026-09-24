"""全局常量：加密信封、会话、邀请码、数据保留、Schema 版本。"""

from __future__ import annotations

# ------------------------------------------------------------------ 加密信封
# 信封格式：hmj1.<key_version>.<nonce_b64url>.<ciphertext_and_tag_b64url>
SECRET_ENVELOPE_PREFIX = "hmj1"
SECRET_KEY_VERSION = 1
SECRET_HKDF_INFO = b"helpme-jev/secret/v1"
SECRET_AAD_PREFIX = "helpme-jev"
SECRET_AAD_VERSION = "v1"
AES_GCM_NONCE_BYTES = 12
AES_GCM_TAG_BYTES = 16
APP_SECRET_BYTES = 32
APP_SECRET_B64_LENGTH = 43

# AAD 用途绑定：不同用途的密文不可互相搬运
PURPOSE_PROVIDER_APIKEY = "provider_apikey"

# ------------------------------------------------------------------ 会话
SESSION_TTL_HOURS_DEFAULT = 8
SESSION_TOKEN_BYTES = 32
SESSION_TOKEN_PREFIX_LEN = 8

# ------------------------------------------------------------------ 邀请码
INVITATION_CODE_PREFIX = "JEV"
INVITATION_CODE_SEGMENT_LENGTH = 4
INVITATION_CODE_SEGMENTS = 3
INVITATION_MAX_USES = 1000

# ------------------------------------------------------------------ 数据保留
RETENTION_DAYS_DEFAULT = 15

# ------------------------------------------------------------------ 外部调用
JEV_TIMEOUT_SECONDS = 45
LLM_TIMEOUT_SECONDS = 60
UPSTREAM_MAX_RETRIES = 3

# ------------------------------------------------------------------ 上下文预算
# JEV（TypeSafe System One / jev-1.13.0）官方规格：
#   - 单请求 64k token（state + 全部 questions 合计）
#   - 其中 state + 单个最长 question ≤ 32k token（英文约 15 万字符）
#   注意：官方把「大而嘈杂的 state」列为已知失败模式（无关细节会成为干扰项），
#   建议 "filter first; send only what the question needs"。
#   因此**默认值刻意保守**（5000 字符 ≈ 远低于上限），可配但不应顶格用。
JEV_STATE_BUDGET_CHARS = 5000
# 官方硬上限（32k token）折算成中文字符的保守估值，用于配置校验
JEV_STATE_HARD_LIMIT_CHARS = 60_000
LLM_CONTEXT_BUDGET_TOKENS_DEFAULT = 64_000

# ------------------------------------------------------------------ 日志
CALL_LOG_BODY_MAX_BYTES = 64 * 1024

# ------------------------------------------------------------------ Schema
SCHEMA_VERSION = 1
