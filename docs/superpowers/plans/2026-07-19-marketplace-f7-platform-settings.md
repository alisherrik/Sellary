# F7 — DB-backed, encrypted marketplace platform settings, configurable from the Owner panel

## Goal

Move the three platform-global marketplace secrets — `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_WEBHOOK_SECRET`, `CLOUDINARY_URL` — out of env-only config into a
Fernet-encrypted DB table editable from the super-admin **Owner panel**, so a
non-technical owner configures them in the UI without a redeploy. Values are
encrypted at rest with a key derived from the existing `SECRET_KEY`. A resolver
returns the DB value when present, else the existing `settings.*` env value, so
every current env-based deploy and every existing test keeps working unchanged.

These settings are **PLATFORM-GLOBAL** (a single shared bot / single Cloudinary
account), configured under `require_super_admin` in the Owner panel — NOT
per-company.

## Architecture

- New tenant-free table `platform_settings` (key → encrypted value). One row per
  logical secret key.
- `core/crypto.py` — Fernet helper deriving the key from `SECRET_KEY`; pure, no DB.
- `repositories/platform_setting_repository.py` — raw get/upsert of rows.
- `services/platform_settings_service.py` — encrypt on set / decrypt on get,
  masking for display, and the **resolver** that layers DB-over-env.
- Owner API: `GET /api/owner/platform-settings` (masked) + `PUT` (plaintext in,
  blank-preserves). Both gated by `require_super_admin`.
- Five existing call sites are rewired to resolve secrets through the service
  (with env fallback). `ImageUploadService` is refactored to take the resolved
  URL as an argument (resolved by the image-upload endpoint, which has `db`).
- Owner-panel UI gains a "Настройки платформы" (Platform settings) section with
  three masked inputs and a Save button.

## Tech Stack

- Backend: Python / FastAPI / SQLAlchemy 2.0 / Alembic / Pydantic v2 / pytest.
  New dependency: `cryptography` (for `cryptography.fernet.Fernet`).
- Frontend (owner panel): Next.js 14 App Router / TypeScript / axios (`ownerApi`)
  / vitest + React Testing Library.

## Global Constraints

- **Backend runs on port 8001**, not 8000.
- **Backend tests run from `sellary-backend/` with the venv active**
  (`.venv\Scripts\pytest.exe`). `core/database.py` connects at import time.
  Test isolation is **transaction rollback**, so in tests/repositories use
  `session.flush()`, **not** `session.commit()`.
- **Strict layering:** `api/ → services/ → repositories/ → models/`. Pydantic
  request/response models live in `schemas/`. Do not skip layers.
