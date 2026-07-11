# Offline Credit — Backend (Sync) Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Make offline credit sales (В долг), offline customer creation, and offline debt repayments syncable from the Tauri cashier, entirely with **additive** backend changes. Concretely: add `customers.client_customer_id` (C1), `POST /api/sync/customers` batch upsert (C2), `customers` in the bootstrap response (C3), credit routing in `POST /api/sync/sales` (C4), and `POST /api/sync/payments` batch with cap-to-balance (C5).

**Architecture:** FastAPI routers (`api/sync.py`) → services (`SyncService`, new `CustomerSyncService`, reused `CustomerLedgerService`) → repositories/models. Debt balance stays **derived** (`SUM(customer_ledger_entries.amount)`); the sync path only routes into the existing, sound credit engine (`record_credit_sale`, `record_payment`). Exactly one new Alembic migration chains off the Phase-1 head `c3d4e5f6a7b8`; railway pins bump in the same commit.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy, Alembic, Pydantic v2, pytest (in-memory SQLite + transaction rollback isolation).

**Depends on:** none (foundation plan; the cashier-side plans consume the endpoints/columns this delivers).

---

## File Structure

**Create**
- `sellary-backend/alembic/versions/20260711_0000-d4e5f6a7b8c9_add_customer_client_customer_id.py` — one migration: `customers.client_customer_id` column + partial unique index.
- `sellary-backend/services/customer_sync_service.py` — `CustomerSyncService`: batch customer upsert (C2) + batch debt payments with cap-to-balance (C5).
- `sellary-backend/tests/integration/test_sync_customers.py` — C2 upsert/dedup/merge/replay + partial-unique-index behaviour.
- `sellary-backend/tests/integration/test_sync_bootstrap_customers.py` — C3 bootstrap returns customers + derived balances.
- `sellary-backend/tests/integration/test_sync_credit_sales.py` — C4 credit routing + cash/card/mobile regression.
- `sellary-backend/tests/integration/test_sync_payments.py` — C5 cap-to-balance + warning + idempotency.

**Modify**
- `sellary-backend/models/customer.py` — add `client_customer_id` column + partial unique index.
- `sellary-backend/schemas/sync.py` — add customer/payment sync schemas; add `customers` to bootstrap; add credit fields to `SyncSaleCreate`.
- `sellary-backend/services/sync_service.py` — bootstrap ships customers (C3); `_validate_sale`/`_create_sale` route credit (C4).
- `sellary-backend/api/sync.py` — register `POST /sync/customers` and `POST /sync/payments`.
- `sellary-backend/tests/unit/test_migration_chain.py` — retarget assertions at the new head.
- `railway.toml` (repo ROOT) — bump `preDeployCommand` pin.
- `sellary-backend/railway.json` — bump `preDeployCommand` pin.

All commands below run **from `sellary-backend/`** with the venv, except the two railway files (repo root). Backend test command: `.venv\Scripts\python.exe -m pytest <path> -q`. Compile gate: `.venv\Scripts\python.exe -m compileall api core models repositories schemas services main.py`. Migration-chain assertions are DB-free (they read `ScriptDirectory`); `alembic upgrade/downgrade` needs Postgres and is a manual gate.

---

## Task 1: C1 — `customers.client_customer_id` column + migration + railway pins

**Files:**
- `sellary-backend/tests/unit/test_migration_chain.py` (modify)
- `sellary-backend/alembic/versions/20260711_0000-d4e5f6a7b8c9_add_customer_client_customer_id.py` (create)
- `sellary-backend/models/customer.py` (modify)
- `sellary-backend/tests/integration/test_sync_customers.py` (create — index test only in this task; C2 behaviour tests added in Task 2)
- `railway.toml` (modify)
- `sellary-backend/railway.json` (modify)

### Step 1.1 — Retarget the migration-chain test (write failing test)

Replace the whole body of `sellary-backend/tests/unit/test_migration_chain.py` with:

```python
"""Assert the ONE new migration chains off c3d4e5f6a7b8 and the dead head stays."""
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

NEW_REV = "d4e5f6a7b8c9"
LIVE_HEAD = "c3d4e5f6a7b8"
DEAD_HEAD = "20260319_0001"

BACKEND_DIR = Path(__file__).resolve().parents[2]


def _script() -> ScriptDirectory:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return ScriptDirectory.from_config(cfg)


def test_new_migration_chains_off_live_head():
    script = _script()
    rev = script.get_revision(NEW_REV)
    assert rev is not None
    assert rev.down_revision == LIVE_HEAD


def test_new_rev_is_a_head_and_dead_head_untouched():
    script = _script()
    heads = set(script.get_heads())
    # Exactly two heads: the new one (main lineage) and the untouched dead head.
    assert NEW_REV in heads
    assert DEAD_HEAD in heads
    assert LIVE_HEAD not in heads  # c3d4e5f6a7b8 is now superseded by NEW_REV
    assert len(heads) == 2
```

Run:

```
.venv\Scripts\python.exe -m pytest tests/unit/test_migration_chain.py -q
```

**Expected: FAIL** — `test_new_migration_chains_off_live_head` errors with `alembic.util.exc.CommandError: Can't locate revision identified by 'd4e5f6a7b8c9'` (the migration file does not exist yet).

### Step 1.2 — Create the migration (minimal impl)

Create `sellary-backend/alembic/versions/20260711_0000-d4e5f6a7b8c9_add_customer_client_customer_id.py`:

```python
"""add customers.client_customer_id

C1 (offline credit): customers.client_customer_id is a nullable local-origin id
from the offline cashier. A partial unique index dedupes offline-created
customers per company while leaving the existing NULL (web-created) rows
unconstrained. Chains off the Phase-1 head c3d4e5f6a7b8; the dead 20260319_0001
head is intentionally left untouched (no alembic merge).

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-07-11 00:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, None] = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Small table (retail POS); DDL is fast and taken inside the migration
    # transaction, so no CONCURRENTLY / long-lock concern.
    op.add_column(
        "customers",
        sa.Column("client_customer_id", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "ix_customers_client_customer_id",
        "customers",
        ["client_customer_id"],
    )
    op.create_index(
        "uq_customers_company_client_customer_id",
        "customers",
        ["company_id", "client_customer_id"],
        unique=True,
        postgresql_where=sa.text("client_customer_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_customers_company_client_customer_id", table_name="customers"
    )
    op.drop_index("ix_customers_client_customer_id", table_name="customers")
    op.drop_column("customers", "client_customer_id")
```

Run:

