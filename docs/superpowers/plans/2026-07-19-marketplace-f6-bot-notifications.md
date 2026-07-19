# F6 — Telegram bot new-order notifications — Implementation Plan

**Date:** 2026-07-19
**Phase:** F6 (final phase) of the Telegram Mini App marketplace roadmap
**Spec:** `docs/superpowers/specs/2026-07-19-telegram-marketplace-design.md`
**Package:** `sellary-backend/`

---

## Goal

When a shopper places an online order (`POST /api/shop/orders`, built in F4), push a
real-time Telegram message to the shop owner. Provide the linking flow so a merchant
connects their Telegram chat to their company: the admin panel shows a
`t.me/<bot>?start=<company-ref>` deep-link; the merchant taps it; the bot webhook
(`POST /api/telegram/webhook`) consumes the `/start <payload>` and upserts a
`merchant_notify_links` row. Notification delivery is **best-effort** — a Bot API or
network failure must never fail or roll back order placement.

Reuses the **same single shared bot** as F2's initData auth (`TELEGRAM_BOT_TOKEN`
already in `core/config.py`).

## Architecture

Strict existing layering is preserved:

```
api/telegram_webhook.py  →  services/merchant_notify_service.py  →  repositories/merchant_notify_repository.py  →  models/merchant_notify_link.py
                            services/telegram_bot_client.py (thin Bot API HTTP wrapper, injectable/mockable)
api/shop_orders.py (F4)  →  services/merchant_notify_service.py  (notification hook after order creation)
```

- **`merchant_notify_link.py`** — new SQLAlchemy model + Alembic migration (chains off head).
- **`telegram_bot_client.py`** — a minimal `sendMessage` HTTP wrapper over `httpx` (already a
  dependency, 0.28.1). Injected into the notify service so tests supply a fake and never touch
  the network.
- **`merchant_notify_service.py`** — two responsibilities: (a) upsert a link from a verified
  `/start` payload; (b) format + best-effort send new-order notifications for a company.
- **`api/telegram_webhook.py`** — `POST /api/telegram/webhook`; verifies the
  `X-Telegram-Bot-Api-Secret-Token` header against `TELEGRAM_WEBHOOK_SECRET`; parses Update;
  routes `/start <payload>` to the service; every other update is a graceful 200 no-op.
- **Order-placement hook** — after `service.place_orders(...)` succeeds and the idempotency row
  commits, fire notifications per affected company inside a guard that swallows all exceptions.
  Recommended delivery mechanism: **FastAPI `BackgroundTasks`** (see Design Decision 2).

## Tech Stack

- Python 3.14 / FastAPI / SQLAlchemy / Alembic / Pydantic v2 / pytest.
- HTTP: `httpx` (already pinned `>=0.28.1` in `requirements.txt`; present in venv).
- Telegram Bot API: `POST https://api.telegram.org/bot<token>/sendMessage` (base URL configurable).
- Reuses existing `TELEGRAM_BOT_TOKEN`; existing HMAC helper style from
  `services/telegram_auth_service.py` for the signed company-ref (Design Decision 1).

---

## Global Constraints (binding — copied verbatim from repo rules)

- **Backend port is 8001**, not 8000. Run the API with `python main.py`.
- **Backend tests run from `sellary-backend/` with the venv active.** On Windows use
  `.venv\Scripts\pytest.exe`. `core/database.py` connects at import.
- **Test isolation uses transaction rollback** — in tests use `session.flush()`, **not**
  `session.commit()`.
- **Migration chains off the current live head `e1f2a3b4c5d6`** (file
  `alembic/versions/20260719_1400-e1f2a3b4c5d6_add_order_domain.py`). The new migration
  becomes the single new live head. **Bump `railway.toml`** `preDeployCommand =
  "alembic upgrade <new_rev>"`. The **two-heads guard** `tests/unit/test_migration_chain.py`
  must stay green: exactly two heads total (the dead orphan `20260319_0001` plus one live
  head), and the railway pin must equal the live head. Do **not** touch or chain off the dead
  head.
- **Strict layering** — `api/ → services/ → repositories/ → models/`. Pydantic request/response
  models live in `schemas/`. Never let a router touch the DB session directly for business logic.
- **Bot API calls must be injectable/mockable — NO network in tests.** The HTTP client is passed
  into the service; tests supply a fake/mock. No test may perform a real outbound request.
- **A notification failure must NEVER fail order placement.** The hook is best-effort:
  exceptions are logged and swallowed; the 201 order response is unaffected. This is tested
  explicitly.
- **The webhook verifies the Telegram secret-token header** (`X-Telegram-Bot-Api-Secret-Token`)
  against `TELEGRAM_WEBHOOK_SECRET`; a missing/wrong secret → **403** and no side effects. If the
  secret is unconfigured (empty), reject all webhook calls (403) rather than accept unsigned ones.
- **Compile gate:** `python -m compileall api core models repositories schemas services main.py`
  must pass (this is the CI gate; no DB needed).
- **Register the new model in `models/__init__.py`** (both the import and `__all__`) so Alembic
  autogen and app import see it.

---

## Design Decisions (flagged — with recommendations)

### Decision 1 — company-ref scheme for `/start <payload>` — **RECOMMEND signed HMAC token**

The `/start` payload deep-links a company. Two options:

- **(A) raw company slug** — simple, but a **security hole**: anyone who guesses/knows a shop's
  slug can send `/start <slug>` and wire *their own* chat to receive that shop's order
  notifications (order contents leak: customer name, phone, address).
