"""P0 安全原语测试：信封加解密、密码哈希、会话令牌、邀请码。"""

from __future__ import annotations

import pytest

from app.core.constants import PURPOSE_PROVIDER_APIKEY
from app.core.security import (
    SecretCryptoError,
    decrypt_secret,
    encrypt_secret,
    generate_invitation_code,
    generate_session_token,
    hash_password,
    hash_token,
    verify_password,
)


# ------------------------------------------------------------------ 信封
def test_envelope_roundtrip() -> None:
    plaintext = "sk-test-abcdefghijklmnop"
    envelope = encrypt_secret(plaintext, PURPOSE_PROVIDER_APIKEY)
    assert envelope.startswith("hmj1.")
    assert decrypt_secret(envelope, PURPOSE_PROVIDER_APIKEY) == plaintext
    assert plaintext not in envelope  # 密文中不得出现明文


def test_envelope_randomized_per_call() -> None:
    first = encrypt_secret("same-value", PURPOSE_PROVIDER_APIKEY)
    second = encrypt_secret("same-value", PURPOSE_PROVIDER_APIKEY)
    assert first != second  # nonce 每次不同


def test_tampered_ciphertext_rejected() -> None:
    """篡改密文必须抛错（完整性校验）。"""
    envelope = encrypt_secret("secret-value", PURPOSE_PROVIDER_APIKEY)
    head, version, nonce, cipher = envelope.split(".")
    tampered = ".".join([head, version, nonce, cipher[:-4] + "AAAA"])
    with pytest.raises(SecretCryptoError):
        decrypt_secret(tampered, PURPOSE_PROVIDER_APIKEY)


def test_aad_purpose_binding() -> None:
    """换 purpose 就解不开 —— 防跨用途搬运密文。"""
    envelope = encrypt_secret("secret-value", PURPOSE_PROVIDER_APIKEY)
    with pytest.raises(SecretCryptoError):
        decrypt_secret(envelope, "another_purpose")


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "not-an-envelope",
        "hmj2.1.YWJj.YWJj",  # 版本号不对
        "hmj1.x.YWJj.YWJj",  # 版本号非整数
        "hmj1.1.YWJj",  # 段数不足
    ],
)
def test_malformed_envelope_rejected(bad: str) -> None:
    with pytest.raises(SecretCryptoError):
        decrypt_secret(bad, PURPOSE_PROVIDER_APIKEY)


# ------------------------------------------------------------------ 密码
def test_password_hash_and_verify() -> None:
    hashed = hash_password("Str0ng!Passw0rd")
    assert hashed != "Str0ng!Passw0rd"
    assert hashed.startswith("$argon2id$")
    assert verify_password("Str0ng!Passw0rd", hashed)
    assert not verify_password("wrong-password", hashed)


# ------------------------------------------------------------------ 令牌
def test_session_token_shape() -> None:
    token, prefix, token_hash = generate_session_token()
    assert len(token) >= 32
    assert token.startswith(prefix)
    assert token_hash == hash_token(token)


# ------------------------------------------------------------------ 邀请码
def test_invitation_code_format() -> None:
    code = generate_invitation_code()
    assert code.startswith("JEV-")
    parts = code.split("-")
    assert parts[0] == "JEV" and len(parts) == 4 and all(len(part) == 4 for part in parts[1:])