```
.venv\Scripts\python.exe -m pytest tests/unit/test_migration_chain.py -q
```

**Expected: PASS** — both tests green (new rev found, chains off `c3d4e5f6a7b8`, exactly two heads).

### Step 1.3 — Add the model column + partial unique index (write failing test)

Create `sellary-backend/tests/integration/test_sync_customers.py` with the index test (behaviour tests are appended in Task 2):

```python
"""C1/C2: customers.client_customer_id column, partial unique index, sync upsert."""
import pytest
from sqlalchemy.exc import IntegrityError

from models.customer import Customer


class TestClientCustomerIdIndex:
    def test_null_client_customer_ids_coexist(self, db_session, default_company):
        db_session.add(Customer(company_id=default_company.id, name="A", phone="p-a"))
        db_session.add(Customer(company_id=default_company.id, name="B", phone="p-b"))
        db_session.flush()  # two NULL client_customer_id rows are fine

    def test_duplicate_client_customer_id_in_company_collides(
        self, db_session, default_company
    ):
        db_session.add(
            Customer(
                company_id=default_company.id,
                name="A",
                phone="p-1",
                client_customer_id="cc-dup",
            )
        )
        db_session.flush()
        db_session.add(
            Customer(
                company_id=default_company.id,
                name="B",
                phone="p-2",
                client_customer_id="cc-dup",
            )
        )
        with pytest.raises(IntegrityError):
            db_session.flush()
        db_session.rollback()
```

Run:

```
.venv\Scripts\python.exe -m pytest tests/integration/test_sync_customers.py -q
```

**Expected: FAIL** — `TypeError: 'client_customer_id' is an invalid keyword argument for Customer` (the model has no such column yet).

### Step 1.4 — Add the model column (minimal impl)

Edit `sellary-backend/models/customer.py`. Change the import line and add the column + index. Full new file:

```python
from sqlalchemy import (
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
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from core.database import Base


class Customer(Base):
    __tablename__ = "customers"
    __table_args__ = (
        UniqueConstraint("company_id", "phone", name="uq_customers_company_phone"),
        Index(
            "uq_customers_company_client_customer_id",
            "company_id",
            "client_customer_id",
            unique=True,
            sqlite_where=text("client_customer_id IS NOT NULL"),
            postgresql_where=text("client_customer_id IS NOT NULL"),
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    name = Column(String(100), index=True)
    phone = Column(String(20), index=True)
    email = Column(String(100))
    address = Column(String(255))
    description = Column(String(500))
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # C1: local-origin id from the offline cashier. NULL for web-created rows; a
    # partial unique index (above) dedupes per company without constraining NULLs.
    client_customer_id = Column(String(64), nullable=True, index=True)

    company = relationship("Company", back_populates="customers")
    sales = relationship("Sale", back_populates="customer")
    ledger_entries = relationship("CustomerLedgerEntry", back_populates="customer")
```

Run:

```
.venv\Scripts\python.exe -m pytest tests/integration/test_sync_customers.py -q
```

**Expected: PASS** — NULLs coexist; the duplicate non-NULL pair raises `IntegrityError`.

### Step 1.5 — Bump railway pins (same commit as the migration)

Edit `railway.toml` (repo ROOT), line 9:

```toml
preDeployCommand = "alembic upgrade d4e5f6a7b8c9"
```

Edit `sellary-backend/railway.json`, the `deploy.preDeployCommand`:

```json
  "deploy": {
    "preDeployCommand": "alembic upgrade d4e5f6a7b8c9",
    "startCommand": "uvicorn main:app --host 0.0.0.0 --port $PORT",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 300,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
```

### Step 1.6 — Compile gate + commit

Run:

```
.venv\Scripts\python.exe -m compileall api core models repositories schemas services main.py
.venv\Scripts\python.exe -m pytest tests/unit/test_migration_chain.py tests/integration/test_sync_customers.py -q
```

**Expected: PASS** (compileall exits 0; both test files green).

> Manual gate (Postgres, not in CI): `alembic upgrade d4e5f6a7b8c9` then `alembic downgrade c3d4e5f6a7b8` round-trip cleanly.

Commit:

```
git add sellary-backend/models/customer.py sellary-backend/alembic/versions/20260711_0000-d4e5f6a7b8c9_add_customer_client_customer_id.py sellary-backend/tests/unit/test_migration_chain.py sellary-backend/tests/integration/test_sync_customers.py railway.toml sellary-backend/railway.json
git commit -m "feat(sync): add customers.client_customer_id column + partial unique index (C1)"
```

---

## Task 2: C2 — `POST /api/sync/customers` batch upsert

**Files:**
- `sellary-backend/schemas/sync.py` (modify — add customer sync schemas)
- `sellary-backend/services/customer_sync_service.py` (create)
- `sellary-backend/api/sync.py` (modify — register route)
- `sellary-backend/tests/integration/test_sync_customers.py` (modify — append behaviour tests)

### Step 2.1 — Append behaviour tests (write failing tests)

Append to `sellary-backend/tests/integration/test_sync_customers.py`:

```python
from tests.conftest import create_auth_headers


def _headers(cashier_user, default_company):
    return create_auth_headers(
        cashier_user.username,
        cashier_user.id,
        default_company.id,
        cashier_user.role,
    )


def _customer_payload(client_customer_id, name, phone=None):
    item = {"client_customer_id": client_customer_id, "name": name}
    if phone is not None:
        item["phone"] = phone
    return {"customers": [item]}


class TestSyncCustomers:
    def test_create_new_customer_returns_server_id(
        self, client, db_session, default_company, cashier_user
    ):
        headers = _headers(cashier_user, default_company)
        resp = client.post(
            "/api/sync/customers",
            json=_customer_payload("cc-new-1", "Иван", "+99290100001"),
            headers=headers,
        )
        assert resp.status_code == 200
        result = resp.json()["results"][0]
        assert result["status"] == "synced"
        assert result["server_id"] is not None

        customer = db_session.get(Customer, result["server_id"])
        assert customer.client_customer_id == "cc-new-1"
        assert customer.name == "Иван"

    def test_replay_same_client_customer_id_is_duplicate(
        self, client, default_company, cashier_user
    ):
        headers = _headers(cashier_user, default_company)
        body = _customer_payload("cc-replay-1", "Пётр", "+99290100002")
        first = client.post("/api/sync/customers", json=body, headers=headers).json()
        second = client.post("/api/sync/customers", json=body, headers=headers).json()
        assert first["results"][0]["status"] == "synced"
        assert second["results"][0]["status"] == "duplicate"
        assert second["results"][0]["server_id"] == first["results"][0]["server_id"]

    def test_merge_by_phone_attaches_client_customer_id(
        self, client, db_session, default_company, cashier_user
    ):
        # A web-created customer (no client_customer_id) already exists.
        existing = Customer(
            company_id=default_company.id, name="Web", phone="+99290100003"
        )
        db_session.add(existing)
        db_session.flush()
        existing_id = existing.id

        headers = _headers(cashier_user, default_company)
        resp = client.post(
            "/api/sync/customers",
            json=_customer_payload("cc-merge-1", "Web", "+99290100003"),
            headers=headers,
        )
        result = resp.json()["results"][0]
        assert result["status"] == "synced"
        assert result["server_id"] == existing_id

        db_session.expire_all()
        assert db_session.get(Customer, existing_id).client_customer_id == "cc-merge-1"

    def test_batch_returns_one_result_per_customer(
        self, client, default_company, cashier_user
    ):
        headers = _headers(cashier_user, default_company)
        body = {
            "customers": [
                {"client_customer_id": "cc-b1", "name": "A", "phone": "+99290100010"},
                {"client_customer_id": "cc-b2", "name": "B", "phone": "+99290100011"},
            ]
        }
        results = client.post("/api/sync/customers", json=body, headers=headers).json()["results"]
        assert len(results) == 2
        assert {r["client_customer_id"] for r in results} == {"cc-b1", "cc-b2"}
        assert all(r["status"] == "synced" for r in results)
```

