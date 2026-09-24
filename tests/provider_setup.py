"""测试辅助：在非配置测试中模拟已通过连通性测试的提供方。"""

from app.core.db import SessionLocal
from app.repositories.models import ProviderConfig


def mark_provider_tested(provider_id: int) -> None:
    with SessionLocal() as db:
        provider = db.get(ProviderConfig, provider_id)
        assert provider is not None
        provider.last_test_ok = True
        provider.is_enabled = True
        db.commit()
