"""Fernet symmetric encryption for platform secrets stored at rest.

The key is derived from the app's SECRET_KEY so no new env var is needed:
    key = urlsafe_b64encode( sha256(SECRET_KEY) )  # 32-byte urlsafe key
NOTE: rotating SECRET_KEY invalidates every previously stored secret — they
must be re-entered in the Owner panel after a rotation.
"""
from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken


class SecretDecryptError(Exception):
    """Raised when a stored token cannot be decrypted (wrong key / tampered)."""


def derive_fernet_key(secret_key: str) -> bytes:
    digest = hashlib.sha256(secret_key.encode()).digest()
    return base64.urlsafe_b64encode(digest)


def encrypt_secret(plaintext: str, *, secret_key: str) -> str:
    f = Fernet(derive_fernet_key(secret_key))
    return f.encrypt(plaintext.encode()).decode()


def decrypt_secret(token: str, *, secret_key: str) -> str:
    f = Fernet(derive_fernet_key(secret_key))
    try:
        return f.decrypt(token.encode()).decode()
    except (InvalidToken, ValueError, TypeError) as exc:
        raise SecretDecryptError("could not decrypt stored secret") from exc
