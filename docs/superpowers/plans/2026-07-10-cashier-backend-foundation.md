# Cashier Backend Additive Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Ship the Phase-1 backend changes (C0 `server_time`, C1 oversell-tolerant sync, C2 `cashier_devices` device auth, C3 `sales.client_sale_id`) as strictly additive, backward-compatible changes plus ONE Alembic migration and the Railway pin bump, so the Tauri cashier can provision devices, refresh access tokens offline-to-online, and push oversell offline sales as historical facts — while the web `POST /api/sales` path stays byte-for-byte strict.

**Architecture:** Follows the existing strict layering `api/ → services/ → repositories/ → models/`, Pydantic in `schemas/`. Oversell tolerance is gated behind `allow_oversell=False` / `allow_negative=False` defaults in `InventoryLedgerService` so only the sync path opts in. Device auth is an opaque, sha256-hashed, revocable token in a new `cashier_devices` table; `/refresh` mints a standard `token_type="access"` 24h JWT that `get_auth_context` already accepts unchanged.

**Tech Stack:** Python 3 / FastAPI / SQLAlchemy / Alembic / PostgreSQL (SQLite in-memory for tests), bcrypt+PyJWT (existing `core/security.py`), `secrets`/`hashlib`/`hmac` for device tokens.

**Depends on:** none (this is the foundation the five cashier-side plans build on).

---

## File Structure

**Create**
- `sellary-backend/models/cashier_device.py` — `CashierDevice` SQLAlchemy model (one row per registered cashier device).
- `sellary-backend/schemas/device.py` — request/response Pydantic models for the device-auth endpoints.
- `sellary-backend/repositories/cashier_device_repository.py` — DB queries for `cashier_devices`.
- `sellary-backend/services/device_auth_service.py` — register / refresh / revoke / list business logic, token hashing, membership re-check.
- `sellary-backend/api/device_auth.py` — router at prefix `/auth/devices`.
- `sellary-backend/alembic/versions/20260710_0000-c3d4e5f6a7b8_add_cashier_devices_and_sale_client_id.py` — the ONE migration (C2 table + C3 column + partial unique index).
- `sellary-backend/tests/unit/test_inventory_ledger_oversell.py` — C1 ledger unit tests.
- `sellary-backend/tests/integration/test_sync_oversell.py` — C1 sync-path oversell + online-strictness regression.
- `sellary-backend/tests/integration/test_sync_client_sale_id.py` — C3 tests.
- `sellary-backend/tests/integration/test_device_auth.py` — C2 endpoint tests.
- `sellary-backend/tests/unit/test_migration_chain.py` — asserts the new head chains off `b2c3d4e5f6a7` and the dead head is untouched.

**Modify**
- `sellary-backend/services/inventory_ledger_service.py` — add `allow_negative` to `_apply_balance`, `allow_oversell` to `consume_fifo`, extend `InventoryConsumption`.
- `sellary-backend/services/sync_service.py` — `_create_sale` opts into `allow_oversell=True`, populates `SyncWarning`s, sets `client_sale_id`.
- `sellary-backend/services/sale_service.py` — map `client_sale_id` into `_to_response` (default None).
- `sellary-backend/schemas/sale.py` — add `client_sale_id: Optional[str] = None` on `Sale`.
- `sellary-backend/models/sale.py` — add `client_sale_id` column + partial unique index `__table_args__`.
- `sellary-backend/models/__init__.py` — register `CashierDevice`.
- `sellary-backend/core/config.py` — add `DEVICE_TOKEN_EXPIRE_DAYS: int = 180`.
- `sellary-backend/main.py` — include the device-auth router.
- `sellary-backend/api/__init__.py` — export the device-auth router.
- `sellary-backend/tests/integration/test_sync_endpoints.py` — add a `server_time` value assertion (C0).
- `railway.toml` (repo root) and `sellary-backend/railway.json` — bump the pinned rev.
- `D:/Learning/Sellary/CLAUDE.md` — correct the two stale facts (migrations tracked; online oversell now rejected).

---

## Task 1: C0 — harden the `server_time` bootstrap field (already shipped)

`server_time` is already present in `schemas/sync.py` (`SyncBootstrapResponse.server_time: datetime`) and set in `services/sync_service.py:bootstrap` (`server_time=datetime.utcnow()`). The existing test only asserts it is non-null. This task adds a characterization test locking the value and the unchanged existing fields, so a later refactor can't silently drop or corrupt it.

**Files:**
- Modify: `sellary-backend/tests/integration/test_sync_endpoints.py` (class `TestBootstrapEndpoint`, after `test_bootstrap_endpoint` ~line 33)

- [ ] Add a focused test asserting `server_time` parses and is within a sane window of "now", and that the pre-existing fields are unchanged. Insert this method into `class TestBootstrapEndpoint`:

```python
    def test_bootstrap_server_time_is_recent_utc(
        self, client, db_session, default_company, admin_user, test_product, test_category
    ):
        from datetime import datetime, timezone

        headers = create_auth_headers(
            admin_user.username, admin_user.id,
            default_company.id, admin_user.role,
        )
        before = datetime.now(timezone.utc)
        response = client.get("/api/sync/bootstrap", headers=headers)
        after = datetime.now(timezone.utc)

        assert response.status_code == 200
        data = response.json()

        # C0: server_time must be present, parseable, and ~now (clock-skew source).
        raw = data["server_time"]
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        assert (before - parsed).total_seconds() <= 60
        assert (parsed - after).total_seconds() <= 60

        # Existing bootstrap contract stays intact (additive-only change).
        for key in (
            "company_id", "company_name", "user_id",
            "user_username", "user_role", "products", "categories",
        ):
            assert key in data
```

- [ ] Run it and confirm it **PASSES immediately** (C0 already implemented — this is a characterization test, not a red→green):
  - Command: `.venv\Scripts\pytest.exe tests/integration/test_sync_endpoints.py::TestBootstrapEndpoint::test_bootstrap_server_time_is_recent_utc -v`
  - Expected: `1 passed`. If it FAILS with `KeyError: 'server_time'`, C0 regressed — restore `server_time=datetime.utcnow()` in `SyncService.bootstrap` and `server_time: datetime` in `SyncBootstrapResponse` before continuing.
- [ ] Commit:
  - `git add sellary-backend/tests/integration/test_sync_endpoints.py`
  - `git commit -m "test(sync): lock C0 server_time bootstrap field value + unchanged fields"`

---

## Task 2: C1 (part 1) — oversell-tolerant `InventoryLedgerService` (defaults preserve strictness)

Add opt-in oversell to the ledger. Defaults stay `False`, so every existing caller (online `POST /api/sales` via `SaleService`, returns, purchase receipts) is byte-for-byte unchanged.

**Files:**
- Modify: `sellary-backend/services/inventory_ledger_service.py` (`InventoryConsumption` ~line 36-41; `_apply_balance` ~line 54-76; `consume_fifo` ~line 132-194)
- Test: `sellary-backend/tests/unit/test_inventory_ledger_oversell.py` (Create)

- [ ] Write the failing unit test. Create `sellary-backend/tests/unit/test_inventory_ledger_oversell.py`:

```python
"""Unit tests for oversell-tolerant FIFO consumption (C1)."""
from decimal import Decimal

import pytest

from services.inventory_ledger_service import InventoryLedgerService


def test_consume_fifo_strict_by_default_raises_on_oversell(
    db_session, layered_product, admin_user
):
    # layered_product holds 5 units (2 @ 10, then 3 @ 20).
    ledger = InventoryLedgerService(db_session, layered_product.company_id)
    with pytest.raises(ValueError, match="Insufficient stock"):
        ledger.consume_fifo(
            product=layered_product,
            quantity=Decimal("8"),
            consumer_type="sale_item",
            consumer_id=1,
            sale_item_id=None,
            user_id=admin_user.id,
            reason="oversell attempt",
            reference_type="sale",
            reference_id=1,
        )


def test_consume_fifo_allow_oversell_goes_negative_and_reports_shortfall(
    db_session, layered_product, admin_user
):
    ledger = InventoryLedgerService(db_session, layered_product.company_id)
    # Baseline: stock 5, inventory_value 80 -> cost_price 16.
    assert layered_product.stock_quantity == Decimal("5")
    assert layered_product.cost_price == Decimal("16.0000")

    consumption = ledger.consume_fifo(
        product=layered_product,
        quantity=Decimal("8"),
        consumer_type="sale_item",
        consumer_id=1,
        sale_item_id=None,
        user_id=admin_user.id,
        reason="oversell",
        reference_type="sale",
        reference_id=1,
        allow_oversell=True,
    )

    # 5 real units (value 80) + 3 shortfall @ cost_price 16 (value 48) = 128.
    assert consumption.value == Decimal("128.0000")
    assert consumption.shortfall_quantity == Decimal("3")
    assert consumption.available_before == Decimal("5")
    # Stock goes negative; inventory_value clamped to 0; cost_price frozen.
    assert layered_product.stock_quantity == Decimal("-3")
    assert layered_product.inventory_value == Decimal("0.0000")
    assert layered_product.cost_price == Decimal("16.0000")
```

- [ ] Run it and see it FAIL:
  - Command: `.venv\Scripts\pytest.exe tests/unit/test_inventory_ledger_oversell.py -v`
  - Expected FAIL: `TypeError: consume_fifo() got an unexpected keyword argument 'allow_oversell'` (second test) and the shortfall/available attributes don't exist.
- [ ] Extend `InventoryConsumption` with the two additive fields. Replace the dataclass (lines ~36-41):

```python
@dataclass
class InventoryConsumption:
    """Result of a FIFO consumption: the allocations created and their cost."""

    allocations: List[InventoryAllocation] = field(default_factory=list)
    value: Decimal = Decimal("0.0000")
    # Additive (C1): populated only on the oversell-tolerant sync path.
    shortfall_quantity: Decimal = Decimal("0")
    available_before: Decimal = Decimal("0")
```

- [ ] Add `allow_negative` to `_apply_balance`. Replace the method (lines ~54-76):

```python
    def _apply_balance(
        self,
        product: Product,
        quantity_change: Decimal,
        value_change: Decimal,
        allow_negative: bool = False,
    ) -> tuple[Decimal, Decimal]:
        """Apply a quantity/value delta to the product, enforcing invariants.

        Returns ``(previous_quantity, new_quantity)`` so the caller can write a
        consistent inventory log. ``allow_negative=True`` (sync oversell path
        only) lets stock go negative; inventory_value is clamped to 0 and
        cost_price is frozen at its last positive-stock value.
        """
        previous_quantity = Decimal(product.stock_quantity or 0)
        new_quantity = previous_quantity + quantity_change
        new_value = (Decimal(product.inventory_value or 0) + value_change).quantize(MONEY_QUANT)
        if new_quantity < 0 and not allow_negative:
            raise ValueError(f"Insufficient stock for product '{product.name}'")
        if new_value < Decimal("-0.0001") and not allow_negative:
            raise ValueError(f"Inventory value cannot become negative for '{product.name}'")

        product.stock_quantity = new_quantity
        product.inventory_value = max(new_value, Decimal("0.0000"))
        if new_quantity > 0:
            product.cost_price = (product.inventory_value / new_quantity).quantize(PRICE_QUANT)
        else:
            # Zero or negative stock: value is 0 and cost_price is left frozen.
            product.inventory_value = Decimal("0.0000")
        return previous_quantity, new_quantity
```

- [ ] Add `allow_oversell` to `consume_fifo`. Replace the method (lines ~132-194):

```python
    def consume_fifo(
        self,
        product: Product,
        quantity: Decimal,
        consumer_type: str,
        consumer_id: int,
        sale_item_id: Optional[int],
        user_id: int,
        reason: Optional[str],
        reference_type: Optional[str],
        reference_id: Optional[int],
        allow_oversell: bool = False,
    ) -> InventoryConsumption:
        """Consume ``quantity`` units FIFO, creating one allocation per layer.

        Default (``allow_oversell=False``): all-or-nothing — raises ValueError
        if available layer stock is insufficient. Sync path (``allow_oversell=
        True``): consumes all available layers at their real FIFO cost, values
        the shortfall at ``product.cost_price``, drives stock negative, and
        reports ``shortfall_quantity`` / ``available_before`` for a SyncWarning.
        """
        quantity = Decimal(quantity)
        layers = self.repo.lock_available_layers(self.company_id, product.id)

        available = sum((layer.remaining_quantity for layer in layers), Decimal("0"))
        if available < quantity and not allow_oversell:
            raise ValueError(f"Insufficient stock for product '{product.name}'")

        allocations: List[InventoryAllocation] = []
        total_value = Decimal("0")
        remaining_to_consume = quantity

        for layer in layers:
            if remaining_to_consume <= 0:
                break
            take = min(layer.remaining_quantity, remaining_to_consume)
            if take <= 0:
                continue

            layer.remaining_quantity = layer.remaining_quantity - take
            allocation = self.repo.add_allocation(
                company_id=self.company_id,
                product_id=product.id,
                layer_id=layer.id,
                consumer_type=consumer_type,
                consumer_id=consumer_id,
                sale_item_id=sale_item_id,
                quantity=take,
            )
            allocations.append(allocation)
            total_value += take * layer.unit_cost
            remaining_to_consume -= take

        shortfall_quantity = quantity - available if available < quantity else Decimal("0")
        if shortfall_quantity < 0:
            shortfall_quantity = Decimal("0")
        shortfall_value = Decimal("0")
        if shortfall_quantity > 0:
            shortfall_value = (
                shortfall_quantity * Decimal(product.cost_price or 0)
            ).quantize(MONEY_QUANT)

        value = (total_value + shortfall_value).quantize(MONEY_QUANT)

        previous_quantity, new_quantity = self._apply_balance(
            product, -quantity, -value, allow_negative=allow_oversell
        )

        self.repo.create_log(
            company_id=self.company_id,
            product_id=product.id,
            user_id=user_id,
            quantity_change=-quantity,
            value_change=-value,
            previous_quantity=previous_quantity,
            new_quantity=new_quantity,
            reason=reason,
            reference_type=reference_type,
            reference_id=reference_id,
        )
        self.db.flush()
        return InventoryConsumption(
            allocations=allocations,
            value=value,
            shortfall_quantity=shortfall_quantity,
            available_before=available,
        )
```

- [ ] Run it and see it PASS:
  - Command: `.venv\Scripts\pytest.exe tests/unit/test_inventory_ledger_oversell.py -v`
  - Expected: `2 passed`.
- [ ] Run the compile gate and the full suite to confirm no ledger caller regressed:
  - Command: `.venv\Scripts\python.exe -m compileall api core models repositories schemas services main.py`
  - Command: `.venv\Scripts\pytest.exe tests/integration tests/unit`
  - Expected: compile OK, all pre-existing tests still pass (defaults unchanged).