- **Migration:** the new migration MUST chain off the current live head
  `f7a8b9c0d1e2` (`add_merchant_notify_links`), and `railway.toml`'s
  `preDeployCommand = "alembic upgrade f7a8b9c0d1e2"` MUST be bumped to the new
  revision. `tests/unit/test_migration_chain.py` guards **exactly two heads**
  (the live head + the frozen dead head `20260319_0001`) and that the railway
  pin equals the live head — keep both green. Register the model in
  `models/__init__.py` (alembic's `env.py` does `from models import *`).
- **Secrets encrypted at rest** with a `SECRET_KEY`-derived Fernet key:
  `base64.urlsafe_b64encode(hashlib.sha256(settings.SECRET_KEY.encode()).digest())`.
  Rotating `SECRET_KEY` invalidates all stored secrets (documented).
- **Env fallback preserves existing behavior:** the resolver returns the DB value
  only when a non-empty decrypted value is stored; otherwise it returns
  `settings.<ENV_NAME>`. DB overrides env when present.
- **Owner endpoints use `require_super_admin`** (owner token, `OwnerContext`).
- **GET never returns plaintext secrets** — only masks (`is_set` + a masked
  hint). PUT accepts plaintext; a blank/omitted field leaves the stored value
  unchanged.
- After F7, the three env vars become **optional fallback** — note this in the
  deploy/verification step. Do not remove them.

## Masking contract (precise)

`GET /api/owner/platform-settings` returns, per key, an object:

```json
{ "is_set": true, "masked": "••••1234", "source": "db" }
```

- `is_set` — `true` iff the **resolved** value (DB-or-env) is non-empty.
- `masked` — never the plaintext. If a value exists: the string `"••••"` +
  the last 4 characters of the resolved value (or `"••••"` alone when the value
  is shorter than 4 chars). If not set: empty string `""`.
- `source` — `"db"` if a stored DB value is present, else `"env"` if only the env
  fallback is set, else `"unset"`.
- The plaintext is **never** serialized in any GET response.

## Blank-preserves-existing PUT semantics (precise)

`PUT /api/owner/platform-settings` body is `PlatformSettingsUpdate`, all fields
`str | None`, all optional:

```json
{ "telegram_bot_token": "123:new", "telegram_webhook_secret": null, "cloudinary_url": "" }
```

- A field that is **omitted** OR `null` OR an **empty/whitespace-only string** →
  the stored value is **left unchanged** (owner isn't forced to re-enter all
  three each save).
- A field with a **non-blank** string → the stored value is **replaced**
  (re-encrypted) with the trimmed plaintext.
- Response is the same masked shape as GET (so the UI can re-render immediately).

---

## Task 1 — Migration + `PlatformSetting` model

**Files**
- Create `sellary-backend/models/platform_setting.py`
- Modify `sellary-backend/models/__init__.py` (register model)
- Create `sellary-backend/alembic/versions/20260719_1600-<rev>_add_platform_settings.py`
- Modify `railway.toml` (bump `preDeployCommand` pin)
- Test: `sellary-backend/tests/unit/test_migration_chain.py` (existing guard — must stay green; no edit expected)

**Interfaces**
- Produces: `PlatformSetting` SQLAlchemy model; table `platform_settings`.
- Columns: `id` (PK int), `key` (`String(64)`, unique, not null, indexed),
  `encrypted_value` (`Text`, not null — holds the Fernet token, base64 text),
  `updated_at` (`DateTime(timezone=True)`, server_default now, onupdate now).
- Consumes: nothing.

**TDD steps**

1. RED — model import/registration test. Create
   `sellary-backend/tests/unit/test_platform_setting_model.py`:

   ```python
   from models import PlatformSetting
   from core.database import Base


   def test_platform_setting_registered_on_metadata():
       assert "platform_settings" in Base.metadata.tables
       cols = Base.metadata.tables["platform_settings"].columns
       assert {"id", "key", "encrypted_value", "updated_at"} <= set(cols.keys())
       assert cols["key"].unique is True


   def test_platform_setting_roundtrips_via_session(db_session):
       row = PlatformSetting(key="telegram_bot_token", encrypted_value="gAAAA...")
       db_session.add(row)
       db_session.flush()
       fetched = db_session.query(PlatformSetting).filter_by(key="telegram_bot_token").one()
       assert fetched.encrypted_value == "gAAAA..."
   ```

   Run: `.venv\Scripts\pytest.exe tests/unit/test_platform_setting_model.py -v` → fails (no model).

2. GREEN — create `models/platform_setting.py`:

   ```python
   """Platform-global, Fernet-encrypted settings editable from the Owner panel.

   Single shared values (Telegram bot token/webhook secret, Cloudinary URL) that
   used to be env-only. Values are stored encrypted (see core/crypto.py); the
   plaintext never touches this table. Not tenant-scoped — one row per key.
   """
   from sqlalchemy import Column, DateTime, Integer, String, Text
   from sqlalchemy.sql import func

   from core.database import Base


   class PlatformSetting(Base):
       __tablename__ = "platform_settings"

       id = Column(Integer, primary_key=True, index=True)
       key = Column(String(64), nullable=False, unique=True, index=True)
       encrypted_value = Column(Text, nullable=False)
       updated_at = Column(
           DateTime(timezone=True),
           server_default=func.now(),
           onupdate=func.now(),
           nullable=False,
       )
   ```

   Register in `models/__init__.py`: add `from .platform_setting import PlatformSetting`
   and add `"PlatformSetting"` to `__all__`.

3. GREEN — create the migration (chain off `f7a8b9c0d1e2`). Pick a fresh 12-char
   hex `<rev>` (e.g. `a8b9c0d1e2f3`):

   ```python
   """add platform_settings table (F7 owner-configurable secrets)

   Revision ID: a8b9c0d1e2f3
   Revises: f7a8b9c0d1e2
   Create Date: 2026-07-19 16:00:00
   """
   from typing import Sequence, Union
   from alembic import op
   import sqlalchemy as sa

   revision: str = "a8b9c0d1e2f3"
   down_revision: Union[str, None] = "f7a8b9c0d1e2"
   branch_labels = None
   depends_on = None


   def upgrade() -> None:
       op.create_table(
           "platform_settings",
           sa.Column("id", sa.Integer(), primary_key=True),
           sa.Column("key", sa.String(length=64), nullable=False),
           sa.Column("encrypted_value", sa.Text(), nullable=False),
           sa.Column("updated_at", sa.DateTime(timezone=True),
                     server_default=sa.text("now()"), nullable=False),
           sa.UniqueConstraint("key", name="uq_platform_settings_key"),
       )
       op.create_index("ix_platform_settings_key", "platform_settings", ["key"], unique=True)


   def downgrade() -> None:
       op.drop_index("ix_platform_settings_key", table_name="platform_settings")
       op.drop_table("platform_settings")
   ```

4. GREEN — bump `railway.toml`: change
   `preDeployCommand = "alembic upgrade f7a8b9c0d1e2"` →
   `preDeployCommand = "alembic upgrade a8b9c0d1e2f3"`.

5. VERIFY — run the model test and the guard:
   `.venv\Scripts\pytest.exe tests/unit/test_platform_setting_model.py tests/unit/test_migration_chain.py -v`
   Expect all green (two heads, railway pin == new live head).

---

## Task 2 — Crypto helper (`core/crypto.py`) + unit tests

**Files**
- Modify `sellary-backend/requirements.txt` (add `cryptography`)
- Create `sellary-backend/core/crypto.py`
- Test: `sellary-backend/tests/unit/test_crypto.py`

**Interfaces**
- Produces:
  - `derive_fernet_key(secret_key: str) -> bytes`
  - `encrypt_secret(plaintext: str, *, secret_key: str) -> str` (returns base64 token text)
  - `decrypt_secret(token: str, *, secret_key: str) -> str` (raises on wrong key/tamper)
  - `SecretDecryptError(Exception)` raised when a token can't be decrypted.
- Consumes: `cryptography.fernet.Fernet`, `hashlib`, `base64`.

**TDD steps**

1. Add `cryptography>=43,<46` to `requirements.txt` (it is NOT currently installed
   — verified). Install into the venv: `.venv\Scripts\python.exe -m pip install "cryptography>=43,<46"`.

2. RED — create `tests/unit/test_crypto.py`:

   ```python
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
   ```

   Run: `.venv\Scripts\pytest.exe tests/unit/test_crypto.py -v` → fails (no module).

3. GREEN — create `core/crypto.py`:

   ```python
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
   ```

4. VERIFY — `.venv\Scripts\pytest.exe tests/unit/test_crypto.py -v` all green.

---

## Task 3 — Repository + `PlatformSettingsService` (get/set/masked/resolve) + tests

**Files**
- Create `sellary-backend/repositories/platform_setting_repository.py`
- Create `sellary-backend/services/platform_settings_service.py`
- Test: `sellary-backend/tests/unit/test_platform_settings_service.py`

**Interfaces**
- `PlatformSettingRepository(db)`:
  - `get(key: str) -> PlatformSetting | None`
  - `upsert(key: str, encrypted_value: str) -> PlatformSetting` (flush, no commit)
- `PlatformSettingsService(db, *, settings=settings)`:
  - Class attr `KEYS: dict[str, str]` mapping logical key → env attr name:
    `{"telegram_bot_token": "TELEGRAM_BOT_TOKEN", "telegram_webhook_secret": "TELEGRAM_WEBHOOK_SECRET", "cloudinary_url": "CLOUDINARY_URL"}`
  - `resolve(key: str) -> str` — decrypted DB value if a non-empty one is stored,
    else `getattr(settings, KEYS[key], "")`. **This is the resolver.**
  - `set(key: str, plaintext: str) -> None` — encrypt + upsert (flush).
  - `get_masked() -> dict[str, dict]` — `{key: {is_set, masked, source}}` per the
    masking contract; never returns plaintext.
  - `update_from_payload(updates: dict[str, str | None]) -> None` — blank-preserves;
    only sets keys whose value is a non-blank trimmed string.
- Consumes: `core.crypto.encrypt_secret/decrypt_secret`, `core.config.settings`.

**TDD steps**

1. RED — create `tests/unit/test_platform_settings_service.py`:

   ```python
   import pytest

   from core.config import settings
   from services.platform_settings_service import PlatformSettingsService


   def test_resolve_falls_back_to_env_when_unset(db_session, monkeypatch):
       monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", "env-token")
       svc = PlatformSettingsService(db_session, settings=settings)
       assert svc.resolve("telegram_bot_token") == "env-token"


   def test_db_value_overrides_env(db_session, monkeypatch):
       monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", "env-token")
       svc = PlatformSettingsService(db_session, settings=settings)
       svc.set("telegram_bot_token", "db-token")
       db_session.flush()
       assert svc.resolve("telegram_bot_token") == "db-token"


   def test_set_stores_ciphertext_not_plaintext(db_session):
       from repositories.platform_setting_repository import PlatformSettingRepository
       svc = PlatformSettingsService(db_session, settings=settings)
       svc.set("cloudinary_url", "cloudinary://k:s@cloud")
       row = PlatformSettingRepository(db_session).get("cloudinary_url")
       assert row is not None
       assert "cloudinary://" not in row.encrypted_value  # encrypted


   def test_get_masked_never_returns_plaintext(db_session, monkeypatch):
       monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", "")
       svc = PlatformSettingsService(db_session, settings=settings)
       svc.set("telegram_bot_token", "1234567890SECRET")
       masked = svc.get_masked()
       row = masked["telegram_bot_token"]
       assert row["is_set"] is True
       assert row["source"] == "db"
       assert row["masked"] == "••••CRET"
       assert "SECRET" not in row["masked"]


   def test_get_masked_reports_env_source(db_session, monkeypatch):
       monkeypatch.setattr(settings, "CLOUDINARY_URL", "cloudinary://k:s@abcd")
       svc = PlatformSettingsService(db_session, settings=settings)
       row = svc.get_masked()["cloudinary_url"]
       assert row["is_set"] is True
       assert row["source"] == "env"
       assert row["masked"] == "••••abcd"


   def test_get_masked_reports_unset(db_session, monkeypatch):
       monkeypatch.setattr(settings, "TELEGRAM_WEBHOOK_SECRET", "")
       svc = PlatformSettingsService(db_session, settings=settings)
       row = svc.get_masked()["telegram_webhook_secret"]
       assert row == {"is_set": False, "masked": "", "source": "unset"}


   def test_update_from_payload_blank_preserves(db_session):
       svc = PlatformSettingsService(db_session, settings=settings)
       svc.set("telegram_bot_token", "original")
       db_session.flush()
       svc.update_from_payload(
           {"telegram_bot_token": "", "telegram_webhook_secret": None, "cloudinary_url": "  "}
       )
       db_session.flush()
       assert svc.resolve("telegram_bot_token") == "original"


   def test_update_from_payload_replaces_nonblank(db_session):
       svc = PlatformSettingsService(db_session, settings=settings)
       svc.set("telegram_bot_token", "original")
       db_session.flush()
       svc.update_from_payload({"telegram_bot_token": "  replaced  "})
       db_session.flush()
       assert svc.resolve("telegram_bot_token") == "replaced"  # trimmed
   ```

   Run → fails (no repo/service).

2. GREEN — `repositories/platform_setting_repository.py`:

   ```python
   from sqlalchemy import select
   from sqlalchemy.orm import Session

   from models.platform_setting import PlatformSetting


   class PlatformSettingRepository:
       def __init__(self, db: Session):
           self.db = db

       def get(self, key: str) -> PlatformSetting | None:
           return self.db.execute(
               select(PlatformSetting).where(PlatformSetting.key == key)
           ).scalar_one_or_none()

       def upsert(self, key: str, encrypted_value: str) -> PlatformSetting:
           existing = self.get(key)
           if existing is not None:
               existing.encrypted_value = encrypted_value
               self.db.flush()
               return existing
           row = PlatformSetting(key=key, encrypted_value=encrypted_value)
           self.db.add(row)
           self.db.flush()
           return row
   ```

3. GREEN — `services/platform_settings_service.py`:

   ```python
   """Platform-global settings with DB-over-env resolution and masking.

   resolve(key) is the single source of truth used by every call site: it returns
   the decrypted DB value when a non-empty one is stored, else the env fallback
   (settings.<ENV_NAME>). Storing writes a Fernet-encrypted token; plaintext never
   leaves this service except through resolve().
   """
   from __future__ import annotations

   from sqlalchemy.orm import Session

   from core.config import settings as default_settings
   from core.crypto import SecretDecryptError, decrypt_secret, encrypt_secret
   from repositories.platform_setting_repository import PlatformSettingRepository


   class PlatformSettingsService:
       KEYS: dict[str, str] = {
           "telegram_bot_token": "TELEGRAM_BOT_TOKEN",
           "telegram_webhook_secret": "TELEGRAM_WEBHOOK_SECRET",
           "cloudinary_url": "CLOUDINARY_URL",
       }

       def __init__(self, db: Session, *, settings=default_settings):
           self.db = db
           self.settings = settings
           self.repo = PlatformSettingRepository(db)

       def _stored_plaintext(self, key: str) -> str | None:
           row = self.repo.get(key)
           if row is None:
               return None
           try:
               value = decrypt_secret(row.encrypted_value, secret_key=self.settings.SECRET_KEY)
           except SecretDecryptError:
               # SECRET_KEY was rotated (or row tampered): treat as unset so the
               # env fallback still works instead of crashing every request.
               return None
           return value or None

       def _env_value(self, key: str) -> str:
           return getattr(self.settings, self.KEYS[key], "") or ""

       def resolve(self, key: str) -> str:
           stored = self._stored_plaintext(key)
           if stored:
               return stored
           return self._env_value(key)

       def set(self, key: str, plaintext: str) -> None:
           if key not in self.KEYS:
               raise ValueError(f"unknown platform setting: {key}")
           token = encrypt_secret(plaintext, secret_key=self.settings.SECRET_KEY)
           self.repo.upsert(key, token)

       @staticmethod
       def _mask(value: str) -> str:
           if not value:
               return ""
           return "••••" + value[-4:] if len(value) >= 4 else "••••"

       def get_masked(self) -> dict[str, dict]:
           out: dict[str, dict] = {}
           for key in self.KEYS:
               stored = self._stored_plaintext(key)
               if stored:
                   resolved, source = stored, "db"
               else:
                   env = self._env_value(key)
                   resolved, source = env, ("env" if env else "unset")
               out[key] = {
                   "is_set": bool(resolved),
                   "masked": self._mask(resolved),
                   "source": source,
               }
           return out

       def update_from_payload(self, updates: dict[str, str | None]) -> None:
           for key, raw in updates.items():
               if key not in self.KEYS:
                   continue
               if raw is None:
                   continue
               trimmed = raw.strip()
               if not trimmed:
                   continue  # blank preserves existing
               self.set(key, trimmed)
   ```

4. VERIFY — `.venv\Scripts\pytest.exe tests/unit/test_platform_settings_service.py -v` all green.

---

## Task 4 — Rewire the 5 call sites to the resolver (+ refactor ImageUploadService)

Thread the resolver through each site, keeping env fallback. Each site already
has a `db` in scope (or the caller does).

**Files**
- Modify `sellary-backend/api/shop_dependencies.py` (bot token, has `db`)
- Modify `sellary-backend/api/shop_orders.py` (`_send_notify` / notify gather)
- Modify `sellary-backend/services/merchant_notify_service.py` (bot token in ctor)
- Modify `sellary-backend/api/telegram_webhook.py` (webhook secret, has `db`)
- Modify `sellary-backend/services/image_upload_service.py` (take URL as arg)
- Modify `sellary-backend/api/products.py` (resolve URL, pass into service)
- Tests:
  - `sellary-backend/tests/unit/test_image_upload_service.py`
  - `sellary-backend/tests/integration/test_platform_settings_rewire.py`

**Interfaces**
- `ImageUploadService.__init__(self, cloudinary_url: str)` — URL passed IN
  (no more reading `settings`). `upload_product_image(...)` unchanged behavior;
  still raises `ValueError("Image upload not configured")` when URL is empty.
- `get_telegram_shopper` uses
  `PlatformSettingsService(db).resolve("telegram_bot_token")`.
- `MerchantNotifyService.__init__(self, db, *, bot_client=None)` builds its
  `TelegramBotClient` with `PlatformSettingsService(db).resolve("telegram_bot_token")`.
- `telegram_webhook._verify_secret` compares against
  `PlatformSettingsService(db).resolve("telegram_webhook_secret")`.

**TDD steps**

1. RED — `tests/unit/test_image_upload_service.py`:

   ```python
   import pytest

   from services.image_upload_service import ImageUploadService


   def test_unconfigured_url_raises_not_configured():
       svc = ImageUploadService("")
       with pytest.raises(ValueError) as exc:
           svc.upload_product_image(b"x", filename="a.png")
       assert "not configured" in str(exc.value)
   ```

   Run → fails (ctor still takes `settings`).

2. GREEN — refactor `services/image_upload_service.py`:

   ```python
   class ImageUploadService:
       def __init__(self, cloudinary_url: str) -> None:
           self._url = cloudinary_url or ""
           if self._url:
               cloudinary.config(cloudinary_url=self._url)
       # upload_product_image unchanged
   ```

3. GREEN — `api/products.py` image endpoint: resolve URL then pass in:

   ```python
   from services.platform_settings_service import PlatformSettingsService
   ...
       cloudinary_url = PlatformSettingsService(db).resolve("cloudinary_url")
       try:
           url = ImageUploadService(cloudinary_url).upload_product_image(
               data, filename=file.filename or "image"
           )
   ```

   (Drop the now-unused `settings` import if nothing else uses it — check first.)

4. GREEN — `api/shop_dependencies.py`: replace
   `bot_token=settings.TELEGRAM_BOT_TOKEN` with
   `bot_token=PlatformSettingsService(db).resolve("telegram_bot_token")`
   (import the service; keep `max_age_seconds=settings.TELEGRAM_AUTH_MAX_AGE_SECONDS`).

5. GREEN — `services/merchant_notify_service.py` ctor:

   ```python
   from services.platform_settings_service import PlatformSettingsService
   ...
       self._bot = bot_client or TelegramBotClient(
           bot_token=PlatformSettingsService(db).resolve("telegram_bot_token"),
           base_url=settings.TELEGRAM_API_BASE_URL,
       )
   ```

6. GREEN — `api/shop_orders.py` `_send_notify`: this DB-free background task
   already receives a plain `_NotifyPayload` (chat_ids + message) — it does NOT
   need the token to build the message. Resolve the bot token **inline in
   `place_orders`** (session open) and carry it on `_NotifyPayload` so the
   background send uses the resolved token without touching the DB:

   ```python
   @dataclasses.dataclass
   class _NotifyPayload:
       company_id: int
       chat_ids: list
       message: str
       bot_token: str

   def _send_notify(payload: _NotifyPayload) -> None:
       from core.config import settings
       from services.telegram_bot_client import TelegramBotClient
       try:
           bot = TelegramBotClient(
               bot_token=payload.bot_token,
               base_url=settings.TELEGRAM_API_BASE_URL,
           )
           ...
   ```

   In `place_orders`, resolve once before the loop:
   `resolved_bot_token = PlatformSettingsService(db).resolve("telegram_bot_token")`
   and pass it into each `_NotifyPayload(...)`.

7. GREEN — `api/telegram_webhook.py`: `_verify_secret` needs the resolved secret.
   Change it to take `configured: str` and resolve in the route:

   ```python
   def _verify_secret(secret_header: str | None, configured: str) -> None:
       if not configured or not secret_header or not hmac.compare_digest(secret_header, configured):
           raise HTTPException(status_code=403, detail="forbidden")

   @router.post("/webhook")
   def telegram_webhook(update, x_telegram_bot_api_secret_token=Header(default=None), db=Depends(get_db)):
       configured = PlatformSettingsService(db).resolve("telegram_webhook_secret")
       _verify_secret(x_telegram_bot_api_secret_token, configured)
       ...
   ```

8. RED/GREEN — integration `tests/integration/test_platform_settings_rewire.py`
   proving DB overrides env and env fallback still works. Example (webhook path,
   which is easiest to drive end-to-end):

   ```python
   from core.config import settings
   from services.platform_settings_service import PlatformSettingsService


   def test_webhook_uses_env_secret_when_no_db_value(client, monkeypatch):
       monkeypatch.setattr(settings, "TELEGRAM_WEBHOOK_SECRET", "env-secret")
       ok = client.post(
           "/api/telegram/webhook",
           json={"update_id": 1},
           headers={"X-Telegram-Bot-Api-Secret-Token": "env-secret"},
       )
       assert ok.status_code == 200
       bad = client.post(
           "/api/telegram/webhook",
           json={"update_id": 1},
           headers={"X-Telegram-Bot-Api-Secret-Token": "wrong"},
       )
       assert bad.status_code == 403


   def test_webhook_db_secret_overrides_env(client, db_session, monkeypatch):
       monkeypatch.setattr(settings, "TELEGRAM_WEBHOOK_SECRET", "env-secret")
       PlatformSettingsService(db_session).set("telegram_webhook_secret", "db-secret")
       db_session.flush()
       # env value now rejected, db value accepted
       assert client.post("/api/telegram/webhook", json={"update_id": 1},
                          headers={"X-Telegram-Bot-Api-Secret-Token": "env-secret"}).status_code == 403
       assert client.post("/api/telegram/webhook", json={"update_id": 1},
                          headers={"X-Telegram-Bot-Api-Secret-Token": "db-secret"}).status_code == 200
   ```

   NOTE on the shared session: confirm the test `client` fixture and `db_session`
   share the same transaction/session (they do in this suite — the app's `get_db`
   is overridden to the test session). If not, set the DB value via the service
   through the same session the request uses. Also, `TelegramUpdate` schema shape:
   send the minimal valid body the schema accepts (check `schemas/telegram.py`;
   `{"update_id": 1}` with no message is a graceful no-op → 200).

9. VERIFY — run the two new test files plus the previously touched suites:
   `.venv\Scripts\pytest.exe tests/unit/test_image_upload_service.py tests/integration/test_platform_settings_rewire.py -v`.

---

## Task 5 — Owner API: GET (masked) + PUT + tests

**Files**
- Create `sellary-backend/schemas/platform_settings.py`
- Modify `sellary-backend/api/owner.py` (add two routes)
- Test: `sellary-backend/tests/integration/test_owner_platform_settings.py`

**Interfaces**
- Schemas (Pydantic v2):
  - `PlatformSettingView`: `is_set: bool`, `masked: str`, `source: str`
  - `PlatformSettingsResponse`: `telegram_bot_token: PlatformSettingView`,
    `telegram_webhook_secret: PlatformSettingView`, `cloudinary_url: PlatformSettingView`
  - `PlatformSettingsUpdate`: `telegram_bot_token: str | None = None`,
    `telegram_webhook_secret: str | None = None`, `cloudinary_url: str | None = None`
- Routes (both `Depends(require_super_admin)`):
  - `GET /api/owner/platform-settings -> PlatformSettingsResponse`
  - `PUT /api/owner/platform-settings -> PlatformSettingsResponse`
    (calls `update_from_payload`, `db.commit()`, returns fresh masked view)

**TDD steps**

1. RED — `tests/integration/test_owner_platform_settings.py`:

   ```python
   def test_get_requires_super_admin(client, admin_headers):
       # a normal company access token must be rejected
       assert client.get("/api/owner/platform-settings", headers=admin_headers).status_code == 401


   def test_get_returns_masked_never_plaintext(client, owner_headers, db_session):
       from services.platform_settings_service import PlatformSettingsService
       PlatformSettingsService(db_session).set("telegram_bot_token", "12345SECRETXYZ")
       db_session.commit()
       resp = client.get("/api/owner/platform-settings", headers=owner_headers)
       assert resp.status_code == 200
       body = resp.json()
       assert body["telegram_bot_token"]["is_set"] is True
       assert body["telegram_bot_token"]["masked"] == "••••TXYZ"
       assert "SECRET" not in resp.text


   def test_put_sets_and_blank_preserves(client, owner_headers):
       # set all three
       client.put("/api/owner/platform-settings", headers=owner_headers, json={
           "telegram_bot_token": "botTOKEN1234",
           "telegram_webhook_secret": "hookSECRET",
           "cloudinary_url": "cloudinary://k:s@cloudNAME",
       })
       # second PUT leaves bot token blank → preserved
       resp = client.put("/api/owner/platform-settings", headers=owner_headers, json={
           "telegram_bot_token": "",
           "cloudinary_url": "cloudinary://k:s@newCLOUD",
       })
       body = resp.json()
       assert body["telegram_bot_token"]["masked"] == "••••1234"  # unchanged
       assert body["cloudinary_url"]["masked"] == "••••LOUD"      # replaced


   def test_put_requires_super_admin(client, admin_headers):
       assert client.put("/api/owner/platform-settings", headers=admin_headers,
                         json={"telegram_bot_token": "x"}).status_code == 401
   ```

   Run → fails (routes 404).

2. GREEN — `schemas/platform_settings.py`:

   ```python
   from pydantic import BaseModel


   class PlatformSettingView(BaseModel):
       is_set: bool
       masked: str
       source: str


   class PlatformSettingsResponse(BaseModel):
       telegram_bot_token: PlatformSettingView
       telegram_webhook_secret: PlatformSettingView
       cloudinary_url: PlatformSettingView


   class PlatformSettingsUpdate(BaseModel):
       telegram_bot_token: str | None = None
       telegram_webhook_secret: str | None = None
       cloudinary_url: str | None = None
   ```

3. GREEN — add to `api/owner.py`:

   ```python
   from schemas.platform_settings import PlatformSettingsResponse, PlatformSettingsUpdate
   from services.platform_settings_service import PlatformSettingsService


   @router.get("/platform-settings", response_model=PlatformSettingsResponse)
   def get_platform_settings(
       db: Session = Depends(get_db),
       owner: OwnerContext = Depends(require_super_admin),
   ):
       del owner
       return PlatformSettingsService(db).get_masked()


   @router.put("/platform-settings", response_model=PlatformSettingsResponse)
   def update_platform_settings(
       payload: PlatformSettingsUpdate,
       db: Session = Depends(get_db),
       owner: OwnerContext = Depends(require_super_admin),
   ):
       del owner
       service = PlatformSettingsService(db)
       service.update_from_payload(payload.model_dump())
       db.commit()
       return service.get_masked()
   ```

   (`get_masked()` returns a dict keyed exactly like the response model, so
   FastAPI validates it into `PlatformSettingsResponse`.)

4. VERIFY — `.venv\Scripts\pytest.exe tests/integration/test_owner_platform_settings.py -v` all green.

---

## Task 6 — Owner-panel UI section (3 masked inputs + save) + tests

**Files**
- Modify `sellary-frontend/src/lib/types.ts` (add `PlatformSettingsView`,
  `PlatformSettingsResponse`, `PlatformSettingsUpdatePayload`)
- Modify `sellary-frontend/src/lib/api.ts` (`ownerApi.getPlatformSettings`,
  `ownerApi.updatePlatformSettings`)
- Create `sellary-frontend/src/components/owner/PlatformSettingsSection.tsx`
- Modify `sellary-frontend/src/components/owner/OwnerDashboard.tsx` (render the
  section + load its data)
- Test: `sellary-frontend/src/components/owner/__tests__/PlatformSettingsSection.test.tsx`

**Interfaces**
- Types:
  ```ts
  export interface PlatformSettingView { is_set: boolean; masked: string; source: 'db' | 'env' | 'unset'; }
  export interface PlatformSettingsResponse {
    telegram_bot_token: PlatformSettingView;
    telegram_webhook_secret: PlatformSettingView;
    cloudinary_url: PlatformSettingView;
  }
  export interface PlatformSettingsUpdatePayload {
    telegram_bot_token?: string;
    telegram_webhook_secret?: string;
    cloudinary_url?: string;
  }
  ```
- `ownerApi`:
  ```ts
  getPlatformSettings: () => ownerClient.get<PlatformSettingsResponse>('/owner/platform-settings'),
  updatePlatformSettings: (data: PlatformSettingsUpdatePayload) =>
    ownerClient.put<PlatformSettingsResponse>('/owner/platform-settings', data),
  ```
- `PlatformSettingsSection` props: `{ settings: PlatformSettingsResponse; onSave: (payload: PlatformSettingsUpdatePayload) => Promise<void>; }`
  - Three `password`-type inputs (bot token, webhook secret, cloudinary URL),
    each with a placeholder showing the masked/`Задано (••••1234)` vs
    `Не задано` hint and source label. Empty inputs are omitted from the payload
    (blank-preserves). Save button submits only the non-empty fields.

**TDD steps**

1. RED — `src/components/owner/__tests__/PlatformSettingsSection.test.tsx`:

   ```tsx
   import { render, screen, fireEvent, waitFor } from '@testing-library/react';
   import { describe, it, expect, vi } from 'vitest';
   import PlatformSettingsSection from '../PlatformSettingsSection';

   const settings = {
     telegram_bot_token: { is_set: true, masked: '••••1234', source: 'db' as const },
     telegram_webhook_secret: { is_set: false, masked: '', source: 'unset' as const },
     cloudinary_url: { is_set: true, masked: '••••abcd', source: 'env' as const },
   };

   it('shows masked hints and never renders plaintext', () => {
     render(<PlatformSettingsSection settings={settings} onSave={vi.fn()} />);
     expect(screen.getByText(/••••1234/)).toBeInTheDocument();
     expect(screen.getByText(/Не задано/)).toBeInTheDocument();
   });

   it('omits blank fields from the save payload (blank preserves)', async () => {
     const onSave = vi.fn().mockResolvedValue(undefined);
     render(<PlatformSettingsSection settings={settings} onSave={onSave} />);
     fireEvent.change(screen.getByLabelText(/Токен бота/i), { target: { value: 'newTOKEN' } });
     fireEvent.click(screen.getByRole('button', { name: /Сохранить/i }));
     await waitFor(() => expect(onSave).toHaveBeenCalledWith({ telegram_bot_token: 'newTOKEN' }));
   });
   ```

   Run: `npx vitest run src/components/owner/__tests__/PlatformSettingsSection.test.tsx` → fails.

2. GREEN — create `PlatformSettingsSection.tsx` (mirror the existing
   `SectionCard`/`TextInput` styling in `OwnerDashboard.tsx`; three labeled
   password inputs, a hint line per field driven by `is_set`/`masked`/`source`,
   a single Save button that builds a payload of only the non-empty inputs and
   calls `onSave`). Russian UI strings to match the panel.

3. GREEN — wire into `OwnerDashboard.tsx`: add
   `const [platformSettings, setPlatformSettings] = useState<PlatformSettingsResponse | null>(null)`,
   load it in `loadAll` via `ownerApi.getPlatformSettings()`, add a
   `handleSavePlatformSettings` calling `ownerApi.updatePlatformSettings(payload)`
   + toast + reload, and render `<PlatformSettingsSection ... />` (guarded on
   `platformSettings`). Nav: the owner panel is a single scrolling dashboard —
   adding the section IS the navigation; no separate route needed.

4. GREEN — add types to `types.ts` and methods to `ownerApi` in `api.ts`.

5. VERIFY — `npx vitest run src/components/owner/__tests__/PlatformSettingsSection.test.tsx`
   and (optionally) `npx vitest run src/lib/__tests__` to confirm no owner-api regressions.

---

## Task 7 — Full-suite / compile / migration-guard verification + deploy note

**Files**
- Modify `sellary-backend/.env.example` (comment: the three vars are now optional
  fallback, DB-configurable in the Owner panel)
- No new code.

**TDD/verify steps**

1. Backend compile gate (the CI gate, no DB needed):
   `.venv\Scripts\python.exe -m compileall api core models repositories schemas services main.py`

2. Full backend suite from `sellary-backend/` with venv:
   `.venv\Scripts\pytest.exe tests/integration tests/unit -q`
   Confirm the migration-chain guard passes (two heads; railway pin ==
   `a8b9c0d1e2f3`) and all pre-existing tests are unaffected (env-fallback proof).

3. Frontend: `npx vitest run` and `npm run build` in `sellary-frontend/`.

4. Deploy note (documentation only, no redeploy here): after F7,
   `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, and `CLOUDINARY_URL` become
   **optional env fallbacks** — a fresh deploy can leave them unset and configure
   them in the Owner panel instead. Document in `.env.example` that rotating
   `SECRET_KEY` invalidates DB-stored secrets (they must be re-entered).

---

## Self-Review Notes (scope item → task)

- Move 3 secrets to a DB table → **Task 1** (model + migration).
- Fernet encryption from SECRET_KEY-derived key; document rotation invalidates →
  **Task 2** (`core/crypto.py`) + **Task 7** (`.env.example` note).
- `cryptography` dependency check (NOT installed — must be added) → **Task 2**
  (add to `requirements.txt` + install).
- Resolver with env fallback (DB overrides env) → **Task 3**
  (`PlatformSettingsService.resolve`).
- Masking contract (`is_set`/`masked`/`source`, never plaintext) → **Task 3**
  (`get_masked`) + **Task 5** (GET response) + **Task 6** (UI hints).
- Blank-preserves PUT semantics → **Task 3** (`update_from_payload`) + **Task 5**
  (PUT route) + **Task 6** (payload omits blanks).
- Rewire `shop_dependencies.py:26` (bot token) → **Task 4 step 4**.
- Rewire `shop_orders.py:68` (notify bot token) → **Task 4 step 6**.
- Rewire `merchant_notify_service.py:32` (bot token in ctor) → **Task 4 step 5**.
- Rewire `telegram_webhook.py:20` (webhook secret) → **Task 4 step 7**.
- Refactor `image_upload_service.py:17` to take URL in; caller `products.py`
  resolves; keep 503 → **Task 4 steps 2-3**.
- DB-overrides-env AND env-fallback-still-works proof → **Task 3** unit tests +
  **Task 4 step 8** integration tests.
- Owner API GET(masked)/PUT, super-admin only → **Task 5**.
- Owner-panel UI (3 masked inputs + save) + nav → **Task 6**.
- Migration chains off `f7a8b9c0d1e2` + bump `railway.toml` + two-heads guard →
  **Task 1** (+ verified in **Task 7**).
- Model registration (`models/__init__.py`; alembic `from models import *`) →
  **Task 1**.
- Full-suite / compile / migration-guard / frontend build → **Task 7**.
