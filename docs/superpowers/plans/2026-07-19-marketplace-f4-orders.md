# Marketplace F4 — Order Domain + Checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Follow TDD: write the failing test, run it, make it pass, commit.

**Goal:** Add the order lifecycle to the Sellary Telegram marketplace. Shoppers place orders through the public `/api/shop` API (initData identity) — a multi-shop cart splits by `company_id` into N orders sharing a `checkout_group_id`, snapshotting price/name, **without touching stock**. Merchants manage those orders through the company-scoped `/api/*` API: confirm (Order → Sale via the existing FIFO ledger, decrementing stock), advance status, and cancel (restoring stock through the existing reversal flow when a Sale already exists). An `Order` is a *request*; a `Sale` is the *committed transaction*. Stock is committed only at confirm.

**Architecture:** Extend the single FastAPI backend. New `orders` / `order_items` tables (tenant-owned by `company_id`) with an order lifecycle enum. A shopper-facing order service reachable from `/api/shop/orders` (reusing the F2 `get_telegram_shopper` initData dependency + the F2 published/enabled catalog gating to validate cart lines), and a merchant-facing order service reachable from `/api/orders` (reusing the existing company-token `get_auth_context`). Confirm delegates to the existing `SaleService.create` (FIFO ledger, oversell-safe) and cancel-after-confirm delegates to the existing `TransactionReversalService.void_sale` — this plan does **not** reinvent stock machinery. A per-shop `Customer` is get-or-created by `telegram_id` (the F2 `customers.telegram_id` partial-unique column) and attached to the order. Layering stays strict: `api → services → repositories → models`; Pydantic models in `schemas/`.

**Tech Stack:** Python 3 / FastAPI / SQLAlchemy / Alembic / Pydantic v2 / pytest. `uuid` (stdlib) for `checkout_group_id`. No new third-party dependency.

## Global Constraints

Binding rules — copied verbatim; do not deviate:

- Backend runs on port **8001** (not 8000); all commands run from `sellary-backend/` with the venv active (`.venv\Scripts\python.exe`, `.venv\Scripts\pytest.exe`).
- Test isolation is **transaction-rollback**: in tests use `db_session.flush()` (not `session.commit()`) for staging; API-path tests share the request-scoped `db_session` via the `client` fixture. Never rely on real persistence across a test.
- **Every new Alembic migration MUST chain off the current live head `d0e1f2a3b4c5` and bump `railway.toml`'s `preDeployCommand = "alembic upgrade <rev>"` to the new revision.** The guard test `tests/unit/test_migration_chain.py` enforces **exactly two heads** (the live head + the dead `20260319_0001`) and that the Railway pin equals the live head. The dead head `20260319_0001` must remain untouched (no `alembic merge`).
- Layering is strict: `api/ (routers) → services/ (business logic) → repositories/ (DB queries) → models/ (SQLAlchemy)`. Pydantic request/response models live in `schemas/`.
- **`Idempotency-Key` header is REQUIRED** (16–64 chars) on `POST /api/shop/orders` and `POST /api/orders/{id}/confirm`, using the existing `core/idempotency.py` (`require_idempotency_key` + `IdempotencyService`). Server replays the original response on retry.
- **An `Order` is separate from a `Sale`. Stock is committed only at confirm** — order placement never touches the ledger. Confirm creates a `Sale` through `SaleService.create` (the FIFO ledger raises `Insufficient stock` on oversell; the order then stays `pending`).
- **Online catalog gating is reused from F2**: a cart line is valid only if its product `is_published` AND `is_active` AND its shop `is_marketplace_enabled` AND `is_active` (the `ShopRepository._base_product_query` gate). Shoppers cannot order hidden/unpublished products.
- CI gate is `python -m compileall api core models repositories schemas services main.py` (must pass with no DB).
- Every new model MUST be registered in `models/__init__.py` (both the import and `__all__`) because `alembic/env.py` does `from models import *` and the test suite builds the schema from `Base.metadata`.

## Resolved design decisions (were open; recommended choice taken)

These were genuine ambiguities in the design spec. They are resolved here so the implementation is unambiguous.

1. **`cashier_id` source for the confirm→Sale.** `Sale.cashier_id` is `NOT NULL` (FK to `users.id`). The merchant API is company-scoped, so on `POST /api/orders/{id}/confirm` the caller `auth.user` is a real member of the confirming company. **DECISION: use `auth.user.id` (the confirming manager/admin) as the Sale's `cashier_id`.** Rationale: the person who confirms the online order *is* the accountable operator — this matches the semantics of `cashier_id` (who rang the transaction) and keeps the Sale attributable in reports without needing a synthetic system user. No new "system user" is introduced. The service therefore takes `confirmed_by_user_id` and passes it straight through to `SaleService.create(..., cashier_id=confirmed_by_user_id)`.

2. **Cash-shift requirement for the confirm→Sale.** The open-shift gate is enforced **only in the `POST /api/sales` router** (`api/sales.py` checks `CashShiftService.has_open_shift()` before calling the service). `SaleService.create` itself does **not** check shifts, and the offline sync path (`services/sync_service.py`) deliberately bypasses the gate. **DECISION: online-order confirm does NOT require an open cash shift.** It calls `SaleService.create` directly (service layer), exactly like the sync path, so a merchant can confirm an online order at any time without opening a till. The plan calls this out in a code comment on the confirm service. (Note for tests: `tests/integration/conftest.py` auto-opens a shift, but confirm does not depend on it — a dedicated `@pytest.mark.no_auto_shift` test proves confirm works with no shift.)

3. **Order status transition validation.** A new `ORDER_TRANSITIONS` map is added to `core/state_machine.py` (mirroring `SALE_TRANSITIONS`), with `validate_order_transition`. `pending → confirmed` is handled by the confirm endpoint (not the generic status endpoint). The generic status endpoint advances `confirmed → preparing → ready → {delivering (delivery only) → completed | completed (pickup)}`. `cancel` is allowed from any non-terminal state. `completed` and `cancelled` are terminal.

4. **Order price/total semantics.** MVP is cash-on-delivery/pickup with online price = `sell_price` (design decisions 6, 10), no tax/discount modelled on the order. `order_item.line_total = unit_price * quantity`; `order.subtotal = order.total_amount = sum(line_total)`. When the Sale is created at confirm, each line becomes a `SaleItemCreate(product_id, quantity, unit_price=snapshot_unit_price, tax_percent=0, discount_amount=0)` and `payment_method=CASH`. The Sale's own totals are recomputed by `SaleService` from those lines; the order keeps its own snapshot totals unchanged.

## Confirmed ground truth (verified against the repo)