- [ ] Commit:
  - `git add sellary-backend/services/inventory_ledger_service.py sellary-backend/tests/unit/test_inventory_ledger_oversell.py`
  - `git commit -m "feat(inventory): add opt-in allow_oversell/allow_negative to FIFO ledger (C1)"`

---

## Task 3: C1 (part 2) — wire oversell tolerance into the sync path + online-strictness regression

`SyncService._create_sale` opts into `allow_oversell=True` and returns `status="synced"` with `SyncWarning`s instead of `failed` on shortfall. Online `POST /api/sales` (via `SaleService`, default path) stays strict — asserted by a regression test.

**Files:**
- Modify: `sellary-backend/services/sync_service.py` (imports ~line 21-28; `_create_sale` consume loop ~line 287-323)
- Test: `sellary-backend/tests/integration/test_sync_oversell.py` (Create)

- [ ] Write the failing integration test. Create `sellary-backend/tests/integration/test_sync_oversell.py`:

```python
"""C1: sync path tolerates oversell; online POST /api/sales stays strict."""
from datetime import datetime, timezone
from decimal import Decimal

import pytest

from tests.conftest import create_auth_headers


def _oversell_payload(product_id, qty="150.000"):
    return {
        "sales": [
            {
                "client_sale_id": "off-oversell-1",
                "idempotency_key": "ik-oversell-1",
                "created_at_client": datetime.now(timezone.utc).isoformat(),
                "payment_method": "cash",
                "discount_amount": "0.00",
                "paid_amount": "0.00",
                "change_amount": "0.00",
                "items": [
                    {"product_id": product_id, "quantity": qty, "sell_price": "15.00"}
                ],
            }
        ]
    }


class TestSyncOversellTolerant:
    def test_sync_oversell_returns_synced_with_warning(
        self, client, db_session, default_company, cashier_user, test_product
    ):
        # test_product has stock 100; selling 150 oversells by 50.
        headers = create_auth_headers(
            cashier_user.username, cashier_user.id,
            default_company.id, cashier_user.role,
        )
        response = client.post(
            "/api/sync/sales", json=_oversell_payload(test_product.id), headers=headers
        )
        assert response.status_code == 200
        result = response.json()["results"][0]
        assert result["status"] == "synced"
        assert result["sale_id"] is not None
        assert result["warnings"] is not None
        warning = result["warnings"][0]
        assert warning["type"] == "oversell"
        assert warning["product_id"] == test_product.id
        assert Decimal(warning["requested"]) == Decimal("150")
        assert Decimal(warning["available"]) == Decimal("100")
        assert Decimal(warning["new_balance"]) == Decimal("-50")


class TestOnlineSaleStaysStrict:
    def test_online_sale_rejects_oversell(
        self, db_session, default_company, cashier_user, test_product
    ):
        from schemas.sale import PaymentMethod, SaleCreate, SaleItemCreate
        from services.sale_service import SaleService

        service = SaleService(db_session, default_company.id)
        with pytest.raises(ValueError, match="Insufficient stock"):
            service.create(
                SaleCreate(
                    items=[
                        SaleItemCreate(
                            product_id=test_product.id,
                            quantity=Decimal("150"),
                            unit_price=Decimal("15.00"),
                            tax_percent=Decimal("0.00"),
                        )
                    ],
                    payment_method=PaymentMethod.CASH,
                ),
                cashier_user.id,
            )
```

- [ ] Run it and see it FAIL:
  - Command: `.venv\Scripts\pytest.exe tests/integration/test_sync_oversell.py -v`
  - Expected FAIL: `TestSyncOversellTolerant` fails with `result["status"] == "failed"` (current `_create_sale` returns failed on oversell). `TestOnlineSaleStaysStrict` should already PASS (proves the default path is untouched).
- [ ] Add the `SyncWarning` import. In `sellary-backend/services/sync_service.py`, extend the `from schemas.sync import (...)` block (line ~21-28) to include `SyncWarning`:

```python
from schemas.sync import (
    SyncBootstrapResponse,
    SyncProductItem,
    SyncSaleCreate,
    SyncSaleResult,
    SyncSalesRequest,
    SyncSalesResponse,
    SyncWarning,
)
```

- [ ] Opt into oversell and collect warnings. In `_create_sale`, replace the FIFO consume block (the `ledger = InventoryLedgerService(...)` through the `return SyncSaleResult(...)` at the end of the method, lines ~287-323):

```python
        ledger = InventoryLedgerService(self.db, company.id)
        warnings: list[SyncWarning] = []
        try:
            with self.db.begin_nested():
                created_sale = self.sale_repo.create(sale, items)
                for item in items:
                    product = product_map[item.product_id]
                    consumption = ledger.consume_fifo(
                        product=product,
                        quantity=item.quantity,
                        consumer_type="sale_item",
                        consumer_id=item.id,
                        sale_item_id=item.id,
                        user_id=user.id,
                        reason=f"Sale #{created_sale.id}",
                        reference_type="sale",
                        reference_id=created_sale.id,
                        # Offline sales are immutable historical facts: record
                        # them even when they exceed available stock. Online
                        # POST /api/sales keeps the default (allow_oversell=False).
                        allow_oversell=True,
                    )
                    item.cost_total_at_sale = consumption.value.quantize(
                        Decimal("0.01")
                    )
                    item.unit_cost_at_sale = (
                        consumption.value / item.quantity
                    ).quantize(Decimal("0.01"))
                    if consumption.shortfall_quantity > 0:
                        warnings.append(
                            SyncWarning(
                                type="oversell",
                                product_id=product.id,
                                product_name=product.name,
                                requested=item.quantity,
                                available=consumption.available_before,
                                new_balance=product.stock_quantity,
                            )
                        )
        except ValueError as exc:
            # Genuinely bad rows only (e.g. negative total). Oversell no longer
            # raises because allow_oversell=True above.
            return SyncSaleResult(
                client_sale_id=sale_create.client_sale_id,
                status="failed",
                error=str(exc),
            )

        self.db.flush()

        return SyncSaleResult(
            client_sale_id=sale_create.client_sale_id,
            status="synced",
            sale_id=created_sale.id,
            warnings=warnings or None,
        )
```

- [ ] Run it and see it PASS:
  - Command: `.venv\Scripts\pytest.exe tests/integration/test_sync_oversell.py -v`
  - Expected: `2 passed`.
- [ ] Run the full sync suite to confirm the existing sync tests (including missing-product `failed`, idempotency `duplicate`) still pass:
  - Command: `.venv\Scripts\pytest.exe tests/integration/test_sync_endpoints.py tests/integration/test_sync_oversell.py -v`
  - Expected: all pass. Note `test_sync_sales_missing_product` still returns `failed` (product-not-found short-circuits before `_create_sale`), proving genuinely-bad rows are unaffected.
- [ ] Commit:
  - `git add sellary-backend/services/sync_service.py sellary-backend/tests/integration/test_sync_oversell.py`
  - `git commit -m "feat(sync): tolerate oversell on sync path, populate SyncWarning; online stays strict (C1)"`

---

## Task 4: C2 (part 1) — config default + `CashierDevice` model

**Files:**
- Modify: `sellary-backend/core/config.py` (Sync section ~line 67-73)
- Create: `sellary-backend/models/cashier_device.py`
- Modify: `sellary-backend/models/__init__.py`

- [ ] Add the config default. In `sellary-backend/core/config.py`, immediately after the `SYNC_ALLOW_OVERSELL: bool = True` line (~line 73), add:

```python

    # Cashier device auth: opaque device_token lifetime, sliding-renewed on every
    # /api/auth/devices/refresh. Additive default; the minted access_token is the
    # unchanged 24h ACCESS_TOKEN_EXPIRE_MINUTES JWT.
    DEVICE_TOKEN_EXPIRE_DAYS: int = 180
```

- [ ] Create the model. Write `sellary-backend/models/cashier_device.py`:

```python
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlalchemy.sql import func

from core.database import Base


class CashierDevice(Base):
    """A registered offline-first cashier device (one active per shop).

    The device_token itself is never stored: only its sha256 hex digest
    (``token_hash``) is persisted so the credential is revocable and
    constant-time-verifiable. ``is_active`` is the single kill-switch.
    """

    __tablename__ = "cashier_devices"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    device_id = Column(String(64), nullable=False, unique=True, index=True)
    name = Column(String(100), nullable=True)
    token_hash = Column(String(64), nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    last_seen_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    __table_args__ = (
        Index("ix_cashier_devices_company_active", "company_id", "is_active"),
    )
```

- [ ] Register the model so `Base.metadata` (tests) and `alembic env` (`from models import *`) both see it. In `sellary-backend/models/__init__.py`, add the import after the `InventoryLayer` import line and add `"CashierDevice"` to `__all__`:

```python
from .inventory_layer import InventoryLayer, InventoryAllocation
from .cashier_device import CashierDevice
```

  and in the `__all__` list add:

```python
    "CashierDevice",
```

- [ ] Run the compile gate + confirm the model imports and the table registers:
  - Command: `.venv\Scripts\python.exe -m compileall api core models repositories schemas services main.py`
  - Command: `.venv\Scripts\python.exe -c "from models import CashierDevice; from core.database import Base; assert 'cashier_devices' in Base.metadata.tables; print('ok')"`
  - Expected: `ok`.
- [ ] Commit:
  - `git add sellary-backend/core/config.py sellary-backend/models/cashier_device.py sellary-backend/models/__init__.py`
  - `git commit -m "feat(auth): add CashierDevice model + DEVICE_TOKEN_EXPIRE_DAYS config (C2)"`

---

## Task 5: C2 (part 2) — device schemas + repository

**Files:**
- Create: `sellary-backend/schemas/device.py`
- Create: `sellary-backend/repositories/cashier_device_repository.py`

- [ ] Create the schemas. Write `sellary-backend/schemas/device.py`:

```python
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class DeviceRegisterRequest(BaseModel):
    # Optional stable per-install UUID from the cashier; server generates one if
    # absent. Passing an existing device_id rotates that row (self-healing).
    name: Optional[str] = None
    device_id: Optional[str] = None


class DeviceRegisterResponse(BaseModel):
    device_id: str
    device_token: str  # plaintext — returned exactly once
    name: Optional[str] = None
    expires_at: Optional[datetime] = None


class DeviceRefreshRequest(BaseModel):
    device_id: str
    device_token: str


class DeviceRefreshResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: Optional[datetime] = None  # new (sliding-renewed) device-token expiry


class DeviceListItem(BaseModel):
    id: int
    device_id: str
    name: Optional[str] = None
    is_active: bool
    expires_at: Optional[datetime] = None
    last_seen_at: Optional[datetime] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True
```

- [ ] Create the repository. Write `sellary-backend/repositories/cashier_device_repository.py`:

```python
from typing import List, Optional

from sqlalchemy.orm import Session

from models.cashier_device import CashierDevice


class CashierDeviceRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_device_id(self, device_id: str) -> Optional[CashierDevice]:
        return (
            self.db.query(CashierDevice)
            .filter(CashierDevice.device_id == device_id)
            .first()
        )

    def get_active_by_company(self, company_id: int) -> List[CashierDevice]:
        return (
            self.db.query(CashierDevice)
            .filter(
                CashierDevice.company_id == company_id,
                CashierDevice.is_active == True,  # noqa: E712
            )
            .all()
        )

    def list_by_company(self, company_id: int) -> List[CashierDevice]:
        return (
            self.db.query(CashierDevice)
            .filter(CashierDevice.company_id == company_id)
            .order_by(CashierDevice.created_at.desc())
            .all()
        )

    def add(self, device: CashierDevice) -> CashierDevice:
        self.db.add(device)
        self.db.flush()
        return device
```

- [ ] Run the compile gate:
  - Command: `.venv\Scripts\python.exe -m compileall api core models repositories schemas services main.py`
  - Expected: compile OK.
- [ ] Commit:
  - `git add sellary-backend/schemas/device.py sellary-backend/repositories/cashier_device_repository.py`
  - `git commit -m "feat(auth): add device-auth schemas + repository (C2)"`

---

## Task 6: C2 (part 3) — `DeviceAuthService` (register / refresh / revoke / list)

Business logic: hash tokens with sha256, compare constant-time, re-check membership on refresh, mint a standard 24h `access_token`, enforce 1-device/shop, sliding-renew the device expiry.

**Files:**
- Create: `sellary-backend/services/device_auth_service.py`

- [ ] Create the service. Write `sellary-backend/services/device_auth_service.py`:

```python
"""Device-auth business logic for the offline-first cashier (C2).

The device credential is an opaque ``secrets.token_urlsafe(48)`` string stored
only as its sha256 hex digest. ``/refresh`` verifies it in constant time, re-
checks the pinned membership (same invariant as ``get_auth_context``), and mints
a normal ``token_type="access"`` 24h JWT that every protected endpoint accepts.
"""
import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from core.config import settings
from core.security import create_access_token
from models.cashier_device import CashierDevice
from models.company_membership import CompanyMembership
from repositories.cashier_device_repository import CashierDeviceRepository


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _as_aware_utc(dt: datetime) -> datetime:
    """Normalise a possibly-naive stored datetime to aware UTC for comparison."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


class DeviceAuthError(Exception):
    """Carries an HTTP status + detail for the router to surface."""

    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


class DeviceAuthService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = CashierDeviceRepository(db)

    def register(
        self,
        company_id: int,
        user_id: int,
        name: Optional[str],
        device_id: Optional[str],
    ) -> Tuple[CashierDevice, str]:
        """Register (or self-heal re-register) the shop's single cashier device.

        Deactivates any prior active device for the company (1-device/shop),
        then rotates the row that matches ``device_id`` if it exists, else
        inserts a new one. Returns ``(device, plaintext_token)``.
        """
        for existing in self.repo.get_active_by_company(company_id):
            existing.is_active = False

        token = secrets.token_urlsafe(48)
        token_hash = _hash_token(token)
        expires_at = datetime.now(timezone.utc) + timedelta(
            days=settings.DEVICE_TOKEN_EXPIRE_DAYS
        )

        device = self.repo.get_by_device_id(device_id) if device_id else None
        if device is not None:
            device.company_id = company_id
            device.user_id = user_id
            device.name = name
            device.token_hash = token_hash
            device.is_active = True
            device.expires_at = expires_at
            device.created_by_user_id = user_id
            self.db.flush()
        else:
            device = CashierDevice(
                company_id=company_id,
                user_id=user_id,
                device_id=device_id or str(uuid.uuid4()),
                name=name,
                token_hash=token_hash,
                is_active=True,
                expires_at=expires_at,
                created_by_user_id=user_id,
            )
            self.repo.add(device)
        return device, token

    def refresh(self, device_id: str, device_token: str) -> Tuple[str, datetime]:
        """Verify the device credential and mint a fresh 24h access_token.

        Raises DeviceAuthError(401) for a bad/inactive/expired token and
        DeviceAuthError(403) if the pinned membership was revoked while offline.
        Returns ``(access_token, new_device_expiry)``.
        """
        device = self.repo.get_by_device_id(device_id)
        provided_hash = _hash_token(device_token)
        # Constant-time compare even when the device is missing (no timing oracle).
        stored_hash = device.token_hash if device is not None else "0" * 64
        token_ok = hmac.compare_digest(provided_hash, stored_hash)
        if device is None or not token_ok or not device.is_active:
            raise DeviceAuthError(401, "Invalid device credentials")

        now = datetime.now(timezone.utc)
        if device.expires_at is not None and _as_aware_utc(device.expires_at) < now:
            raise DeviceAuthError(401, "Device token expired")

        membership = (
            self.db.query(CompanyMembership)
            .filter(
                CompanyMembership.user_id == device.user_id,
                CompanyMembership.company_id == device.company_id,
                CompanyMembership.is_active == True,  # noqa: E712
            )
            .first()
        )
        if (
            membership is None
            or membership.company is None
            or not membership.company.is_active
            or membership.user is None
            or not membership.user.is_active
        ):
            raise DeviceAuthError(403, "Device membership revoked")

        access_token = create_access_token(
            data={
                "sub": membership.user.username,
                "user_id": device.user_id,
                "company_id": device.company_id,
                "role": membership.role,
                "global_role": membership.user.global_role,
                # Additive claim that existing decoders ignore.
                "device_id": device.device_id,
            },
            expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
        )
        device.last_seen_at = now
        device.expires_at = now + timedelta(days=settings.DEVICE_TOKEN_EXPIRE_DAYS)
        self.db.flush()
        return access_token, device.expires_at

    def revoke(self, company_id: int, device_id: str) -> CashierDevice:
        device = self.repo.get_by_device_id(device_id)
        if device is None or device.company_id != company_id:
            raise DeviceAuthError(404, "Device not found")
        device.is_active = False
        self.db.flush()
        return device

    def list_devices(self, company_id: int) -> List[CashierDevice]:
        return self.repo.list_by_company(company_id)
```

