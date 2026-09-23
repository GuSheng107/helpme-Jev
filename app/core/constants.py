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
INVITATION_CODE_LENGTH = 20
INVITATION_CODE_PREFIX_LEN = 8
INVITATION_MAX_USES = 1000
INVITATION_MAX_EXPIRY_YEARS = 5

# ------------------------------------------------------------------ 数据保留
RETENTION_DAYS_DEFAULT = 15

# ------------------------------------------------------------------ 外部调用
JEV_TIMEOUT_SECONDS = 45
LLM_TIMEOUT_SECONDS = 60
UPSTREAM_MAX_RETRIES = 3

# ------------------------------------------------------------------ 上下文预算
JEV_STATE_BUDGET_CHARS = 1500
LLM_CONTEXT_BUDGET_TOKENS_DEFAULT = 64_000

# ------------------------------------------------------------------ 日志
CALL_LOG_BODY_MAX_BYTES = 64 * 1024

# ------------------------------------------------------------------ Schema
SCHEMA_VERSION = 1