Run:

```
.venv\Scripts\python.exe -m pytest tests/integration/test_sync_customers.py::TestSyncCustomers -q
```

**Expected: FAIL** — every request returns `404 Not Found` (route `/api/sync/customers` is not registered), so `resp.json()["results"]` raises `KeyError`.

### Step 2.2 — Add customer sync schemas (minimal impl, part 1)

Edit `sellary-backend/schemas/sync.py`. Insert the `SyncCustomerItem` class **before** `SyncBootstrapResponse` (so the bootstrap field can reference it in Task 3), and append the request/response schemas at the end of the file.

Insert immediately after the `SyncProductItem` class (before `class SyncBootstrapResponse`):

```python
class SyncCustomerItem(BaseModel):
    id: int
    client_customer_id: Optional[str] = None
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    description: Optional[str] = None
    balance: Decimal = Decimal("0.00")
    is_active: bool
```

Append at the end of `sellary-backend/schemas/sync.py`:

```python
class SyncCustomerCreate(BaseModel):
    client_customer_id: str
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    description: Optional[str] = None


class SyncCustomersRequest(BaseModel):
    customers: list[SyncCustomerCreate]


class SyncCustomerResult(BaseModel):
    client_customer_id: str
    status: str
    server_id: Optional[int] = None
    error: Optional[str] = None


class SyncCustomersResponse(BaseModel):
    results: list[SyncCustomerResult]


class SyncPaymentWarning(BaseModel):
    type: str
    requested: Decimal
    applied: Decimal


class SyncPaymentCreate(BaseModel):
    client_payment_id: str
    idempotency_key: str
    client_customer_id: str
    amount: Decimal = Field(..., gt=0, decimal_places=2)
    payment_method: str
    description: Optional[str] = None


class SyncPaymentsRequest(BaseModel):
    payments: list[SyncPaymentCreate]


class SyncPaymentResult(BaseModel):
    client_payment_id: str
    status: str
    applied_amount: Decimal = Decimal("0.00")
    warnings: Optional[list[SyncPaymentWarning]] = None
    error: Optional[str] = None


class SyncPaymentsResponse(BaseModel):
    results: list[SyncPaymentResult]
```

### Step 2.3 — Create `CustomerSyncService` (minimal impl, part 2)

Create `sellary-backend/services/customer_sync_service.py`:

```python
from decimal import Decimal

from sqlalchemy.orm import Session

from core.idempotency import IdempotencyConflictError, IdempotencyService
from models.company import Company
from models.customer import Customer
from models.user import User
from schemas.customer_ledger import CustomerPaymentCreate
from schemas.sale import PaymentMethod as SchemaPaymentMethod
from schemas.sync import (
    SyncCustomerCreate,
    SyncCustomerResult,
    SyncCustomersRequest,
    SyncCustomersResponse,
    SyncPaymentCreate,
    SyncPaymentResult,
    SyncPaymentsRequest,
    SyncPaymentsResponse,
    SyncPaymentWarning,
)
from services.customer_ledger_service import CustomerLedgerService


PAYMENTS_ENDPOINT = "/api/sync/payments"
ZERO = Decimal("0.00")


class CustomerSyncService:
    def __init__(self, db: Session):
        self.db = db

    # ---- C2: batch customer upsert -------------------------------------
    def sync_customers(
        self, company: Company, user: User, request: SyncCustomersRequest
    ) -> SyncCustomersResponse:
        results = [self._upsert_customer(company, item) for item in request.customers]
        return SyncCustomersResponse(results=results)

    def _upsert_customer(
        self, company: Company, item: SyncCustomerCreate
    ) -> SyncCustomerResult:
        try:
            by_client = (
                self.db.query(Customer)
                .filter(
                    Customer.company_id == company.id,
                    Customer.client_customer_id == item.client_customer_id,
                )
                .first()
            )
            if by_client:
                # Idempotent replay — this client id was already pushed.
                return SyncCustomerResult(
                    client_customer_id=item.client_customer_id,
                    status="duplicate",
                    server_id=by_client.id,
                )

            if item.phone:
                by_phone = (
                    self.db.query(Customer)
                    .filter(
                        Customer.company_id == company.id,
                        Customer.phone == item.phone,
                        Customer.is_active == True,  # noqa: E712
                    )
                    .first()
                )
                if by_phone:
                    if by_phone.client_customer_id is None:
                        with self.db.begin_nested():
                            by_phone.client_customer_id = item.client_customer_id
                        return SyncCustomerResult(
                            client_customer_id=item.client_customer_id,
                            status="synced",
                            server_id=by_phone.id,
                        )
                    # Phone already mapped to another device's client id — do not
                    # overwrite; return the known server id.
                    return SyncCustomerResult(
                        client_customer_id=item.client_customer_id,
                        status="duplicate",
                        server_id=by_phone.id,
                    )

            with self.db.begin_nested():
                customer = Customer(
                    company_id=company.id,
                    client_customer_id=item.client_customer_id,
                    name=item.name,
                    phone=item.phone,
                    email=item.email,
                    address=item.address,
                    description=item.description,
                    is_active=True,
                )
                self.db.add(customer)
                self.db.flush()
            return SyncCustomerResult(
                client_customer_id=item.client_customer_id,
                status="synced",
                server_id=customer.id,
            )
        except Exception as exc:  # savepoint already rolled back; batch continues
            return SyncCustomerResult(
                client_customer_id=item.client_customer_id,
                status="failed",
                error=str(exc),
            )

    # ---- C5: batch debt payments (cap-to-balance) ----------------------
    def sync_payments(
        self, company: Company, user: User, request: SyncPaymentsRequest
    ) -> SyncPaymentsResponse:
        results = [
            self._process_payment(company, user, item) for item in request.payments
        ]
        return SyncPaymentsResponse(results=results)

    def _process_payment(
        self, company: Company, user: User, item: SyncPaymentCreate
    ) -> SyncPaymentResult:
        idempotency = IdempotencyService(self.db)
        request_body = item.model_dump()

        try:
            cached = idempotency.get_cached_response(
                key=item.idempotency_key,
                company_id=company.id,
                user_id=user.id,
                endpoint=PAYMENTS_ENDPOINT,
                request_body=request_body,
            )
            if cached:
                body, _ = cached
                return SyncPaymentResult(
                    client_payment_id=item.client_payment_id,
                    status="duplicate",
                    applied_amount=Decimal(str(body.get("applied_amount", "0.00"))),
                )
        except IdempotencyConflictError:
            return SyncPaymentResult(
                client_payment_id=item.client_payment_id, status="duplicate"
            )

        method = item.payment_method.lower()
        if method not in ("cash", "card", "mobile"):
            return SyncPaymentResult(
                client_payment_id=item.client_payment_id,
                status="failed",
                error=f"Invalid payment_method: {item.payment_method}",
            )

        customer = (
            self.db.query(Customer)
            .filter(
                Customer.company_id == company.id,
                Customer.client_customer_id == item.client_customer_id,
                Customer.is_active == True,  # noqa: E712
            )
            .first()
        )
        if not customer:
            return SyncPaymentResult(
                client_payment_id=item.client_payment_id,
                status="failed",
                error=f"Customer not synced: {item.client_customer_id}",
            )

        ledger = CustomerLedgerService(self.db, company.id)
        balance = ledger.get_customer_balance(customer.id)
        requested = Decimal(item.amount).quantize(Decimal("0.01"))
        applied = min(requested, balance) if balance > ZERO else ZERO

        warnings: list[SyncPaymentWarning] = []
        if applied < requested:
            warnings.append(
                SyncPaymentWarning(
                    type="overpayment", requested=requested, applied=applied
                )
            )

        if applied <= ZERO:
            # Nothing to apply, but record idempotency so a re-push is a duplicate.
            return self._store_and_result(
                idempotency, company, user, item, request_body, ZERO, warnings
            )

        try:
            with self.db.begin_nested():
                ledger.record_payment(
                    customer.id,
                    CustomerPaymentCreate(
                        amount=applied,
                        payment_method=SchemaPaymentMethod(method),
                        description=item.description,
                    ),
                    user.id,
                )
        except Exception as exc:
            return SyncPaymentResult(
                client_payment_id=item.client_payment_id,
                status="failed",
                error=str(exc),
            )

        return self._store_and_result(
            idempotency, company, user, item, request_body, applied, warnings
        )

    def _store_and_result(
        self,
        idempotency: IdempotencyService,
        company: Company,
        user: User,
        item: SyncPaymentCreate,
        request_body: dict,
        applied: Decimal,
        warnings: list[SyncPaymentWarning],
    ) -> SyncPaymentResult:
        try:
            idempotency.store_response(
                key=item.idempotency_key,
                company_id=company.id,
                user_id=user.id,
                endpoint=PAYMENTS_ENDPOINT,
                request_body=request_body,
                response_body={"applied_amount": str(applied)},
                status_code=201,
            )
        except IdempotencyConflictError:
            return SyncPaymentResult(
                client_payment_id=item.client_payment_id,
                status="duplicate",
                applied_amount=applied,
            )
        return SyncPaymentResult(
            client_payment_id=item.client_payment_id,
            status="synced",
            applied_amount=applied,
            warnings=warnings or None,
        )
```

### Step 2.4 — Register the route (minimal impl, part 3)

Edit `sellary-backend/api/sync.py`. Replace the import block and append the two endpoints. Full new file:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api.dependencies import AuthContext, get_auth_context
from core.database import get_db
from schemas.sync import (
    SyncBootstrapResponse,
    SyncCustomersRequest,
    SyncCustomersResponse,
    SyncPaymentsRequest,
    SyncPaymentsResponse,
    SyncSalesRequest,
    SyncSalesResponse,
)
from services.customer_sync_service import CustomerSyncService
from services.sync_service import SyncService

router = APIRouter(prefix="/sync", tags=["sync"])