- [ ] Run the compile gate:
  - Command: `.venv\Scripts\python.exe -m compileall api core models repositories schemas services main.py`
  - Expected: compile OK.
- [ ] Commit:
  - `git add sellary-backend/services/device_auth_service.py`
  - `git commit -m "feat(auth): add DeviceAuthService (register/refresh/revoke/list) (C2)"`

---

## Task 7: C2 (part 4) — router `api/device_auth.py`, wiring, and endpoint tests

**Files:**
- Create: `sellary-backend/api/device_auth.py`
- Modify: `sellary-backend/api/__init__.py`
- Modify: `sellary-backend/main.py` (imports ~line 11-25; router includes ~line 70-82)
- Test: `sellary-backend/tests/integration/test_device_auth.py` (Create)

- [ ] Write the failing integration test. Create `sellary-backend/tests/integration/test_device_auth.py`:

```python
"""Integration tests for the cashier device-auth endpoints (C2)."""
from datetime import datetime, timedelta, timezone

from core.security import decode_access_token
from tests.conftest import create_auth_headers


def _register(client, headers, name="Kassa 1", device_id=None):
    body = {"name": name}
    if device_id is not None:
        body["device_id"] = device_id
    return client.post("/api/auth/devices/register", json=body, headers=headers)


class TestDeviceRegister:
    def test_cashier_can_self_register_and_get_token_once(
        self, client, db_session, default_company, cashier_user
    ):
        headers = create_auth_headers(
            cashier_user.username, cashier_user.id,
            default_company.id, cashier_user.role,
        )
        resp = _register(client, headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["device_id"]
        assert data["device_token"]  # plaintext, once
        assert data["expires_at"] is not None

    def test_register_enforces_one_device_per_shop(
        self, client, db_session, default_company, cashier_user
    ):
        from models.cashier_device import CashierDevice

        headers = create_auth_headers(
            cashier_user.username, cashier_user.id,
            default_company.id, cashier_user.role,
        )
        first = _register(client, headers).json()
        _register(client, headers)  # second registration

        active = (
            db_session.query(CashierDevice)
            .filter(
                CashierDevice.company_id == default_company.id,
                CashierDevice.is_active == True,  # noqa: E712
            )
            .all()
        )
        assert len(active) == 1
        first_row = (
            db_session.query(CashierDevice)
            .filter(CashierDevice.device_id == first["device_id"])
            .one()
        )
        assert first_row.is_active is False


class TestDeviceRefresh:
    def test_refresh_mints_access_token_and_slides_expiry(
        self, client, db_session, default_company, cashier_user
    ):
        from models.cashier_device import CashierDevice

        headers = create_auth_headers(
            cashier_user.username, cashier_user.id,
            default_company.id, cashier_user.role,
        )
        reg = _register(client, headers).json()

        resp = client.post(
            "/api/auth/devices/refresh",
            json={"device_id": reg["device_id"], "device_token": reg["device_token"]},
        )
        assert resp.status_code == 200
        data = resp.json()
        payload = decode_access_token(data["access_token"])
        assert payload is not None
        assert payload["token_type"] == "access"
        assert payload["user_id"] == cashier_user.id
        assert payload["company_id"] == default_company.id
        assert payload["role"] == "cashier"
        assert payload["device_id"] == reg["device_id"]

        row = (
            db_session.query(CashierDevice)
            .filter(CashierDevice.device_id == reg["device_id"])
            .one()
        )
        assert row.last_seen_at is not None

    def test_refresh_rejects_bad_token(
        self, client, db_session, default_company, cashier_user
    ):
        headers = create_auth_headers(
            cashier_user.username, cashier_user.id,
            default_company.id, cashier_user.role,
        )
        reg = _register(client, headers).json()
        resp = client.post(
            "/api/auth/devices/refresh",
            json={"device_id": reg["device_id"], "device_token": "wrong-token"},
        )
        assert resp.status_code == 401

    def test_refresh_rejects_inactive_device(
        self, client, db_session, default_company, cashier_user
    ):
        from models.cashier_device import CashierDevice

        headers = create_auth_headers(
            cashier_user.username, cashier_user.id,
            default_company.id, cashier_user.role,
        )
        reg = _register(client, headers).json()
        row = (
            db_session.query(CashierDevice)
            .filter(CashierDevice.device_id == reg["device_id"])
            .one()
        )
        row.is_active = False
        db_session.flush()
        resp = client.post(
            "/api/auth/devices/refresh",
            json={"device_id": reg["device_id"], "device_token": reg["device_token"]},
        )
        assert resp.status_code == 401

    def test_refresh_rejects_expired_device(
        self, client, db_session, default_company, cashier_user
    ):
        from models.cashier_device import CashierDevice

        headers = create_auth_headers(
            cashier_user.username, cashier_user.id,
            default_company.id, cashier_user.role,
        )
        reg = _register(client, headers).json()
        row = (
            db_session.query(CashierDevice)
            .filter(CashierDevice.device_id == reg["device_id"])
            .one()
        )
        row.expires_at = datetime.now(timezone.utc) - timedelta(days=1)
        db_session.flush()
        resp = client.post(
            "/api/auth/devices/refresh",
            json={"device_id": reg["device_id"], "device_token": reg["device_token"]},
        )
        assert resp.status_code == 401

    def test_refresh_rejects_revoked_membership_with_403(
        self, client, db_session, default_company, cashier_user
    ):
        from models.company_membership import CompanyMembership

        headers = create_auth_headers(
            cashier_user.username, cashier_user.id,
            default_company.id, cashier_user.role,
        )
        reg = _register(client, headers).json()
        membership = (
            db_session.query(CompanyMembership)
            .filter(
                CompanyMembership.user_id == cashier_user.id,
                CompanyMembership.company_id == default_company.id,
            )
            .one()
        )
        membership.is_active = False
        db_session.flush()
        resp = client.post(
            "/api/auth/devices/refresh",
            json={"device_id": reg["device_id"], "device_token": reg["device_token"]},
        )
        assert resp.status_code == 403

    def test_refresh_rate_limited(
        self, client, db_session, default_company, cashier_user, monkeypatch
    ):
        import api.device_auth as device_auth_module

        headers = create_auth_headers(
            cashier_user.username, cashier_user.id,
            default_company.id, cashier_user.role,
        )
        reg = _register(client, headers).json()
        monkeypatch.setattr(
            device_auth_module.login_rate_limiter, "is_rate_limited", lambda key: True
        )
        resp = client.post(
            "/api/auth/devices/refresh",
            json={"device_id": reg["device_id"], "device_token": reg["device_token"]},
        )
        assert resp.status_code == 429


class TestDeviceRevokeAndList:
    def test_admin_can_revoke_and_list(
        self, client, db_session, default_company, admin_user, cashier_user
    ):
        cashier_headers = create_auth_headers(
            cashier_user.username, cashier_user.id,
            default_company.id, cashier_user.role,
        )
        reg = _register(client, cashier_headers).json()

        admin_headers = create_auth_headers(
            admin_user.username, admin_user.id,
            default_company.id, admin_user.role,
        )
        listed = client.get("/api/auth/devices", headers=admin_headers)
        assert listed.status_code == 200
        assert any(d["device_id"] == reg["device_id"] for d in listed.json())

        revoked = client.delete(
            f"/api/auth/devices/{reg['device_id']}", headers=admin_headers
        )
        assert revoked.status_code == 200

        # Refresh now fails because the device is inactive.
        after = client.post(
            "/api/auth/devices/refresh",
            json={"device_id": reg["device_id"], "device_token": reg["device_token"]},
        )
        assert after.status_code == 401

    def test_cashier_cannot_revoke(
        self, client, db_session, default_company, cashier_user
    ):
        headers = create_auth_headers(
            cashier_user.username, cashier_user.id,
            default_company.id, cashier_user.role,
        )
        reg = _register(client, headers).json()
        resp = client.delete(
            f"/api/auth/devices/{reg['device_id']}", headers=headers
        )
        assert resp.status_code == 403
```

