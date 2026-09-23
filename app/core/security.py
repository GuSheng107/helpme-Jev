"""安全原语：密码哈希、Secret 信封加解密、会话令牌、邀请码。

信封格式：``hmj1.<key_version>.<nonce_b64url>.<ciphertext_and_tag_b64url>``

派生链路：``32B APP_SECRET --HKDF-SHA256(salt=None, info=...)--> AES-256-GCM 密钥``

AAD：``helpme-jev/<purpose>/v1`` —— **用途绑定**，不同 purpose 的密文不可互相搬运。

设计红线（见 DESIGN.md §6）：解密失败一律抛错拒绝，**绝不猜测降级**。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
from functools import lru_cache

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from .config import get_settings
from .constants import (
    AES_GCM_NONCE_BYTES,
    APP_SECRET_B64_LENGTH,
    APP_SECRET_BYTES,
    INVITATION_CODE_LENGTH,
    INVITATION_CODE_PREFIX_LEN,
    SECRET_AAD_PREFIX,
    SECRET_AAD_VERSION,
    SECRET_ENVELOPE_PREFIX,
    SECRET_HKDF_INFO,
    SECRET_KEY_VERSION,
)


class SecretCryptoError(Exception):
    """密文无法解密：格式非法 / 密钥不符 / 完整性校验失败。"""


# ================================================================== 密码
_password_hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _password_hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    try:
        return _password_hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


# ================================================================== 应用密钥
@lru_cache(maxsize=1)
def app_secret_bytes() -> bytes:
    """读取并校验 APP_SECRET（32 字节 CSPRNG 的 base64url，43 字符）。"""
    raw = (get_settings().app_secret or "").strip()
    if not raw:
        raise SecretCryptoError(
            "APP_SECRET 未配置：请在 .env 填入 32 字节 CSPRNG 的 base64url（43 字符）。"
            '生成：python -c "import base64,os;print(base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip(chr(61)))"'
        )
    if len(raw) != APP_SECRET_B64_LENGTH:
        raise SecretCryptoError(
            f"APP_SECRET 长度须为 {APP_SECRET_B64_LENGTH} 字符，当前 {len(raw)}"
        )
    try:
        key = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
    except Exception as exc:  # noqa: BLE001 - 统一转为本域异常
        raise SecretCryptoError("APP_SECRET 不是合法的 base64url 字符串") from exc
    if len(key) != APP_SECRET_BYTES:
        raise SecretCryptoError(f"APP_SECRET 解码后须为 {APP_SECRET_BYTES} 字节")
    return key


@lru_cache(maxsize=4)
def _derive_key(info: bytes) -> bytes:
    return HKDF(algorithm=SHA256(), length=32, salt=None, info=info).derive(app_secret_bytes())


def _aad(purpose: str) -> bytes:
    return f"{SECRET_AAD_PREFIX}/{purpose}/{SECRET_AAD_VERSION}".encode()


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64d(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def encrypt_secret(plaintext: str, purpose: str) -> str:
    """加密明文，返回带版本的信封字符串。"""
    nonce = os.urandom(AES_GCM_NONCE_BYTES)
    ciphertext = AESGCM(_derive_key(SECRET_HKDF_INFO)).encrypt(
        nonce, plaintext.encode("utf-8"), _aad(purpose)
    )
    return ".".join(
        [
            SECRET_ENVELOPE_PREFIX,
            str(SECRET_KEY_VERSION),
            _b64e(nonce),
            _b64e(ciphertext),
        ]
    )


def decrypt_secret(envelope: str, purpose: str) -> str:
    """解密信封。任何异常都抛 SecretCryptoError，**不做降级猜测**。"""
    parts = (envelope or "").split(".")
    if len(parts) != 4 or parts[0] != SECRET_ENVELOPE_PREFIX:
        raise SecretCryptoError("密文信封格式非法")

    try:
        version = int(parts[1])
    except ValueError as exc:
        raise SecretCryptoError("密文版本号非法") from exc
    if version != SECRET_KEY_VERSION:
        raise SecretCryptoError(f"不支持的密文版本：{version}")

    try:
        nonce = _b64d(parts[2])
        ciphertext = _b64d(parts[3])
    except Exception as exc:  # noqa: BLE001
        raise SecretCryptoError("密文 base64 解码失败") from exc
    if len(nonce) != AES_GCM_NONCE_BYTES:
        raise SecretCryptoError("nonce 长度非法")

    try:
        plaintext = AESGCM(_derive_key(SECRET_HKDF_INFO)).decrypt(
            nonce, ciphertext, _aad(purpose)
        )
    except InvalidTag as exc:
        raise SecretCryptoError("密文完整性校验失败（密钥不符或数据被篡改）") from exc
    return plaintext.decode("utf-8")


# ================================================================== 会话令牌
def hash_token(token: str) -> str:
    """确定性哈希，便于按 hash 反查（库里只存它）。"""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_session_token() -> tuple[str, str, str]:
    """返回 (明文 token, 前缀, 哈希)。明文**只回给调用方一次**。"""
    token = secrets.token_urlsafe(32)
    return token, token[:8], hash_token(token)


# ================================================================== 邀请码
# 去掉易混淆字符（0/O、1/I/L）
_INVITATION_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def normalize_invitation_code(plaintext: str) -> str:
    """归一化：大写、只保留字母数字（丢掉分隔符与空白）。"""
    return "".join(ch for ch in (plaintext or "").upper() if ch.isalnum())


def generate_invitation_code() -> tuple[str, str, str]:
    """返回 (展示用明文邀请码, 前缀, 哈希)。

    哈希基于**归一化形式**，展示形式带分隔符便于抄写。
    """
    raw = "".join(secrets.choice(_INVITATION_ALPHABET) for _ in range(INVITATION_CODE_LENGTH))
    display = "-".join(raw[i : i + 4] for i in range(0, INVITATION_CODE_LENGTH, 4))
    return display, raw[:INVITATION_CODE_PREFIX_LEN], hash_token(raw)


def verify_invitation_code(plaintext: str, code_hash: str) -> bool:
    normalized = normalize_invitation_code(plaintext)
    if not normalized:
        return False
    return hmac.compare_digest(hash_token(normalized), code_hash)