@router.get("/bootstrap", response_model=SyncBootstrapResponse)
def bootstrap(
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    service = SyncService(db)
    return service.bootstrap(auth.company, auth.user)


@router.post("/sales", response_model=SyncSalesResponse)
def sync_sales(
    request: SyncSalesRequest,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    service = SyncService(db)
    try:
        result = service.sync_sales(auth.company, auth.user, request)
        db.commit()
        return result
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/customers", response_model=SyncCustomersResponse)
def sync_customers(
    request: SyncCustomersRequest,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    service = CustomerSyncService(db)
    try:
        result = service.sync_customers(auth.company, auth.user, request)
        db.commit()
        return result
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/payments", response_model=SyncPaymentsResponse)
def sync_payments(
    request: SyncPaymentsRequest,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    service = CustomerSyncService(db)
    try:
        result = service.sync_payments(auth.company, auth.user, request)
        db.commit()
        return result
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))
```

> Note: the previously-unused `IdempotencyConflictError` import was dropped from `api/sync.py` (it is used inside the services, not the router).

Run:

```
.venv\Scripts\python.exe -m pytest tests/integration/test_sync_customers.py -q
```

**Expected: PASS** — create/replay/merge/batch all green.

### Step 2.5 — Compile gate + commit

Run:

```
.venv\Scripts\python.exe -m compileall api core models repositories schemas services main.py
```

**Expected: PASS** (exit 0).

Commit:

```
git add sellary-backend/schemas/sync.py sellary-backend/services/customer_sync_service.py sellary-backend/api/sync.py sellary-backend/tests/integration/test_sync_customers.py
git commit -m "feat(sync): add POST /api/sync/customers batch upsert with phone-dedup merge (C2)"
```

---

## Task 3: C3 — customers in the bootstrap response

**Files:**
- `sellary-backend/schemas/sync.py` (modify — add field to `SyncBootstrapResponse`)
- `sellary-backend/services/sync_service.py` (modify — ship customers)
- `sellary-backend/tests/integration/test_sync_bootstrap_customers.py` (create)

### Step 3.1 — Write failing test

Create `sellary-backend/tests/integration/test_sync_bootstrap_customers.py`:

```python
"""C3: GET /api/sync/bootstrap ships active customers with derived balances."""
from decimal import Decimal

from models.customer import Customer
from models.customer_ledger_entry import CustomerLedgerEntry
from tests.conftest import create_auth_headers


def _headers(cashier_user, default_company):
    return create_auth_headers(
        cashier_user.username,
        cashier_user.id,
        default_company.id,
        cashier_user.role,
    )


def test_bootstrap_includes_active_customer_with_balance(
    client, db_session, default_company, cashier_user
):
    customer = Customer(
        company_id=default_company.id,
        name="Должник",
        phone="+99290200001",
        client_customer_id="cc-boot-1",
    )
    db_session.add(customer)
    db_session.flush()
    # A raw credit_sale ledger entry gives a derived balance of 30.00.
    db_session.add(
        CustomerLedgerEntry(
            company_id=default_company.id,
            customer_id=customer.id,
            sale_id=None,
            entry_type="credit_sale",
            amount=Decimal("30.00"),
            created_by_user_id=cashier_user.id,
        )
    )
    db_session.flush()

    resp = client.get(
        "/api/sync/bootstrap", headers=_headers(cashier_user, default_company)
    )
    assert resp.status_code == 200
    customers = resp.json()["customers"]
    match = [c for c in customers if c["client_customer_id"] == "cc-boot-1"]
    assert len(match) == 1
    assert match[0]["balance"] == "30.00"
    assert match[0]["name"] == "Должник"
    assert match[0]["is_active"] is True


def test_bootstrap_excludes_inactive_customers(
    client, db_session, default_company, cashier_user
):
    inactive = Customer(
        company_id=default_company.id,
        name="Ушёл",
        phone="+99290200002",
        is_active=False,
    )
    db_session.add(inactive)
    db_session.flush()

    resp = client.get(
        "/api/sync/bootstrap", headers=_headers(cashier_user, default_company)
    )
    names = [c["name"] for c in resp.json()["customers"]]
    assert "Ушёл" not in names
```

Run:

```
.venv\Scripts\python.exe -m pytest tests/integration/test_sync_bootstrap_customers.py -q
```

**Expected: FAIL** — `KeyError: 'customers'` (the bootstrap response has no `customers` key yet).

### Step 3.2 — Add the field to the bootstrap schema (minimal impl, part 1)

Edit `sellary-backend/schemas/sync.py`, in `class SyncBootstrapResponse`, add the `customers` field after `categories`:

```python
class SyncBootstrapResponse(BaseModel):
    company_id: int
    company_name: str
    user_id: int
    user_username: str
    user_role: str
    server_time: datetime
    products: list[SyncProductItem]
    categories: list[Category]
    customers: list[SyncCustomerItem] = []
```

### Step 3.3 — Ship customers from `SyncService.bootstrap` (minimal impl, part 2)

Edit `sellary-backend/services/sync_service.py`. Add imports near the top (with the other model/schema imports):

```python
from models.customer import Customer
from services.customer_ledger_service import CustomerLedgerService
```

and add `SyncCustomerItem` to the `from schemas.sync import (...)` list.

In `bootstrap`, after building `categories` and before the `return SyncBootstrapResponse(...)`, add:

```python
        active_customers = (
            self.db.query(Customer)
            .filter(
                Customer.company_id == company.id,
                Customer.is_active == True,  # noqa: E712
            )
            .all()
        )
        ledger = CustomerLedgerService(self.db, company.id)
```

Then add the `customers=[...]` argument to the `SyncBootstrapResponse(...)` call (after `categories=[...]`):

```python
            customers=[
                SyncCustomerItem(
                    id=c.id,
                    client_customer_id=c.client_customer_id,
                    name=c.name,
                    phone=c.phone,
                    email=c.email,
                    address=c.address,
                    description=c.description,
                    balance=ledger.get_customer_balance(c.id),
                    is_active=c.is_active,
                )
                for c in active_customers
            ],
```

Run:

```
.venv\Scripts\python.exe -m pytest tests/integration/test_sync_bootstrap_customers.py -q
```

**Expected: PASS** — active customer present with `balance == "30.00"`; inactive excluded.

### Step 3.4 — Regression + compile gate + commit

Run (confirm existing bootstrap/sync tests still green):

```
.venv\Scripts\python.exe -m pytest tests/integration/test_sync_endpoints.py -q
.venv\Scripts\python.exe -m compileall api core models repositories schemas services main.py
```

**Expected: PASS** (existing sync tests unaffected; compileall exit 0).

Commit:

```
git add sellary-backend/schemas/sync.py sellary-backend/services/sync_service.py sellary-backend/tests/integration/test_sync_bootstrap_customers.py
git commit -m "feat(sync): ship active customers + derived balances in bootstrap (C3)"
```

---

## Task 4: C4 — credit routing in `POST /api/sync/sales`

**Files:**
- `sellary-backend/schemas/sync.py` (modify — add credit fields to `SyncSaleCreate`)
- `sellary-backend/services/sync_service.py` (modify — validate + route credit)
- `sellary-backend/tests/integration/test_sync_credit_sales.py` (create)

### Step 4.1 — Write failing tests (credit routing + regression)

Create `sellary-backend/tests/integration/test_sync_credit_sales.py`:

```python
"""C4: credit routing in /api/sync/sales; cash/card/mobile regression."""
from datetime import datetime, timezone

from models.sale import PaymentMethod, Sale
from tests.conftest import create_auth_headers


def _headers(cashier_user, default_company):
    return create_auth_headers(
        cashier_user.username,
        cashier_user.id,
        default_company.id,
        cashier_user.role,
    )


def _push_customer(client, headers, client_customer_id, phone):
    body = {
        "customers": [
            {
                "client_customer_id": client_customer_id,
                "name": "Кредитник",
                "phone": phone,
            }
        ]
    }
    return client.post("/api/sync/customers", json=body, headers=headers).json()[
        "results"
    ][0]["server_id"]


def _sale_item(product_id):
    return {"product_id": product_id, "quantity": "2.000", "sell_price": "15.00"}


def _base_sale(client_sale_id, idempotency_key, product_id, **overrides):
    payload = {
        "client_sale_id": client_sale_id,
        "idempotency_key": idempotency_key,
        "created_at_client": datetime.now(timezone.utc).isoformat(),
        "payment_method": "cash",
        "discount_amount": "0.00",
        "paid_amount": "30.00",
        "change_amount": "0.00",
        "items": [_sale_item(product_id)],
    }
    payload.update(overrides)
    return {"sales": [payload]}


class TestCreditSaleSync:
    def test_credit_sale_routes_to_ledger(
        self, client, db_session, default_company, cashier_user, test_product
    ):
        headers = _headers(cashier_user, default_company)
        server_id = _push_customer(client, headers, "cc-cr-1", "+99290300001")

        resp = client.post(
            "/api/sync/sales",
            json=_base_sale(
                "csid-cr-1",
                "ik-cr-1",
                test_product.id,
                payment_method="credit",
                client_customer_id="cc-cr-1",
                paid_amount="0.00",
            ),
            headers=headers,
        )
        result = resp.json()["results"][0]
        assert result["status"] == "synced"

        sale = db_session.get(Sale, result["sale_id"])
        assert sale.payment_method == PaymentMethod.CREDIT
        assert sale.customer_id == server_id
        assert sale.payment_status == "unpaid"

        ledger = client.get(
            f"/api/customers/{server_id}/ledger", headers=headers
        ).json()
        assert ledger["balance"] == "30.00"
        assert ledger["entries"][0]["entry_type"] == "credit_sale"

    def test_credit_sale_with_initial_payment_is_partial(
        self, client, db_session, default_company, cashier_user, test_product
    ):
        headers = _headers(cashier_user, default_company)
        server_id = _push_customer(client, headers, "cc-cr-2", "+99290300002")

        resp = client.post(
            "/api/sync/sales",
            json=_base_sale(
                "csid-cr-2",
                "ik-cr-2",
                test_product.id,
                payment_method="credit",
                client_customer_id="cc-cr-2",
                paid_amount="10.00",
                initial_payment_method="cash",
            ),
            headers=headers,
        )
        result = resp.json()["results"][0]
        assert result["status"] == "synced"
        sale = db_session.get(Sale, result["sale_id"])
        assert sale.payment_status == "partial"

        ledger = client.get(
            f"/api/customers/{server_id}/ledger", headers=headers
        ).json()
        assert ledger["balance"] == "20.00"

    def test_credit_sale_without_client_customer_id_fails(
        self, client, default_company, cashier_user, test_product
    ):
        headers = _headers(cashier_user, default_company)
        resp = client.post(
            "/api/sync/sales",
            json=_base_sale(
                "csid-cr-3",
                "ik-cr-3",
                test_product.id,
                payment_method="credit",
                paid_amount="0.00",
            ),
            headers=headers,
        )
        result = resp.json()["results"][0]
        assert result["status"] == "failed"
        assert "client_customer_id" in result["error"]

    def test_credit_sale_unknown_customer_fails(
        self, client, default_company, cashier_user, test_product
    ):
        headers = _headers(cashier_user, default_company)
        resp = client.post(
            "/api/sync/sales",
            json=_base_sale(
                "csid-cr-4",
                "ik-cr-4",
                test_product.id,
                payment_method="credit",
                client_customer_id="cc-does-not-exist",
                paid_amount="0.00",
            ),
            headers=headers,
        )
        result = resp.json()["results"][0]
        assert result["status"] == "failed"
        assert "not synced" in result["error"]


class TestNonCreditRegression:
    def test_cash_sale_unchanged(
        self, client, db_session, default_company, cashier_user, test_product
    ):
        headers = _headers(cashier_user, default_company)
        resp = client.post(
            "/api/sync/sales",
            json=_base_sale("csid-cash-1", "ik-cash-1", test_product.id),
            headers=headers,
        )
        result = resp.json()["results"][0]
        assert result["status"] == "synced"
        sale = db_session.get(Sale, result["sale_id"])
        assert sale.payment_method == PaymentMethod.CASH
        assert sale.customer_id is None
        assert sale.payment_status == "paid"

    def test_card_sale_unchanged(
        self, client, db_session, default_company, cashier_user, test_product
    ):
        headers = _headers(cashier_user, default_company)
        resp = client.post(
            "/api/sync/sales",
            json=_base_sale(
                "csid-card-1",
                "ik-card-1",
                test_product.id,
                payment_method="card",
                card_type="alif",
            ),
            headers=headers,
        )
        result = resp.json()["results"][0]
        assert result["status"] == "synced"
        sale = db_session.get(Sale, result["sale_id"])
        assert sale.payment_method == PaymentMethod.CARD
        assert sale.customer_id is None

    def test_mobile_sale_unchanged(
        self, client, db_session, default_company, cashier_user, test_product
    ):
        headers = _headers(cashier_user, default_company)
        resp = client.post(
            "/api/sync/sales",
            json=_base_sale(
                "csid-mob-1", "ik-mob-1", test_product.id, payment_method="mobile"
            ),
            headers=headers,
        )
        result = resp.json()["results"][0]
        assert result["status"] == "synced"
        sale = db_session.get(Sale, result["sale_id"])
        assert sale.payment_method == PaymentMethod.MOBILE
        assert sale.customer_id is None
```

Run:

```
.venv\Scripts\python.exe -m pytest tests/integration/test_sync_credit_sales.py -q
```

**Expected: FAIL** — the credit tests fail because `_validate_sale` returns `"Invalid payment_method: credit"`, so `result["status"] == "failed"` and the ledger assertions (or the "not synced"/"client_customer_id" error-string checks) do not match. (The regression tests pass, proving the fixtures/harness are sound.)

### Step 4.2 — Add credit fields to `SyncSaleCreate` (minimal impl, part 1)

Edit `sellary-backend/schemas/sync.py`, in `class SyncSaleCreate`, add two optional fields (after `notes`):

```python
class SyncSaleCreate(BaseModel):
    client_sale_id: str
    idempotency_key: str
    created_at_client: datetime
    payment_method: str
    card_type: Optional[str] = None
    discount_amount: Decimal = Decimal("0")
    paid_amount: Decimal
    change_amount: Decimal = Decimal("0")
    notes: Optional[str] = None
    client_customer_id: Optional[str] = None
    initial_payment_method: Optional[str] = None
    items: list[SyncSaleItemCreate]
```

### Step 4.3 — Route credit in `SyncService` (minimal impl, part 2)

Edit `sellary-backend/services/sync_service.py`.

Add imports (with the other model/service imports — `Customer` and `CustomerLedgerService` were already added in Task 3, so only ensure both are present):

```python
from models.customer import Customer
from services.customer_ledger_service import CustomerLedgerService
```

Replace `_validate_sale` with:

```python
    def _validate_sale(self, sale_create: SyncSaleCreate) -> str | None:
        if not sale_create.items:
            return "Sale must have at least one item"

        payment_method_lower = sale_create.payment_method.lower()
        if payment_method_lower not in ("cash", "card", "mobile", "credit"):
            return f"Invalid payment_method: {sale_create.payment_method}"

        if payment_method_lower == "credit":
            if not sale_create.client_customer_id:
                return "client_customer_id is required when payment_method is credit"
            if sale_create.initial_payment_method:
                ipm = sale_create.initial_payment_method.lower()
                if ipm not in ("cash", "card", "mobile"):
                    return f"Invalid initial_payment_method: {sale_create.initial_payment_method}"

        if payment_method_lower == "card" and not sale_create.card_type:
            return "card_type is required when payment_method is card"

        card_type_lower = sale_create.card_type.lower() if sale_create.card_type else None
        if payment_method_lower != "card" and card_type_lower:
            return "card_type must not be set when payment_method is not card"

        if card_type_lower and card_type_lower not in ("alif", "eskhata", "dc"):
            return f"Invalid card_type: {sale_create.card_type}"

        return None
```

In `_create_sale`, update the payment-method map to include credit and resolve the customer. Replace the block that currently reads:

```python
        pm_map = {
            "cash": PaymentMethod.CASH,
            "card": PaymentMethod.CARD,
            "mobile": PaymentMethod.MOBILE,
        }
        payment_method = pm_map[sale_create.payment_method.lower()]
```

with:

```python
        pm_map = {
            "cash": PaymentMethod.CASH,
            "card": PaymentMethod.CARD,
            "mobile": PaymentMethod.MOBILE,
            "credit": PaymentMethod.CREDIT,
        }
        payment_method = pm_map[sale_create.payment_method.lower()]

        customer_id = None
        if payment_method == PaymentMethod.CREDIT:
            customer = (
                self.db.query(Customer)
                .filter(
                    Customer.company_id == company.id,
                    Customer.client_customer_id == sale_create.client_customer_id,
                    Customer.is_active == True,  # noqa: E712
                )
                .first()
            )
            if not customer:
                return SyncSaleResult(
                    client_sale_id=sale_create.client_sale_id,
                    status="failed",
                    error=f"Customer not synced: {sale_create.client_customer_id}",
                )
            customer_id = customer.id
```

In the `Sale(...)` constructor, change `customer_id=None,` to `customer_id=customer_id,`.

Inside the `with self.db.begin_nested():` block, **after** the `for item in items:` inventory loop (still inside the `with`), add the credit-ledger call:

```python
                if payment_method == PaymentMethod.CREDIT:
                    initial_method = (
                        pm_map[sale_create.initial_payment_method.lower()]
                        if sale_create.initial_payment_method
                        else None
                    )
                    CustomerLedgerService(self.db, company.id).record_credit_sale(
                        created_sale,
                        user.id,
                        initial_payment_amount=sale_create.paid_amount,
                        initial_payment_method=initial_method,
                    )
```

> Placement rationale: `record_credit_sale` runs inside the same savepoint as the sale + FIFO consumption. If it raises `ValueError` (e.g. initial payment exceeds total), the existing `except ValueError` below returns a `failed` result and the savepoint rolls back the sale, inventory, and ledger together — no partial state, no orphan `client_sale_id`. The non-credit path never enters this branch, so cash/card/mobile behaviour is unchanged.

Run:

```
.venv\Scripts\python.exe -m pytest tests/integration/test_sync_credit_sales.py -q
```

**Expected: PASS** — credit routes to the ledger (unpaid/partial), missing/absent customer fails cleanly, and cash/card/mobile are unchanged.

### Step 4.4 — Full sync regression + compile gate + commit

Run (prove no regression across all sync + credit-endpoint suites):

```
.venv\Scripts\python.exe -m pytest tests/integration/test_sync_endpoints.py tests/integration/test_sync_client_sale_id.py tests/integration/test_sync_oversell.py tests/unit/test_sync_service.py tests/integration/test_customer_credit_endpoints.py -q
.venv\Scripts\python.exe -m compileall api core models repositories schemas services main.py
```

**Expected: PASS** (all existing sync/credit tests green; compileall exit 0).

Commit:

```
git add sellary-backend/schemas/sync.py sellary-backend/services/sync_service.py sellary-backend/tests/integration/test_sync_credit_sales.py
git commit -m "feat(sync): route credit sales to the ledger in /api/sync/sales (C4)"
```

---

## Task 5: C5 — `POST /api/sync/payments` cap-to-balance + warning + idempotency

The schemas (`SyncPaymentCreate`, `SyncPaymentResult`, etc.), the `CustomerSyncService.sync_payments`/`_process_payment` logic, and the router were all delivered in Task 2. This task adds the behavioural tests that lock in cap-to-balance, warnings, idempotency, and no-debt handling.

**Files:**
- `sellary-backend/tests/integration/test_sync_payments.py` (create)

### Step 5.1 — Write the tests

Create `sellary-backend/tests/integration/test_sync_payments.py`:

```python
"""C5: /api/sync/payments — cap-to-balance, overpayment warning, idempotency."""
from datetime import datetime, timezone

from tests.conftest import create_auth_headers


def _headers(cashier_user, default_company):
    return create_auth_headers(
        cashier_user.username,
        cashier_user.id,
        default_company.id,
        cashier_user.role,
    )


def _push_customer(client, headers, client_customer_id, phone):
    body = {
        "customers": [
            {
                "client_customer_id": client_customer_id,
                "name": "Платёжник",
                "phone": phone,
            }
        ]
    }
    return client.post("/api/sync/customers", json=body, headers=headers).json()[
        "results"
    ][0]["server_id"]


def _make_debt(client, headers, client_customer_id, client_sale_id, idem, product_id):
    """Create a 30.00 open credit sale so the customer has a reducible balance."""
    payload = {
        "sales": [
            {
                "client_sale_id": client_sale_id,
                "idempotency_key": idem,
                "created_at_client": datetime.now(timezone.utc).isoformat(),
                "payment_method": "credit",
                "client_customer_id": client_customer_id,
                "discount_amount": "0.00",
                "paid_amount": "0.00",
                "change_amount": "0.00",
                "items": [
                    {"product_id": product_id, "quantity": "2.000", "sell_price": "15.00"}
                ],
            }
        ]
    }
    client.post("/api/sync/sales", json=payload, headers=headers)


def _payment(client_payment_id, idempotency_key, client_customer_id, amount):
    return {
        "payments": [
            {
                "client_payment_id": client_payment_id,
                "idempotency_key": idempotency_key,
                "client_customer_id": client_customer_id,
                "amount": amount,
                "payment_method": "cash",
            }
        ]
    }


class TestSyncPayments:
    def test_partial_payment_applied_no_warning(
        self, client, default_company, cashier_user, test_product
    ):
        headers = _headers(cashier_user, default_company)
        server_id = _push_customer(client, headers, "cc-pay-1", "+99290400001")
        _make_debt(client, headers, "cc-pay-1", "csid-pay-1", "ik-debt-1", test_product.id)

        resp = client.post(
            "/api/sync/payments",
            json=_payment("cp-1", "ik-pay-1234567890", "cc-pay-1", "20.00"),
            headers=headers,
        )
        result = resp.json()["results"][0]
        assert result["status"] == "synced"
        assert result["applied_amount"] == "20.00"
        assert result["warnings"] is None

        balance = client.get(
            f"/api/customers/{server_id}", headers=headers
        ).json()["balance"]
        assert balance == "10.00"

    def test_overpayment_capped_with_warning(
        self, client, default_company, cashier_user, test_product
    ):
        headers = _headers(cashier_user, default_company)
        server_id = _push_customer(client, headers, "cc-pay-2", "+99290400002")
        _make_debt(client, headers, "cc-pay-2", "csid-pay-2", "ik-debt-2", test_product.id)

        resp = client.post(
            "/api/sync/payments",
            json=_payment("cp-2", "ik-pay-2234567890", "cc-pay-2", "50.00"),
            headers=headers,
        )
        result = resp.json()["results"][0]
        assert result["status"] == "synced"
        assert result["applied_amount"] == "30.00"
        assert result["warnings"][0]["type"] == "overpayment"
        assert result["warnings"][0]["requested"] == "50.00"
        assert result["warnings"][0]["applied"] == "30.00"

        balance = client.get(
            f"/api/customers/{server_id}", headers=headers
        ).json()["balance"]
        assert balance == "0.00"

    def test_payment_is_idempotent(
        self, client, default_company, cashier_user, test_product
    ):
        headers = _headers(cashier_user, default_company)
        server_id = _push_customer(client, headers, "cc-pay-3", "+99290400003")
        _make_debt(client, headers, "cc-pay-3", "csid-pay-3", "ik-debt-3", test_product.id)

        body = _payment("cp-3", "ik-pay-3234567890", "cc-pay-3", "20.00")
        first = client.post("/api/sync/payments", json=body, headers=headers).json()
        second = client.post("/api/sync/payments", json=body, headers=headers).json()
        assert first["results"][0]["status"] == "synced"
        assert second["results"][0]["status"] == "duplicate"
        assert second["results"][0]["applied_amount"] == "20.00"

        # Balance reduced exactly once: 30 - 20 = 10 (not 30 - 40).
        balance = client.get(
            f"/api/customers/{server_id}", headers=headers
        ).json()["balance"]
        assert balance == "10.00"

    def test_payment_on_zero_debt_skipped_with_warning(
        self, client, default_company, cashier_user
    ):
        headers = _headers(cashier_user, default_company)
        _push_customer(client, headers, "cc-pay-4", "+99290400004")  # no debt

        resp = client.post(
            "/api/sync/payments",
            json=_payment("cp-4", "ik-pay-4234567890", "cc-pay-4", "10.00"),
            headers=headers,
        )
        result = resp.json()["results"][0]
        assert result["status"] == "synced"
        assert result["applied_amount"] == "0.00"
        assert result["warnings"][0]["type"] == "overpayment"

    def test_payment_unknown_customer_fails(
        self, client, default_company, cashier_user
    ):
        headers = _headers(cashier_user, default_company)
        resp = client.post(
            "/api/sync/payments",
            json=_payment("cp-5", "ik-pay-5234567890", "cc-missing", "10.00"),
            headers=headers,
        )
        result = resp.json()["results"][0]
        assert result["status"] == "failed"
        assert "not synced" in result["error"]
```

Run:

```
.venv\Scripts\python.exe -m pytest tests/integration/test_sync_payments.py -q
```

**Expected: PASS** — the endpoint (built in Task 2) applies partial payments, caps overpayment with a warning, is idempotent (balance reduced once), skips zero-debt with a warning, and fails unknown customers. If any assertion fails, debug `CustomerSyncService._process_payment` / `_store_and_result` per superpowers:systematic-debugging before changing tests.

### Step 5.2 — Compile gate + full regression + commit

Run:

```
.venv\Scripts\python.exe -m compileall api core models repositories schemas services main.py
.venv\Scripts\python.exe -m pytest tests/integration/test_sync_customers.py tests/integration/test_sync_bootstrap_customers.py tests/integration/test_sync_credit_sales.py tests/integration/test_sync_payments.py tests/unit/test_migration_chain.py -q
```

**Expected: PASS** (compileall exit 0; all five offline-credit backend test files green).

Commit:

```
git add sellary-backend/tests/integration/test_sync_payments.py
git commit -m "test(sync): cover /api/sync/payments cap-to-balance + idempotency (C5)"
```

---

## Done-when

- `alembic/versions/20260711_0000-d4e5f6a7b8c9_add_customer_client_customer_id.py` exists; `tests/unit/test_migration_chain.py` asserts it chains off `c3d4e5f6a7b8` and is one of exactly two heads.
- `railway.toml` (root) and `sellary-backend/railway.json` both pin `alembic upgrade d4e5f6a7b8c9`.
- `POST /api/sync/customers`, `POST /api/sync/payments` registered; `GET /api/sync/bootstrap` returns `customers` with derived balances.
- `POST /api/sync/sales` accepts `payment_method="credit"` (with `client_customer_id`) and routes to `record_credit_sale`; cash/card/mobile + online `POST /api/sales` byte-for-byte unchanged (regression tests green).
- `.venv\Scripts\python.exe -m compileall api core models repositories schemas services main.py` exits 0 (CI gate).
- Manual Postgres gate (not CI): `alembic upgrade d4e5f6a7b8c9` then `alembic downgrade c3d4e5f6a7b8` round-trips cleanly.
