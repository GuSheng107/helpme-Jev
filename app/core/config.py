"""应用配置：全部来自环境变量 / .env，凭据不落库、不入版本库。"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

from .constants import (
    JEV_STATE_BUDGET_CHARS,
    LLM_CONTEXT_BUDGET_TOKENS_DEFAULT,
    RETENTION_DAYS_DEFAULT,
    SESSION_TTL_HOURS_DEFAULT,
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # 安全
    app_secret: str = ""

    # 服务
    port: int = 8790
    database_path: str = "./data/helpme_jev.db"

    # 数据保留与会话
    retention_days: int = RETENTION_DAYS_DEFAULT
    session_ttl_hours: int = SESSION_TTL_HOURS_DEFAULT

    # 上下文预算
    jev_state_budget_chars: int = JEV_STATE_BUDGET_CHARS
    llm_context_budget_tokens: int = LLM_CONTEXT_BUDGET_TOKENS_DEFAULT

    # 首启默认管理员（首次登录强制改密）
    default_admin_username: str = "admin"
    default_admin_password: str = "helpme-jev-admin-2026!"

    # 前端构建产物目录（生产模式下由后端托管）
    web_dist_dir: str = "./web/dist"


@lru_cache
def get_settings() -> Settings:
    return Settings()