- **(B) signed/opaque HMAC token** — the admin panel mints
  `payload = base64url(company_id) + "." + HMAC_SHA256(SECRET_KEY, company_id)[:N]`. The
  webhook verifies the HMAC (constant-time compare) before linking. A stranger cannot forge a
  valid token without `SECRET_KEY`.

**Recommendation: (B).** It reuses the codebase's existing HMAC idiom (see
`services/telegram_auth_service.py`) and `core.config.settings.SECRET_KEY`. Implement the
mint + verify as a pure helper (`services/merchant_link_token.py`) so both the future admin
endpoint (deferred) and the webhook share one source of truth. Telegram truncates deep-link
`start` payloads to 64 chars and restricts them to `A-Za-z0-9_-`, so the token uses
**base64url without padding** and a truncated HMAC (16 bytes → 22 chars) to stay within budget.

### Decision 2 — synchronous best-effort vs FastAPI BackgroundTasks — **RECOMMEND BackgroundTasks**

- **Sync best-effort** (`try/except` around a blocking `sendMessage` before returning 201):
  simplest, fully deterministic in tests, but adds Bot API latency to the order response and
  couples the shopper's checkout speed to Telegram's reachability.
- **BackgroundTasks**: FastAPI runs the send *after* the response is flushed, so checkout stays
  fast and a slow/failing Bot API never delays the shopper.

**Recommendation: BackgroundTasks** for the production send path, with the send function itself
*also* internally guarded by try/except (defense in depth: a BackgroundTask exception otherwise
surfaces in logs but the response is already sent — we still want it swallowed cleanly and
logged with context). Because BackgroundTasks run inside the same test request lifecycle under
`TestClient`, the order-placement hook remains synchronously testable (the background task
executes before `TestClient` returns). The notify **service method** is guaranteed
exception-free by its own guard, so even a raw sync call would be safe — BackgroundTasks is the
recommended default, and the plan's tests assert the guard holds regardless of scheduling.

### Decision 3 — one message per order vs one per company per checkout

A single cart splits into N orders across companies (F4, shared `checkout_group_id`). Send
**one message per created order** (each order = one shop's fulfillment unit, has its own
`order_number` and items). This is the simplest correct behavior and matches the spec's
example text. Grouping multiple same-company orders into one message is out of scope.

---

## Interfaces (canonical signatures)

```python
# models/merchant_notify_link.py
class MerchantNotifyLink(Base):
    __tablename__ = "merchant_notify_links"
    id: int
    company_id: int          # FK companies.id, not null, indexed
    telegram_chat_id: str    # String(64), not null  (chat ids can be large / negative)
    created_at: datetime     # server_default now()
    # UniqueConstraint(company_id, telegram_chat_id) name="uq_merchant_notify_company_chat"

# services/merchant_link_token.py  (pure, no DB, no network)
def mint_company_ref(company_id: int, *, secret: str) -> str
def verify_company_ref(token: str, *, secret: str) -> int | None   # returns company_id or None

# repositories/merchant_notify_repository.py
class MerchantNotifyRepository:
    def __init__(self, db: Session): ...
    def upsert(self, company_id: int, telegram_chat_id: str) -> MerchantNotifyLink   # idempotent on (company_id, chat_id)
    def list_chat_ids_for_company(self, company_id: int) -> list[str]

# services/telegram_bot_client.py
class TelegramBotClient:                      # thin, injectable Bot API wrapper
    def __init__(self, *, bot_token: str, base_url: str = "https://api.telegram.org", http: httpx.Client | None = None): ...
    def send_message(self, chat_id: str, text: str) -> None   # raises on HTTP/network error

# services/merchant_notify_service.py
class MerchantNotifyService:
    def __init__(self, db: Session, *, bot_client: TelegramBotClient | None = None): ...
    def link_from_start_payload(self, payload: str, telegram_chat_id: str) -> bool
        # verify payload → company_id; upsert link; return True if linked, False if payload invalid
    def notify_new_order(self, order: OrderResponse | Order) -> None
        # look up links; format; best-effort send; swallow+log all send failures. Never raises.
    @staticmethod
    def format_order_message(order) -> str

# schemas/telegram.py
class TelegramUpdate(BaseModel):              # minimal, permissive Pydantic v2 model
    update_id: int | None = None
    message: TelegramMessage | None = None
class TelegramMessage(BaseModel):
    chat: TelegramChat | None = None
    text: str | None = None
class TelegramChat(BaseModel):
    id: int
```

---

## Tasks

Each task is independently testable. TDD: write the failing test first, then the minimum
implementation. Run tests from `sellary-backend/` with `.venv\Scripts\pytest.exe`.

---

### Task 1 — Config: webhook secret + Bot API base URL

**Files**
- Modify: `sellary-backend/core/config.py`
- Test: `sellary-backend/tests/unit/test_config_telegram_webhook.py` (Create)

**Interfaces**
- Produces: `settings.TELEGRAM_WEBHOOK_SECRET: str` (default `""`),
  `settings.TELEGRAM_API_BASE_URL: str` (default `"https://api.telegram.org"`).
- Consumes: existing `Settings`/`get_settings` pattern.

**TDD steps**

1. Test — defaults exist and typed:
```python
# tests/unit/test_config_telegram_webhook.py
from core.config import Settings

def test_telegram_webhook_settings_have_safe_defaults():
    s = Settings()
    assert s.TELEGRAM_WEBHOOK_SECRET == ""          # empty → webhook rejects all (fail-closed)
    assert s.TELEGRAM_API_BASE_URL == "https://api.telegram.org"

def test_telegram_webhook_secret_reads_from_env(monkeypatch):
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", "s3cr3t-header-value")
    assert Settings().TELEGRAM_WEBHOOK_SECRET == "s3cr3t-header-value"
```

