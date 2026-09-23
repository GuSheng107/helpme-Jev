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
    normalize_invitation_code,
    verify_invitation_code,
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
def test_invitation_code_roundtrip() -> None:
    display, prefix, code_hash = generate_invitation_code()
    assert "-" in display
    assert len(prefix) == 8
    assert verify_invitation_code(display, code_hash)
    # 归一化（无分隔符）后也应通过
    assert verify_invitation_code(normalize_invitation_code(display), code_hash)
    # 小写输入也应通过
    assert verify_invitation_code(display.lower(), code_hash)


def test_invitation_code_rejects_wrong() -> None:
    _display, _prefix, code_hash = generate_invitation_code()
    assert not verify_invitation_code("WRONGCODE12345678", code_hash)
    assert not verify_invitation_code("", code_hash)