- [ ] Run it and see it FAIL:
  - Command: `.venv\Scripts\pytest.exe tests/integration/test_device_auth.py -v`
  - Expected FAIL: `404 Not Found` on every request (router not registered yet).
- [ ] Create the router. Write `sellary-backend/api/device_auth.py`:

```python
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from api.dependencies import (
    AuthContext,
    get_auth_context,
    require_manager_or_admin,
)
from core.database import get_db
from core.rate_limiter import login_rate_limiter
from schemas.device import (
    DeviceListItem,
    DeviceRefreshRequest,
    DeviceRefreshResponse,
    DeviceRegisterRequest,
    DeviceRegisterResponse,
)
from services.device_auth_service import DeviceAuthError, DeviceAuthService

router = APIRouter(prefix="/auth/devices", tags=["devices"])


def _client_ip(request: Request) -> str:
    return (
        request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or (request.client.host if request.client else "unknown")
    )


@router.post("/register", response_model=DeviceRegisterResponse)
def register_device(
    body: DeviceRegisterRequest,
    request: Request,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    # Any authenticated company member may self-register on first run.
    if login_rate_limiter.is_rate_limited(_client_ip(request)):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests",
        )
    service = DeviceAuthService(db)
    device, token = service.register(
        auth.company_id, auth.user.id, body.name, body.device_id
    )
    db.commit()
    return DeviceRegisterResponse(
        device_id=device.device_id,
        device_token=token,
        name=device.name,
        expires_at=device.expires_at,
    )


@router.post("/refresh", response_model=DeviceRefreshResponse)
def refresh_device(
    body: DeviceRefreshRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    # NO bearer: this is the offline-return call. Rate-limit by device_id + IP.
    if login_rate_limiter.is_rate_limited(f"device:{body.device_id}:{_client_ip(request)}"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests",
        )
    service = DeviceAuthService(db)
    try:
        access_token, expires_at = service.refresh(body.device_id, body.device_token)
    except DeviceAuthError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)
    db.commit()
    return DeviceRefreshResponse(
        access_token=access_token, token_type="bearer", expires_at=expires_at
    )


@router.delete("/{device_id}")
def revoke_device(
    device_id: str,
    auth: AuthContext = Depends(require_manager_or_admin),
    db: Session = Depends(get_db),
):
    service = DeviceAuthService(db)
    try:
        service.revoke(auth.company_id, device_id)
    except DeviceAuthError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)
    db.commit()
    return {"message": "Device revoked"}


@router.get("", response_model=list[DeviceListItem])
def list_devices(
    auth: AuthContext = Depends(require_manager_or_admin),
    db: Session = Depends(get_db),
):
    service = DeviceAuthService(db)
    return service.list_devices(auth.company_id)
```

- [ ] Export the router. In `sellary-backend/api/__init__.py`, add after the `sync` import line and to `__all__`:

```python
from .sync import router as sync_router
from .device_auth import router as device_auth_router
```

  and in `__all__` add:

```python
    "device_auth_router",
```

- [ ] Register the router in `main.py`. In the `from api import (...)` block (line ~11-25) add `device_auth_router,` after `sync_router,`; then after `app.include_router(sync_router, prefix=settings.API_V1_STR)` (line ~82) add:

```python
    app.include_router(device_auth_router, prefix=settings.API_V1_STR)
```

- [ ] Run it and see it PASS:
  - Command: `.venv\Scripts\pytest.exe tests/integration/test_device_auth.py -v`
  - Expected: all device-auth tests pass.
- [ ] Run the compile gate + full suite:
  - Command: `.venv\Scripts\python.exe -m compileall api core models repositories schemas services main.py`
  - Command: `.venv\Scripts\pytest.exe tests/integration tests/unit`
  - Expected: compile OK, all pass.
- [ ] Commit:
  - `git add sellary-backend/api/device_auth.py sellary-backend/api/__init__.py sellary-backend/main.py sellary-backend/tests/integration/test_device_auth.py`
  - `git commit -m "feat(auth): add /api/auth/devices register/refresh/revoke/list router (C2)"`

---

## Task 8: C3 — `sales.client_sale_id` column, partial unique index, sync assignment, response exposure

**Files:**
- Modify: `sellary-backend/models/sale.py` (imports line ~2; column block ~line 80; add `__table_args__`)
- Modify: `sellary-backend/services/sync_service.py` (`_create_sale` `Sale(...)` construction ~line 265-278)
- Modify: `sellary-backend/schemas/sale.py` (`Sale` model ~line 119, before `class Config`)
- Modify: `sellary-backend/services/sale_service.py` (`_to_response` `SaleResponse(...)` ~line 340)
- Test: `sellary-backend/tests/integration/test_sync_client_sale_id.py` (Create)

- [ ] Write the failing integration test. Create `sellary-backend/tests/integration/test_sync_client_sale_id.py`:

```python
"""C3: sales.client_sale_id persistence, re-sync duplicate, partial unique index."""
from datetime import datetime, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from tests.conftest import create_auth_headers


def _payload(product_id, client_sale_id, idempotency_key):
    return {
        "sales": [
            {
                "client_sale_id": client_sale_id,
                "idempotency_key": idempotency_key,
                "created_at_client": datetime.now(timezone.utc).isoformat(),
                "payment_method": "cash",
                "discount_amount": "0.00",
                "paid_amount": "30.00",
                "change_amount": "0.00",
                "items": [
                    {"product_id": product_id, "quantity": "2.000", "sell_price": "15.00"}
                ],
            }
        ]
    }


class TestClientSaleId:
    def test_client_sale_id_persisted_on_synced_sale(
        self, client, db_session, default_company, cashier_user, test_product
    ):
        from models.sale import Sale

        headers = create_auth_headers(
            cashier_user.username, cashier_user.id,
            default_company.id, cashier_user.role,
        )
        resp = client.post(
            "/api/sync/sales",
            json=_payload(test_product.id, "csid-persist-1", "ik-persist-1"),
            headers=headers,
        )
        sale_id = resp.json()["results"][0]["sale_id"]
        sale = db_session.get(Sale, sale_id)
        assert sale.client_sale_id == "csid-persist-1"

    def test_resync_same_client_sale_id_is_duplicate(
        self, client, db_session, default_company, cashier_user, test_product
    ):
        headers = create_auth_headers(
            cashier_user.username, cashier_user.id,
            default_company.id, cashier_user.role,
        )
        body = _payload(test_product.id, "csid-dup-1", "ik-dup-c3")
        first = client.post("/api/sync/sales", json=body, headers=headers).json()
        second = client.post("/api/sync/sales", json=body, headers=headers).json()
        assert first["results"][0]["status"] == "synced"
        assert second["results"][0]["status"] == "duplicate"
        assert second["results"][0]["sale_id"] == first["results"][0]["sale_id"]

    def test_partial_unique_index_blocks_duplicate_but_allows_nulls(
        self, db_session, default_company, cashier_user, test_product
    ):
        from models.sale import PaymentMethod, Sale, SaleStatus

        def _mk(client_sale_id):
            return Sale(
                company_id=default_company.id,
                cashier_id=cashier_user.id,
                payment_method=PaymentMethod.CASH,
                status=SaleStatus.COMPLETED,
                client_sale_id=client_sale_id,
            )

        # Two NULL client_sale_id rows (the online path) coexist fine.
        db_session.add(_mk(None))
        db_session.add(_mk(None))
        db_session.flush()

        # Two identical non-NULL client_sale_id rows in one company collide.
        db_session.add(_mk("same-csid"))
        db_session.flush()
        db_session.add(_mk("same-csid"))
        with pytest.raises(IntegrityError):
            db_session.flush()
        db_session.rollback()
```

- [ ] Run it and see it FAIL:
  - Command: `.venv\Scripts\pytest.exe tests/integration/test_sync_client_sale_id.py -v`
  - Expected FAIL: `TypeError`/`AttributeError` — `Sale` has no `client_sale_id`, and no unique index exists.
- [ ] Add the column + partial unique index to the model. In `sellary-backend/models/sale.py`:
  - Change the top import (line 2) to include `text`:

```python
from sqlalchemy import Column, Integer, String, Numeric, DateTime, ForeignKey, Enum as SQLEnum, Index, Text, text
```

  - Add the column immediately after the `created_at = Column(...)` line (~line 80):

```python
    # C3: local-origin id from the offline cashier. NULL for online sales; a
    # partial unique index (below) dedupes per company without constraining NULLs.
    client_sale_id = Column(String(64), nullable=True, index=True)
```

  - Add `__table_args__` after the last relationship (after `reversal_operation = relationship("ReversalOperation")`, ~line 92):

```python

    __table_args__ = (
        Index(
            "uq_sales_company_client_sale_id",
            "company_id",
            "client_sale_id",
            unique=True,
            sqlite_where=text("client_sale_id IS NOT NULL"),
            postgresql_where=text("client_sale_id IS NOT NULL"),
        ),
    )
```

- [ ] Set `client_sale_id` when the sync path creates the sale. In `sellary-backend/services/sync_service.py`, in `_create_sale`, add the field to the `Sale(...)` constructor (after `company_id=company.id,`, ~line 266):

```python
            company_id=company.id,
            client_sale_id=sale_create.client_sale_id,
```

- [ ] Expose it optionally on the response schema. In `sellary-backend/schemas/sale.py`, add to the `Sale` model just before `reversal_operation_id: Optional[int] = None` (~line 119):

```python
    # C3: present only for sales that originated on an offline cashier device.
    client_sale_id: Optional[str] = None
```

- [ ] Map it in `_to_response`. In `sellary-backend/services/sale_service.py`, add to the `SaleResponse(...)` call after `reversal_operation_id=sale.reversal_operation_id,` (~line 365):

```python
            reversal_operation_id=sale.reversal_operation_id,
            client_sale_id=getattr(sale, "client_sale_id", None),
```

- [ ] Run it and see it PASS:
  - Command: `.venv\Scripts\pytest.exe tests/integration/test_sync_client_sale_id.py -v`
  - Expected: `3 passed`.
- [ ] Run the compile gate + full suite:
  - Command: `.venv\Scripts\python.exe -m compileall api core models repositories schemas services main.py`
  - Command: `.venv\Scripts\pytest.exe tests/integration tests/unit`
  - Expected: compile OK, all pass (online `_to_response` returns `client_sale_id=None`).
- [ ] Commit:
  - `git add sellary-backend/models/sale.py sellary-backend/services/sync_service.py sellary-backend/schemas/sale.py sellary-backend/services/sale_service.py sellary-backend/tests/integration/test_sync_client_sale_id.py`
  - `git commit -m "feat(sales): add client_sale_id column + partial unique index; sync sets it (C3)"`

---

## Task 9: The ONE Alembic migration (C2 + C3) + Railway pin bump

Single migration off the Railway-pinned live head `b2c3d4e5f6a7`: creates `cashier_devices`, adds `sales.client_sale_id` + its plain index + the partial unique index. **No `alembic merge`** — the dead head `20260319_0001` stays untouched. The pinned rev is bumped in `railway.toml` and `railway.json` in this same commit.

**Files:**
- Create: `sellary-backend/alembic/versions/20260710_0000-c3d4e5f6a7b8_add_cashier_devices_and_sale_client_id.py`
- Test: `sellary-backend/tests/unit/test_migration_chain.py` (Create)
- Modify: `railway.toml` (repo root, line ~9); `sellary-backend/railway.json` (line ~8)

- [ ] Write the failing migration-chain test (no DB needed). Create `sellary-backend/tests/unit/test_migration_chain.py`:

```python
"""Assert the ONE new migration chains off b2c3d4e5f6a7 and the dead head stays."""
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

NEW_REV = "c3d4e5f6a7b8"
LIVE_HEAD = "b2c3d4e5f6a7"
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
    assert LIVE_HEAD not in heads  # b2c3d4e5f6a7 is now superseded by NEW_REV
    assert len(heads) == 2
```

- [ ] Run it and see it FAIL:
  - Command: `.venv\Scripts\pytest.exe tests/unit/test_migration_chain.py -v`
  - Expected FAIL: `KeyError`/`ResolutionError` — revision `c3d4e5f6a7b8` does not exist yet.
- [ ] Create the migration. Write `sellary-backend/alembic/versions/20260710_0000-c3d4e5f6a7b8_add_cashier_devices_and_sale_client_id.py`:

```python
"""add cashier_devices table and sales.client_sale_id

C2: cashier_devices holds one opaque, sha256-hashed, revocable device token per
registered offline cashier device (1 active per shop). C3: sales.client_sale_id
is a nullable local-origin id with a partial unique index that dedupes offline
sales per company without constraining the existing NULL online rows.

Chains off the Railway-pinned live head b2c3d4e5f6a7. The dead 20260319_0001
head is intentionally left untouched (no alembic merge).

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-07-10 00:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c3d4e5f6a7b8"
down_revision: Union[str, None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # C2 — cashier_devices
    op.create_table(
        "cashier_devices",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=True),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_cashier_devices_id", "cashier_devices", ["id"])
    op.create_index("ix_cashier_devices_company_id", "cashier_devices", ["company_id"])
    op.create_index(
        "ix_cashier_devices_device_id", "cashier_devices", ["device_id"], unique=True
    )
    op.create_index(
        "ix_cashier_devices_company_active",
        "cashier_devices",
        ["company_id", "is_active"],
    )

    # C3 — sales.client_sale_id + plain index + partial unique index.
    # NOTE: the sales table is small (retail POS); these DDLs are fast and taken
    # inside the migration transaction, so no CONCURRENTLY / long lock concern.
    op.add_column("sales", sa.Column("client_sale_id", sa.String(length=64), nullable=True))
    op.create_index("ix_sales_client_sale_id", "sales", ["client_sale_id"])
    op.create_index(
        "uq_sales_company_client_sale_id",
        "sales",
        ["company_id", "client_sale_id"],
        unique=True,
        postgresql_where=sa.text("client_sale_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_sales_company_client_sale_id", table_name="sales")
    op.drop_index("ix_sales_client_sale_id", table_name="sales")
    op.drop_column("sales", "client_sale_id")

    op.drop_index("ix_cashier_devices_company_active", table_name="cashier_devices")
    op.drop_index("ix_cashier_devices_device_id", table_name="cashier_devices")
    op.drop_index("ix_cashier_devices_company_id", table_name="cashier_devices")
    op.drop_index("ix_cashier_devices_id", table_name="cashier_devices")
    op.drop_table("cashier_devices")
```

- [ ] Run the chain test and see it PASS:
  - Command: `.venv\Scripts\pytest.exe tests/unit/test_migration_chain.py -v`
  - Expected: `2 passed`.
- [ ] Bump the Railway pin in `sellary-backend/railway.json` — change the `preDeployCommand` (line ~8) from `"alembic upgrade b2c3d4e5f6a7"` to:

```json
    "preDeployCommand": "alembic upgrade c3d4e5f6a7b8",
```

- [ ] Bump the Railway pin in the root `railway.toml` — change the `preDeployCommand` (line ~9) from `alembic upgrade b2c3d4e5f6a7` to:

```toml
preDeployCommand = "alembic upgrade c3d4e5f6a7b8"
```

- [ ] Manual DB round-trip gate (requires a reachable Postgres via `DATABASE_URL`; this is the one step the `compileall` CI gate cannot catch). Run and confirm both directions succeed and the columns/tables appear/disappear:
  - Command: `.venv\Scripts\python.exe -m alembic upgrade c3d4e5f6a7b8`
  - Command: `.venv\Scripts\python.exe -c "from sqlalchemy import create_engine, inspect; from core.config import settings; i=inspect(create_engine(settings.DATABASE_URL)); assert 'cashier_devices' in i.get_table_names(); assert any(c['name']=='client_sale_id' for c in i.get_columns('sales')); print('upgrade ok')"`
  - Command: `.venv\Scripts\python.exe -m alembic downgrade b2c3d4e5f6a7`
  - Command: `.venv\Scripts\python.exe -c "from sqlalchemy import create_engine, inspect; from core.config import settings; i=inspect(create_engine(settings.DATABASE_URL)); assert 'cashier_devices' not in i.get_table_names(); assert not any(c['name']=='client_sale_id' for c in i.get_columns('sales')); print('downgrade ok')"`
  - Command (re-apply so the DB is at head for local dev): `.venv\Scripts\python.exe -m alembic upgrade c3d4e5f6a7b8`
  - Expected: `upgrade ok` then `downgrade ok`, no errors. If no Postgres is available, note this as a pre-merge manual gate.
- [ ] Run the compile gate + full suite once more:
  - Command: `.venv\Scripts\python.exe -m compileall api core models repositories schemas services main.py`
  - Command: `.venv\Scripts\pytest.exe tests/integration tests/unit`
  - Expected: compile OK, all pass.
- [ ] Commit (migration + pin bump together, as required):
  - `git add sellary-backend/alembic/versions/20260710_0000-c3d4e5f6a7b8_add_cashier_devices_and_sale_client_id.py sellary-backend/tests/unit/test_migration_chain.py sellary-backend/railway.json railway.toml`
  - `git commit -m "feat(db): add cashier_devices + sales.client_sale_id migration; bump railway pin to c3d4e5f6a7b8"`

---

## Task 10: Ship the stale-doc fixes (spec §12)

Two stale CLAUDE.md facts directly threaten this work: it says migrations are gitignored (they are **tracked** — the migration file above must be committed) and that online overselling is allowed (online now **rejects**; only the sync path tolerates).

**Files:**
- Modify: `D:/Learning/Sellary/CLAUDE.md`

- [ ] Fix the "migrations gitignored" line. Locate the sentence containing `Alembic migrations (\`alembic/versions/*.py\`) and all \`.env\` files are gitignored.` and replace it with:

```
- **Alembic migrations (`alembic/versions/*.py`) are tracked (committed); all `.env` files are gitignored.** Commit generated migrations; copy config from the `.env.example` files.
```

  (Replace the existing bullet that currently combines both claims; keep the `.env.example` guidance.)

- [ ] Fix the "online overselling allowed" line. Locate the sentence containing `Stock overselling is intentionally allowed in \`services/sale_service.py\`` and replace the bullet with:

```
- **Online `POST /api/sales` rejects oversell** — the FIFO ledger in `services/inventory_ledger_service.py` cannot back negative stock (`consume_fifo` raises `Insufficient stock`). Only the offline **sync path** (`services/sync_service.py`, `allow_oversell=True`) tolerates oversell, recording it as a historical fact with a `SyncWarning`.
```

- [ ] Verify the edits landed and no other file references the stale claims that would now be wrong:
  - Command: `.venv\Scripts\pytest.exe tests/integration tests/unit`  (sanity: nothing broke)
  - Grep check (informational): `git grep -n "overselling is intentionally allowed" ../ || echo "no stale oversell claim remains"`
  - Expected: the stale phrase is gone from CLAUDE.md (AGENTS.md may still reference it; note it for a follow-up but it is out of scope for this backend plan).
- [ ] Commit:
  - `git add ../CLAUDE.md`
  - `git commit -m "docs: correct migrations-tracked and online-oversell-rejected facts (spec §12)"`

---

## Final verification

- [ ] Full suite green: `.venv\Scripts\pytest.exe tests/integration tests/unit`
- [ ] CI compile gate green: `.venv\Scripts\python.exe -m compileall api core models repositories schemas services main.py`
- [ ] Migration heads sane: `.venv\Scripts\python.exe -m alembic heads` shows `c3d4e5f6a7b8 (head)` and `20260319_0001 (head)` (two heads; the dead one untouched).
- [ ] Both Railway pins read `c3d4e5f6a7b8` (`git grep -n "c3d4e5f6a7b8" ../railway.toml railway.json`).