2. Implement — add two fields near the existing `TELEGRAM_BOT_TOKEN` block:
```python
    # Telegram bot webhook (F6 new-order notifications). Secret guards
    # POST /api/telegram/webhook via the X-Telegram-Bot-Api-Secret-Token header.
    # Empty → the webhook rejects ALL calls (fail-closed) so an unconfigured
    # deployment cannot be driven by forged updates.
    TELEGRAM_WEBHOOK_SECRET: str = ""
    # Bot API base; overridable in tests / for a local mock. No trailing slash.
    TELEGRAM_API_BASE_URL: str = "https://api.telegram.org"
```

3. Run: `.venv\Scripts\pytest.exe tests/unit/test_config_telegram_webhook.py -v`. Update
   `.env.example` with the two new keys (documentation only; `.env` is gitignored).

---

### Task 2 — Model + migration: `merchant_notify_links`

**Files**
- Create: `sellary-backend/models/merchant_notify_link.py`
- Modify: `sellary-backend/models/__init__.py` (import + `__all__`)
- Create: `sellary-backend/alembic/versions/20260719_1500-<newrev>_add_merchant_notify_links.py`
- Modify: `railway.toml` (bump `preDeployCommand` to the new rev)
- Test: `sellary-backend/tests/integration/test_merchant_notify_link_model.py` (Create)
- Existing guard that must stay green: `tests/unit/test_migration_chain.py`

**Interfaces**
- Produces: `models.MerchantNotifyLink` (see Interfaces block).
- Migration: `revision = "<newrev>"`, `down_revision = "e1f2a3b4c5d6"`.

**TDD steps**

1. Test — model persists and the unique constraint holds:
```python
# tests/integration/test_merchant_notify_link_model.py
import pytest
from sqlalchemy.exc import IntegrityError
from models.merchant_notify_link import MerchantNotifyLink

def test_can_create_link(db_session, default_company):
    link = MerchantNotifyLink(company_id=default_company.id, telegram_chat_id="123456")
    db_session.add(link)
    db_session.flush()          # NOT commit — rollback isolation
    assert link.id is not None
    assert link.created_at is not None

def test_unique_company_chat(db_session, default_company):
    db_session.add(MerchantNotifyLink(company_id=default_company.id, telegram_chat_id="777"))
    db_session.flush()
    db_session.add(MerchantNotifyLink(company_id=default_company.id, telegram_chat_id="777"))
    with pytest.raises(IntegrityError):
        db_session.flush()
```

2. Implement the model:
```python
# models/merchant_notify_link.py
"""Telegram chats to notify per shop (F6 new-order notifications).

A merchant links their chat once via the bot's /start deep-link; each new online
order fires a best-effort message to every linked chat for that company.
"""
from sqlalchemy import Column, ForeignKey, Index, Integer, String, UniqueConstraint, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from core.database import Base


class MerchantNotifyLink(Base):
    __tablename__ = "merchant_notify_links"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    telegram_chat_id = Column(String(64), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    company = relationship("Company")

    __table_args__ = (
        UniqueConstraint("company_id", "telegram_chat_id", name="uq_merchant_notify_company_chat"),
        Index("ix_merchant_notify_company_id", "company_id"),
    )
```

3. Register in `models/__init__.py`: add `from .merchant_notify_link import MerchantNotifyLink`
   and `"MerchantNotifyLink"` in `__all__`.

