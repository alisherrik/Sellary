# Marketplace F2 — Public Catalog API + Telegram initData Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Follow TDD: write the failing test, run it, make it pass, commit.

**Goal:** Add the shopper-facing read API and identity layer for the Sellary Telegram marketplace. Verify Telegram Mini App `initData` (HMAC-SHA256 against the bot token), get-or-create a global `telegram_users` identity, and expose an unauthenticated-by-company `/api/shop/*` catalog: products (published + shop-enabled), single product, shops, single shop storefront, and categories, with `search` / `category` / `company` filters and pagination.

**Architecture:** Extend the single FastAPI backend. A new global `telegram_users` table (no login) plus a nullable `customers.telegram_id` (partial-unique per `(company_id, telegram_id)`, mirroring the existing `client_customer_id` pattern). A stateless `initData` verification service and a FastAPI dependency (`get_telegram_shopper`) that reads header `X-Telegram-Init-Data`, verifies it, and yields the shopper. A new `/api/shop` router backed by a shop service + shop repository that gate on `products.is_published = true` AND `companies.is_marketplace_enabled = true` across all tenants (this is the ONE place tenant scope is intentionally cross-company, read-only). No orders — that is F4.

**Tech Stack:** Python 3 / FastAPI / SQLAlchemy / Alembic / Pydantic v2 / pytest. `hashlib` / `hmac` from stdlib for initData verification (no new dependency).

## Global Constraints

Binding rules — copied verbatim; do not deviate:

- Backend runs on port **8001** (not 8000); all commands run from `sellary-backend/` with the venv active (`.venv\Scripts\python.exe`, `.venv\Scripts\pytest.exe`).
- Test isolation is **transaction-rollback**: in tests use `db_session.flush()` (not `session.commit()`) for staging; API-path tests share the request-scoped `db_session` via the `client` fixture. Never rely on real persistence across a test.
- **Every new Alembic migration MUST chain off the current live head `c9d0e1f2a3b4` and bump `railway.toml`'s `preDeployCommand = "alembic upgrade <rev>"` to the new revision.** The guard test `tests/unit/test_migration_chain.py` enforces **exactly two heads** (the live head + the dead `20260319_0001`) and that the Railway pin equals the live head. The dead head `20260319_0001` must remain untouched (no `alembic merge`).
- Layering is strict: `api/ (routers) → services/ (business logic) → repositories/ (DB queries) → models/ (SQLAlchemy)`. Pydantic request/response models live in `schemas/`.
- **initData HMAC-SHA256 verification is mandatory** on the shopper identity path; forged data and a stale `auth_date` (older than the configured max age) MUST be rejected. Without it anyone could act as any `telegram_id`.
- CI gate is `python -m compileall api core models repositories schemas services main.py` (must pass with no DB).
- The new `TelegramUser` model MUST be registered in `models/__init__.py` (both the import and `__all__`) because `alembic/env.py` does `from models import *` and the test suite builds the schema from `Base.metadata`.

## Confirmed ground truth (verified against the repo)

