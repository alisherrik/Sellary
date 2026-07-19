import pytest

from core.crypto import (
    SecretDecryptError,
    decrypt_secret,
    derive_fernet_key,
    encrypt_secret,
)

KEY = "unit-test-secret-key-at-least-32-chars-long!!"


def test_derived_key_is_32byte_urlsafe_b64_and_stable():
    k1 = derive_fernet_key(KEY)
    k2 = derive_fernet_key(KEY)
    assert k1 == k2
    import base64
    assert len(base64.urlsafe_b64decode(k1)) == 32


def test_encrypt_decrypt_roundtrip():
    token = encrypt_secret("123456:ABC-secret", secret_key=KEY)
    assert token != "123456:ABC-secret"  # ciphertext, not plaintext
    assert decrypt_secret(token, secret_key=KEY) == "123456:ABC-secret"


def test_encrypt_is_nondeterministic():
    # Fernet embeds a random IV — two encryptions differ but both decrypt.
    a = encrypt_secret("same", secret_key=KEY)
    b = encrypt_secret("same", secret_key=KEY)
    assert a != b
    assert decrypt_secret(a, secret_key=KEY) == "same"


def test_decrypt_with_wrong_key_raises():
    token = encrypt_secret("secret", secret_key=KEY)
    with pytest.raises(SecretDecryptError):
        decrypt_secret(token, secret_key="a-completely-different-secret-key-32c!")


def test_decrypt_garbage_raises():
    with pytest.raises(SecretDecryptError):
        decrypt_secret("not-a-valid-token", secret_key=KEY)