- **Current live migration head: `d0e1f2a3b4c5`** (`20260719_1300-d0e1f2a3b4c5_add_telegram_users_and_customer_telegram_id.py`, `down_revision = "c9d0e1f2a3b4"`). `railway.toml` currently pins `alembic upgrade d0e1f2a3b4c5`. This plan chains the new migration off `d0e1f2a3b4c5` and re-pins Railway to the new revision `e1f2a3b4c5d6`.
- F2 shipped: `TelegramUser` model + `telegram_users` table; `customers.telegram_id` (BigInteger, nullable) with `ix_customers_telegram_id` + partial-unique `uq_customers_company_telegram_id`; `get_telegram_shopper` dependency (`api/shop_dependencies.py`); `ShopService`/`ShopRepository` with published+enabled gating; `TelegramUserRepository.get_or_create`. F4 consumes all of these.
- `SaleService(db, company_id).create(sale_create: SaleCreate, cashier_id: int) -> SaleResponse` runs the FIFO ledger; `consume_fifo` raises `ValueError("Insufficient stock for product '<name>'")` when a line cannot be filled (online confirm must NOT pass `allow_oversell`). The router catches `ValueError` → HTTP 400.
- `TransactionReversalService(db, company_id).void_sale(sale_id: int, reason: str, user_id: int) -> VoidResult` releases the sale's ledger allocations (restores outstanding stock) and flips the Sale to `CANCELLED`. This is the existing cancel/reversal flow F4 reuses for cancel-after-confirm.
- `Sale.cashier_id` is `NOT NULL` FK to `users.id`; `Sale.customer_id` is nullable FK to `customers.id`.
- Idempotency: `require_idempotency_key(request) -> str` (400 if missing / wrong length); `IdempotencyService(db).get_cached_response(...)` / `.store_response(...)` are keyed by `(key, company_id, user_id, endpoint)`. The shopper path has **no company-scoped user**; see Task 6 for the shopper idempotency scoping decision.
- `resolve_company_id(db, company_id)` (services/tenant.py) resolves tenant scope; merchant order service uses it. The shopper order service is cross-company by nature (a shopper's cart spans shops) — it resolves each line's `company_id` from the gated product.
- Fixtures in `tests/conftest.py`: `client`, `db_session`, `default_company`, `secondary_company`, `test_product`, `test_category`, `admin_user`, `manager_user`, `manager_headers`, `admin_headers`. `tests/integration/conftest.py` auto-opens a cash shift (irrelevant to order placement; and confirm does not require it — see decision 2).
- The F2 initData test signing helper (`_sign` building `HMAC_SHA256("WebAppData", bot_token)` → `hash`) is reused for shopper-path integration tests; copy it locally per test module as F2 did.

---

### Task 1: Migration — `orders` + `order_items` tables

**Files:**
- Create: `sellary-backend/alembic/versions/20260719_1400-e1f2a3b4c5d6_add_orders_and_order_items.py`
- Modify: `railway.toml` (repo root, `preDeployCommand` line)
- Test: reuse `sellary-backend/tests/unit/test_migration_chain.py` (no edit — it must still pass with the new head)

**Interfaces:**
- Produces: table `orders(id, order_number INT, company_id FK, telegram_user_id FK, customer_id FK NULL, status, fulfillment_type, delivery_address NULL, contact_phone NULL, contact_name NULL, subtotal, total_amount, notes NULL, sale_id FK NULL, checkout_group_id, created_at, updated_at)` and `order_items(id, order_id FK, product_id FK, product_name, unit_price, quantity, line_total)`. Unique `(company_id, order_number)`. New live migration head `e1f2a3b4c5d6`.

- [ ] **Step 1: Create the migration**

Create `sellary-backend/alembic/versions/20260719_1400-e1f2a3b4c5d6_add_orders_and_order_items.py`:

```python
"""add orders and order_items tables

F4 (marketplace order domain + checkout). An Order is a shopper request that
does NOT touch stock; a Sale is created only when the merchant confirms. Orders
are tenant-owned by company_id; order_number is sequential per company (unique
per (company_id, order_number)). checkout_group_id groups the N orders that a
single multi-shop cart splits into. order_items snapshot product_name/unit_price
so later price/name changes never alter an existing order. sale_id links to the
Sale created at confirm (nullable until then). Chains off the F2 head
d0e1f2a3b4c5; the dead 20260319_0001 head is intentionally left untouched.

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
Create Date: 2026-07-19 14:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e1f2a3b4c5d6"
down_revision: Union[str, None] = "d0e1f2a3b4c5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Enum values are stored as native strings (values_callable pattern, matching
# the Sale/PO enums). create_constraint=False keeps SQLite tests permissive.
ORDER_STATUSES = (
    "pending",
    "confirmed",
    "preparing",
    "ready",
    "delivering",
    "completed",
    "cancelled",
)
FULFILLMENT_TYPES = ("delivery", "pickup")


def upgrade() -> None:
    order_status = sa.Enum(
        *ORDER_STATUSES, name="orderstatus", native_enum=True, create_constraint=False
    )
    fulfillment_type = sa.Enum(
        *FULFILLMENT_TYPES,
        name="fulfillmenttype",
        native_enum=True,
        create_constraint=False,
    )

    op.create_table(
        "orders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("order_number", sa.Integer(), nullable=False),
        sa.Column(
            "company_id",
            sa.Integer(),
            sa.ForeignKey("companies.id"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "telegram_user_id",
            sa.Integer(),
            sa.ForeignKey("telegram_users.id"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "customer_id",
            sa.Integer(),
            sa.ForeignKey("customers.id"),
            nullable=True,
        ),
        sa.Column("status", order_status, nullable=False, server_default="pending"),
        sa.Column("fulfillment_type", fulfillment_type, nullable=False),
        sa.Column("delivery_address", sa.String(length=500), nullable=True),
        sa.Column("contact_phone", sa.String(length=32), nullable=True),
        sa.Column("contact_name", sa.String(length=150), nullable=True),
        sa.Column("subtotal", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("total_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("notes", sa.String(length=500), nullable=True),
        sa.Column(
            "sale_id", sa.Integer(), sa.ForeignKey("sales.id"), nullable=True
        ),
        sa.Column("checkout_group_id", sa.String(length=36), nullable=True, index=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.UniqueConstraint(
            "company_id", "order_number", name="uq_orders_company_order_number"
        ),
    )

    op.create_table(
        "order_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "order_id",
            sa.Integer(),
            sa.ForeignKey("orders.id"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "product_id",
            sa.Integer(),
            sa.ForeignKey("products.id"),
            nullable=False,
        ),
        sa.Column("product_name", sa.String(length=200), nullable=False),
        sa.Column("unit_price", sa.Numeric(12, 4), nullable=False),
        sa.Column("quantity", sa.Numeric(10, 3), nullable=False),
        sa.Column("line_total", sa.Numeric(12, 2), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("order_items")
    op.drop_table("orders")
    # Native enum types are dropped explicitly on Postgres; harmless no-op on SQLite.
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        sa.Enum(name="orderstatus").drop(bind, checkfirst=True)
        sa.Enum(name="fulfillmenttype").drop(bind, checkfirst=True)
```

- [ ] **Step 2: Bump the Railway migration pin**

In `railway.toml` (repo root), change `preDeployCommand = "alembic upgrade d0e1f2a3b4c5"` to `preDeployCommand = "alembic upgrade e1f2a3b4c5d6"`.

- [ ] **Step 3: Run the migration-chain guard**

Run: `.venv\Scripts\pytest.exe tests/unit/test_migration_chain.py -v`
Expected: PASS — exactly two heads (`e1f2a3b4c5d6` + dead `20260319_0001`); Railway pin equals the live head `e1f2a3b4c5d6`; lineage walks to base without touching the dead head.

- [ ] **Step 4: Commit**

```bash
git add sellary-backend/alembic/versions/20260719_1400-e1f2a3b4c5d6_add_orders_and_order_items.py railway.toml
git commit -m "feat(marketplace): migration for orders + order_items"
```

---

### Task 2: `Order` + `OrderItem` models + enums

**Files:**
- Create: `sellary-backend/models/order.py`
- Modify: `sellary-backend/models/__init__.py` (import + `__all__`)
- Test: `sellary-backend/tests/unit/test_order_model.py`

**Interfaces:**
- Produces:
  - `OrderStatus(str, enum.Enum)`: `PENDING, CONFIRMED, PREPARING, READY, DELIVERING, COMPLETED, CANCELLED`.
  - `FulfillmentType(str, enum.Enum)`: `DELIVERY, PICKUP`.
  - `Order(id, order_number, company_id, telegram_user_id, customer_id, status, fulfillment_type, delivery_address, contact_phone, contact_name, subtotal, total_amount, notes, sale_id, checkout_group_id, created_at, updated_at)` with relationship `items` (cascade all, delete-orphan) and `sale`.
  - `OrderItem(id, order_id, product_id, product_name, unit_price, quantity, line_total)` with `back_populates="items"`.
  - Both registered in `models/__init__.py` so `Base.metadata` builds them in tests and alembic sees them.

- [ ] **Step 1: Write the failing test**

Create `sellary-backend/tests/unit/test_order_model.py`:

```python
"""Order/OrderItem persist and enforce unique (company_id, order_number)."""
from decimal import Decimal

import pytest

from models.order import FulfillmentType, Order, OrderItem, OrderStatus
from models.telegram_user import TelegramUser


def _shopper(db):
    tu = TelegramUser(telegram_id=1001, first_name="Ali")
    db.add(tu)
    db.flush()
    return tu


def test_order_defaults(db_session, default_company):
    tu = _shopper(db_session)
    order = Order(
        company_id=default_company.id,
        order_number=1,
        telegram_user_id=tu.id,
        fulfillment_type=FulfillmentType.PICKUP,
        subtotal=Decimal("30.00"),
        total_amount=Decimal("30.00"),
    )
    db_session.add(order)
    db_session.flush()
    assert order.id is not None
    assert order.status == OrderStatus.PENDING  # server_default
    assert order.sale_id is None
    assert order.customer_id is None


def test_order_items_cascade(db_session, default_company, test_product):
    tu = _shopper(db_session)
    order = Order(
        company_id=default_company.id,
        order_number=2,
        telegram_user_id=tu.id,
        fulfillment_type=FulfillmentType.DELIVERY,
        subtotal=Decimal("30.00"),
        total_amount=Decimal("30.00"),
    )
    order.items.append(
        OrderItem(
            product_id=test_product.id,
            product_name="Snapshot Name",
            unit_price=Decimal("15.0000"),
            quantity=Decimal("2"),
            line_total=Decimal("30.00"),
        )
    )
    db_session.add(order)
    db_session.flush()
    assert order.items[0].id is not None
    assert order.items[0].product_name == "Snapshot Name"


def test_unique_order_number_per_company(db_session, default_company):
    tu = _shopper(db_session)
    for _ in range(2):
        db_session.add(
            Order(
                company_id=default_company.id,
                order_number=7,
                telegram_user_id=tu.id,
                fulfillment_type=FulfillmentType.PICKUP,
                subtotal=Decimal("0"),
                total_amount=Decimal("0"),
            )
        )
    with pytest.raises(Exception):
        db_session.flush()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest.exe tests/unit/test_order_model.py -v`
Expected: FAIL — `ModuleNotFoundError: models.order`.

- [ ] **Step 3: Create the model**

Create `sellary-backend/models/order.py`:

```python
import enum
from decimal import Decimal

from sqlalchemy import (
    Column,
    DateTime,
    Enum as SQLEnum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from core.database import Base


class OrderStatus(str, enum.Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    PREPARING = "preparing"
    READY = "ready"
    DELIVERING = "delivering"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class FulfillmentType(str, enum.Enum):
    DELIVERY = "delivery"
    PICKUP = "pickup"


def _enum_values(enum_class: type[enum.Enum]) -> list[str]:
    return [member.value for member in enum_class]


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (
        UniqueConstraint(
            "company_id", "order_number", name="uq_orders_company_order_number"
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    order_number = Column(Integer, nullable=False)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    telegram_user_id = Column(
        Integer, ForeignKey("telegram_users.id"), nullable=False, index=True
    )
    # Linked to the per-shop Customer on placement (get-or-create by telegram_id).
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)
    status = Column(
        SQLEnum(
            OrderStatus,
            values_callable=_enum_values,
            create_constraint=False,
            native_enum=True,
            name="orderstatus",
        ),
        nullable=False,
        default=OrderStatus.PENDING,
        server_default="pending",
    )
    fulfillment_type = Column(
        SQLEnum(
            FulfillmentType,
            values_callable=_enum_values,
            create_constraint=False,
            native_enum=True,
            name="fulfillmenttype",
        ),
        nullable=False,
    )
    delivery_address = Column(String(500), nullable=True)
    contact_phone = Column(String(32), nullable=True)
    contact_name = Column(String(150), nullable=True)
    subtotal = Column(Numeric(12, 2), nullable=False, default=Decimal("0.00"))
    total_amount = Column(Numeric(12, 2), nullable=False, default=Decimal("0.00"))
    notes = Column(String(500), nullable=True)
    # Set at confirm; stock is committed at that point (Order -> Sale).
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=True)
    # Groups the N orders split from one multi-shop cart. UUID string.
    checkout_group_id = Column(String(36), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    items = relationship(
        "OrderItem", back_populates="order", cascade="all, delete-orphan"
    )
    sale = relationship("Sale")


class OrderItem(Base):
    __tablename__ = "order_items"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    # Snapshots taken at placement so later product edits never alter this order.
    product_name = Column(String(200), nullable=False)
    unit_price = Column(Numeric(12, 4), nullable=False)
    quantity = Column(Numeric(10, 3), nullable=False)
    line_total = Column(Numeric(12, 2), nullable=False)

    order = relationship("Order", back_populates="items")
```

- [ ] **Step 4: Register the models**

In `sellary-backend/models/__init__.py`, add after `from .telegram_user import TelegramUser`:

```python
from .order import FulfillmentType, Order, OrderItem, OrderStatus
```

and add `"Order"`, `"OrderItem"`, `"OrderStatus"`, `"FulfillmentType"` to `__all__`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv\Scripts\pytest.exe tests/unit/test_order_model.py -v`
Expected: PASS — defaults (status pending, sale_id/customer_id NULL), item cascade, unique order_number per company.

- [ ] **Step 6: Commit**

```bash
git add sellary-backend/models/order.py sellary-backend/models/__init__.py sellary-backend/tests/unit/test_order_model.py
git commit -m "feat(marketplace): Order + OrderItem models and lifecycle enums"
```

---

### Task 3: Order status state machine

**Files:**
- Modify: `sellary-backend/core/state_machine.py` (add `ORDER_TRANSITIONS`, `validate_order_transition`, helpers)
- Test: `sellary-backend/tests/unit/test_order_state_machine.py`

**Interfaces:**
- Consumes: `OrderStatus` (Task 2).
- Produces:
  - `ORDER_TRANSITIONS: Dict[OrderStatus, Set[OrderStatus]]`.
  - `validate_order_transition(current: OrderStatus, target: OrderStatus, order_id: int) -> None` — raises `StateTransitionError` (existing class) when disallowed.
  - `can_cancel_order(status) -> bool` (True for any non-terminal state).

Transition table:
- `PENDING → {CONFIRMED, CANCELLED}`
- `CONFIRMED → {PREPARING, CANCELLED}`
- `PREPARING → {READY, CANCELLED}`
- `READY → {DELIVERING, COMPLETED, CANCELLED}` (DELIVERING only for delivery orders; COMPLETED for pickup — the service enforces the fulfillment gate)
- `DELIVERING → {COMPLETED, CANCELLED}`
- `COMPLETED → {}` (terminal)
- `CANCELLED → {}` (terminal)

- [ ] **Step 1: Write the failing test**

Create `sellary-backend/tests/unit/test_order_state_machine.py`:

```python
"""Order lifecycle transitions are validated centrally."""
import pytest

from core.state_machine import (
    StateTransitionError,
    can_cancel_order,
    validate_order_transition,
)
from models.order import OrderStatus


@pytest.mark.parametrize(
    "current,target",
    [
        (OrderStatus.PENDING, OrderStatus.CONFIRMED),
        (OrderStatus.CONFIRMED, OrderStatus.PREPARING),
        (OrderStatus.PREPARING, OrderStatus.READY),
        (OrderStatus.READY, OrderStatus.DELIVERING),
        (OrderStatus.READY, OrderStatus.COMPLETED),
        (OrderStatus.DELIVERING, OrderStatus.COMPLETED),
        (OrderStatus.PENDING, OrderStatus.CANCELLED),
        (OrderStatus.READY, OrderStatus.CANCELLED),
    ],
)
def test_allowed_transitions(current, target):
    validate_order_transition(current, target, order_id=1)  # no raise


@pytest.mark.parametrize(
    "current,target",
    [
        (OrderStatus.PENDING, OrderStatus.READY),          # skips confirm/preparing
        (OrderStatus.COMPLETED, OrderStatus.PREPARING),    # terminal
        (OrderStatus.CANCELLED, OrderStatus.CONFIRMED),    # terminal
        (OrderStatus.CONFIRMED, OrderStatus.CONFIRMED),    # no self-loop
    ],
)
def test_disallowed_transitions(current, target):
    with pytest.raises(StateTransitionError):
        validate_order_transition(current, target, order_id=1)


def test_can_cancel_only_non_terminal():
    assert can_cancel_order(OrderStatus.PENDING)
    assert can_cancel_order(OrderStatus.DELIVERING)
    assert not can_cancel_order(OrderStatus.COMPLETED)
    assert not can_cancel_order(OrderStatus.CANCELLED)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest.exe tests/unit/test_order_state_machine.py -v`
Expected: FAIL — `ImportError: cannot import name 'validate_order_transition'`.

- [ ] **Step 3: Implement in `core/state_machine.py`**

Add at the top import: `from models.order import OrderStatus`. Then append:

```python
# =============================================================================
# ORDER STATUS TRANSITIONS (marketplace F4)
# =============================================================================

ORDER_TRANSITIONS: Dict[OrderStatus, Set[OrderStatus]] = {
    OrderStatus.PENDING: {OrderStatus.CONFIRMED, OrderStatus.CANCELLED},
    OrderStatus.CONFIRMED: {OrderStatus.PREPARING, OrderStatus.CANCELLED},
    OrderStatus.PREPARING: {OrderStatus.READY, OrderStatus.CANCELLED},
    # DELIVERING is delivery-only and COMPLETED is the pickup shortcut; the
    # service enforces the fulfillment_type gate on top of this table.
    OrderStatus.READY: {
        OrderStatus.DELIVERING,
        OrderStatus.COMPLETED,
        OrderStatus.CANCELLED,
    },
    OrderStatus.DELIVERING: {OrderStatus.COMPLETED, OrderStatus.CANCELLED},
    OrderStatus.COMPLETED: set(),   # terminal
    OrderStatus.CANCELLED: set(),   # terminal
}


def validate_order_transition(
    current_status: OrderStatus, target_status: OrderStatus, order_id: int
) -> None:
    allowed = ORDER_TRANSITIONS.get(current_status, set())
    if target_status not in allowed:
        raise StateTransitionError(
            entity_type="Order",
            entity_id=order_id,
            current_status=current_status.value,
            target_status=target_status.value,
        )


def can_cancel_order(order_status: OrderStatus) -> bool:
    return OrderStatus.CANCELLED in ORDER_TRANSITIONS.get(order_status, set())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv\Scripts\pytest.exe tests/unit/test_order_state_machine.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sellary-backend/core/state_machine.py sellary-backend/tests/unit/test_order_state_machine.py
git commit -m "feat(marketplace): order status state machine"
```

---

### Task 4: Order schemas (shopper + merchant)

**Files:**
- Create: `sellary-backend/schemas/order.py`
- Test: `sellary-backend/tests/unit/test_order_schemas.py`

**Interfaces:**
- Produces:
  - Shopper request: `OrderCartItem(product_id: int, quantity: Decimal>0)`; `PlaceOrderRequest(items: list[OrderCartItem] (min 1), fulfillment_type: FulfillmentType, delivery_address: str | None, contact_phone: str | None, contact_name: str | None, notes: str | None)` with a `model_validator` requiring `delivery_address` when `fulfillment_type == DELIVERY`.
  - `SharePhoneRequest(phone: str)` for `POST /api/shop/me/phone`.
  - Response: `OrderItemResponse(id, product_id, product_name, unit_price, quantity, line_total)`; `OrderResponse(id, order_number, company_id, company_name, status, fulfillment_type, delivery_address, contact_phone, contact_name, subtotal, total_amount, notes, sale_id, checkout_group_id, created_at, items)`; `PlaceOrderResponse(checkout_group_id: str, orders: list[OrderResponse])`.
  - Merchant status request: `AdvanceStatusRequest(status: OrderStatus)`; `CancelOrderRequest(reason: str | None)`.
  - All response models `from_attributes = True`. Shopper responses omit merchant-only fields (`telegram_user_id`, `customer_id`, cost).

- [ ] **Step 1: Write the failing test**

Create `sellary-backend/tests/unit/test_order_schemas.py`:

```python
"""Order schemas: delivery requires an address; response shape is shopper-safe."""
from decimal import Decimal

import pytest
from pydantic import ValidationError

from models.order import FulfillmentType, OrderStatus
from schemas.order import OrderCartItem, OrderResponse, PlaceOrderRequest


def test_place_order_requires_at_least_one_item():
    with pytest.raises(ValidationError):
        PlaceOrderRequest(items=[], fulfillment_type=FulfillmentType.PICKUP)


def test_delivery_requires_address():
    with pytest.raises(ValidationError, match="delivery_address"):
        PlaceOrderRequest(
            items=[OrderCartItem(product_id=1, quantity=Decimal("1"))],
            fulfillment_type=FulfillmentType.DELIVERY,
            delivery_address=None,
        )


def test_pickup_allows_no_address():
    req = PlaceOrderRequest(
        items=[OrderCartItem(product_id=1, quantity=Decimal("2"))],
        fulfillment_type=FulfillmentType.PICKUP,
    )
    assert req.items[0].quantity == Decimal("2")


def test_order_response_omits_shopper_unsafe_fields():
    resp = OrderResponse(
        id=1,
        order_number=1,
        company_id=5,
        company_name="Shop A",
        status=OrderStatus.PENDING,
        fulfillment_type=FulfillmentType.PICKUP,
        delivery_address=None,
        contact_phone=None,
        contact_name=None,
        subtotal=Decimal("30.00"),
        total_amount=Decimal("30.00"),
        notes=None,
        sale_id=None,
        checkout_group_id="grp",
        created_at=__import__("datetime").datetime.now(),
        items=[],
    )
    dumped = resp.model_dump()
    assert "telegram_user_id" not in dumped
    assert "customer_id" not in dumped
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest.exe tests/unit/test_order_schemas.py -v`
Expected: FAIL — `ModuleNotFoundError: schemas.order`.

- [ ] **Step 3: Write the schemas**

Create `sellary-backend/schemas/order.py`:

```python
"""Order request/response schemas for the marketplace (shopper + merchant).

Shopper responses deliberately omit merchant-internal fields (telegram_user_id,
customer_id) and never expose cost. Money follows MVP rules: online price =
sell_price, cash on delivery/pickup, no tax/discount on the order itself.
"""
from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, Field, model_validator

from models.order import FulfillmentType, OrderStatus


class OrderCartItem(BaseModel):
    product_id: int
    quantity: Decimal = Field(..., gt=0, decimal_places=3)


class PlaceOrderRequest(BaseModel):
    items: List[OrderCartItem] = Field(..., min_length=1)
    fulfillment_type: FulfillmentType
    delivery_address: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_name: Optional[str] = None
    notes: Optional[str] = None

    @model_validator(mode="after")
    def _delivery_needs_address(self):
        if self.fulfillment_type == FulfillmentType.DELIVERY and not (
            self.delivery_address and self.delivery_address.strip()
        ):
            raise ValueError("delivery_address is required for delivery orders")
        return self


class SharePhoneRequest(BaseModel):
    phone: str = Field(..., min_length=3, max_length=32)


class OrderItemResponse(BaseModel):
    id: int
    product_id: int
    product_name: str
    unit_price: Decimal
    quantity: Decimal
    line_total: Decimal

    class Config:
        from_attributes = True


class OrderResponse(BaseModel):
    id: int
    order_number: int
    company_id: int
    company_name: str
    status: OrderStatus
    fulfillment_type: FulfillmentType
    delivery_address: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_name: Optional[str] = None
    subtotal: Decimal
    total_amount: Decimal
    notes: Optional[str] = None
    sale_id: Optional[int] = None
    checkout_group_id: Optional[str] = None
    created_at: datetime
    items: List[OrderItemResponse]

    class Config:
        from_attributes = True


class PlaceOrderResponse(BaseModel):
    checkout_group_id: str
    orders: List[OrderResponse]


class AdvanceStatusRequest(BaseModel):
    status: OrderStatus


class CancelOrderRequest(BaseModel):
    reason: Optional[str] = None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv\Scripts\pytest.exe tests/unit/test_order_schemas.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sellary-backend/schemas/order.py sellary-backend/tests/unit/test_order_schemas.py
git commit -m "feat(marketplace): order request/response schemas"
```

---

### Task 5: Order repository (per-company numbering, tenant-scoped reads, customer link)

**Files:**
- Create: `sellary-backend/repositories/order_repository.py`
- Modify: `sellary-backend/repositories/customer_repository.py` (add `get_by_telegram_id` + `get_or_create_for_telegram`)
- Test: `sellary-backend/tests/integration/test_order_repository.py`

**Interfaces:**
- Consumes: `Order`, `OrderItem`, `Customer`, `OrderStatus`.
- Produces:
  - `OrderRepository(db)`:
    - `next_order_number(company_id: int) -> int` — `max(order_number)+1` per company (starts at 1). Uses a `with_for_update`-locked `MAX` read to serialize concurrent placements in the same company.
    - `create(order: Order) -> Order` — `add` + `flush` (assigns ids; items via cascade).
    - `get_for_company(company_id, order_id) -> Order | None` — tenant-scoped, eager-loads items.
    - `get_for_company_by_status(company_id, status: OrderStatus | None, skip, limit) -> tuple[list[Order], int]`.
    - `get_for_shopper(telegram_user_id, order_id) -> Order | None` — scoped to the shopper.
    - `list_for_shopper(telegram_user_id, skip, limit) -> list[Order]` — newest first.
    - `get_for_company_for_update(company_id, order_id) -> Order | None` — row lock for confirm/status/cancel.
  - `CustomerRepository`:
    - `get_by_telegram_id(company_id, telegram_id) -> Customer | None`
    - `get_or_create_for_telegram(company_id, telegram_id, *, name, phone) -> Customer` — finds by `(company_id, telegram_id)`, else creates a per-shop `Customer` with `telegram_id` set; **uses `flush`, not commit** (transaction-rollback isolation).

- [ ] **Step 1: Write the failing test**

Create `sellary-backend/tests/integration/test_order_repository.py`:

```python
"""Order numbering is per-company; reads are tenant/shopper scoped; customer link."""
from decimal import Decimal

import pytest

from models.order import FulfillmentType, Order, OrderItem, OrderStatus
from models.telegram_user import TelegramUser
from repositories.customer_repository import CustomerRepository
from repositories.order_repository import OrderRepository


def _shopper(db, tid=2001):
    tu = TelegramUser(telegram_id=tid, first_name="Ali")
    db.add(tu)
    db.flush()
    return tu


def _mk_order(db, company, tu, number, status=OrderStatus.PENDING):
    order = Order(
        company_id=company.id,
        order_number=number,
        telegram_user_id=tu.id,
        status=status,
        fulfillment_type=FulfillmentType.PICKUP,
        subtotal=Decimal("10.00"),
        total_amount=Decimal("10.00"),
    )
    order.items.append(
        OrderItem(
            product_id=None if False else 1,  # replaced by real product in richer tests
            product_name="X",
            unit_price=Decimal("10.0000"),
            quantity=Decimal("1"),
            line_total=Decimal("10.00"),
        )
    )
    return order


def test_next_order_number_is_per_company(db_session, default_company, secondary_company):
    repo = OrderRepository(db_session)
    assert repo.next_order_number(default_company.id) == 1
    tu = _shopper(db_session)
    o1 = Order(
        company_id=default_company.id, order_number=1, telegram_user_id=tu.id,
        fulfillment_type=FulfillmentType.PICKUP, subtotal=Decimal("0"), total_amount=Decimal("0"),
    )
    db_session.add(o1)
    db_session.flush()
    assert repo.next_order_number(default_company.id) == 2
    # A different company still starts at 1.
    assert repo.next_order_number(secondary_company.id) == 1


def test_get_for_company_is_tenant_scoped(db_session, default_company, secondary_company):
    repo = OrderRepository(db_session)
    tu = _shopper(db_session)
    o = Order(
        company_id=default_company.id, order_number=1, telegram_user_id=tu.id,
        fulfillment_type=FulfillmentType.PICKUP, subtotal=Decimal("0"), total_amount=Decimal("0"),
    )
    db_session.add(o)
    db_session.flush()
    assert repo.get_for_company(default_company.id, o.id) is not None
    assert repo.get_for_company(secondary_company.id, o.id) is None


def test_list_for_shopper_only_own(db_session, default_company):
    repo = OrderRepository(db_session)
    a = _shopper(db_session, tid=3001)
    b = _shopper(db_session, tid=3002)
    for tu, n in ((a, 1), (b, 2)):
        db_session.add(Order(
            company_id=default_company.id, order_number=n, telegram_user_id=tu.id,
            fulfillment_type=FulfillmentType.PICKUP, subtotal=Decimal("0"), total_amount=Decimal("0"),
        ))
    db_session.flush()
    a_orders = repo.list_for_shopper(a.id, skip=0, limit=50)
    assert {o.telegram_user_id for o in a_orders} == {a.id}


def test_customer_get_or_create_by_telegram_id(db_session, default_company):
    repo = CustomerRepository(db_session)
    c1 = repo.get_or_create_for_telegram(
        default_company.id, 9999, name="Ali", phone="+992900000000"
    )
    db_session.flush()
    c2 = repo.get_or_create_for_telegram(
        default_company.id, 9999, name="Ali", phone="+992900000000"
    )
    assert c1.id == c2.id
    assert c1.telegram_id == 9999
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest.exe tests/integration/test_order_repository.py -v`
Expected: FAIL — `ModuleNotFoundError: repositories.order_repository`.

- [ ] **Step 3: Extend `CustomerRepository`**

In `sellary-backend/repositories/customer_repository.py`, add (import `BigInteger` not needed; `telegram_id` is a mapped column):

```python
    def get_by_telegram_id(self, company_id: int, telegram_id: int) -> Optional[Customer]:
        return (
            self.db.query(Customer)
            .filter(
                Customer.company_id == company_id,
                Customer.telegram_id == telegram_id,
            )
            .first()
        )

    def get_or_create_for_telegram(
        self,
        company_id: int,
        telegram_id: int,
        *,
        name: Optional[str] = None,
        phone: Optional[str] = None,
    ) -> Customer:
        """Per-shop Customer linked to a global Telegram shopper.

        Deduped by the partial-unique (company_id, telegram_id) index. Uses
        flush (not commit) so it composes inside the request transaction and
        respects the test suite's transaction-rollback isolation.
        """
        existing = self.get_by_telegram_id(company_id, telegram_id)
        if existing is not None:
            return existing
        customer = Customer(
            company_id=company_id,
            telegram_id=telegram_id,
            name=name,
            phone=phone,
        )
        self.db.add(customer)
        self.db.flush()
        return customer
```

- [ ] **Step 4: Write the repository**

Create `sellary-backend/repositories/order_repository.py`:

```python
from typing import List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from models.order import Order, OrderStatus


class OrderRepository:
    def __init__(self, db: Session):
        self.db = db

    def next_order_number(self, company_id: int) -> int:
        current_max = (
            self.db.query(func.max(Order.order_number))
            .filter(Order.company_id == company_id)
            .scalar()
        )
        return (current_max or 0) + 1

    def create(self, order: Order) -> Order:
        self.db.add(order)
        self.db.flush()  # assigns order.id + item ids via cascade
        return order

    def get_for_company(self, company_id: int, order_id: int) -> Optional[Order]:
        return (
            self.db.query(Order)
            .options(joinedload(Order.items))
            .filter(Order.company_id == company_id, Order.id == order_id)
            .first()
        )

    def get_for_company_for_update(
        self, company_id: int, order_id: int
    ) -> Optional[Order]:
        return (
            self.db.query(Order)
            .filter(Order.company_id == company_id, Order.id == order_id)
            .with_for_update()
            .first()
        )

    def get_for_company_by_status(
        self,
        company_id: int,
        status: Optional[OrderStatus],
        skip: int = 0,
        limit: int = 50,
    ) -> Tuple[List[Order], int]:
        query = (
            self.db.query(Order)
            .options(joinedload(Order.items))
            .filter(Order.company_id == company_id)
        )
        if status is not None:
            query = query.filter(Order.status == status)
        total = query.count()
        rows = (
            query.order_by(Order.created_at.desc(), Order.id.desc())
            .offset(skip)
            .limit(limit)
            .all()
        )
        return rows, total

    def get_for_shopper(
        self, telegram_user_id: int, order_id: int
    ) -> Optional[Order]:
        return (
            self.db.query(Order)
            .options(joinedload(Order.items))
            .filter(
                Order.telegram_user_id == telegram_user_id, Order.id == order_id
            )
            .first()
        )

    def list_for_shopper(
        self, telegram_user_id: int, skip: int = 0, limit: int = 50
    ) -> List[Order]:
        return (
            self.db.query(Order)
            .options(joinedload(Order.items))
            .filter(Order.telegram_user_id == telegram_user_id)
            .order_by(Order.created_at.desc(), Order.id.desc())
            .offset(skip)
            .limit(limit)
            .all()
        )
```

Note: the model-only `OrderItem(product_id=... )` requires a real product FK; the `_mk_order` helper in Step 1 uses a placeholder id (`1`) only in tests that never flush that item against a FK-checked DB — where a flush is needed, the richer service tests (Task 6/7) build real products. If SQLite FK enforcement flags the placeholder, replace it with a `test_product` fixture id.

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv\Scripts\pytest.exe tests/integration/test_order_repository.py -v`
Expected: PASS — per-company numbering, tenant scoping, shopper scoping, customer get-or-create.

- [ ] **Step 6: Commit**

```bash
git add sellary-backend/repositories/order_repository.py sellary-backend/repositories/customer_repository.py sellary-backend/tests/integration/test_order_repository.py
git commit -m "feat(marketplace): order repository + customer get-or-create by telegram_id"
```

---

### Task 6: Shopper order service — place (multi-shop split, snapshot, no stock), read

**Files:**
- Create: `sellary-backend/services/shopper_order_service.py`
- Test: `sellary-backend/tests/integration/test_shopper_order_service.py`

**Interfaces:**
- Consumes: `ShopRepository` (F2 gate — a line is valid only if `get_published_product(product_id)` returns a row), `OrderRepository`, `CustomerRepository`, `TelegramUser`, `PlaceOrderRequest`, `OrderResponse`.
- Produces `ShopperOrderService(db)`:
  - `place_order(shopper: TelegramUser, request: PlaceOrderRequest) -> PlaceOrderResponse`:
    1. Resolve each cart line's product via `ShopRepository.get_published_product` — raises `ValueError("Product <id> is not available")` if any line is not published/enabled/active (gating reused from F2).
    2. Enforce fulfillment support: each involved shop must support the requested `fulfillment_type` (`company.supports_delivery` / `supports_pickup`); else `ValueError`.
    3. **Split lines by `company_id`** into groups; generate ONE `checkout_group_id = str(uuid4())` shared by all resulting orders.
    4. For each company group: get-or-create the per-shop `Customer` by `shopper.telegram_id` (name = `shopper.first_name`, phone = `request.contact_phone or shopper.phone`); allocate `order_number = OrderRepository.next_order_number(company_id)`; build the `Order` (status `PENDING`, `sale_id=None`) with snapshot `OrderItem`s (`product_name = product.name`, `unit_price = product.sell_price`, `line_total = unit_price*quantity`); set `subtotal = total_amount = sum(line_total)`. **No ledger call — stock is untouched.**
    5. Persist all orders (single flush), return `PlaceOrderResponse(checkout_group_id, orders=[OrderResponse...])`.
  - `list_my_orders(shopper) -> list[OrderResponse]`
  - `get_my_order(shopper, order_id) -> OrderResponse | None`
  - `share_phone(shopper, phone) -> None` — updates `telegram_users.phone` (and back-fills any existing per-shop Customers with NULL phone for that telegram_id — optional; MVP updates only the TelegramUser row).
  - `_to_response(order) -> OrderResponse` — maps, with `company_name` from `order` join (eager-load company or fetch via `order.items[0]`/a company lookup; simplest: `joinedload` company in the repo read, or resolve name from a `Company` fetch by `company_id`).

Note on `company_name`: add `company = relationship("Company")` is heavy; instead the service resolves the shop name from the gated product (already loaded) at build time and, for reads, the repo eager-loads via a lightweight `Company` join. Simplest robust choice: store nothing extra and resolve `company_name` in `_to_response` with `self.db.get(Company, order.company_id).name`.

- [ ] **Step 1: Write the failing test**

Create `sellary-backend/tests/integration/test_shopper_order_service.py`:

```python
"""Shopper places orders: multi-shop split, price snapshot, NO stock movement."""
from decimal import Decimal

import pytest

from models.company import Company
from models.order import FulfillmentType, OrderStatus
from models.product import Product
from models.telegram_user import TelegramUser
from schemas.order import OrderCartItem, PlaceOrderRequest
from services.shopper_order_service import ShopperOrderService


@pytest.fixture
def shopper(db_session):
    tu = TelegramUser(telegram_id=5001, first_name="Ali", username="ali")
    db_session.add(tu)
    db_session.flush()
    return tu


def _publish(db, company, name, price="15.00", stock="100"):
    company.is_marketplace_enabled = True
    company.supports_pickup = True
    company.supports_delivery = True
    db.flush()
    p = Product(
        company_id=company.id, name=name, cost_price=Decimal("4.0000"),
        sell_price=Decimal(price), stock_quantity=Decimal(stock),
        is_active=True, is_published=True,
    )
    db.add(p)
    db.flush()
    return p


def test_single_shop_order_snapshots_price_and_no_stock_change(
    db_session, default_company, shopper
):
    p = _publish(db_session, default_company, "Milk", price="12.00", stock="100")
    before = Decimal(p.stock_quantity)
    resp = ShopperOrderService(db_session).place_order(
        shopper,
        PlaceOrderRequest(
            items=[OrderCartItem(product_id=p.id, quantity=Decimal("3"))],
            fulfillment_type=FulfillmentType.PICKUP,
        ),
    )
    assert len(resp.orders) == 1
    order = resp.orders[0]
    assert order.status == OrderStatus.PENDING
    assert order.sale_id is None
    assert order.items[0].unit_price == Decimal("12.0000")
    assert order.items[0].line_total == Decimal("36.00")
    assert order.total_amount == Decimal("36.00")
    # Snapshot must survive a later price change.
    p.sell_price = Decimal("99.00")
    db_session.flush()
    assert order.items[0].unit_price == Decimal("12.0000")
    # STOCK UNTOUCHED — the ledger was never called.
    db_session.refresh(p)
    assert Decimal(p.stock_quantity) == before


def test_multi_shop_cart_splits_by_company(
    db_session, default_company, secondary_company, shopper
):
    a = _publish(db_session, default_company, "A")
    b = _publish(db_session, secondary_company, "B")
    resp = ShopperOrderService(db_session).place_order(
        shopper,
        PlaceOrderRequest(
            items=[
                OrderCartItem(product_id=a.id, quantity=Decimal("1")),
                OrderCartItem(product_id=b.id, quantity=Decimal("2")),
            ],
            fulfillment_type=FulfillmentType.PICKUP,
        ),
    )
    assert len(resp.orders) == 2
    assert {o.company_id for o in resp.orders} == {default_company.id, secondary_company.id}
    # All split orders share one checkout_group_id.
    assert len({o.checkout_group_id for o in resp.orders}) == 1
    assert resp.checkout_group_id == resp.orders[0].checkout_group_id


def test_unpublished_product_rejected(db_session, default_company, shopper):
    default_company.is_marketplace_enabled = True
    db_session.flush()
    hidden = Product(
        company_id=default_company.id, name="Hidden", cost_price=Decimal("1.0000"),
        sell_price=Decimal("2.0000"), stock_quantity=Decimal("5"),
        is_active=True, is_published=False,
    )
    db_session.add(hidden)
    db_session.flush()
    with pytest.raises(ValueError, match="not available"):
        ShopperOrderService(db_session).place_order(
            shopper,
            PlaceOrderRequest(
                items=[OrderCartItem(product_id=hidden.id, quantity=Decimal("1"))],
                fulfillment_type=FulfillmentType.PICKUP,
            ),
        )


def test_placement_links_per_shop_customer_by_telegram_id(
    db_session, default_company, shopper
):
    from repositories.customer_repository import CustomerRepository

    p = _publish(db_session, default_company, "Milk")
    resp = ShopperOrderService(db_session).place_order(
        shopper,
        PlaceOrderRequest(
            items=[OrderCartItem(product_id=p.id, quantity=Decimal("1"))],
            fulfillment_type=FulfillmentType.PICKUP,
            contact_phone="+992900123456",
        ),
    )
    cust = CustomerRepository(db_session).get_by_telegram_id(
        default_company.id, shopper.telegram_id
    )
    assert cust is not None
    # A second order for the same shopper reuses the same Customer row.
    ShopperOrderService(db_session).place_order(
        shopper,
        PlaceOrderRequest(
            items=[OrderCartItem(product_id=p.id, quantity=Decimal("1"))],
            fulfillment_type=FulfillmentType.PICKUP,
        ),
    )
    all_custs = (
        db_session.query(type(cust))
        .filter_by(company_id=default_company.id, telegram_id=shopper.telegram_id)
        .all()
    )
    assert len(all_custs) == 1


def test_list_my_orders_scoped_to_shopper(db_session, default_company, shopper):
    p = _publish(db_session, default_company, "Milk")
    ShopperOrderService(db_session).place_order(
        shopper,
        PlaceOrderRequest(
            items=[OrderCartItem(product_id=p.id, quantity=Decimal("1"))],
            fulfillment_type=FulfillmentType.PICKUP,
        ),
    )
    other = TelegramUser(telegram_id=5999, first_name="Other")
    db_session.add(other)
    db_session.flush()
    mine = ShopperOrderService(db_session).list_my_orders(shopper)
    assert len(mine) == 1
    assert ShopperOrderService(db_session).list_my_orders(other) == []


def test_share_phone_updates_identity(db_session, shopper):
    ShopperOrderService(db_session).share_phone(shopper, "+992901112233")
    db_session.refresh(shopper)
    assert shopper.phone == "+992901112233"


def test_delivery_to_pickup_only_shop_rejected(db_session, default_company, shopper):
    p = _publish(db_session, default_company, "Milk")
    default_company.supports_delivery = False
    db_session.flush()
    with pytest.raises(ValueError, match="delivery"):
        ShopperOrderService(db_session).place_order(
            shopper,
            PlaceOrderRequest(
                items=[OrderCartItem(product_id=p.id, quantity=Decimal("1"))],
                fulfillment_type=FulfillmentType.DELIVERY,
                delivery_address="Some St 1",
            ),
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest.exe tests/integration/test_shopper_order_service.py -v`
Expected: FAIL — `ModuleNotFoundError: services.shopper_order_service`.

- [ ] **Step 3: Write the service**

Create `sellary-backend/services/shopper_order_service.py`:

```python
"""Shopper-facing order placement + reads. Cross-company by nature (a cart can
span shops), so this service does NOT use resolve_company_id — it resolves each
line's company from the F2-gated product. Placement never touches stock: an
Order is a request; the ledger runs only at merchant confirm (F5 wiring lives in
MerchantOrderService.confirm)."""
from collections import defaultdict
from decimal import Decimal
from typing import Dict, List, Optional
from uuid import uuid4

from sqlalchemy.orm import Session

from models.company import Company
from models.order import FulfillmentType, Order, OrderItem, OrderStatus
from models.telegram_user import TelegramUser
from repositories.customer_repository import CustomerRepository
from repositories.order_repository import OrderRepository
from repositories.shop_repository import ShopRepository
from schemas.order import (
    OrderResponse,
    PlaceOrderRequest,
    PlaceOrderResponse,
)


class ShopperOrderService:
    def __init__(self, db: Session):
        self.db = db
        self.shop_repo = ShopRepository(db)
        self.order_repo = OrderRepository(db)
        self.customer_repo = CustomerRepository(db)

    def place_order(
        self, shopper: TelegramUser, request: PlaceOrderRequest
    ) -> PlaceOrderResponse:
        # 1) Resolve + gate every line through the F2 published/enabled query.
        resolved = []
        for line in request.items:
            product = self.shop_repo.get_published_product(line.product_id)
            if product is None:
                raise ValueError(f"Product {line.product_id} is not available")
            resolved.append((product, line.quantity))

        # 2) Group by company; enforce fulfillment support per shop.
        by_company: Dict[int, List] = defaultdict(list)
        companies: Dict[int, Company] = {}
        for product, qty in resolved:
            by_company[product.company_id].append((product, qty))
            if product.company_id not in companies:
                companies[product.company_id] = product.company
        for company_id, company in companies.items():
            if request.fulfillment_type == FulfillmentType.DELIVERY and not company.supports_delivery:
                raise ValueError(
                    f"Shop '{company.name}' does not support delivery"
                )
            if request.fulfillment_type == FulfillmentType.PICKUP and not company.supports_pickup:
                raise ValueError(
                    f"Shop '{company.name}' does not support pickup"
                )

        # 3) One checkout group for the whole cart.
        checkout_group_id = str(uuid4())
        contact_phone = request.contact_phone or shopper.phone

        created: List[Order] = []
        for company_id, lines in by_company.items():
            customer = self.customer_repo.get_or_create_for_telegram(
                company_id,
                shopper.telegram_id,
                name=request.contact_name or shopper.first_name,
                phone=contact_phone,
            )
            order = Order(
                company_id=company_id,
                order_number=self.order_repo.next_order_number(company_id),
                telegram_user_id=shopper.id,
                customer_id=customer.id,
                status=OrderStatus.PENDING,
                fulfillment_type=request.fulfillment_type,
                delivery_address=request.delivery_address,
                contact_phone=contact_phone,
                contact_name=request.contact_name or shopper.first_name,
                notes=request.notes,
                checkout_group_id=checkout_group_id,
            )
            subtotal = Decimal("0.00")
            for product, qty in lines:
                unit_price = Decimal(product.sell_price)
                line_total = (unit_price * Decimal(qty)).quantize(Decimal("0.01"))
                order.items.append(
                    OrderItem(
                        product_id=product.id,
                        product_name=product.name,
                        unit_price=unit_price,
                        quantity=Decimal(qty),
                        line_total=line_total,
                    )
                )
                subtotal += line_total
            order.subtotal = subtotal
            order.total_amount = subtotal
            self.order_repo.create(order)
            created.append(order)

        self.db.flush()
        return PlaceOrderResponse(
            checkout_group_id=checkout_group_id,
            orders=[self._to_response(o) for o in created],
        )

    def list_my_orders(self, shopper: TelegramUser) -> List[OrderResponse]:
        return [
            self._to_response(o)
            for o in self.order_repo.list_for_shopper(shopper.id)
        ]

    def get_my_order(
        self, shopper: TelegramUser, order_id: int
    ) -> Optional[OrderResponse]:
        order = self.order_repo.get_for_shopper(shopper.id, order_id)
        return self._to_response(order) if order else None

    def share_phone(self, shopper: TelegramUser, phone: str) -> None:
        shopper.phone = phone
        self.db.flush()

    def _to_response(self, order: Order) -> OrderResponse:
        company = self.db.get(Company, order.company_id)
        return OrderResponse(
            id=order.id,
            order_number=order.order_number,
            company_id=order.company_id,
            company_name=company.name if company else "",
            status=order.status,
            fulfillment_type=order.fulfillment_type,
            delivery_address=order.delivery_address,
            contact_phone=order.contact_phone,
            contact_name=order.contact_name,
            subtotal=order.subtotal,
            total_amount=order.total_amount,
            notes=order.notes,
            sale_id=order.sale_id,
            checkout_group_id=order.checkout_group_id,
            created_at=order.created_at,
            items=list(order.items),
        )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv\Scripts\pytest.exe tests/integration/test_shopper_order_service.py -v`
Expected: PASS — snapshot + no stock change, multi-shop split shares one group id, unpublished rejected, per-shop customer get-or-create, shopper-scoped reads, phone share, fulfillment gate.

- [ ] **Step 5: Commit**

```bash
git add sellary-backend/services/shopper_order_service.py sellary-backend/tests/integration/test_shopper_order_service.py
git commit -m "feat(marketplace): shopper order service (multi-shop split, snapshot, no stock)"
```

---

### Task 7: Merchant order service — confirm (→Sale, decrement), status, cancel (restore)

**Files:**
- Create: `sellary-backend/services/merchant_order_service.py`
- Test: `sellary-backend/tests/integration/test_merchant_order_service.py`

**Interfaces:**
- Consumes: `OrderRepository`, `SaleService.create`, `TransactionReversalService.void_sale`, `validate_order_transition` / `can_cancel_order`, `resolve_company_id`.
- Produces `MerchantOrderService(db, company_id)`:
  - `list_orders(status: OrderStatus | None, skip, limit) -> tuple[list[OrderResponse], int]`
  - `get_order(order_id) -> OrderResponse | None`
  - `confirm(order_id, confirmed_by_user_id: int) -> OrderResponse`:
    - Lock the order (`get_for_company_for_update`); 404 if not found.
    - `validate_order_transition(order.status, CONFIRMED, order.id)` (only `PENDING → CONFIRMED`).
    - Build `SaleCreate(items=[SaleItemCreate(product_id, quantity, unit_price=snapshot, tax_percent=0, discount_amount=0) ...], payment_method=CASH, customer_id=order.customer_id)`; call `SaleService(db, company_id).create(sale_create, cashier_id=confirmed_by_user_id)` — **the FIFO ledger decrements stock and raises `ValueError("Insufficient stock ...")` on oversell** (no `allow_oversell`). **Cash shift is NOT required** (service-layer call, mirrors the sync path; see decision 2).
    - On success: set `order.sale_id = sale.id`, `order.status = CONFIRMED`, flush, return response.
    - On `ValueError` from the ledger: let it propagate (the router maps to 400/409); the order row stays `PENDING` because the transaction is rolled back at the router.
  - `advance_status(order_id, target: OrderStatus) -> OrderResponse`:
    - Lock; 404 if missing. `validate_order_transition(order.status, target, order.id)`.
    - Fulfillment gate: reject `DELIVERING` for a `PICKUP` order (`ValueError`). `CONFIRMED` and `CANCELLED` are NOT reachable here (confirm and cancel have dedicated methods) — reject them with `ValueError("use confirm/cancel")`.
    - Set status, flush, return.
  - `cancel(order_id, reason: str | None, user_id: int) -> OrderResponse`:
    - Lock; 404 if missing. `can_cancel_order(order.status)` else `ValueError`/`StateTransitionError`.
    - **If `order.sale_id` is set**, run the existing reversal: `TransactionReversalService(db, company_id).void_sale(order.sale_id, reason or "Order cancelled", user_id)` — this restores stock through the ledger. If no sale (still `PENDING`), no stock to restore.
    - Set `order.status = CANCELLED`, flush, return.

- [ ] **Step 1: Write the failing test**

Create `sellary-backend/tests/integration/test_merchant_order_service.py`:

```python
"""Merchant confirm creates a Sale + decrements stock; cancel-after-confirm restores.

No auto-shift: proves confirm does NOT require an open cash shift.
"""
from decimal import Decimal

import pytest

from models.order import (
    FulfillmentType,
    Order,
    OrderItem,
    OrderStatus,
)
from models.product import Product
from models.telegram_user import TelegramUser
from services.merchant_order_service import MerchantOrderService

pytestmark = pytest.mark.no_auto_shift


@pytest.fixture
def shopper(db_session):
    tu = TelegramUser(telegram_id=6001, first_name="Ali")
    db_session.add(tu)
    db_session.flush()
    return tu


def _pending_order(db, company, shopper, product, qty="2", price="15.00", number=1):
    order = Order(
        company_id=company.id,
        order_number=number,
        telegram_user_id=shopper.id,
        status=OrderStatus.PENDING,
        fulfillment_type=FulfillmentType.PICKUP,
        subtotal=Decimal(price) * Decimal(qty),
        total_amount=Decimal(price) * Decimal(qty),
    )
    order.items.append(
        OrderItem(
            product_id=product.id,
            product_name=product.name,
            unit_price=Decimal(price),
            quantity=Decimal(qty),
            line_total=(Decimal(price) * Decimal(qty)).quantize(Decimal("0.01")),
        )
    )
    db.add(order)
    db.flush()
    return order


def test_confirm_creates_sale_and_decrements_stock(
    db_session, default_company, shopper, test_product, admin_user
):
    before = Decimal(test_product.stock_quantity)
    order = _pending_order(db_session, default_company, shopper, test_product, qty="2")
    svc = MerchantOrderService(db_session, default_company.id)
    resp = svc.confirm(order.id, confirmed_by_user_id=admin_user.id)
    assert resp.status == OrderStatus.CONFIRMED
    assert resp.sale_id is not None
    db_session.refresh(test_product)
    assert Decimal(test_product.stock_quantity) == before - Decimal("2")


def test_confirm_insufficient_stock_leaves_order_pending(
    db_session, default_company, shopper, test_category, admin_user
):
    low = Product(
        company_id=default_company.id, name="Scarce", cost_price=Decimal("1.0000"),
        sell_price=Decimal("5.0000"), stock_quantity=Decimal("1"),
        is_active=True, is_published=True, category_id=test_category.id,
    )
    db_session.add(low)
    db_session.flush()
    # Back the 1 unit with a real FIFO layer so the ledger sees availability=1.
    from services.inventory_ledger_service import InventoryLedgerService
    InventoryLedgerService(db_session, default_company.id).add_layer(
        low, Decimal("1"), Decimal("1.00"), "opening_balance", None, admin_user.id
    )
    db_session.flush()
    order = _pending_order(db_session, default_company, shopper, low, qty="5", price="5.00")
    svc = MerchantOrderService(db_session, default_company.id)
    with pytest.raises(ValueError, match="Insufficient stock"):
        svc.confirm(order.id, confirmed_by_user_id=admin_user.id)
    # The order object is unchanged in-session (router rolls back on ValueError).
    assert order.status == OrderStatus.PENDING
    assert order.sale_id is None


def test_cancel_after_confirm_restores_stock(
    db_session, default_company, shopper, test_product, admin_user
):
    before = Decimal(test_product.stock_quantity)
    order = _pending_order(db_session, default_company, shopper, test_product, qty="3")
    svc = MerchantOrderService(db_session, default_company.id)
    svc.confirm(order.id, confirmed_by_user_id=admin_user.id)
    db_session.refresh(test_product)
    assert Decimal(test_product.stock_quantity) == before - Decimal("3")
    svc.cancel(order.id, reason="changed mind", user_id=admin_user.id)
    db_session.refresh(test_product)
    assert Decimal(test_product.stock_quantity) == before  # fully restored
    resp = svc.get_order(order.id)
    assert resp.status == OrderStatus.CANCELLED


def test_cancel_pending_order_no_sale(
    db_session, default_company, shopper, test_product, admin_user
):
    order = _pending_order(db_session, default_company, shopper, test_product)
    svc = MerchantOrderService(db_session, default_company.id)
    resp = svc.cancel(order.id, reason=None, user_id=admin_user.id)
    assert resp.status == OrderStatus.CANCELLED
    assert resp.sale_id is None


def test_status_progression_pickup(
    db_session, default_company, shopper, test_product, admin_user
):
    order = _pending_order(db_session, default_company, shopper, test_product)
    svc = MerchantOrderService(db_session, default_company.id)
    svc.confirm(order.id, confirmed_by_user_id=admin_user.id)
    svc.advance_status(order.id, OrderStatus.PREPARING)
    svc.advance_status(order.id, OrderStatus.READY)
    resp = svc.advance_status(order.id, OrderStatus.COMPLETED)  # pickup skips delivering
    assert resp.status == OrderStatus.COMPLETED


def test_delivering_rejected_for_pickup_order(
    db_session, default_company, shopper, test_product, admin_user
):
    order = _pending_order(db_session, default_company, shopper, test_product)
    svc = MerchantOrderService(db_session, default_company.id)
    svc.confirm(order.id, confirmed_by_user_id=admin_user.id)
    svc.advance_status(order.id, OrderStatus.PREPARING)
    svc.advance_status(order.id, OrderStatus.READY)
    with pytest.raises(ValueError):
        svc.advance_status(order.id, OrderStatus.DELIVERING)


def test_merchant_cannot_see_other_company_order(
    db_session, default_company, secondary_company, shopper, test_product
):
    order = _pending_order(db_session, default_company, shopper, test_product)
    other = MerchantOrderService(db_session, secondary_company.id)
    assert other.get_order(order.id) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest.exe tests/integration/test_merchant_order_service.py -v`
Expected: FAIL — `ModuleNotFoundError: services.merchant_order_service`.

- [ ] **Step 3: Write the service**

Create `sellary-backend/services/merchant_order_service.py`:

```python
"""Merchant-facing order management: confirm (-> Sale via FIFO ledger), advance
status, cancel (reversal restores stock). Tenant-scoped by company_id. Confirm
calls SaleService at the SERVICE layer, so — like the offline sync path — it is
NOT gated on an open cash shift (that gate lives only in POST /api/sales)."""
from decimal import Decimal
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from core.state_machine import (
    StateTransitionError,
    can_cancel_order,
    validate_order_transition,
)
from models.company import Company
from models.order import FulfillmentType, Order, OrderStatus
from repositories.order_repository import OrderRepository
from schemas.order import OrderResponse
from schemas.sale import PaymentMethod, SaleCreate, SaleItemCreate
from services.sale_service import SaleService
from services.tenant import resolve_company_id
from services.transaction_reversal_service import TransactionReversalService


class MerchantOrderService:
    def __init__(self, db: Session, company_id: int | None = None):
        self.db = db
        self.company_id = resolve_company_id(db, company_id)
        self.repo = OrderRepository(db)

    def list_orders(
        self, status: Optional[OrderStatus] = None, skip: int = 0, limit: int = 50
    ) -> Tuple[List[OrderResponse], int]:
        rows, total = self.repo.get_for_company_by_status(
            self.company_id, status, skip=skip, limit=limit
        )
        return [self._to_response(o) for o in rows], total

    def get_order(self, order_id: int) -> Optional[OrderResponse]:
        order = self.repo.get_for_company(self.company_id, order_id)
        return self._to_response(order) if order else None

    def confirm(self, order_id: int, confirmed_by_user_id: int) -> OrderResponse:
        order = self.repo.get_for_company_for_update(self.company_id, order_id)
        if not order:
            raise ValueError(f"Order {order_id} not found")
        validate_order_transition(order.status, OrderStatus.CONFIRMED, order.id)

        sale_create = SaleCreate(
            customer_id=order.customer_id,
            items=[
                SaleItemCreate(
                    product_id=item.product_id,
                    quantity=Decimal(item.quantity),
                    unit_price=Decimal(item.unit_price),
                    tax_percent=Decimal("0.00"),
                    discount_amount=Decimal("0.00"),
                )
                for item in order.items
            ],
            payment_method=PaymentMethod.CASH,
            discount_amount=Decimal("0.00"),
        )
        # FIFO ledger decrements stock and raises ValueError("Insufficient
        # stock ...") on oversell. NOT allow_oversell — an online order must not
        # back negative stock; the merchant resolves it and retries.
        sale = SaleService(self.db, self.company_id).create(
            sale_create, cashier_id=confirmed_by_user_id
        )
        order.sale_id = sale.id
        order.status = OrderStatus.CONFIRMED
        self.db.flush()
        return self._to_response(order)

    def advance_status(
        self, order_id: int, target: OrderStatus
    ) -> OrderResponse:
        order = self.repo.get_for_company_for_update(self.company_id, order_id)
        if not order:
            raise ValueError(f"Order {order_id} not found")
        if target in (OrderStatus.CONFIRMED, OrderStatus.CANCELLED):
            raise ValueError("Use confirm/cancel for this transition")
        validate_order_transition(order.status, target, order.id)
        if (
            target == OrderStatus.DELIVERING
            and order.fulfillment_type == FulfillmentType.PICKUP
        ):
            raise ValueError("Pickup orders cannot enter delivering")
        order.status = target
        self.db.flush()
        return self._to_response(order)

    def cancel(
        self, order_id: int, reason: Optional[str], user_id: int
    ) -> OrderResponse:
        order = self.repo.get_for_company_for_update(self.company_id, order_id)
        if not order:
            raise ValueError(f"Order {order_id} not found")
        if not can_cancel_order(order.status):
            raise StateTransitionError(
                entity_type="Order",
                entity_id=order.id,
                current_status=order.status.value,
                target_status=OrderStatus.CANCELLED.value,
            )
        if order.sale_id is not None:
            # Existing reversal flow: releases ledger allocations, restores the
            # outstanding stock, flips the Sale to CANCELLED.
            TransactionReversalService(self.db, self.company_id).void_sale(
                order.sale_id, reason or "Order cancelled", user_id
            )
        order.status = OrderStatus.CANCELLED
        self.db.flush()
        return self._to_response(order)

    def _to_response(self, order: Order) -> OrderResponse:
        company = self.db.get(Company, order.company_id)
        return OrderResponse(
            id=order.id,
            order_number=order.order_number,
            company_id=order.company_id,
            company_name=company.name if company else "",
            status=order.status,
            fulfillment_type=order.fulfillment_type,
            delivery_address=order.delivery_address,
            contact_phone=order.contact_phone,
            contact_name=order.contact_name,
            subtotal=order.subtotal,
            total_amount=order.total_amount,
            notes=order.notes,
            sale_id=order.sale_id,
            checkout_group_id=order.checkout_group_id,
            created_at=order.created_at,
            items=list(order.items),
        )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv\Scripts\pytest.exe tests/integration/test_merchant_order_service.py -v`
Expected: PASS — confirm→Sale + decrement (no shift needed), oversell leaves order pending, cancel-after-confirm restores stock, cancel pending (no sale), pickup progression, delivering rejected for pickup, tenant isolation.

- [ ] **Step 5: Commit**

```bash
git add sellary-backend/services/merchant_order_service.py sellary-backend/tests/integration/test_merchant_order_service.py
git commit -m "feat(marketplace): merchant order service (confirm->Sale, status, cancel restore)"
```

---

### Task 8: Shopper order endpoints on `/api/shop` (+ idempotent placement, phone)

**Files:**
- Modify: `sellary-backend/api/shop.py` (add order routes)
- Test: `sellary-backend/tests/integration/test_shop_order_endpoints.py`

**Interfaces:**
- Consumes: `ShopperOrderService`, `get_telegram_shopper` (F2), `require_idempotency_key` + `IdempotencyService`.
- Produces (mounted under `/api/shop`):
  - `POST /api/shop/orders` (**Idempotency-Key required**) → `PlaceOrderResponse` (201). Splits cart, snapshots, no stock. 400 on unavailable product / unsupported fulfillment. **Idempotency scoping for the shopper path:** the idempotency table is keyed by `(key, company_id, user_id, endpoint)`; the shopper has no company scope, so use `company_id=0` (sentinel) and `user_id=shopper.id` (the `telegram_users.id`, a stable per-shopper integer). Endpoint string `"/api/shop/orders"`. This makes double-tap placement replay the original `PlaceOrderResponse`.
  - `GET /api/shop/orders` → `list[OrderResponse]` (my orders).
  - `GET /api/shop/orders/{order_id}` → `OrderResponse` (404 if not the shopper's).
  - `POST /api/shop/me/phone` → 204/200 (updates `telegram_users.phone`).

**Idempotency note:** the `IdempotencyKey` model's `company_id` is a plain FK-less integer column (verify: if it is a FK to `companies.id`, `0` violates it — in that case use the shopper's *first resolved company_id* as the scope, or a dedicated nullable column). Confirm before implementing; the safe default if `company_id` is FK-constrained is to store the idempotency record under the first order's `company_id` and include `checkout_group_id` in the cached body.

- [ ] **Step 1: Verify the idempotency `company_id` constraint**

Run: `.venv\Scripts\python.exe -c "from models.idempotency_key import IdempotencyKey; print([(c.name, c.foreign_keys) for c in IdempotencyKey.__table__.columns if c.name=='company_id'])"`
- If `company_id` has **no** foreign key → the sentinel `company_id=0` is safe; proceed with `0`.
- If it **is** FK-constrained → scope the shopper idempotency record under the first split order's `company_id` (available after placement) using a **manual pre-insert lookup** pattern: check the cache BEFORE placement with a deterministic key derived only from the header key + shopper id + endpoint, and store AFTER placement with the real first `company_id`. Document the chosen path in a code comment.

- [ ] **Step 2: Write the failing test**

Create `sellary-backend/tests/integration/test_shop_order_endpoints.py`:

```python
"""End-to-end shopper order routes: place (idempotent, split), my-orders, phone."""
import hashlib
import hmac
import json
import uuid
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


def _publish(db, company, name, price="10.00"):
    company.is_marketplace_enabled = True
    company.supports_pickup = True
    db.flush()
    p = Product(
        company_id=company.id, name=name, cost_price=Decimal("4.0000"),
        sell_price=Decimal(price), stock_quantity=Decimal("100"),
        is_active=True, is_published=True,
    )
    db.add(p)
    db.flush()
    return p


def _idem():
    return {"Idempotency-Key": uuid.uuid4().hex}


def test_place_order_requires_idempotency_key(client, db_session, default_company, shop_headers):
    p = _publish(db_session, default_company, "Milk")
    resp = client.post(
        "/api/shop/orders",
        headers=shop_headers,
        json={"items": [{"product_id": p.id, "quantity": "1"}], "fulfillment_type": "pickup"},
    )
    assert resp.status_code == 400
    assert "Idempotency-Key" in resp.json()["detail"]


def test_place_order_succeeds(client, db_session, default_company, shop_headers):
    p = _publish(db_session, default_company, "Milk", price="12.00")
    resp = client.post(
        "/api/shop/orders",
        headers={**shop_headers, **_idem()},
        json={"items": [{"product_id": p.id, "quantity": "2"}], "fulfillment_type": "pickup"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert len(body["orders"]) == 1
    assert body["orders"][0]["total_amount"] == "24.00"
    assert body["orders"][0]["status"] == "pending"


def test_place_order_idempotent_replay(client, db_session, default_company, shop_headers):
    p = _publish(db_session, default_company, "Milk")
    idem = _idem()
    payload = {"items": [{"product_id": p.id, "quantity": "1"}], "fulfillment_type": "pickup"}
    first = client.post("/api/shop/orders", headers={**shop_headers, **idem}, json=payload)
    second = client.post("/api/shop/orders", headers={**shop_headers, **idem}, json=payload)
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["checkout_group_id"] == second.json()["checkout_group_id"]
    # Only ONE order actually created despite two calls.
    from models.order import Order
    assert db_session.query(Order).filter_by(company_id=default_company.id).count() == 1


def test_my_orders_and_detail(client, db_session, default_company, shop_headers):
    p = _publish(db_session, default_company, "Milk")
    created = client.post(
        "/api/shop/orders", headers={**shop_headers, **_idem()},
        json={"items": [{"product_id": p.id, "quantity": "1"}], "fulfillment_type": "pickup"},
    ).json()
    order_id = created["orders"][0]["id"]
    listing = client.get("/api/shop/orders", headers=shop_headers)
    assert listing.status_code == 200
    assert order_id in {o["id"] for o in listing.json()}
    detail = client.get(f"/api/shop/orders/{order_id}", headers=shop_headers)
    assert detail.status_code == 200
    # A different shopper cannot see it.
    other = {"X-Telegram-Init-Data": _init_data(telegram_id=999)}
    assert client.get(f"/api/shop/orders/{order_id}", headers=other).status_code == 404


def test_share_phone(client, db_session, shop_headers):
    resp = client.post("/api/shop/me/phone", headers=shop_headers, json={"phone": "+992901234567"})
    assert resp.status_code in (200, 204)
    from models.telegram_user import TelegramUser
    tu = db_session.query(TelegramUser).filter_by(telegram_id=42).first()
    assert tu.phone == "+992901234567"
```

- [ ] **Step 3: Add routes to `api/shop.py`**

Add imports and routes (order matters — `/orders` before `/orders/{id}` is fine as static vs int). Use `db.commit()` on the write paths (matching `api/sales.py`), since the client fixture shares the session — follow the exact idempotency structure from `api/sales.py::create_sale`:

```python
from core.idempotency import (
    IdempotencyConflictError,
    IdempotencyService,
    require_idempotency_key,
)
from schemas.order import (
    OrderResponse,
    PlaceOrderRequest,
    PlaceOrderResponse,
    SharePhoneRequest,
)
from services.shopper_order_service import ShopperOrderService

SHOPPER_IDEM_COMPANY = 0  # sentinel: shopper path has no company scope


@router.post("/orders", response_model=PlaceOrderResponse, status_code=201)
def place_order(
    request: PlaceOrderRequest,
    db: Session = Depends(get_db),
    shopper: TelegramUser = Depends(get_telegram_shopper),
    idempotency_key: str = Depends(require_idempotency_key),
):
    endpoint = "/api/shop/orders"
    request_body = request.model_dump(mode="json")
    idem = IdempotencyService(db)
    try:
        cached = idem.get_cached_response(
            key=idempotency_key,
            company_id=SHOPPER_IDEM_COMPANY,
            user_id=shopper.id,
            endpoint=endpoint,
            request_body=request_body,
        )
        if cached:
            return PlaceOrderResponse(**cached[0])
    except IdempotencyConflictError as exc:
        raise HTTPException(status_code=409, detail=exc.message)

    service = ShopperOrderService(db)
    try:
        result = service.place_order(shopper, request)
        idem.store_response(
            key=idempotency_key,
            company_id=SHOPPER_IDEM_COMPANY,
            user_id=shopper.id,
            endpoint=endpoint,
            request_body=request_body,
            response_body=result,
            status_code=201,
        )
        db.commit()
        return result
    except IdempotencyConflictError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=exc.message)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/orders", response_model=List[OrderResponse])
def my_orders(
    db: Session = Depends(get_db),
    shopper: TelegramUser = Depends(get_telegram_shopper),
):
    return ShopperOrderService(db).list_my_orders(shopper)


@router.get("/orders/{order_id}", response_model=OrderResponse)
def my_order(
    order_id: int,
    db: Session = Depends(get_db),
    shopper: TelegramUser = Depends(get_telegram_shopper),
):
    order = ShopperOrderService(db).get_my_order(shopper, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@router.post("/me/phone", status_code=200)
def share_phone(
    payload: SharePhoneRequest,
    db: Session = Depends(get_db),
    shopper: TelegramUser = Depends(get_telegram_shopper),
):
    ShopperOrderService(db).share_phone(shopper, payload.phone)
    db.commit()
    return {"ok": True}
```

If Step 1 found `company_id` is FK-constrained, swap `SHOPPER_IDEM_COMPANY` for the documented first-order-company approach.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv\Scripts\pytest.exe tests/integration/test_shop_order_endpoints.py -v`
Expected: PASS — idempotency required, place succeeds, replay returns same group + only one order, my-orders/detail scoped, phone share.

- [ ] **Step 5: Commit**

```bash
git add sellary-backend/api/shop.py sellary-backend/tests/integration/test_shop_order_endpoints.py
git commit -m "feat(marketplace): shopper order endpoints (idempotent placement, my-orders, phone)"
```

---

### Task 9: Merchant order endpoints on `/api/orders` (+ idempotent confirm) + registration

**Files:**
- Create: `sellary-backend/api/orders.py`
- Modify: `sellary-backend/api/__init__.py` (import + `__all__`)
- Modify: `sellary-backend/main.py` (import + `include_router`)
- Test: `sellary-backend/tests/integration/test_merchant_order_endpoints.py`

**Interfaces:**
- Consumes: `MerchantOrderService`, `get_auth_context` (company token), `require_idempotency_key` + `IdempotencyService`, `StateTransitionError`.
- Produces (`router = APIRouter(prefix="/orders", tags=["orders"])`, mounted under `/api`):
  - `GET /api/orders?status=&skip=&limit=` → `list[OrderResponse]` (sets `X-Total-Count`).
  - `GET /api/orders/{id}` → `OrderResponse` (404).
  - `POST /api/orders/{id}/confirm` (**Idempotency-Key required**) → `OrderResponse`. Scope `(key, auth.company_id, auth.user.id, "/api/orders/{id}/confirm")`. 400 on `Insufficient stock` (order stays pending — rollback), 409 on invalid transition / idempotency conflict, 404 if not found.
  - `POST /api/orders/{id}/status` (`AdvanceStatusRequest`) → `OrderResponse`. 409 on invalid transition, 400 on fulfillment/misuse error.
  - `POST /api/orders/{id}/cancel` (`CancelOrderRequest`) → `OrderResponse`. 409 on terminal-state, restores stock if a Sale exists.

- [ ] **Step 1: Write the failing test**

Create `sellary-backend/tests/integration/test_merchant_order_endpoints.py`:

```python
"""End-to-end merchant order routes with the company token."""
import uuid
from decimal import Decimal

import pytest

from models.order import FulfillmentType, Order, OrderItem, OrderStatus
from models.telegram_user import TelegramUser


@pytest.fixture
def pending_order(db_session, default_company, test_product):
    tu = TelegramUser(telegram_id=7001, first_name="Ali")
    db_session.add(tu)
    db_session.flush()
    order = Order(
        company_id=default_company.id, order_number=1, telegram_user_id=tu.id,
        status=OrderStatus.PENDING, fulfillment_type=FulfillmentType.PICKUP,
        subtotal=Decimal("30.00"), total_amount=Decimal("30.00"),
    )
    order.items.append(OrderItem(
        product_id=test_product.id, product_name=test_product.name,
        unit_price=Decimal("15.0000"), quantity=Decimal("2"), line_total=Decimal("30.00"),
    ))
    db_session.add(order)
    db_session.flush()
    return order


def _idem():
    return {"Idempotency-Key": uuid.uuid4().hex}


def test_list_orders_filter_by_status(client, admin_headers, pending_order):
    resp = client.get("/api/orders?status=pending", headers=admin_headers)
    assert resp.status_code == 200, resp.text
    assert pending_order.id in {o["id"] for o in resp.json()}


def test_confirm_requires_idempotency_key(client, admin_headers, pending_order):
    resp = client.post(f"/api/orders/{pending_order.id}/confirm", headers=admin_headers)
    assert resp.status_code == 400


def test_confirm_creates_sale(client, db_session, admin_headers, pending_order, test_product):
    before = Decimal(test_product.stock_quantity)
    resp = client.post(
        f"/api/orders/{pending_order.id}/confirm",
        headers={**admin_headers, **_idem()},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "confirmed"
    assert body["sale_id"] is not None
    db_session.refresh(test_product)
    assert Decimal(test_product.stock_quantity) == before - Decimal("2")


def test_confirm_idempotent_replay(client, admin_headers, pending_order):
    idem = _idem()
    a = client.post(f"/api/orders/{pending_order.id}/confirm", headers={**admin_headers, **idem})
    b = client.post(f"/api/orders/{pending_order.id}/confirm", headers={**admin_headers, **idem})
    assert a.status_code == 200 and b.status_code == 200
    assert a.json()["sale_id"] == b.json()["sale_id"]


def test_status_and_cancel_flow(client, admin_headers, pending_order):
    client.post(f"/api/orders/{pending_order.id}/confirm", headers={**admin_headers, **_idem()})
    r1 = client.post(f"/api/orders/{pending_order.id}/status", headers=admin_headers, json={"status": "preparing"})
    assert r1.status_code == 200
    r2 = client.post(f"/api/orders/{pending_order.id}/cancel", headers=admin_headers, json={"reason": "test"})
    assert r2.status_code == 200
    assert r2.json()["status"] == "cancelled"


def test_tenant_isolation_other_company_404(client, db_session, pending_order):
    from tests.conftest import create_auth_headers
    from models.company import Company
    other = Company(name="Other", slug="other-co", is_active=True)
    db_session.add(other)
    db_session.flush()
    headers = create_auth_headers("x", 999, other.id, "admin")
    assert client.get(f"/api/orders/{pending_order.id}", headers=headers).status_code == 404
```

Note: `test_confirm_*` rely on the auto-open-shift fixture being irrelevant; confirm works with or without a shift. These endpoint tests run under the default integration conftest (shift auto-opened) — that is fine, it just proves confirm does not *break* when a shift exists.

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest.exe tests/integration/test_merchant_order_endpoints.py -v`
Expected: FAIL — routes not registered (404 everywhere).

- [ ] **Step 3: Write the router**

Create `sellary-backend/api/orders.py`, following the `api/sales.py` idempotency + error-mapping structure. Map `StateTransitionError` → 409, `Insufficient stock` `ValueError` → 400, other `ValueError` "not found" → 404 else 400. `GET /api/orders` sets `response.headers["X-Total-Count"]`. The confirm endpoint passes `confirmed_by_user_id=auth.user.id`.

```python
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from api.dependencies import AuthContext, get_auth_context
from core.database import get_db
from core.idempotency import (
    IdempotencyConflictError,
    IdempotencyService,
    require_idempotency_key,
)
from core.state_machine import StateTransitionError
from models.order import OrderStatus
from schemas.order import (
    AdvanceStatusRequest,
    CancelOrderRequest,
    OrderResponse,
)
from services.merchant_order_service import MerchantOrderService

router = APIRouter(prefix="/orders", tags=["orders"])


@router.get("", response_model=list[OrderResponse])
def list_orders(
    response: Response,
    status: Optional[OrderStatus] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    orders, total = MerchantOrderService(db, auth.company_id).list_orders(
        status=status, skip=skip, limit=limit
    )
    response.headers["X-Total-Count"] = str(total)
    return orders


@router.get("/{order_id}", response_model=OrderResponse)
def get_order(
    order_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    order = MerchantOrderService(db, auth.company_id).get_order(order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@router.post("/{order_id}/confirm", response_model=OrderResponse)
def confirm_order(
    order_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
    idempotency_key: str = Depends(require_idempotency_key),
):
    endpoint = f"/api/orders/{order_id}/confirm"
    request_body = {"order_id": order_id}
    idem = IdempotencyService(db)
    try:
        cached = idem.get_cached_response(
            key=idempotency_key, company_id=auth.company_id, user_id=auth.user.id,
            endpoint=endpoint, request_body=request_body,
        )
        if cached:
            return OrderResponse(**cached[0])
    except IdempotencyConflictError as exc:
        raise HTTPException(status_code=409, detail=exc.message)

    service = MerchantOrderService(db, auth.company_id)
    try:
        result = service.confirm(order_id, confirmed_by_user_id=auth.user.id)
        idem.store_response(
            key=idempotency_key, company_id=auth.company_id, user_id=auth.user.id,
            endpoint=endpoint, request_body=request_body, response_body=result,
            status_code=200,
        )
        db.commit()
        return result
    except IdempotencyConflictError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=exc.message)
    except StateTransitionError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=exc.message)
    except ValueError as exc:
        db.rollback()
        detail = str(exc)
        status_code = 404 if "not found" in detail.lower() else 400
        raise HTTPException(status_code=status_code, detail=detail)


@router.post("/{order_id}/status", response_model=OrderResponse)
def advance_order_status(
    order_id: int,
    payload: AdvanceStatusRequest,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    service = MerchantOrderService(db, auth.company_id)
    try:
        result = service.advance_status(order_id, payload.status)
        db.commit()
        return result
    except StateTransitionError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=exc.message)
    except ValueError as exc:
        db.rollback()
        detail = str(exc)
        status_code = 404 if "not found" in detail.lower() else 400
        raise HTTPException(status_code=status_code, detail=detail)


@router.post("/{order_id}/cancel", response_model=OrderResponse)
def cancel_order(
    order_id: int,
    payload: CancelOrderRequest,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    service = MerchantOrderService(db, auth.company_id)
    try:
        result = service.cancel(order_id, payload.reason, auth.user.id)
        db.commit()
        return result
    except StateTransitionError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=exc.message)
    except ValueError as exc:
        db.rollback()
        detail = str(exc)
        status_code = 404 if "not found" in detail.lower() else 400
        raise HTTPException(status_code=status_code, detail=detail)
```

- [ ] **Step 4: Register the router**

In `sellary-backend/api/__init__.py`, add `from .orders import router as orders_router` and `"orders_router"` to `__all__`. In `sellary-backend/main.py`, add `orders_router` to the `from api import (...)` block and `app.include_router(orders_router, prefix=settings.API_V1_STR)` after the shop include.

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv\Scripts\pytest.exe tests/integration/test_merchant_order_endpoints.py -v`
Expected: PASS — list/filter, confirm requires key + creates Sale + decrements + replays, status/cancel flow, tenant isolation 404.

- [ ] **Step 6: Commit**

```bash
git add sellary-backend/api/orders.py sellary-backend/api/__init__.py sellary-backend/main.py sellary-backend/tests/integration/test_merchant_order_endpoints.py
git commit -m "feat(marketplace): merchant /api/orders router + registration"
```

---

### Task 10: Full-suite gate + confirm-oversell-then-retry regression

**Files:**
- Test: `sellary-backend/tests/integration/test_order_confirm_oversell.py`

**Interfaces:**
- Consumes: everything above. Proves the critical business invariant end-to-end: confirming an order that exceeds stock returns a clear 4xx and leaves the order `pending`; after restocking, a retry confirms and decrements.

- [ ] **Step 1: Write the regression test**

Create `sellary-backend/tests/integration/test_order_confirm_oversell.py`:

```python
"""Confirm an over-stock order -> 4xx + order stays pending; restock -> confirm ok."""
import uuid
from decimal import Decimal

import pytest

from models.order import FulfillmentType, Order, OrderItem, OrderStatus
from models.product import Product
from models.telegram_user import TelegramUser
from services.inventory_ledger_service import InventoryLedgerService


def _idem():
    return {"Idempotency-Key": uuid.uuid4().hex}


@pytest.fixture
def scarce_order(db_session, default_company, test_category, admin_user):
    p = Product(
        company_id=default_company.id, name="Scarce", cost_price=Decimal("1.0000"),
        sell_price=Decimal("5.0000"), stock_quantity=Decimal("1"),
        is_active=True, is_published=True, category_id=test_category.id,
    )
    db_session.add(p)
    db_session.flush()
    InventoryLedgerService(db_session, default_company.id).add_layer(
        p, Decimal("1"), Decimal("1.00"), "opening_balance", None, admin_user.id
    )
    db_session.flush()
    tu = TelegramUser(telegram_id=8001, first_name="Ali")
    db_session.add(tu)
    db_session.flush()
    order = Order(
        company_id=default_company.id, order_number=1, telegram_user_id=tu.id,
        status=OrderStatus.PENDING, fulfillment_type=FulfillmentType.PICKUP,
        subtotal=Decimal("25.00"), total_amount=Decimal("25.00"),
    )
    order.items.append(OrderItem(
        product_id=p.id, product_name="Scarce", unit_price=Decimal("5.0000"),
        quantity=Decimal("5"), line_total=Decimal("25.00"),
    ))
    db_session.add(order)
    db_session.flush()
    return order, p


def test_confirm_oversell_then_restock_retry(client, db_session, admin_headers, scarce_order):
    order, product = scarce_order
    # 5 requested vs 1 in stock -> 400, order still pending.
    resp = client.post(f"/api/orders/{order.id}/confirm", headers={**admin_headers, **_idem()})
    assert resp.status_code == 400, resp.text
    assert "Insufficient stock" in resp.json()["detail"]
    db_session.refresh(order)
    assert order.status == OrderStatus.PENDING
    assert order.sale_id is None

    # Restock and retry with a FRESH idempotency key -> confirms.
    from models.user import User
    admin = db_session.query(User).filter_by(username="admin").first()
    InventoryLedgerService(db_session, order.company_id).add_layer(
        product, Decimal("10"), Decimal("1.00"), "purchase_receipt", None, admin.id
    )
    db_session.commit()
    resp2 = client.post(f"/api/orders/{order.id}/confirm", headers={**admin_headers, **_idem()})
    assert resp2.status_code == 200, resp2.text
    assert resp2.json()["status"] == "confirmed"
```

- [ ] **Step 2: Run compile gate + the F4 suite**

```
.venv\Scripts\python.exe -m compileall api core models repositories schemas services main.py
```

```
.venv\Scripts\pytest.exe ^
  tests/unit/test_migration_chain.py ^
  tests/unit/test_order_model.py ^
  tests/unit/test_order_state_machine.py ^
  tests/unit/test_order_schemas.py ^
  tests/integration/test_order_repository.py ^
  tests/integration/test_shopper_order_service.py ^
  tests/integration/test_merchant_order_service.py ^
  tests/integration/test_shop_order_endpoints.py ^
  tests/integration/test_merchant_order_endpoints.py ^
  tests/integration/test_order_confirm_oversell.py -v
```

Expected: compile OK; all F4 tests PASS.

- [ ] **Step 3: Run the whole suite to confirm no regressions**

Run: `.venv\Scripts\pytest.exe tests/integration tests/unit`
Expected: PASS (new tables/enums are additive; the shift gate and existing sale/reversal paths are unchanged).

- [ ] **Step 4: Commit**

```bash
git add sellary-backend/tests/integration/test_order_confirm_oversell.py
git commit -m "test(marketplace): confirm-oversell-then-retry regression"
```

---

## Self-Review Notes

**Scope-item → task mapping:**

| Scope item | Task(s) |
|---|---|
| Migration: `orders` + `order_items` (full column set, enums, unique per-company order_number, sale_id FK, checkout_group_id); chain off `d0e1f2a3b4c5`; bump `railway.toml`; two-heads guard | Task 1 (revision `e1f2a3b4c5d6`, guard re-run) |
| Register new models in `models/__init__.py` | Task 2 (Step 4) |
| `Order`/`OrderItem` models + status/fulfillment enums | Task 2 |
| Order status transitions (valid transitions, terminal states) | Task 3 (`ORDER_TRANSITIONS`, `validate_order_transition`) |
| `POST /api/shop/orders` — Idempotency-Key required | Task 8 (route idempotency), Task 4 (request schema) |
| Multi-shop cart split by company_id → N orders sharing checkout_group_id | Task 6 (`place_order` group-by-company + one uuid), tested Task 6 + Task 8 |
| Validate products belong to enabled/published shops (F2 gating) | Task 6 (`ShopRepository.get_published_product` gate) |
| Snapshot price/name; no stock touch on placement | Task 6 (OrderItem snapshots; no ledger call), tested Task 6 |
| Optional phone capture `POST /api/shop/me/phone` | Task 4 (`SharePhoneRequest`), Task 6 (`share_phone`), Task 8 (route) |
| `GET /api/shop/orders` (my orders by telegram_id) + `GET /api/shop/orders/{id}` | Task 5 (repo shopper scoping), Task 6, Task 8 |
| `GET /api/orders` (filter by status) + `GET /api/orders/{id}` | Task 5 (repo), Task 7, Task 9 |
| `POST /api/orders/{id}/confirm` (Idempotency-Key; →Sale via sale_service; decrement via FIFO; set sale_id; →confirmed; insufficient stock → order stays pending, clear 4xx) | Task 7 (`confirm`), Task 9 (route + 400 mapping), Task 10 (oversell regression) |
| `POST /api/orders/{id}/status` (advance with valid transitions) | Task 7 (`advance_status`), Task 9 |
| `POST /api/orders/{id}/cancel` (reason; if Sale exists → reversal restores stock) | Task 7 (`cancel` → `void_sale`), Task 9 |
| Per-shop Customer get-or-create by telegram_id, attach to order | Task 5 (`get_or_create_for_telegram`), Task 6 (linked on placement) |
| Tenant isolation (merchant only own orders; shopper only own) | Task 5 (scoped reads), Task 7/9 (merchant 404), Task 6/8 (shopper 404) |
| Idempotency replay on placement + confirm | Task 8 + Task 9 (replay tests) |

**Resolved ambiguities (recommended choices taken; see "Resolved design decisions"):**
- **cashier_id for confirm→Sale = `auth.user.id`** (the confirming manager/admin). No synthetic system user.
- **Confirm does NOT require an open cash shift** — it calls `SaleService.create` at the service layer, like the sync path; the shift gate lives only in `POST /api/sales`.
- **Order price model:** online price = `sell_price`, cash, no tax/discount on the order; Sale totals recomputed by `SaleService` from snapshot lines.
- **Shopper idempotency scoping:** `(key, company_id=0 sentinel, user_id=telegram_users.id, "/api/shop/orders")` — with a Task 8 Step 1 check to confirm `idempotency_keys.company_id` is not FK-constrained (fallback documented if it is).

**Deferred (explicitly out of F4):**
- **Merchant order UI** (Next.js `/orders` page, confirm/status/cancel buttons, order list/detail views) → **F5**. F4 delivers only the backend `/api/orders` endpoints F5 consumes.
- **Telegram bot new-order notification** (`merchant_notify_links`, `/start` deep-link, push on placement) → **F6**. `order_service` placement does NOT emit notifications in F4.
- **Cloudinary images / `is_published` toggle / marketplace settings** → shipped in **F1**; F4 only reads them via the F2 gate.
- **Public catalog read endpoints** (`/api/shop/catalog` etc.) → shipped in **F2**; F4 reuses `ShopRepository` for the placement gate but adds no catalog routes.
- **Online payment / delivery fees / promo codes / reviews** → out of MVP entirely.

**Consistency checks performed:**
- Migration chains off the confirmed live head `d0e1f2a3b4c5` (verified: `railway.toml` currently pins it; the head file declares `revision = d0e1f2a3b4c5`). New head `e1f2a3b4c5d6`; dead `20260319_0001` untouched → exactly two heads for the guard test. Railway pin bumped in the same task.
- `Order`/`OrderItem` registered in `models/__init__.py` so `alembic/env.py`'s `from models import *` and the test suite's `Base.metadata.create_all` both see them. FKs (`telegram_users.id`, `companies.id`, `customers.id`, `sales.id`, `products.id`) all reference tables that exist at head.
- Enum columns follow the existing `Sale`/`PaymentMethod` pattern (`values_callable`, `create_constraint=False`, `native_enum=True`) so native strings round-trip on Postgres and SQLite tests stay permissive.
- Confirm reuses `SaleService(db, company_id).create(sale_create, cashier_id)` verbatim (signature verified) with `payment_method=CASH`, `tax_percent=0`, `discount_amount=0`, no `allow_oversell`, so `consume_fifo` enforces stock and the router maps `Insufficient stock` → 400 with the order left pending (rollback). Cancel-after-confirm reuses `TransactionReversalService.void_sale(sale_id, reason, user_id)` (signature verified), which restores outstanding stock through the ledger.
- Idempotency structure mirrors `api/sales.py::create_sale` exactly (get_cached_response → store_response → commit; 409 on conflict, 400 on ValueError). Confirm uses the company-scoped `(key, company_id, user.id, endpoint)`; the shopper path uses the sentinel scope pending the Task 8 Step 1 FK check.
- Repository writes use `flush` (not `commit`) so the transaction-rollback test isolation holds; the API layer owns the single `commit` per request, matching the existing sales router. `CustomerRepository.get_or_create_for_telegram` deliberately uses `flush` (the existing `.create` uses `commit`, which would break test isolation — a distinct method avoids touching that).
- State machine adds an `Order` branch alongside `Sale`/`PO` without altering existing tables; `validate_order_transition` raises the shared `StateTransitionError`, so the router's existing 409 mapping applies uniformly.