4. Write the migration (mirror the head file's style — plain VARCHAR, explicit indexes):
```python
"""add merchant_notify_links table (F6 bot notifications)

Revision ID: <newrev>
Revises: e1f2a3b4c5d6
Create Date: 2026-07-19 15:00:00
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "<newrev>"
down_revision: Union[str, None] = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_table(
        "merchant_notify_links",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id"), nullable=False),
        sa.Column("telegram_chat_id", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("company_id", "telegram_chat_id",
                            name="uq_merchant_notify_company_chat"),
    )
    op.create_index("ix_merchant_notify_company_id", "merchant_notify_links", ["company_id"])

def downgrade() -> None:
    op.drop_index("ix_merchant_notify_company_id", table_name="merchant_notify_links")
    op.drop_table("merchant_notify_links")
```
   Pick a real hex `<newrev>` (e.g. continue the codebase's rolling-hex convention, next after
   `e1f2a3b4c5d6`). Name the file `20260719_1500-<newrev>_add_merchant_notify_links.py`.

5. Bump `railway.toml`: `preDeployCommand = "alembic upgrade <newrev>"`.

6. Run the guard + model tests:
   `.venv\Scripts\pytest.exe tests/unit/test_migration_chain.py tests/integration/test_merchant_notify_link_model.py -v`.
   All three chain tests must pass (still exactly two heads; pin equals new live head).

---

### Task 3 — Company-ref token: mint + verify (pure helper)

**Files**
- Create: `sellary-backend/services/merchant_link_token.py`
- Test: `sellary-backend/tests/unit/test_merchant_link_token.py` (Create)

**Interfaces**
- Produces: `mint_company_ref(company_id, *, secret) -> str`,
  `verify_company_ref(token, *, secret) -> int | None`.
- Consumes: `hmac`, `hashlib`, `base64` (stdlib only). No DB, no network.

**TDD steps**

1. Tests — round-trip, tamper rejection, budget:
```python
# tests/unit/test_merchant_link_token.py
from services.merchant_link_token import mint_company_ref, verify_company_ref

SECRET = "unit-test-secret-key-at-least-32-chars-long!!"

def test_round_trip():
    token = mint_company_ref(42, secret=SECRET)
    assert verify_company_ref(token, secret=SECRET) == 42

def test_tampered_token_rejected():
    token = mint_company_ref(42, secret=SECRET)
    assert verify_company_ref(token[:-1] + ("A" if token[-1] != "A" else "B"), secret=SECRET) is None

def test_wrong_secret_rejected():
    token = mint_company_ref(42, secret=SECRET)
    assert verify_company_ref(token, secret="different-secret") is None

def test_garbage_rejected():
    assert verify_company_ref("not-a-token", secret=SECRET) is None
    assert verify_company_ref("", secret=SECRET) is None

def test_fits_telegram_start_budget():
    # Telegram /start payload: <=64 chars, [A-Za-z0-9_-] only.
    import re
    token = mint_company_ref(2_000_000_000, secret=SECRET)
    assert len(token) <= 64
    assert re.fullmatch(r"[A-Za-z0-9_-]+", token)
```

2. Implement (base64url, no padding, truncated HMAC, constant-time compare):
```python
# services/merchant_link_token.py
"""Signed opaque company reference carried in the bot's /start deep-link.

Format:  b64url(company_id_bytes) + "." + b64url(HMAC_SHA256(secret, company_id_bytes)[:16])
The signature prevents a stranger from linking their chat to someone else's shop.
Pure helper — no DB, no network. Reuses the codebase HMAC idiom (telegram_auth_service).
"""
from __future__ import annotations
import base64
import hashlib
import hmac

_SIG_BYTES = 16  # 128-bit tag → 22 b64url chars, well within Telegram's 64-char budget


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")

def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))

def _sig(company_bytes: bytes, secret: str) -> bytes:
    return hmac.new(secret.encode(), company_bytes, hashlib.sha256).digest()[:_SIG_BYTES]

def mint_company_ref(company_id: int, *, secret: str) -> str:
    body = str(company_id).encode()
    return f"{_b64(body)}.{_b64(_sig(body, secret))}"

def verify_company_ref(token: str, *, secret: str) -> int | None:
    if not token or "." not in token:
        return None
    body_b64, sig_b64 = token.split(".", 1)
    try:
        body = _unb64(body_b64)
        provided = _unb64(sig_b64)
    except Exception:
        return None
    if not hmac.compare_digest(provided, _sig(body, secret)):
        return None
    try:
        return int(body.decode())
    except ValueError:
        return None
```

3. Run: `.venv\Scripts\pytest.exe tests/unit/test_merchant_link_token.py -v`.

---

### Task 4 — Notify repository

**Files**
- Create: `sellary-backend/repositories/merchant_notify_repository.py`
- Test: `sellary-backend/tests/integration/test_merchant_notify_repository.py` (Create)

**Interfaces**
- Produces: `MerchantNotifyRepository.upsert(company_id, telegram_chat_id) -> MerchantNotifyLink`,
  `.list_chat_ids_for_company(company_id) -> list[str]`.

**TDD steps**

1. Tests:
```python
# tests/integration/test_merchant_notify_repository.py
from repositories.merchant_notify_repository import MerchantNotifyRepository

def test_upsert_creates_then_is_idempotent(db_session, default_company):
    repo = MerchantNotifyRepository(db_session)
    a = repo.upsert(default_company.id, "555")
    db_session.flush()
    b = repo.upsert(default_company.id, "555")   # same pair → no duplicate
    db_session.flush()
    assert a.id == b.id
    assert repo.list_chat_ids_for_company(default_company.id) == ["555"]

def test_lists_multiple_chats(db_session, default_company):
    repo = MerchantNotifyRepository(db_session)
    repo.upsert(default_company.id, "111")
    repo.upsert(default_company.id, "222")
    db_session.flush()
    assert set(repo.list_chat_ids_for_company(default_company.id)) == {"111", "222"}

def test_empty_for_unlinked_company(db_session, default_company):
    assert MerchantNotifyRepository(db_session).list_chat_ids_for_company(default_company.id) == []
```

2. Implement (upsert = look up existing pair, else insert; `flush()` not `commit()`):
```python
# repositories/merchant_notify_repository.py
from sqlalchemy import select
from sqlalchemy.orm import Session
from models.merchant_notify_link import MerchantNotifyLink


class MerchantNotifyRepository:
    def __init__(self, db: Session):
        self.db = db

    def upsert(self, company_id: int, telegram_chat_id: str) -> MerchantNotifyLink:
        existing = self.db.execute(
            select(MerchantNotifyLink).where(
                MerchantNotifyLink.company_id == company_id,
                MerchantNotifyLink.telegram_chat_id == telegram_chat_id,
            )
        ).scalar_one_or_none()
        if existing is not None:
            return existing
        link = MerchantNotifyLink(company_id=company_id, telegram_chat_id=telegram_chat_id)
        self.db.add(link)
        self.db.flush()
        return link

    def list_chat_ids_for_company(self, company_id: int) -> list[str]:
        rows = self.db.execute(
            select(MerchantNotifyLink.telegram_chat_id).where(
                MerchantNotifyLink.company_id == company_id
            )
        ).scalars().all()
        return list(rows)
```

3. Run: `.venv\Scripts\pytest.exe tests/integration/test_merchant_notify_repository.py -v`.

---

### Task 5 — Bot API client (injectable, mockable)

**Files**
- Create: `sellary-backend/services/telegram_bot_client.py`
- Test: `sellary-backend/tests/unit/test_telegram_bot_client.py` (Create)

**Interfaces**
- Produces: `TelegramBotClient(bot_token, base_url, http).send_message(chat_id, text) -> None`.
- Consumes: `httpx.Client` (injectable; default constructed lazily). **No real network in tests.**

**TDD steps**

1. Tests — hits the right URL/payload; propagates errors (so the *service* can swallow them). Use
   `httpx.MockTransport` — never a real request:
```python
# tests/unit/test_telegram_bot_client.py
import httpx, json, pytest
from services.telegram_bot_client import TelegramBotClient

def _client(handler):
    transport = httpx.MockTransport(handler)
    http = httpx.Client(transport=transport)
    return TelegramBotClient(bot_token="TESTTOKEN", base_url="https://api.telegram.org", http=http)

def test_send_message_posts_expected_request():
    captured = {}
    def handler(request):
        captured["url"] = str(request.url)
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"ok": True})
    _client(handler).send_message("999", "hi")
    assert captured["url"] == "https://api.telegram.org/botTESTTOKEN/sendMessage"
    assert captured["body"] == {"chat_id": "999", "text": "hi"}

def test_send_message_raises_on_http_error():
    def handler(request):
        return httpx.Response(403, json={"ok": False, "description": "blocked"})
    with pytest.raises(Exception):
        _client(handler).send_message("999", "hi")

def test_send_message_raises_on_network_error():
    def handler(request):
        raise httpx.ConnectError("boom")
    with pytest.raises(Exception):
        _client(handler).send_message("999", "hi")
```

2. Implement:
```python
# services/telegram_bot_client.py
"""Thin Bot API wrapper (sendMessage only, MVP). Injectable httpx.Client so
tests supply a MockTransport — no test ever performs a real network call."""
from __future__ import annotations
import httpx


class TelegramBotClient:
    def __init__(self, *, bot_token: str, base_url: str = "https://api.telegram.org",
                 http: httpx.Client | None = None, timeout: float = 5.0):
        self._token = bot_token
        self._base = base_url.rstrip("/")
        self._http = http or httpx.Client(timeout=timeout)

    def send_message(self, chat_id: str, text: str) -> None:
        resp = self._http.post(
            f"{self._base}/bot{self._token}/sendMessage",
            json={"chat_id": chat_id, "text": text},
        )
        resp.raise_for_status()
```
   Note: the client *raises* on failure by design; swallowing happens one layer up in the
   service (single place, easy to test).

3. Run: `.venv\Scripts\pytest.exe tests/unit/test_telegram_bot_client.py -v`.

---

### Task 6 — Notify service: link + format + best-effort send

**Files**
- Create: `sellary-backend/services/merchant_notify_service.py`
- Test: `sellary-backend/tests/integration/test_merchant_notify_service.py` (Create)

**Interfaces**
- Produces: `MerchantNotifyService(db, bot_client=...).link_from_start_payload(payload, chat_id) -> bool`,
  `.notify_new_order(order) -> None` (never raises), `.format_order_message(order) -> str`.
- Consumes: `MerchantNotifyRepository`, `merchant_link_token.verify_company_ref`,
  `TelegramBotClient`, `settings.SECRET_KEY`.

**TDD steps**

1. Tests:
```python
# tests/integration/test_merchant_notify_service.py
from decimal import Decimal
from unittest.mock import MagicMock
from core.config import settings
from services.merchant_notify_service import MerchantNotifyService
from services.merchant_link_token import mint_company_ref
from repositories.merchant_notify_repository import MerchantNotifyRepository


class _FakeBot:
    def __init__(self): self.sent = []
    def send_message(self, chat_id, text): self.sent.append((chat_id, text))

class _BoomBot:
    def send_message(self, chat_id, text): raise RuntimeError("telegram down")


def test_link_from_valid_payload(db_session, default_company):
    svc = MerchantNotifyService(db_session, bot_client=_FakeBot())
    payload = mint_company_ref(default_company.id, secret=settings.SECRET_KEY)
    assert svc.link_from_start_payload(payload, "12345") is True
    db_session.flush()
    assert MerchantNotifyRepository(db_session).list_chat_ids_for_company(default_company.id) == ["12345"]

def test_link_from_invalid_payload_is_ignored(db_session, default_company):
    svc = MerchantNotifyService(db_session, bot_client=_FakeBot())
    assert svc.link_from_start_payload("forged-token", "12345") is False
    db_session.flush()
    assert MerchantNotifyRepository(db_session).list_chat_ids_for_company(default_company.id) == []

def test_notify_sends_to_all_links(db_session, default_company, make_order):
    MerchantNotifyRepository(db_session).upsert(default_company.id, "111")
    MerchantNotifyRepository(db_session).upsert(default_company.id, "222")
    db_session.flush()
    bot = _FakeBot()
    order = make_order(company_id=default_company.id)   # helper builds a persisted order + items
    MerchantNotifyService(db_session, bot_client=bot).notify_new_order(order)
    assert {c for c, _ in bot.sent} == {"111", "222"}
    body = bot.sent[0][1]
    assert str(order.order_number) in body

def test_notify_swallows_send_failure(db_session, default_company, make_order):
    MerchantNotifyRepository(db_session).upsert(default_company.id, "111")
    db_session.flush()
    order = make_order(company_id=default_company.id)
    # Must NOT raise even though the bot always throws.
    MerchantNotifyService(db_session, bot_client=_BoomBot()).notify_new_order(order)

def test_notify_noop_when_no_links(db_session, default_company, make_order):
    bot = _FakeBot()
    order = make_order(company_id=default_company.id)
    MerchantNotifyService(db_session, bot_client=bot).notify_new_order(order)
    assert bot.sent == []

def test_format_message_contains_key_fields(db_session, default_company, make_order):
    order = make_order(company_id=default_company.id)
    msg = MerchantNotifyService.format_order_message(order)
    assert str(order.order_number) in msg
    assert order.contact_name in msg
```
   Add a small `make_order` fixture to `tests/conftest.py` (or a local fixture) that persists an
   `Order` + `OrderItem`(s) under a company using `session.flush()` — reuse the existing
   `default_company`, `test_product`, and a telegram-user helper from F4 tests. Accept
   `notify_new_order` taking either an ORM `Order` or an `OrderResponse` (format helper reads
   `order_number`, `contact_name`, `contact_phone`, `total_amount`, `fulfillment_type`, and a
   count of `items`).

2. Implement:
```python
# services/merchant_notify_service.py
"""Merchant new-order notifications (F6).

Two jobs:
  * link_from_start_payload — verify the signed company-ref from the bot's
    /start deep-link and upsert a merchant_notify_links row.
  * notify_new_order — best-effort push to every linked chat. NEVER raises:
    a Bot API / network failure must not affect order placement.
"""
from __future__ import annotations
import logging
from sqlalchemy.orm import Session

from core.config import settings
from repositories.merchant_notify_repository import MerchantNotifyRepository
from services.merchant_link_token import verify_company_ref
from services.telegram_bot_client import TelegramBotClient

logger = logging.getLogger(__name__)

_FULFILLMENT_RU = {"delivery": "доставка", "pickup": "самовывоз"}


class MerchantNotifyService:
    def __init__(self, db: Session, *, bot_client: TelegramBotClient | None = None):
        self.db = db
        self.repo = MerchantNotifyRepository(db)
        self._bot = bot_client or TelegramBotClient(
            bot_token=settings.TELEGRAM_BOT_TOKEN,
            base_url=settings.TELEGRAM_API_BASE_URL,
        )

    def link_from_start_payload(self, payload: str, telegram_chat_id: str) -> bool:
        company_id = verify_company_ref(payload, secret=settings.SECRET_KEY)
        if company_id is None:
            return False
        self.repo.upsert(company_id, telegram_chat_id)
        return True

    @staticmethod
    def format_order_message(order) -> str:
        n_items = len(order.items)
        fulfil = _FULFILLMENT_RU.get(str(order.fulfillment_type), str(order.fulfillment_type))
        return (
            f"🛒 Новый заказ #{order.order_number}, "
            f"{n_items} товаров, {order.total_amount}, {fulfil}, "
            f"{order.contact_name} {order.contact_phone}"
        )

    def notify_new_order(self, order) -> None:
        try:
            chat_ids = self.repo.list_chat_ids_for_company(order.company_id)
            if not chat_ids:
                return
            text = self.format_order_message(order)
            for chat_id in chat_ids:
                try:
                    self._bot.send_message(chat_id, text)
                except Exception:
                    logger.warning(
                        "merchant notify send failed company=%s chat=%s order=%s",
                        order.company_id, chat_id, getattr(order, "order_number", "?"),
                        exc_info=True,
                    )
        except Exception:  # defense in depth — lookup/format must not bubble either
            logger.exception("merchant notify failed for order company=%s", getattr(order, "company_id", "?"))
```

3. Run: `.venv\Scripts\pytest.exe tests/integration/test_merchant_notify_service.py -v`.

---

### Task 7 — Webhook endpoint

**Files**
- Create: `sellary-backend/api/telegram_webhook.py`
- Create: `sellary-backend/schemas/telegram.py`
- Modify: `sellary-backend/main.py` (import + `include_router`)
- Test: `sellary-backend/tests/integration/test_telegram_webhook.py` (Create)

**Interfaces**
- Route: `POST /api/telegram/webhook`.
- Header: `X-Telegram-Bot-Api-Secret-Token` compared to `settings.TELEGRAM_WEBHOOK_SECRET`
  (constant-time). Missing/wrong/unconfigured → **403**, no side effects.
- Consumes: `MerchantNotifyService.link_from_start_payload`.
- Produces: `200 {"ok": true}` for handled and gracefully-ignored updates.

**TDD steps**

1. Tests — valid `/start` links a chat; bad secret → 403; irrelevant update → 200 no-op:
```python
# tests/integration/test_telegram_webhook.py
import pytest
from core.config import settings
from services.merchant_link_token import mint_company_ref
from repositories.merchant_notify_repository import MerchantNotifyRepository

SECRET = "webhook-secret-header-value"

@pytest.fixture(autouse=True)
def _set_secret(monkeypatch):
    monkeypatch.setattr(settings, "TELEGRAM_WEBHOOK_SECRET", SECRET)

def _hdr(secret=SECRET):
    return {"X-Telegram-Bot-Api-Secret-Token": secret}

def test_start_payload_links_chat(client, db_session, default_company):
    payload = mint_company_ref(default_company.id, secret=settings.SECRET_KEY)
    body = {"update_id": 1, "message": {"chat": {"id": 55501}, "text": f"/start {payload}"}}
    resp = client.post("/api/telegram/webhook", json=body, headers=_hdr())
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    assert MerchantNotifyRepository(db_session).list_chat_ids_for_company(default_company.id) == ["55501"]

def test_wrong_secret_rejected(client, default_company):
    body = {"update_id": 1, "message": {"chat": {"id": 1}, "text": "/start x"}}
    resp = client.post("/api/telegram/webhook", json=body, headers=_hdr("nope"))
    assert resp.status_code == 403

def test_missing_secret_rejected(client):
    resp = client.post("/api/telegram/webhook", json={"update_id": 1})
    assert resp.status_code == 403

def test_unconfigured_secret_fails_closed(client, monkeypatch):
    monkeypatch.setattr(settings, "TELEGRAM_WEBHOOK_SECRET", "")
    resp = client.post("/api/telegram/webhook", json={"update_id": 1}, headers={"X-Telegram-Bot-Api-Secret-Token": ""})
    assert resp.status_code == 403

def test_irrelevant_update_is_noop_200(client, db_session, default_company):
    # A plain text message (no /start) — accepted, nothing linked.
    body = {"update_id": 2, "message": {"chat": {"id": 999}, "text": "hello bot"}}
    resp = client.post("/api/telegram/webhook", json=body, headers=_hdr())
    assert resp.status_code == 200
    assert MerchantNotifyRepository(db_session).list_chat_ids_for_company(default_company.id) == []

def test_start_without_payload_is_noop_200(client):
    body = {"update_id": 3, "message": {"chat": {"id": 999}, "text": "/start"}}
    assert client.post("/api/telegram/webhook", json=body, headers=_hdr()).status_code == 200

def test_empty_update_is_noop_200(client):
    assert client.post("/api/telegram/webhook", json={"update_id": 4}, headers=_hdr()).status_code == 200
```

2. Implement the schema (permissive — Telegram sends many fields we ignore):
```python
# schemas/telegram.py
from pydantic import BaseModel, ConfigDict

class _Loose(BaseModel):
    model_config = ConfigDict(extra="ignore")

class TelegramChat(_Loose):
    id: int

class TelegramMessage(_Loose):
    chat: TelegramChat | None = None
    text: str | None = None

class TelegramUpdate(_Loose):
    update_id: int | None = None
    message: TelegramMessage | None = None
```

3. Implement the router:
```python
# api/telegram_webhook.py
"""Telegram bot webhook (F6). Verifies the secret-token header, then handles the
merchant linking command `/start <company-ref>`. All other updates are a
graceful 200 no-op. The webhook must commit its own link write."""
import hmac
import logging

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from core.config import settings
from core.database import get_db
from schemas.telegram import TelegramUpdate
from services.merchant_notify_service import MerchantNotifyService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/telegram", tags=["telegram-webhook"])


def _verify_secret(secret_header: str | None) -> None:
    configured = settings.TELEGRAM_WEBHOOK_SECRET
    # Fail-closed: no configured secret → reject everything.
    if not configured or not secret_header or not hmac.compare_digest(secret_header, configured):
        raise HTTPException(status_code=403, detail="forbidden")


@router.post("/webhook")
def telegram_webhook(
    update: TelegramUpdate,
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _verify_secret(x_telegram_bot_api_secret_token)

    msg = update.message
    text = (msg.text if msg else None) or ""
    if msg and msg.chat and text.startswith("/start"):
        parts = text.split(maxsplit=1)
        if len(parts) == 2 and parts[1].strip():
            payload = parts[1].strip()
            linked = MerchantNotifyService(db).link_from_start_payload(payload, str(msg.chat.id))
            if linked:
                db.commit()
    # Everything else (and failed/absent payloads): graceful no-op.
    return {"ok": True}
```

4. Register in `main.py`: import `telegram_webhook_router` and add
   `app.include_router(telegram_webhook_router, prefix=settings.API_V1_STR)` beside the other
   routers.

5. Run: `.venv\Scripts\pytest.exe tests/integration/test_telegram_webhook.py -v`.

---

### Task 8 — Wire notification into order placement

**Files**
- Modify: `sellary-backend/api/shop_orders.py` (add the best-effort notify hook)
- Test: `sellary-backend/tests/integration/test_shop_orders_notify.py` (Create)

**Interfaces**
- Consumes: `MerchantNotifyService.notify_new_order(order)` per created order, scheduled via
  FastAPI `BackgroundTasks` **after** the successful commit (Design Decision 2).
- Produces: unchanged `201` `List[OrderResponse]`.

**TDD steps**

1. Tests — new order triggers notify per company; a notify exception does NOT fail the order:
```python
# tests/integration/test_shop_orders_notify.py
# Reuse F4's checkout fixtures/helpers (see tests/integration/test_shop_order_endpoints.py):
#   _sign(telegram_id=...), a published product under a marketplace-enabled company,
#   an Idempotency-Key header, and a valid CheckoutRequest body.
from unittest.mock import patch
from repositories.merchant_notify_repository import MerchantNotifyRepository


def test_placing_order_notifies_linked_merchant(shop_client, db_session, marketplace_company, checkout_body, idem_headers):
    MerchantNotifyRepository(db_session).upsert(marketplace_company.id, "42042")
    db_session.flush()
    sent = []
    def fake_send(self, order):   # patch the service method, capture calls
        sent.append(order.company_id)
    with patch("services.merchant_notify_service.MerchantNotifyService.notify_new_order", fake_send):
        resp = shop_client.post("/api/shop/orders", json=checkout_body, headers=idem_headers)
    assert resp.status_code == 201
    assert marketplace_company.id in sent   # notify fired for the affected company

def test_notify_failure_does_not_fail_order(shop_client, db_session, marketplace_company, checkout_body, idem_headers):
    MerchantNotifyRepository(db_session).upsert(marketplace_company.id, "42042")
    db_session.flush()
    def boom(self, order):
        raise RuntimeError("telegram exploded")
    # Because the production hook wraps notify in try/except AND the service self-guards,
    # the order response must still be 201 even if the scheduled task raises.
    with patch("services.merchant_notify_service.MerchantNotifyService.notify_new_order", boom):
        resp = shop_client.post("/api/shop/orders", json=checkout_body, headers=idem_headers)
    assert resp.status_code == 201
    assert len(resp.json()) >= 1   # orders were still created & returned
```
   Note on the second test: schedule the notify via a small **wrapper** that itself swallows
   exceptions (so a raised BackgroundTask cannot surface even under `TestClient`, which
   re-raises background exceptions). This makes "notify failure never fails the order" a
   structural guarantee, not just a convention.

2. Implement in `api/shop_orders.py` — add `BackgroundTasks` to the endpoint and schedule a
   guarded notify per created order after `db.commit()`:
```python
from fastapi import BackgroundTasks
from services.merchant_notify_service import MerchantNotifyService
from models.order import Order

def _safe_notify(db: Session, order_id: int) -> None:
    """Best-effort: reload the order in a fresh unit of work and notify. Any
    failure is swallowed — order placement already succeeded and committed."""
    try:
        order = db.get(Order, order_id)
        if order is not None:
            MerchantNotifyService(db).notify_new_order(order)
    except Exception:
        logging.getLogger(__name__).exception("post-order notify failed order=%s", order_id)
```
   In `place_orders`, add `background_tasks: BackgroundTasks` to the signature; after the
   `db.commit()` that stores the idempotency record, schedule one task per created order:
```python
    for created_order in created:
        background_tasks.add_task(_safe_notify, db, created_order.id)
    return created
```
   Notes: (a) the `_safe_notify` wrapper + the service's internal guard = double swallow, so a
   raised notify never escapes; (b) scheduling *after* commit means the DB row is durable before
   we notify; (c) reusing the request `db` session inside a BackgroundTask is acceptable here
   because the task runs before the session dependency closes under Starlette's ordering — if a
   fresh session is preferred, open one via `SessionLocal()` inside `_safe_notify` and close it
   in a `finally`. **Recommend the fresh-session variant for production robustness**; keep the
   plan's tests agnostic by patching `notify_new_order`.

3. Run: `.venv\Scripts\pytest.exe tests/integration/test_shop_orders_notify.py -v`.

---

### Task 9 — Full-suite + compile gate

**Files**: none (verification only).

**Steps**
1. `.venv\Scripts\python.exe -m compileall api core models repositories schemas services main.py`
   (CI gate — must exit clean).
2. `.venv\Scripts\pytest.exe tests/unit tests/integration -q` — full suite green, including the
   migration-chain guard.
3. Confirm `railway.toml` pin equals the new live head (asserted by
   `test_railway_pin_matches_live_head`).

---

## Self-Review Notes — scope-item → task mapping

| Scope item (from the F6 brief) | Task(s) |
|---|---|
| Migration `merchant_notify_links` (id, company_id FK, telegram_chat_id, created_at; unique (company_id, telegram_chat_id)); chains off `e1f2a3b4c5d6`; new head; bump `railway.toml`; two-heads guard | Task 2 |
| Register model in `models/__init__.py` | Task 2 (step 3) |
| Webhook `POST /api/telegram/webhook`; `/start <payload>` upserts a link | Task 7 (+ token verify Task 3, service Task 6) |
| Webhook verifies `X-Telegram-Bot-Api-Secret-Token`; wrong/missing → 403; irrelevant update → 200 no-op | Task 7 |
| Notification send service — format message, look up links, resilient best-effort send with mocked Bot API, swallows failure | Tasks 5 (client) + 6 (service) |
| Wire into order placement after `POST /api/shop/orders`; failure must not roll back / fail the response | Task 8 |
| Sync vs BackgroundTasks decision (documented + recommended) | Design Decision 2; Task 8 |
| Config `TELEGRAM_WEBHOOK_SECRET` + Bot API base URL | Task 1 |
| Bot API calls injectable/mockable — no network in tests | Task 5 (httpx MockTransport) + Task 6 (fake bot) |
| Company-ref scheme documented + verified (signed vs slug) | Design Decision 1; Tasks 3, 6, 7 |

**Explicitly deferred (not in this plan):** the admin-panel "Connect Telegram notifications"
button that renders `t.me/<bot>?start=<mint_company_ref(company_id)>` in the Next.js frontend.
F6 backend provides the mint helper (`services/merchant_link_token.py`) and the consuming
webhook; the small admin-UI follow-up (and, optionally, a merchant endpoint
`GET /api/company/telegram-link` returning the deep-link) is a separate task in
`sellary-frontend/`. Shopper-facing status-change notifications also remain deferred (roadmap).

**Assumptions:**
- `httpx` (already `>=0.28.1` in `requirements.txt`, present in venv) is the HTTP client; no new
  dependency needed.
- F4 checkout endpoint and its test helpers (`_sign`, marketplace-company/published-product
  fixtures, Idempotency-Key usage) exist and are reused for Task 8's integration tests.
- `settings.SECRET_KEY` (already validated `>=32` chars in prod) signs the company-ref token —
  no new secret required for linking; `TELEGRAM_WEBHOOK_SECRET` is separate and guards the
  webhook transport.
- Message language is Russian to match existing UI-string convention.