- **Current live migration head: `c9d0e1f2a3b4`** (`20260719_1200-c9d0e1f2a3b4_add_marketplace_fields.py`, `down_revision = "b8c9d0e1f2a3"`). `railway.toml` already pins `alembic upgrade c9d0e1f2a3b4`. This plan chains the new migration off `c9d0e1f2a3b4` and re-pins Railway to the new revision.
- F1 already added `products.is_published` / `products.image_url` and `companies.is_marketplace_enabled` / `logo_url` / `marketplace_description` / `supports_delivery` / `supports_pickup` to the models AND the DB (migration `c9d0e1f2a3b4`). F2 consumes these; it does not re-add them.
- `customers.telegram_id` does **not** exist yet — F2 adds it (the design doc lists it as an F1 table change, but F1's plan explicitly deferred `telegram_users` + `customers.telegram_id` to F2). This plan owns both.
- Partial-unique-index pattern to mirror: `models/customer.py` (`uq_customers_company_client_customer_id`, `postgresql_where` + `sqlite_where`) and migration `20260711_0000-d4e5f6a7b8c9_add_customer_client_customer_id.py`.
- `resolve_company_id` in `services/tenant.py` is for tenant-scoped services; the shop service is deliberately cross-company, so it does NOT use it.
- Fixtures available in `tests/conftest.py`: `client`, `db_session`, `default_company`, `secondary_company`, `test_product`, `test_category`, `manager_headers`. `tests/integration/conftest.py` auto-opens a cash shift (irrelevant to reads).

---

### Task 1: Migration — `telegram_users` table + `customers.telegram_id`

**Files:**
- Create: `sellary-backend/alembic/versions/20260719_1300-d0e1f2a3b4c5_add_telegram_users_and_customer_telegram_id.py`
- Modify: `railway.toml` (repo root, `preDeployCommand` line)
- Test: reuse `sellary-backend/tests/unit/test_migration_chain.py` (no edit — it must still pass with the new head)

**Interfaces:**
- Produces: table `telegram_users(id, telegram_id BIGINT UNIQUE NOT NULL, first_name, username, phone NULL, created_at)`; column `customers.telegram_id BIGINT NULL` with index `ix_customers_telegram_id` and partial-unique index `uq_customers_company_telegram_id` on `(company_id, telegram_id)` where `telegram_id IS NOT NULL`. New live migration head `d0e1f2a3b4c5`.

- [ ] **Step 1: Create the migration**

Create `sellary-backend/alembic/versions/20260719_1300-d0e1f2a3b4c5_add_telegram_users_and_customer_telegram_id.py`:

```python
"""add telegram_users table and customers.telegram_id

F2 (marketplace public catalog + Telegram identity). telegram_users is the
global, login-less shopper identity keyed by a verified Telegram user id.
customers.telegram_id links a per-shop Customer to that global shopper; it is
nullable (web/POS-created customers have none) and a partial unique index
dedupes it per company while leaving NULLs unconstrained — mirroring the
client_customer_id pattern. Chains off the F1 head c9d0e1f2a3b4; the dead
20260319_0001 head is intentionally left untouched (no alembic merge).

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-07-19 13:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d0e1f2a3b4c5"
down_revision: Union[str, None] = "c9d0e1f2a3b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "telegram_users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("telegram_id", sa.BigInteger(), nullable=False),
        sa.Column("first_name", sa.String(length=150), nullable=True),
        sa.Column("username", sa.String(length=150), nullable=True),
        sa.Column("phone", sa.String(length=32), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_telegram_users_telegram_id",
        "telegram_users",
        ["telegram_id"],
        unique=True,
    )

    # Small table (retail POS); DDL is fast and taken inside the migration
    # transaction, so no CONCURRENTLY / long-lock concern.
    op.add_column(
        "customers", sa.Column("telegram_id", sa.BigInteger(), nullable=True)
    )
    op.create_index(
        "ix_customers_telegram_id", "customers", ["telegram_id"]
    )
    op.create_index(
        "uq_customers_company_telegram_id",
        "customers",
        ["company_id", "telegram_id"],
        unique=True,
        postgresql_where=sa.text("telegram_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_customers_company_telegram_id", table_name="customers")
    op.drop_index("ix_customers_telegram_id", table_name="customers")
    op.drop_column("customers", "telegram_id")
    op.drop_index("ix_telegram_users_telegram_id", table_name="telegram_users")
    op.drop_table("telegram_users")
```

- [ ] **Step 2: Bump the Railway migration pin**

In `railway.toml` (repo root), change:

```toml
preDeployCommand = "alembic upgrade c9d0e1f2a3b4"
```

to:

```toml
preDeployCommand = "alembic upgrade d0e1f2a3b4c5"
```

- [ ] **Step 3: Run the migration-chain guard to verify it passes**

Run: `.venv\Scripts\pytest.exe tests/unit/test_migration_chain.py -v`
Expected: PASS — exactly two heads (`d0e1f2a3b4c5` + dead `20260319_0001`); Railway pin equals the live head `d0e1f2a3b4c5`; lineage walks to base without touching the dead head.

- [ ] **Step 4: Commit**

```bash
git add sellary-backend/alembic/versions/20260719_1300-d0e1f2a3b4c5_add_telegram_users_and_customer_telegram_id.py railway.toml
git commit -m "feat(marketplace): migration for telegram_users + customers.telegram_id"
```

---

### Task 2: `TelegramUser` model + `customers.telegram_id` mapping

**Files:**
- Create: `sellary-backend/models/telegram_user.py`
- Modify: `sellary-backend/models/customer.py` (add `telegram_id` column + partial-unique index)
- Modify: `sellary-backend/models/__init__.py` (import + `__all__`)
- Test: `sellary-backend/tests/unit/test_telegram_user_model.py`

**Interfaces:**
- Produces: `TelegramUser(id, telegram_id: int, first_name: str | None, username: str | None, phone: str | None, created_at)` with unique `telegram_id`. `Customer.telegram_id: int | None`. Both visible to `Base.metadata` (so `create_all` in tests builds them).

- [ ] **Step 1: Write the failing test**

Create `sellary-backend/tests/unit/test_telegram_user_model.py`:

```python
"""TelegramUser persists a global shopper identity; Customer gains telegram_id."""
from decimal import Decimal

import pytest

from models.customer import Customer
from models.telegram_user import TelegramUser


def test_telegram_user_defaults(db_session):
    tu = TelegramUser(telegram_id=123456789, first_name="Ali", username="ali")
    db_session.add(tu)
    db_session.flush()
    assert tu.id is not None
    assert tu.phone is None
    assert tu.created_at is not None


def test_telegram_id_is_unique(db_session):
    db_session.add(TelegramUser(telegram_id=555, first_name="A"))
    db_session.flush()
    db_session.add(TelegramUser(telegram_id=555, first_name="B"))
    with pytest.raises(Exception):
        db_session.flush()


def test_customer_has_nullable_telegram_id(db_session, default_company):
    customer = Customer(company_id=default_company.id, name="Web Cust")
    db_session.add(customer)
    db_session.flush()
    assert customer.telegram_id is None
    customer.telegram_id = 987654321
    db_session.flush()
    assert customer.telegram_id == 987654321
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest.exe tests/unit/test_telegram_user_model.py -v`
Expected: FAIL — `ModuleNotFoundError: models.telegram_user` (and `Customer` has no `telegram_id`).

- [ ] **Step 3: Create the model**

Create `sellary-backend/models/telegram_user.py`:

```python
from sqlalchemy import BigInteger, Column, DateTime, Integer, String
from sqlalchemy.sql import func

from core.database import Base


class TelegramUser(Base):
    """Global, login-less shopper identity, keyed by a verified Telegram id.

    Created on the shopper's first authenticated request via get-or-create.
    ``phone`` is captured later (shared on first order); browsing needs none.
    """

    __tablename__ = "telegram_users"

    id = Column(Integer, primary_key=True, index=True)
    telegram_id = Column(BigInteger, unique=True, index=True, nullable=False)
    first_name = Column(String(150), nullable=True)
    username = Column(String(150), nullable=True)
    phone = Column(String(32), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
```

- [ ] **Step 4: Add `telegram_id` to `Customer`**

In `sellary-backend/models/customer.py`, add to `__table_args__` (after the `client_customer_id` index block, before the closing `)`):

```python
        Index(
            "uq_customers_company_telegram_id",
            "company_id",
            "telegram_id",
            unique=True,
            sqlite_where=text("telegram_id IS NOT NULL"),
            postgresql_where=text("telegram_id IS NOT NULL"),
        ),
```

and add the column after `client_customer_id` (around line 42):

```python
    # F2 marketplace: links this per-shop Customer to a global Telegram shopper.
    # NULL for web/POS-created rows; the partial unique index (above) dedupes per
    # company without constraining NULLs — mirrors client_customer_id.
    telegram_id = Column(BigInteger, nullable=True, index=True)
```

Add `BigInteger` to the `sqlalchemy` import block at the top of `customer.py`:

```python
from sqlalchemy import (
    BigInteger,
    Column,
    Integer,
    String,
    DateTime,
    Boolean,
    ForeignKey,
    UniqueConstraint,
    Index,
    text,
)
```

- [ ] **Step 5: Register the model so `Base.metadata` and alembic see it**

In `sellary-backend/models/__init__.py`, add the import (after `from .customer import Customer`):

```python
from .telegram_user import TelegramUser
```

and add `"TelegramUser",` to the `__all__` list.

- [ ] **Step 6: Run tests to verify they pass**

Run: `.venv\Scripts\pytest.exe tests/unit/test_telegram_user_model.py -v`
Expected: PASS — insert/defaults, unique `telegram_id`, nullable `Customer.telegram_id`.

- [ ] **Step 7: Commit**

```bash
git add sellary-backend/models/telegram_user.py sellary-backend/models/customer.py sellary-backend/models/__init__.py sellary-backend/tests/unit/test_telegram_user_model.py
git commit -m "feat(marketplace): TelegramUser model + customers.telegram_id mapping"
```

---

### Task 3: Config `TELEGRAM_BOT_TOKEN` + `TELEGRAM_AUTH_MAX_AGE` + initData verify service

**Files:**
- Modify: `sellary-backend/core/config.py` (add settings after `CLOUDINARY_URL`)
- Modify: `sellary-backend/.env.example` (document the keys)
- Create: `sellary-backend/services/telegram_auth_service.py`
- Test: `sellary-backend/tests/unit/test_telegram_auth_service.py`

**Interfaces:**
- Produces:
  - `Settings.TELEGRAM_BOT_TOKEN: str = ""`, `Settings.TELEGRAM_AUTH_MAX_AGE_SECONDS: int = 86400`.
  - `parse_and_verify_init_data(init_data: str, *, bot_token: str, max_age_seconds: int | None = None, now: int | None = None) -> TelegramInitData` where `TelegramInitData` is a dataclass `(telegram_id: int, first_name: str | None, username: str | None, auth_date: int, raw_user: dict)`.
  - Raises `TelegramAuthError` (a `ValueError` subclass) with messages: `"init data not configured"` (empty bot token), `"malformed init data"` (missing `hash`/`user`/`auth_date` or unparseable), `"invalid init data signature"` (hash mismatch), `"init data expired"` (stale `auth_date`).

**initData algorithm (official Telegram Web App validation):** `init_data` is a URL-encoded query string. Take all key/value pairs except `hash`, sort keys alphabetically, join as `k=v` lines separated by `\n` into `data_check_string`. Compute `secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token)`, then `computed = HMAC_SHA256(key=secret_key, msg=data_check_string).hexdigest()`. It is valid iff `computed == hash`. The `user` field is a JSON string; `auth_date` is a unix timestamp — reject if `now - auth_date > max_age_seconds`. Use `hmac.compare_digest` for the comparison.

- [ ] **Step 1: Write the failing test**

Create `sellary-backend/tests/unit/test_telegram_auth_service.py`:

```python
"""initData HMAC verification against a known bot token + computed hash."""
import hashlib
import hmac
import json
from urllib.parse import urlencode

import pytest

from services.telegram_auth_service import (
    TelegramAuthError,
    parse_and_verify_init_data,
)

BOT_TOKEN = "123456:TEST-BOT-TOKEN"


def _sign(fields: dict, bot_token: str = BOT_TOKEN) -> str:
    """Build a valid init_data query string signed like Telegram does."""
    data_check_string = "\n".join(
        f"{k}={fields[k]}" for k in sorted(fields)
    )
    secret_key = hmac.new(
        b"WebAppData", bot_token.encode(), hashlib.sha256
    ).digest()
    computed = hmac.new(
        secret_key, data_check_string.encode(), hashlib.sha256
    ).hexdigest()
    return urlencode({**fields, "hash": computed})


def _fields(telegram_id=42, auth_date=1_700_000_000, username="shopper"):
    user = json.dumps(
        {"id": telegram_id, "first_name": "Ali", "username": username},
        separators=(",", ":"),
    )
    return {"auth_date": str(auth_date), "query_id": "abc", "user": user}


def test_valid_init_data_parses_identity():
    init_data = _sign(_fields())
    result = parse_and_verify_init_data(
        init_data, bot_token=BOT_TOKEN, now=1_700_000_100
    )
    assert result.telegram_id == 42
    assert result.username == "shopper"
    assert result.first_name == "Ali"
    assert result.auth_date == 1_700_000_000


def test_forged_hash_rejected():
    fields = _fields()
    fields["hash"] = "deadbeef" * 8  # wrong signature
    init_data = urlencode(fields)
    with pytest.raises(TelegramAuthError, match="signature"):
        parse_and_verify_init_data(
            init_data, bot_token=BOT_TOKEN, now=1_700_000_100
        )


def test_tampered_payload_rejected():
    # Sign, then mutate the user id after signing → hash no longer matches.
    init_data = _sign(_fields(telegram_id=42))
    tampered = init_data.replace("%22id%22%3A42", "%22id%22%3A99")
    assert tampered != init_data
    with pytest.raises(TelegramAuthError, match="signature"):
        parse_and_verify_init_data(
            tampered, bot_token=BOT_TOKEN, now=1_700_000_100
        )


def test_stale_auth_date_rejected():
    init_data = _sign(_fields(auth_date=1_700_000_000))
    with pytest.raises(TelegramAuthError, match="expired"):
        parse_and_verify_init_data(
            init_data,
            bot_token=BOT_TOKEN,
            max_age_seconds=60,
            now=1_700_000_000 + 3600,
        )


def test_wrong_bot_token_rejected():
    init_data = _sign(_fields(), bot_token="999:OTHER")
    with pytest.raises(TelegramAuthError, match="signature"):
        parse_and_verify_init_data(
            init_data, bot_token=BOT_TOKEN, now=1_700_000_100
        )


def test_empty_bot_token_rejected():
    with pytest.raises(TelegramAuthError, match="not configured"):
        parse_and_verify_init_data("auth_date=1&hash=x", bot_token="")


def test_missing_hash_rejected():
    with pytest.raises(TelegramAuthError, match="malformed"):
        parse_and_verify_init_data(
            "auth_date=1&user=%7B%7D", bot_token=BOT_TOKEN
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest.exe tests/unit/test_telegram_auth_service.py -v`
Expected: FAIL — `ModuleNotFoundError: services.telegram_auth_service`.

- [ ] **Step 3: Add config settings**

In `sellary-backend/core/config.py`, add to the `Settings` class after `CLOUDINARY_URL` (line 31):

```python
    # Telegram Mini App marketplace. BOT token is used to verify shopper initData
    # HMAC-SHA256 signatures. Empty disables the /api/shop identity path (returns
    # 503). Read from env in production. Max-age rejects replayed/stale initData.
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_AUTH_MAX_AGE_SECONDS: int = 86400  # 24h
```

In `sellary-backend/.env.example`, add:

```
# Telegram Mini App marketplace bot token (from @BotFather). Leave blank to
# disable the shopper /api/shop identity path.
TELEGRAM_BOT_TOKEN=
TELEGRAM_AUTH_MAX_AGE_SECONDS=86400
```

- [ ] **Step 4: Write the service**

Create `sellary-backend/services/telegram_auth_service.py`:

```python
"""Verify Telegram Web App ``initData`` per the official algorithm.

The Mini App sends ``initData`` (a URL-encoded query string) on every request.
We rebuild the data-check-string (all fields except ``hash``, sorted, joined by
newlines), derive ``secret_key = HMAC_SHA256("WebAppData", bot_token)``, and
compare ``HMAC_SHA256(secret_key, data_check_string)`` against the supplied
``hash`` with a constant-time compare. A stale ``auth_date`` is rejected so a
leaked initData string cannot be replayed indefinitely.

Reference: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from urllib.parse import parse_qsl


class TelegramAuthError(ValueError):
    """Raised when initData is missing, malformed, forged, or expired."""


@dataclass(frozen=True)
class TelegramInitData:
    telegram_id: int
    first_name: str | None
    username: str | None
    auth_date: int
    raw_user: dict


def parse_and_verify_init_data(
    init_data: str,
    *,
    bot_token: str,
    max_age_seconds: int | None = None,
    now: int | None = None,
) -> TelegramInitData:
    if not bot_token:
        raise TelegramAuthError("init data not configured")
    if not init_data:
        raise TelegramAuthError("malformed init data")

    # keep_blank_values so an empty field still contributes to the check string.
    pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = pairs.pop("hash", None)
    if not received_hash or "auth_date" not in pairs or "user" not in pairs:
        raise TelegramAuthError("malformed init data")

    data_check_string = "\n".join(
        f"{key}={pairs[key]}" for key in sorted(pairs)
    )
    secret_key = hmac.new(
        b"WebAppData", bot_token.encode(), hashlib.sha256
    ).digest()
    computed = hmac.new(
        secret_key, data_check_string.encode(), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(computed, received_hash):
        raise TelegramAuthError("invalid init data signature")

    try:
        auth_date = int(pairs["auth_date"])
        user = json.loads(pairs["user"])
        telegram_id = int(user["id"])
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise TelegramAuthError("malformed init data") from exc

    if max_age_seconds is not None:
        current = now if now is not None else int(time.time())
        if current - auth_date > max_age_seconds:
            raise TelegramAuthError("init data expired")

    return TelegramInitData(
        telegram_id=telegram_id,
        first_name=user.get("first_name"),
        username=user.get("username"),
        auth_date=auth_date,
        raw_user=user,
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv\Scripts\pytest.exe tests/unit/test_telegram_auth_service.py -v`
Expected: PASS — valid identity, forged/tampered/wrong-token → signature error, stale → expired, empty token → not configured, missing hash → malformed.

- [ ] **Step 6: Commit**

```bash
git add sellary-backend/core/config.py sellary-backend/.env.example sellary-backend/services/telegram_auth_service.py sellary-backend/tests/unit/test_telegram_auth_service.py
git commit -m "feat(marketplace): Telegram initData HMAC verification service + config"
```

---

### Task 4: `telegram_users` get-or-create + `get_telegram_shopper` FastAPI dependency

**Files:**
- Create: `sellary-backend/repositories/telegram_user_repository.py`
- Create: `sellary-backend/api/shop_dependencies.py`
- Test: `sellary-backend/tests/unit/test_telegram_user_repository.py`
- Test: `sellary-backend/tests/integration/test_shop_auth_dependency.py`

**Interfaces:**
- Consumes: `parse_and_verify_init_data` (Task 3), `TelegramUser` (Task 2), `settings.TELEGRAM_BOT_TOKEN` / `TELEGRAM_AUTH_MAX_AGE_SECONDS`.
- Produces:
  - `TelegramUserRepository(db).get_or_create(telegram_id: int, *, first_name, username) -> TelegramUser` — inserts on first sight, else returns the existing row and refreshes `first_name`/`username` if they changed.
  - `get_telegram_shopper(x_telegram_init_data: str = Header(...), db = Depends(get_db)) -> TelegramUser` — verifies the header, get-or-creates, returns the shopper. `401` on missing header, forged, or expired; `503` when the bot token is unconfigured.

The dependency lives in `api/` (it wires FastAPI to the service + repository). The get-or-create is a repository concern (DB write).

- [ ] **Step 1: Write the failing repository test**

Create `sellary-backend/tests/unit/test_telegram_user_repository.py`:

```python
"""TelegramUserRepository.get_or_create is idempotent per telegram_id."""
from repositories.telegram_user_repository import TelegramUserRepository


def test_creates_on_first_sight(db_session):
    repo = TelegramUserRepository(db_session)
    user = repo.get_or_create(777, first_name="Ali", username="ali")
    db_session.flush()
    assert user.id is not None
    assert user.telegram_id == 777


def test_returns_existing_and_updates_name(db_session):
    repo = TelegramUserRepository(db_session)
    first = repo.get_or_create(888, first_name="Old", username="old")
    db_session.flush()
    again = repo.get_or_create(888, first_name="New", username="new")
    db_session.flush()
    assert again.id == first.id
    assert again.first_name == "New"
    assert again.username == "new"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest.exe tests/unit/test_telegram_user_repository.py -v`
Expected: FAIL — `ModuleNotFoundError: repositories.telegram_user_repository`.

- [ ] **Step 3: Write the repository**

Create `sellary-backend/repositories/telegram_user_repository.py`:

```python
from typing import Optional

from sqlalchemy.orm import Session

from models.telegram_user import TelegramUser


class TelegramUserRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_telegram_id(self, telegram_id: int) -> Optional[TelegramUser]:
        return (
            self.db.query(TelegramUser)
            .filter(TelegramUser.telegram_id == telegram_id)
            .first()
        )

    def get_or_create(
        self,
        telegram_id: int,
        *,
        first_name: str | None = None,
        username: str | None = None,
    ) -> TelegramUser:
        user = self.get_by_telegram_id(telegram_id)
        if user is None:
            user = TelegramUser(
                telegram_id=telegram_id,
                first_name=first_name,
                username=username,
            )
            self.db.add(user)
            self.db.flush()
            return user
        # Keep the identity fresh (Telegram profile can change).
        changed = False
        if first_name is not None and user.first_name != first_name:
            user.first_name = first_name
            changed = True
        if username is not None and user.username != username:
            user.username = username
            changed = True
        if changed:
            self.db.flush()
        return user
```

- [ ] **Step 4: Write the dependency**

Create `sellary-backend/api/shop_dependencies.py`:

```python
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from core.config import settings
from core.database import get_db
from models.telegram_user import TelegramUser
from repositories.telegram_user_repository import TelegramUserRepository
from services.telegram_auth_service import (
    TelegramAuthError,
    parse_and_verify_init_data,
)


def get_telegram_shopper(
    x_telegram_init_data: str = Header(..., alias="X-Telegram-Init-Data"),
    db: Session = Depends(get_db),
) -> TelegramUser:
    """Verify the Mini App initData header and yield the shopper identity.

    401 on missing/forged/expired data; 503 when the bot token is unconfigured
    (deployment misconfiguration, not the caller's fault).
    """
    try:
        identity = parse_and_verify_init_data(
            x_telegram_init_data,
            bot_token=settings.TELEGRAM_BOT_TOKEN,
            max_age_seconds=settings.TELEGRAM_AUTH_MAX_AGE_SECONDS,
        )
    except TelegramAuthError as exc:
        detail = str(exc)
        if "not configured" in detail:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=detail
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=detail
        )

    return TelegramUserRepository(db).get_or_create(
        identity.telegram_id,
        first_name=identity.first_name,
        username=identity.username,
    )
```

- [ ] **Step 5: Write the dependency integration test**

This test mounts the dependency on a throwaway route so it can exercise the header path end-to-end without depending on the shop router (built in Task 7). It reuses the `_sign` helper from the Task 3 test via a small local copy.

Create `sellary-backend/tests/integration/test_shop_auth_dependency.py`:

```python
"""get_telegram_shopper verifies the header and get-or-creates the shopper."""
import hashlib
import hmac
import json
from urllib.parse import urlencode

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from api.shop_dependencies import get_telegram_shopper
from core.config import settings
from core.database import get_db
from models.telegram_user import TelegramUser

BOT_TOKEN = "123456:TEST-BOT-TOKEN"


def _sign(telegram_id=42, auth_date=1_700_000_000, bot_token=BOT_TOKEN):
    user = json.dumps(
        {"id": telegram_id, "first_name": "Ali", "username": "shopper"},
        separators=(",", ":"),
    )
    fields = {"auth_date": str(auth_date), "user": user}
    dcs = "\n".join(f"{k}={fields[k]}" for k in sorted(fields))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(secret, dcs.encode(), hashlib.sha256).hexdigest()
    return urlencode(fields)


@pytest.fixture
def shop_client(db_session, monkeypatch):
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", BOT_TOKEN)
    # Disable staleness so a fixed old auth_date still validates.
    monkeypatch.setattr(settings, "TELEGRAM_AUTH_MAX_AGE_SECONDS", 10**12)

    app = FastAPI()

    @app.get("/whoami")
    def whoami(shopper: TelegramUser = Depends(get_telegram_shopper)):
        return {"telegram_id": shopper.telegram_id, "id": shopper.id}

    app.dependency_overrides[get_db] = lambda: db_session
    return TestClient(app)


def test_valid_header_creates_shopper(shop_client, db_session):
    resp = shop_client.get(
        "/whoami", headers={"X-Telegram-Init-Data": _sign(telegram_id=42)}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["telegram_id"] == 42
    assert (
        db_session.query(TelegramUser).filter_by(telegram_id=42).count() == 1
    )


def test_missing_header_401(shop_client):
    resp = shop_client.get("/whoami")
    assert resp.status_code in (401, 422)  # FastAPI 422 for missing required header


def test_forged_header_401(shop_client):
    forged = _sign(telegram_id=42, bot_token="999:WRONG")
    resp = shop_client.get("/whoami", headers={"X-Telegram-Init-Data": forged})
    assert resp.status_code == 401, resp.text
```

Note: a missing required `Header(...)` yields FastAPI's 422; the test accepts either. If you prefer a strict 401 for the missing case, make the header `Optional[str] = Header(None, ...)` in the dependency and raise 401 explicitly when it is `None` — do that only if the shop router later needs the softer contract.

- [ ] **Step 6: Run tests to verify they pass**

Run: `.venv\Scripts\pytest.exe tests/unit/test_telegram_user_repository.py tests/integration/test_shop_auth_dependency.py -v`
Expected: PASS — get-or-create idempotency; valid header creates exactly one shopper; forged header rejected.

- [ ] **Step 7: Commit**

```bash
git add sellary-backend/repositories/telegram_user_repository.py sellary-backend/api/shop_dependencies.py sellary-backend/tests/unit/test_telegram_user_repository.py sellary-backend/tests/integration/test_shop_auth_dependency.py
git commit -m "feat(marketplace): telegram_users get-or-create + shopper auth dependency"
```

---

### Task 5: Shop (public) Pydantic schemas

**Files:**
- Create: `sellary-backend/schemas/shop.py`
- Test: `sellary-backend/tests/unit/test_shop_schemas.py`

**Interfaces:**
- Produces (all `from_attributes = True`, no cost/margin/stock-value leakage — shopper never sees `cost_price`):
  - `ShopSummary(company_id: int, slug: str, name: str, logo_url: str | None, marketplace_description: str | None, supports_delivery: bool, supports_pickup: bool)`
  - `ShopProduct(id, name, description, sell_price: Decimal, image_url, uom, category_id, category_name, company_id, company_name, company_slug, in_stock: bool)`
  - `ShopCategory(id, name)`
  - `CatalogPage(items: list[ShopProduct], total: int, skip: int, limit: int)`
  - `ShopDetail(shop: ShopSummary, products: list[ShopProduct])`

Note deliberately excluded fields: `cost_price`, `inventory_value`, `stock_quantity` (exact figure), `profit_percent`, `min_stock_level`. Stock is exposed only as a boolean `in_stock` hint (design decision 7: low-stock hint, no hard reserve).

- [ ] **Step 1: Write the failing test**

Create `sellary-backend/tests/unit/test_shop_schemas.py`:

```python
"""Shop schemas expose only shopper-safe fields (no cost/margin)."""
from decimal import Decimal

from schemas.shop import CatalogPage, ShopCategory, ShopProduct, ShopSummary


def test_shop_product_omits_cost_fields():
    p = ShopProduct(
        id=1,
        name="Milk",
        description=None,
        sell_price=Decimal("12000"),
        image_url=None,
        uom="dona",
        category_id=None,
        category_name=None,
        company_id=5,
        company_name="Shop A",
        company_slug="shop-a",
        in_stock=True,
    )
    dumped = p.model_dump()
    assert "cost_price" not in dumped
    assert "profit_percent" not in dumped
    assert dumped["sell_price"] == Decimal("12000")
    assert dumped["in_stock"] is True


def test_catalog_page_wraps_items():
    page = CatalogPage(items=[], total=0, skip=0, limit=20)
    assert page.total == 0 and page.items == []


def test_shop_summary_and_category_shapes():
    s = ShopSummary(
        company_id=5,
        slug="shop-a",
        name="Shop A",
        logo_url=None,
        marketplace_description="Best",
        supports_delivery=True,
        supports_pickup=False,
    )
    assert s.slug == "shop-a"
    c = ShopCategory(id=3, name="Drinks")
    assert c.name == "Drinks"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest.exe tests/unit/test_shop_schemas.py -v`
Expected: FAIL — `ModuleNotFoundError: schemas.shop`.

- [ ] **Step 3: Write the schemas**

Create `sellary-backend/schemas/shop.py`:

```python
"""Shopper-facing (public) response schemas.

Deliberately narrow: no cost_price, inventory_value, profit_percent, or exact
stock — a shopper must never see a merchant's margins. Stock is surfaced only as
an ``in_stock`` boolean hint (catalog does not hard-reserve; see design 7).
"""
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel


class ShopSummary(BaseModel):
    company_id: int
    slug: str
    name: str
    logo_url: Optional[str] = None
    marketplace_description: Optional[str] = None
    supports_delivery: bool
    supports_pickup: bool

    class Config:
        from_attributes = True


class ShopCategory(BaseModel):
    id: int
    name: str

    class Config:
        from_attributes = True


class ShopProduct(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    sell_price: Decimal
    image_url: Optional[str] = None
    uom: str
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    company_id: int
    company_name: str
    company_slug: str
    in_stock: bool

    class Config:
        from_attributes = True


class CatalogPage(BaseModel):
    items: List[ShopProduct]
    total: int
    skip: int
    limit: int


class ShopDetail(BaseModel):
    shop: ShopSummary
    products: List[ShopProduct]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv\Scripts\pytest.exe tests/unit/test_shop_schemas.py -v`
Expected: PASS — no cost fields present; page/summary/category shapes hold.

- [ ] **Step 5: Commit**

```bash
git add sellary-backend/schemas/shop.py sellary-backend/tests/unit/test_shop_schemas.py
git commit -m "feat(marketplace): public shop response schemas"
```

---

### Task 6: Catalog repository + shop service (published + enabled gating, filters)

**Files:**
- Create: `sellary-backend/repositories/shop_repository.py`
- Create: `sellary-backend/services/shop_service.py`
- Test: `sellary-backend/tests/integration/test_shop_service.py`

**Interfaces:**
- Consumes: `Product`, `Company`, `Category`; `schemas.shop.*`.
- Produces (all cross-company, read-only; gate = `Product.is_published == True` AND `Company.is_marketplace_enabled == True` AND `Product.is_active == True` AND `Company.is_active == True`):
  - `ShopRepository(db).catalog(*, skip, limit, search, category_id, company_id) -> tuple[list[Product], int]` — rows joined to `Company` (and left-joined `Category`), ordered by `Product.id`.
  - `ShopRepository(db).get_published_product(product_id) -> Product | None`
  - `ShopRepository(db).enabled_shops() -> list[Company]`
  - `ShopRepository(db).get_enabled_shop_by_slug(slug) -> Company | None`
  - `ShopRepository(db).published_categories() -> list[Category]` — categories that have at least one published product in an enabled shop.
  - `ShopService(db)` mapping to schemas: `.catalog(...) -> CatalogPage`, `.get_product(id) -> ShopProduct | None`, `.list_shops() -> list[ShopSummary]`, `.get_shop(slug) -> ShopDetail | None`, `.list_categories() -> list[ShopCategory]`. `_to_product(product) -> ShopProduct` sets `in_stock = Decimal(product.stock_quantity or 0) > 0`.

- [ ] **Step 1: Write the failing test**

Create `sellary-backend/tests/integration/test_shop_service.py`:

```python
"""Shop service gates on published+enabled and isolates nothing it shouldn't leak.

Uses default_company and secondary_company to prove cross-shop visibility for
enabled shops and invisibility for disabled ones / unpublished products.
"""
from decimal import Decimal

import pytest

from models.category import Category
from models.company import Company
from models.product import Product
from services.shop_service import ShopService


def _mk_product(db, company, name, *, published=True, category=None, stock=5, price="10.00"):
    p = Product(
        company_id=company.id,
        name=name,
        cost_price=Decimal("4.0000"),
        sell_price=Decimal(price),
        stock_quantity=Decimal(stock),
        is_active=True,
        is_published=published,
        category_id=category.id if category else None,
    )
    db.add(p)
    db.flush()
    return p


@pytest.fixture
def enabled_default(db_session, default_company):
    default_company.is_marketplace_enabled = True
    default_company.name = "Default Shop"
    db_session.flush()
    return default_company


@pytest.fixture
def enabled_secondary(db_session, secondary_company):
    secondary_company.is_marketplace_enabled = True
    secondary_company.name = "Second Shop"
    db_session.flush()
    return secondary_company


def test_catalog_spans_enabled_shops(db_session, enabled_default, enabled_secondary):
    _mk_product(db_session, enabled_default, "Apple")
    _mk_product(db_session, enabled_secondary, "Banana")
    page = ShopService(db_session).catalog(skip=0, limit=50)
    names = {i.name for i in page.items}
    assert {"Apple", "Banana"} <= names
    assert page.total >= 2


def test_unpublished_product_hidden(db_session, enabled_default):
    _mk_product(db_session, enabled_default, "Secret", published=False)
    page = ShopService(db_session).catalog(skip=0, limit=50)
    assert "Secret" not in {i.name for i in page.items}


def test_disabled_shop_hidden(db_session, default_company, secondary_company):
    # default enabled, secondary NOT enabled
    default_company.is_marketplace_enabled = True
    db_session.flush()
    _mk_product(db_session, default_company, "Visible")
    _mk_product(db_session, secondary_company, "FromDisabledShop")
    page = ShopService(db_session).catalog(skip=0, limit=50)
    names = {i.name for i in page.items}
    assert "Visible" in names
    assert "FromDisabledShop" not in names


def test_product_response_omits_cost(db_session, enabled_default):
    _mk_product(db_session, enabled_default, "Milk", price="12000.00")
    page = ShopService(db_session).catalog(skip=0, limit=50)
    item = next(i for i in page.items if i.name == "Milk")
    dumped = item.model_dump()
    assert "cost_price" not in dumped
    assert item.sell_price == Decimal("12000.00")
    assert item.company_id == enabled_default.id


def test_search_filter(db_session, enabled_default):
    _mk_product(db_session, enabled_default, "Red Apple")
    _mk_product(db_session, enabled_default, "Green Pear")
    page = ShopService(db_session).catalog(skip=0, limit=50, search="apple")
    assert {i.name for i in page.items} == {"Red Apple"}


def test_company_filter(db_session, enabled_default, enabled_secondary):
    _mk_product(db_session, enabled_default, "D1")
    _mk_product(db_session, enabled_secondary, "S1")
    page = ShopService(db_session).catalog(
        skip=0, limit=50, company_id=enabled_secondary.id
    )
    assert {i.name for i in page.items} == {"S1"}


def test_category_filter(db_session, enabled_default):
    cat = Category(company_id=enabled_default.id, name="Fruit")
    db_session.add(cat)
    db_session.flush()
    _mk_product(db_session, enabled_default, "Kiwi", category=cat)
    _mk_product(db_session, enabled_default, "Bread")
    page = ShopService(db_session).catalog(skip=0, limit=50, category_id=cat.id)
    assert {i.name for i in page.items} == {"Kiwi"}


def test_get_product_only_if_published(db_session, enabled_default):
    hidden = _mk_product(db_session, enabled_default, "Hidden", published=False)
    shown = _mk_product(db_session, enabled_default, "Shown")
    svc = ShopService(db_session)
    assert svc.get_product(hidden.id) is None
    assert svc.get_product(shown.id).name == "Shown"


def test_list_shops_only_enabled(db_session, enabled_default, secondary_company):
    shops = ShopService(db_session).list_shops()
    ids = {s.company_id for s in shops}
    assert enabled_default.id in ids
    assert secondary_company.id not in ids


def test_get_shop_by_slug_with_products(db_session, enabled_default):
    _mk_product(db_session, enabled_default, "OnlyOne")
    detail = ShopService(db_session).get_shop(enabled_default.slug)
    assert detail is not None
    assert detail.shop.company_id == enabled_default.id
    assert {p.name for p in detail.products} == {"OnlyOne"}


def test_categories_only_from_published_products(db_session, enabled_default):
    used = Category(company_id=enabled_default.id, name="Used")
    unused = Category(company_id=enabled_default.id, name="Unused")
    db_session.add_all([used, unused])
    db_session.flush()
    _mk_product(db_session, enabled_default, "P1", category=used)
    cats = ShopService(db_session).list_categories()
    names = {c.name for c in cats}
    assert "Used" in names
    assert "Unused" not in names
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest.exe tests/integration/test_shop_service.py -v`
Expected: FAIL — `ModuleNotFoundError: services.shop_service`.

- [ ] **Step 3: Write the repository**

Create `sellary-backend/repositories/shop_repository.py`:

```python
from typing import List, Optional, Tuple

from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from models.category import Category
from models.company import Company
from models.product import Product


class ShopRepository:
    """Cross-company, read-only queries for the public marketplace catalog.

    Every query is gated by the marketplace visibility rule:
      Product.is_published AND Product.is_active
      AND Company.is_marketplace_enabled AND Company.is_active
    This is the one place tenant scope is intentionally global — reads only.
    """

    def __init__(self, db: Session):
        self.db = db

    def _base_product_query(self):
        return (
            self.db.query(Product)
            .join(Company, Product.company_id == Company.id)
            .options(joinedload(Product.company), joinedload(Product.category))
            .filter(
                Product.is_published.is_(True),
                Product.is_active.is_(True),
                Company.is_marketplace_enabled.is_(True),
                Company.is_active.is_(True),
            )
        )

    def catalog(
        self,
        *,
        skip: int = 0,
        limit: int = 50,
        search: Optional[str] = None,
        category_id: Optional[int] = None,
        company_id: Optional[int] = None,
    ) -> Tuple[List[Product], int]:
        query = self._base_product_query()
        if search:
            query = query.filter(
                or_(
                    Product.name.ilike(f"%{search}%"),
                    Product.barcode.ilike(f"%{search}%"),
                )
            )
        if category_id is not None:
            query = query.filter(Product.category_id == category_id)
        if company_id is not None:
            query = query.filter(Product.company_id == company_id)
        total = query.count()
        products = query.order_by(Product.id).offset(skip).limit(limit).all()
        return products, total

    def get_published_product(self, product_id: int) -> Optional[Product]:
        return self._base_product_query().filter(Product.id == product_id).first()

    def enabled_shops(self) -> List[Company]:
        return (
            self.db.query(Company)
            .filter(
                Company.is_marketplace_enabled.is_(True),
                Company.is_active.is_(True),
            )
            .order_by(Company.name)
            .all()
        )

    def get_enabled_shop_by_slug(self, slug: str) -> Optional[Company]:
        return (
            self.db.query(Company)
            .filter(
                Company.slug == slug,
                Company.is_marketplace_enabled.is_(True),
                Company.is_active.is_(True),
            )
            .first()
        )

    def products_for_shop(self, company_id: int) -> List[Product]:
        return (
            self._base_product_query()
            .filter(Product.company_id == company_id)
            .order_by(Product.id)
            .all()
        )

    def published_categories(self) -> List[Category]:
        return (
            self.db.query(Category)
            .join(Product, Product.category_id == Category.id)
            .join(Company, Product.company_id == Company.id)
            .filter(
                Category.is_active.is_(True),
                Product.is_published.is_(True),
                Product.is_active.is_(True),
                Company.is_marketplace_enabled.is_(True),
                Company.is_active.is_(True),
            )
            .distinct()
            .order_by(Category.name)
            .all()
        )
```

- [ ] **Step 4: Write the service**

Create `sellary-backend/services/shop_service.py`:

```python
"""Map gated catalog rows to shopper-safe schemas. Cross-company, read-only."""
from decimal import Decimal
from typing import List, Optional

from sqlalchemy.orm import Session

from models.company import Company
from models.product import Product
from repositories.shop_repository import ShopRepository
from schemas.shop import (
    CatalogPage,
    ShopCategory,
    ShopDetail,
    ShopProduct,
    ShopSummary,
)


class ShopService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = ShopRepository(db)

    def catalog(
        self,
        *,
        skip: int = 0,
        limit: int = 50,
        search: Optional[str] = None,
        category_id: Optional[int] = None,
        company_id: Optional[int] = None,
    ) -> CatalogPage:
        products, total = self.repo.catalog(
            skip=skip,
            limit=limit,
            search=search,
            category_id=category_id,
            company_id=company_id,
        )
        return CatalogPage(
            items=[self._to_product(p) for p in products],
            total=total,
            skip=skip,
            limit=limit,
        )

    def get_product(self, product_id: int) -> Optional[ShopProduct]:
        product = self.repo.get_published_product(product_id)
        return self._to_product(product) if product else None

    def list_shops(self) -> List[ShopSummary]:
        return [self._to_summary(c) for c in self.repo.enabled_shops()]

    def get_shop(self, slug: str) -> Optional[ShopDetail]:
        company = self.repo.get_enabled_shop_by_slug(slug)
        if company is None:
            return None
        products = self.repo.products_for_shop(company.id)
        return ShopDetail(
            shop=self._to_summary(company),
            products=[self._to_product(p) for p in products],
        )

    def list_categories(self) -> List[ShopCategory]:
        return [
            ShopCategory(id=c.id, name=c.name)
            for c in self.repo.published_categories()
        ]

    def _to_summary(self, company: Company) -> ShopSummary:
        return ShopSummary(
            company_id=company.id,
            slug=company.slug,
            name=company.name,
            logo_url=company.logo_url,
            marketplace_description=company.marketplace_description,
            supports_delivery=company.supports_delivery,
            supports_pickup=company.supports_pickup,
        )

    def _to_product(self, product: Product) -> ShopProduct:
        category = product.category if product.category and product.category.is_active else None
        return ShopProduct(
            id=product.id,
            name=product.name,
            description=product.description,
            sell_price=product.sell_price,
            image_url=product.image_url,
            uom=product.uom,
            category_id=category.id if category else None,
            category_name=category.name if category else None,
            company_id=product.company_id,
            company_name=product.company.name,
            company_slug=product.company.slug,
            in_stock=Decimal(product.stock_quantity or 0) > 0,
        )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv\Scripts\pytest.exe tests/integration/test_shop_service.py -v`
Expected: PASS — cross-shop visibility, unpublished/disabled hidden, filters, single product gating, shop list/detail, category derivation.

- [ ] **Step 6: Commit**

```bash
git add sellary-backend/repositories/shop_repository.py sellary-backend/services/shop_service.py sellary-backend/tests/integration/test_shop_service.py
git commit -m "feat(marketplace): catalog repository + shop service with published/enabled gating"
```

---

### Task 7: `/api/shop` router + registration

**Files:**
- Create: `sellary-backend/api/shop.py`
- Modify: `sellary-backend/api/__init__.py` (import + `__all__`)
- Modify: `sellary-backend/main.py` (import + `include_router`)
- Test: `sellary-backend/tests/integration/test_shop_endpoints.py`

**Interfaces:**
- Consumes: `ShopService` (Task 6), `get_telegram_shopper` (Task 4).
- Produces (`router = APIRouter(prefix="/shop", tags=["shop"])`, mounted under `settings.API_V1_STR`, so paths are `/api/shop/*`). Every route depends on `get_telegram_shopper` (the Mini App always sends initData). CORS for the future Mini App origin is a config follow-up (see note below), not enforced here.
  - `GET /api/shop/catalog?search=&category=&company=&skip=&limit=` → `CatalogPage`
  - `GET /api/shop/products/{product_id}` → `ShopProduct` (404 if not published/enabled)
  - `GET /api/shop/shops` → `list[ShopSummary]`
  - `GET /api/shop/shops/{slug}` → `ShopDetail` (404 if not enabled)
  - `GET /api/shop/categories` → `list[ShopCategory]`

- [ ] **Step 1: Write the failing test**

Create `sellary-backend/tests/integration/test_shop_endpoints.py`:

```python
"""End-to-end /api/shop routes with initData auth + published/enabled gating."""
import hashlib
import hmac
import json
from decimal import Decimal
from urllib.parse import urlencode

import pytest

from core.config import settings
from models.product import Product

BOT_TOKEN = "123456:TEST-BOT-TOKEN"


def _init_data(telegram_id=42, bot_token=BOT_TOKEN):
    user = json.dumps(
        {"id": telegram_id, "first_name": "Ali", "username": "shopper"},
        separators=(",", ":"),
    )
    fields = {"auth_date": "1700000000", "user": user}
    dcs = "\n".join(f"{k}={fields[k]}" for k in sorted(fields))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(secret, dcs.encode(), hashlib.sha256).hexdigest()
    return urlencode(fields)


@pytest.fixture
def shop_headers(monkeypatch):
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", BOT_TOKEN)
    monkeypatch.setattr(settings, "TELEGRAM_AUTH_MAX_AGE_SECONDS", 10**12)
    return {"X-Telegram-Init-Data": _init_data()}


def _publish_product(db, company, name, price="10.00"):
    company.is_marketplace_enabled = True
    db.flush()
    p = Product(
        company_id=company.id,
        name=name,
        cost_price=Decimal("4.0000"),
        sell_price=Decimal(price),
        stock_quantity=Decimal("5"),
        is_active=True,
        is_published=True,
    )
    db.add(p)
    db.flush()
    return p


def test_catalog_requires_init_data(client):
    resp = client.get("/api/shop/catalog")
    assert resp.status_code in (401, 422)


def test_catalog_returns_published(client, db_session, default_company, shop_headers):
    _publish_product(db_session, default_company, "Apple")
    resp = client.get("/api/shop/catalog", headers=shop_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] >= 1
    assert "Apple" in {i["name"] for i in body["items"]}
    # No cost leakage in the wire response.
    assert all("cost_price" not in i for i in body["items"])


def test_catalog_company_filter(
    client, db_session, default_company, secondary_company, shop_headers
):
    _publish_product(db_session, default_company, "D1")
    _publish_product(db_session, secondary_company, "S1")
    resp = client.get(
        f"/api/shop/catalog?company={secondary_company.id}", headers=shop_headers
    )
    assert resp.status_code == 200, resp.text
    assert {i["name"] for i in resp.json()["items"]} == {"S1"}


def test_get_single_product(client, db_session, default_company, shop_headers):
    p = _publish_product(db_session, default_company, "Milk")
    resp = client.get(f"/api/shop/products/{p.id}", headers=shop_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Milk"


def test_get_unpublished_product_404(client, db_session, default_company, shop_headers):
    default_company.is_marketplace_enabled = True
    db_session.flush()
    p = Product(
        company_id=default_company.id,
        name="Hidden",
        cost_price=Decimal("1.0000"),
        sell_price=Decimal("2.0000"),
        stock_quantity=Decimal("1"),
        is_active=True,
        is_published=False,
    )
    db_session.add(p)
    db_session.flush()
    resp = client.get(f"/api/shop/products/{p.id}", headers=shop_headers)
    assert resp.status_code == 404, resp.text


def test_list_shops(client, db_session, default_company, shop_headers):
    _publish_product(db_session, default_company, "X")
    resp = client.get("/api/shop/shops", headers=shop_headers)
    assert resp.status_code == 200, resp.text
    assert default_company.id in {s["company_id"] for s in resp.json()}


def test_get_shop_by_slug(client, db_session, default_company, shop_headers):
    _publish_product(db_session, default_company, "OnlyOne")
    resp = client.get(f"/api/shop/shops/{default_company.slug}", headers=shop_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["shop"]["slug"] == default_company.slug
    assert {p["name"] for p in body["products"]} == {"OnlyOne"}


def test_get_unknown_shop_404(client, shop_headers):
    resp = client.get("/api/shop/shops/does-not-exist", headers=shop_headers)
    assert resp.status_code == 404, resp.text


def test_categories(client, db_session, default_company, shop_headers):
    from models.category import Category

    cat = Category(company_id=default_company.id, name="Fruit")
    db_session.add(cat)
    db_session.flush()
    default_company.is_marketplace_enabled = True
    db_session.flush()
    p = Product(
        company_id=default_company.id,
        name="Kiwi",
        cost_price=Decimal("1.0000"),
        sell_price=Decimal("2.0000"),
        stock_quantity=Decimal("1"),
        is_active=True,
        is_published=True,
        category_id=cat.id,
    )
    db_session.add(p)
    db_session.flush()
    resp = client.get("/api/shop/categories", headers=shop_headers)
    assert resp.status_code == 200, resp.text
    assert "Fruit" in {c["name"] for c in resp.json()}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest.exe tests/integration/test_shop_endpoints.py -v`
Expected: FAIL — routes not registered (404 for every path).

- [ ] **Step 3: Write the router**

Create `sellary-backend/api/shop.py`:

```python
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from api.shop_dependencies import get_telegram_shopper
from core.config import settings
from core.database import get_db
from models.telegram_user import TelegramUser
from schemas.shop import CatalogPage, ShopCategory, ShopDetail, ShopProduct, ShopSummary
from services.shop_service import ShopService

router = APIRouter(prefix="/shop", tags=["shop"])


@router.get("/catalog", response_model=CatalogPage)
def get_catalog(
    search: Optional[str] = None,
    category: Optional[int] = Query(None, description="category_id filter"),
    company: Optional[int] = Query(None, description="company_id filter"),
    skip: int = Query(0, ge=0),
    limit: int = Query(settings.DEFAULT_PAGE_SIZE, ge=1, le=settings.MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
    shopper: TelegramUser = Depends(get_telegram_shopper),
):
    return ShopService(db).catalog(
        skip=skip,
        limit=limit,
        search=search,
        category_id=category,
        company_id=company,
    )


@router.get("/products/{product_id}", response_model=ShopProduct)
def get_product(
    product_id: int,
    db: Session = Depends(get_db),
    shopper: TelegramUser = Depends(get_telegram_shopper),
):
    product = ShopService(db).get_product(product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


@router.get("/shops", response_model=List[ShopSummary])
def list_shops(
    db: Session = Depends(get_db),
    shopper: TelegramUser = Depends(get_telegram_shopper),
):
    return ShopService(db).list_shops()


@router.get("/shops/{slug}", response_model=ShopDetail)
def get_shop(
    slug: str,
    db: Session = Depends(get_db),
    shopper: TelegramUser = Depends(get_telegram_shopper),
):
    detail = ShopService(db).get_shop(slug)
    if detail is None:
        raise HTTPException(status_code=404, detail="Shop not found")
    return detail


@router.get("/categories", response_model=List[ShopCategory])
def list_categories(
    db: Session = Depends(get_db),
    shopper: TelegramUser = Depends(get_telegram_shopper),
):
    return ShopService(db).list_categories()
```

- [ ] **Step 4: Register the router**

In `sellary-backend/api/__init__.py`, add the import after `from .company import router as company_router`:

```python
from .shop import router as shop_router
```

and add `"shop_router",` to `__all__`.

In `sellary-backend/main.py`, add `shop_router,` to the import block (after `company_router,`) and add after the `company_router` include line:

```python
    app.include_router(shop_router, prefix=settings.API_V1_STR)
```

- [ ] **Step 5: CORS follow-up note (do NOT hard-require now)**

The Mini App will call `/api/shop/*` from Telegram's WebView, whose origin is `https://<your-mini-app-host>` (the hosted `sellary-shop` build), not `tauri://localhost`. When that host is known (F3), add it to `BACKEND_CORS_ORIGINS` / set `BACKEND_CORS_ORIGINS_RAW` in production env. Leave a code comment above the CORS middleware in `main.py`:

```python
    # NOTE (F2/F3): add the Telegram Mini App host to BACKEND_CORS_ORIGINS_RAW in
    # production once sellary-shop is deployed, so /api/shop/* is reachable from
    # the WebView origin. initData auth (header X-Telegram-Init-Data) is the real
    # security boundary; CORS only governs browser fetch eligibility.
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `.venv\Scripts\pytest.exe tests/integration/test_shop_endpoints.py -v`
Expected: PASS — auth required, catalog + filters, single product (200/404), shops list, shop-by-slug (200/404), categories.

- [ ] **Step 7: Commit**

```bash
git add sellary-backend/api/shop.py sellary-backend/api/__init__.py sellary-backend/main.py sellary-backend/tests/integration/test_shop_endpoints.py
git commit -m "feat(marketplace): /api/shop public catalog router + registration"
```

---

### Task 8: Full-suite gate + tenant-leakage regression sweep

**Files:**
- Test: `sellary-backend/tests/integration/test_shop_tenant_isolation.py`

**Interfaces:**
- Consumes: everything above. This task is a belt-and-suspenders regression proving that (a) a disabled shop's published products never appear via any `/api/shop` route, and (b) enabling one shop does not expose another's unpublished products, across `default_company` and `secondary_company`.

- [ ] **Step 1: Write the regression test**

Create `sellary-backend/tests/integration/test_shop_tenant_isolation.py`:

```python
"""No cross-tenant leakage: only published products of enabled shops surface."""
import hashlib
import hmac
import json
from decimal import Decimal
from urllib.parse import urlencode

import pytest

from core.config import settings
from models.product import Product

BOT_TOKEN = "123456:TEST-BOT-TOKEN"


def _headers(monkeypatch):
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", BOT_TOKEN)
    monkeypatch.setattr(settings, "TELEGRAM_AUTH_MAX_AGE_SECONDS", 10**12)
    user = json.dumps({"id": 7, "first_name": "T"}, separators=(",", ":"))
    fields = {"auth_date": "1700000000", "user": user}
    dcs = "\n".join(f"{k}={fields[k]}" for k in sorted(fields))
    secret = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(secret, dcs.encode(), hashlib.sha256).hexdigest()
    return {"X-Telegram-Init-Data": urlencode(fields)}


def _add(db, company, name, *, published, price="9.00"):
    p = Product(
        company_id=company.id,
        name=name,
        cost_price=Decimal("1.0000"),
        sell_price=Decimal(price),
        stock_quantity=Decimal("3"),
        is_active=True,
        is_published=published,
    )
    db.add(p)
    db.flush()
    return p


def test_disabled_shop_never_leaks(
    client, db_session, default_company, secondary_company, monkeypatch
):
    headers = _headers(monkeypatch)
    # default is enabled; secondary stays disabled but has a "published" product.
    default_company.is_marketplace_enabled = True
    db_session.flush()
    _add(db_session, default_company, "PublicItem", published=True)
    _add(db_session, secondary_company, "ShouldNeverShow", published=True)

    catalog = client.get("/api/shop/catalog", headers=headers).json()
    names = {i["name"] for i in catalog["items"]}
    assert "PublicItem" in names
    assert "ShouldNeverShow" not in names

    # Shop list must not include the disabled secondary shop.
    shops = client.get("/api/shop/shops", headers=headers).json()
    assert secondary_company.id not in {s["company_id"] for s in shops}

    # Its slug detail must 404, not reveal products.
    resp = client.get(f"/api/shop/shops/{secondary_company.slug}", headers=headers)
    assert resp.status_code == 404


def test_enabling_one_shop_does_not_expose_others_unpublished(
    client, db_session, default_company, secondary_company, monkeypatch
):
    headers = _headers(monkeypatch)
    default_company.is_marketplace_enabled = True
    secondary_company.is_marketplace_enabled = True
    db_session.flush()
    _add(db_session, default_company, "DefPublic", published=True)
    _add(db_session, secondary_company, "SecUnpublished", published=False)

    catalog = client.get("/api/shop/catalog", headers=headers).json()
    names = {i["name"] for i in catalog["items"]}
    assert "DefPublic" in names
    assert "SecUnpublished" not in names
```

- [ ] **Step 2: Run the regression + full marketplace suite**

Run the compile gate first:

`.venv\Scripts\python.exe -m compileall api core models repositories schemas services main.py`

Then the F2 suite:

```
.venv\Scripts\pytest.exe ^
  tests/unit/test_migration_chain.py ^
  tests/unit/test_telegram_user_model.py ^
  tests/unit/test_telegram_auth_service.py ^
  tests/unit/test_telegram_user_repository.py ^
  tests/unit/test_shop_schemas.py ^
  tests/integration/test_shop_auth_dependency.py ^
  tests/integration/test_shop_service.py ^
  tests/integration/test_shop_endpoints.py ^
  tests/integration/test_shop_tenant_isolation.py -v
```

Expected: compile OK; all F2 tests PASS.

- [ ] **Step 3: Run the whole suite to confirm no regressions**

Run: `.venv\Scripts\pytest.exe tests/integration tests/unit`
Expected: PASS (pre-existing suite unaffected; new `telegram_id` column and `telegram_users` table are additive).

- [ ] **Step 4: Commit**

```bash
git add sellary-backend/tests/integration/test_shop_tenant_isolation.py
git commit -m "test(marketplace): tenant-isolation regression for /api/shop"
```

---

## Self-Review Notes

**Scope-item → task mapping:**

| Scope item | Task(s) |
|---|---|
| Telegram initData auth dependency (`X-Telegram-Init-Data`, HMAC-SHA256 vs `BOT_TOKEN`, reject forged/stale) | Task 3 (verify service, unit-tested), Task 4 (FastAPI `get_telegram_shopper` dependency) |
| Add `TELEGRAM_BOT_TOKEN` to config | Task 3 (+`TELEGRAM_AUTH_MAX_AGE_SECONDS`) |
| Get-or-create `telegram_users` row → yield shopper identity | Task 4 (repository get-or-create + dependency) |
| New table `telegram_users` (id, telegram_id unique, first_name, username, phone nullable, created_at) | Task 1 (migration), Task 2 (model) |
| `customers.telegram_id` (nullable, partial-unique per `(company_id, telegram_id)`, mirrors `client_customer_id`) | Task 1 (migration index), Task 2 (model column + `__table_args__` index) |
| ONE migration chaining off `c9d0e1f2a3b4` + bump `railway.toml`; two-heads guard | Task 1 (revision `d0e1f2a3b4c5`, `down_revision = c9d0e1f2a3b4`, railway pin bumped; guard test re-run) |
| `GET /api/shop/catalog` (published + enabled gating; `search`/`category`/`company`; pagination) | Task 6 (repo/service), Task 7 (route) |
| `GET /api/shop/products/{id}` | Task 6/7 (404 when not published/enabled) |
| `GET /api/shop/shops` (+ logo/name) | Task 5 (`ShopSummary`), Task 6/7 |
| `GET /api/shop/shops/{slug}` (+ its products) | Task 5 (`ShopDetail`), Task 6/7 |
| `GET /api/shop/categories` | Task 6 (`published_categories`), Task 7 |
| Register router in `api/__init__.py` + `main.py` | Task 7 |
| CORS note for future Mini App origin (config follow-up, not hard-required) | Task 7 Step 5 (code comment + env guidance) |
| Unit tests for initData HMAC (known token + computed hash) | Task 3 test |
| Integration tests: catalog filtering, published/enabled gating, tenant-leakage across `default_company`/`secondary_company` | Tasks 6, 7, 8 |

**Deferred (explicitly out of F2):**
- **Orders / checkout** (`orders`, `order_items`, `POST /api/shop/orders`, "my orders", phone share, `Idempotency-Key`) → **F4**. `telegram_users.phone` exists but is only populated in F4; F2 leaves it `NULL`. The `customers.telegram_id` link column is created here but is *written* (linking a Customer to a shopper) only in F4 on first order — F2 just provisions the schema.
- **Mini App UI** (`sellary-shop/` Vite package, cart/localStorage, product detail screens) → **F3**.
- **Merchant order management** (`/orders` Next.js page, confirm→Sale, status transitions) → **F5**.
- **Telegram bot webhook + notifications** (`merchant_notify_links`, `/start` deep-link) → **F6**.
- **Cloudinary image upload / `is_published` merchant toggle** → already shipped in **F1**; F2 only *reads* `image_url` / `is_published`.

**Consistency checks performed:**
- Migration chains off the confirmed live head `c9d0e1f2a3b4` (verified: `railway.toml` currently pins it; F1 migration file declares `revision = c9d0e1f2a3b4`). New head `d0e1f2a3b4c5`; the dead `20260319_0001` head is untouched, keeping exactly two heads for the guard test.
- `TelegramUser` registered in `models/__init__.py` so `alembic/env.py`'s `from models import *` and the test suite's `Base.metadata.create_all` both see it (verified `env.py` uses `from models import *`).
- `customers.telegram_id` mirrors `client_customer_id` exactly: `BigInteger` column + `ix_*` index + partial-unique `(company_id, telegram_id)` with both `sqlite_where` (tests, in-memory SQLite) and `postgresql_where` (prod), matching `models/customer.py`.
- Cross-company shop queries deliberately bypass `resolve_company_id` (they are global read-only), documented in the repository docstring. Shopper-safe schemas omit `cost_price`/`inventory_value`/`profit_percent`; asserted in Tasks 5, 6, 7.
- initData verifier signature `parse_and_verify_init_data(init_data, *, bot_token, max_age_seconds=None, now=None)` matches every call site (Task 4 dependency passes `bot_token`/`max_age_seconds`; unit tests inject `now`). `TelegramInitData` fields (`telegram_id`, `first_name`, `username`, `auth_date`, `raw_user`) match the get-or-create call and dependency mapping.
- Router mounted at `prefix="/shop"` under `settings.API_V1_STR` (`/api`) → `/api/shop/*`, consistent with the design's API surface table.
