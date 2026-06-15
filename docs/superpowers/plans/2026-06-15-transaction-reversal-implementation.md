# Transaction Reversal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin-only, audit-preserving sale and purchase annulment that reverses stock and valuation effects without deleting posted transactions.

**Architecture:** Introduce an immutable receipt/layer/allocation ledger beside the existing fast product balance. Every new stock mutation updates `products.stock_quantity`, `products.inventory_value`, an inventory log, and ledger lineage in one transaction. A focused reversal service previews and executes sale or purchase annulment, while the frontend exposes Russian admin-only dialogs and blocker details.

**Tech Stack:** FastAPI, SQLAlchemy 2, PostgreSQL, Alembic, Pydantic 2, pytest, Next.js 15 App Router, React 18, TypeScript, TanStack Query, Vitest, Testing Library, Playwright CLI.

---

## Scope And File Map

### Backend files to create

- `sellary-backend/models/reversal_operation.py` — immutable admin reversal audit record.
- `sellary-backend/models/purchase_receipt.py` — purchase receipt header and receipt line models.
- `sellary-backend/models/inventory_layer.py` — stock provenance layers and outgoing allocations.
- `sellary-backend/repositories/inventory_ledger_repository.py` — deterministic row locks and ledger persistence queries.
- `sellary-backend/services/inventory_ledger_service.py` — stock quantity/value mutation, FIFO consume, and allocation release rules.
- `sellary-backend/services/transaction_reversal_service.py` — sale/purchase preview and annulment orchestration.
- `sellary-backend/schemas/reversal.py` — reason, preview, blocker, impact, and result contracts.
- `sellary-backend/tests/unit/test_inventory_ledger_service.py` — quantity/value/layer invariants.
- `sellary-backend/tests/unit/test_transaction_reversal_service.py` — reversal business behavior and legacy safeguards.
- `sellary-backend/tests/integration/test_transaction_reversal_endpoints.py` — auth, idempotency, tenant, and HTTP contracts.
- `sellary-backend/alembic/versions/20260615_1200-7e3f1c9a4b20_add_transaction_reversal_ledger.py` — reviewed deploy migration and opening-balance backfill.

### Backend files to modify

- `sellary-backend/models/__init__.py`
- `sellary-backend/models/company.py`
- `sellary-backend/models/product.py`
- `sellary-backend/models/inventory_log.py`
- `sellary-backend/models/sale.py`
- `sellary-backend/models/sale_item.py`
- `sellary-backend/models/purchase_order.py`
- `sellary-backend/models/purchase_order_item.py`
- `sellary-backend/schemas/sale.py`
- `sellary-backend/schemas/purchase_order.py`
- `sellary-backend/schemas/inventory_log.py`
- `sellary-backend/repositories/inventory_repository.py`
- `sellary-backend/repositories/product_repository.py`
- `sellary-backend/repositories/sale_repository.py`
- `sellary-backend/repositories/purchase_order_repository.py`
- `sellary-backend/services/inventory_service.py`
- `sellary-backend/services/product_service.py`
- `sellary-backend/services/sale_service.py`
- `sellary-backend/services/sale_return_service.py`
- `sellary-backend/services/purchase_order_service.py`
- `sellary-backend/services/sync_service.py`
- `sellary-backend/services/report_service.py`
- `sellary-backend/api/sales.py`
- `sellary-backend/api/products.py`
- `sellary-backend/api/purchase_orders.py`
- `sellary-backend/core/state_machine.py`
- existing backend tests touched by changed cancellation and stock behavior.
- `sellary-backend/tests/conftest.py`

### Frontend files to create

- `sellary-frontend/src/components/transactions/AnnulmentDialog.tsx` — reusable Russian confirmation/preview dialog.
- `sellary-frontend/src/components/transactions/__tests__/AnnulmentDialog.test.tsx`
- `sellary-frontend/src/app/(protected)/sales/__tests__/page.test.tsx`
- `sellary-frontend/src/app/(protected)/purchase-orders/[id]/__tests__/page.test.tsx`

### Frontend files to modify

- `sellary-frontend/src/lib/types.ts`
- `sellary-frontend/src/lib/api.ts`
- `sellary-frontend/src/app/(protected)/sales/page.tsx`
- `sellary-frontend/src/app/(protected)/purchase-orders/[id]/page.tsx`
- `sellary-frontend/src/components/purchase-orders/PurchaseOrderStatusBadge.tsx`

### Explicitly out of scope

- Do not stage or modify the existing local change in `sellary-backend/railway.json`.
- Do not stage `.codex-remote-attachments/` or `.superpowers/`.
- Do not add Training Mode in this implementation.

---

## Task 1: Add Ledger And Reversal Schema

**Files:**
- Create: `sellary-backend/models/reversal_operation.py`
- Create: `sellary-backend/models/purchase_receipt.py`
- Create: `sellary-backend/models/inventory_layer.py`
- Create: `sellary-backend/alembic/versions/20260615_1200-7e3f1c9a4b20_add_transaction_reversal_ledger.py`
- Modify: `sellary-backend/models/company.py`
- Modify: `sellary-backend/models/product.py`
- Modify: `sellary-backend/models/inventory_log.py`
- Modify: `sellary-backend/models/sale.py`
- Modify: `sellary-backend/models/sale_item.py`
- Modify: `sellary-backend/models/purchase_order.py`
- Modify: `sellary-backend/models/purchase_order_item.py`
- Modify: `sellary-backend/models/__init__.py`
- Test: `sellary-backend/tests/unit/test_inventory_ledger_service.py`

- [ ] **Step 1: Write a failing metadata test**

Add tests that assert the new tables and audit columns exist in SQLAlchemy metadata:

```python
from core.database import Base


def test_transaction_reversal_tables_are_registered():
    expected = {
        "reversal_operations",
        "purchase_receipts",
        "purchase_receipt_items",
        "inventory_layers",
        "inventory_allocations",
    }
    assert expected.issubset(Base.metadata.tables)


def test_products_track_inventory_value():
    columns = Base.metadata.tables["products"].c
    assert "inventory_value" in columns
```

- [ ] **Step 2: Run the metadata test and confirm RED**

Run from `sellary-backend`:

```powershell
.venv\Scripts\pytest.exe tests/unit/test_inventory_ledger_service.py -v
```

Expected: FAIL because the new tables and `products.inventory_value` do not exist.

- [ ] **Step 3: Add model definitions**

Use portable SQLAlchemy `JSON` and string operation types, avoiding new PostgreSQL enum types:

```python
# models/reversal_operation.py
from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, JSON, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from core.database import Base


class ReversalOperation(Base):
    __tablename__ = "reversal_operations"
    __table_args__ = (
        Index("ix_reversal_company_entity", "company_id", "entity_type", "entity_id"),
    )

    id = Column(Integer, primary_key=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    entity_type = Column(String(40), nullable=False)
    entity_id = Column(Integer, nullable=False)
    operation_type = Column(String(40), nullable=False)
    reason = Column(Text, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    impact = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    company = relationship("Company", back_populates="reversal_operations")
    user = relationship("User")
```

```python
# models/purchase_receipt.py
class PurchaseReceipt(Base):
    __tablename__ = "purchase_receipts"
    id = Column(Integer, primary_key=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    purchase_order_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    reversal_operation_id = Column(Integer, ForeignKey("reversal_operations.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    reversed_at = Column(DateTime(timezone=True), nullable=True)
    items = relationship("PurchaseReceiptItem", cascade="all, delete-orphan", back_populates="receipt")
    purchase_order = relationship("PurchaseOrder", back_populates="receipts")
    user = relationship("User")


class PurchaseReceiptItem(Base):
    __tablename__ = "purchase_receipt_items"
    id = Column(Integer, primary_key=True)
    purchase_receipt_id = Column(Integer, ForeignKey("purchase_receipts.id"), nullable=False, index=True)
    purchase_order_item_id = Column(Integer, ForeignKey("purchase_order_items.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    quantity = Column(Numeric(10, 3), nullable=False)
    unit_cost = Column(Numeric(10, 2), nullable=False)
    receipt = relationship("PurchaseReceipt", back_populates="items")
    purchase_order_item = relationship("PurchaseOrderItem", back_populates="receipt_items")
    product = relationship("Product")
    inventory_layer = relationship("InventoryLayer", back_populates="purchase_receipt_item", uselist=False)
```

```python
# models/inventory_layer.py
class InventoryLayer(Base):
    __tablename__ = "inventory_layers"
    __table_args__ = (
        CheckConstraint("original_quantity >= 0", name="ck_layer_original_nonnegative"),
        CheckConstraint("remaining_quantity >= 0", name="ck_layer_remaining_nonnegative"),
        CheckConstraint("remaining_quantity <= original_quantity", name="ck_layer_remaining_lte_original"),
        Index("ix_layer_fifo", "company_id", "product_id", "created_at", "id"),
    )
    id = Column(Integer, primary_key=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    source_type = Column(String(40), nullable=False)
    source_id = Column(Integer, nullable=True)
    purchase_receipt_item_id = Column(
        Integer,
        ForeignKey("purchase_receipt_items.id"),
        nullable=True,
        unique=True,
        index=True,
    )
    original_quantity = Column(Numeric(10, 3), nullable=False)
    remaining_quantity = Column(Numeric(10, 3), nullable=False)
    unit_cost = Column(Numeric(10, 2), nullable=False)
    reversal_operation_id = Column(Integer, ForeignKey("reversal_operations.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    reversed_at = Column(DateTime(timezone=True), nullable=True)
    purchase_receipt_item = relationship("PurchaseReceiptItem", back_populates="inventory_layer")
    allocations = relationship("InventoryAllocation", back_populates="layer")


class InventoryAllocation(Base):
    __tablename__ = "inventory_allocations"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_allocation_quantity_positive"),
        CheckConstraint("released_quantity >= 0", name="ck_allocation_released_nonnegative"),
        CheckConstraint("released_quantity <= quantity", name="ck_allocation_released_lte_quantity"),
    )
    id = Column(Integer, primary_key=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    layer_id = Column(Integer, ForeignKey("inventory_layers.id"), nullable=False, index=True)
    consumer_type = Column(String(40), nullable=False)
    consumer_id = Column(Integer, nullable=False)
    sale_item_id = Column(Integer, ForeignKey("sale_items.id"), nullable=True, index=True)
    quantity = Column(Numeric(10, 3), nullable=False)
    released_quantity = Column(Numeric(10, 3), nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    layer = relationship("InventoryLayer", back_populates="allocations")
    sale_item = relationship("SaleItem", back_populates="allocations")
```

Add these columns:

```python
# Company
inventory_ledger_started_at = Column(DateTime(timezone=True), nullable=True)

# Product
inventory_value = Column(Numeric(16, 4), nullable=False, default=Decimal("0.0000"))

# Sale and PurchaseOrder
voided_at = Column(DateTime(timezone=True), nullable=True)
voided_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
void_reason = Column(Text, nullable=True)
reversal_operation_id = Column(Integer, ForeignKey("reversal_operations.id"), nullable=True)

# InventoryLog
value_change = Column(Numeric(16, 4), nullable=False, default=Decimal("0.0000"))
reversal_operation_id = Column(Integer, ForeignKey("reversal_operations.id"), nullable=True)
```

- [ ] **Step 4: Add the reviewed Alembic migration**

Use revision `7e3f1c9a4b20`, down revision `d6220dc5b3cb`. The upgrade must:

1. Abort if any product has negative stock.
2. Create all new tables and indexes.
3. Add nullable columns first.
4. Backfill `products.inventory_value = stock_quantity * cost_price`.
5. Set one `inventory_ledger_started_at` timestamp per company.
6. Insert one `opening_balance` layer per positive-stock product.
7. Make `products.inventory_value` and `inventory_logs.value_change` non-null.

Core migration statements:

```python
op.execute("""
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM products WHERE stock_quantity < 0) THEN
    RAISE EXCEPTION 'Cannot initialize inventory ledger while negative stock exists';
  END IF;
END $$;
""")
op.execute("UPDATE products SET inventory_value = stock_quantity * cost_price")
op.execute("UPDATE companies SET inventory_ledger_started_at = CURRENT_TIMESTAMP")
op.execute("""
INSERT INTO inventory_layers (
    company_id, product_id, source_type, original_quantity,
    remaining_quantity, unit_cost, created_at
)
SELECT company_id, id, 'opening_balance', stock_quantity,
       stock_quantity, cost_price, CURRENT_TIMESTAMP
FROM products
WHERE stock_quantity > 0
""")
```

The downgrade drops foreign keys/columns in reverse dependency order. This migration is a reviewed deploy artifact; do not use an unchecked autogenerate diff.

- [ ] **Step 5: Register models and relationships**

Import every model from `models/__init__.py`, then add focused relationships on `Company`, `Product`, `SaleItem`, `PurchaseOrder`, and `PurchaseOrderItem`. Do not add cascade delete from posted business documents to ledger tables.

- [ ] **Step 6: Run migration and metadata verification**

On the isolated test database:

```powershell
.venv\Scripts\alembic.exe upgrade head
.venv\Scripts\python.exe -m compileall models
.venv\Scripts\pytest.exe tests/unit/test_inventory_ledger_service.py -v
```

Expected: migration succeeds; metadata tests PASS.

- [ ] **Step 7: Commit schema work**

```powershell
git add sellary-backend/models sellary-backend/alembic/versions/20260615_1200-7e3f1c9a4b20_add_transaction_reversal_ledger.py sellary-backend/tests/unit/test_inventory_ledger_service.py
git commit -m "feat: add transaction reversal ledger schema"
```

---

## Task 2: Build Inventory Ledger Invariants

**Files:**
- Create: `sellary-backend/repositories/inventory_ledger_repository.py`
- Create: `sellary-backend/services/inventory_ledger_service.py`
- Modify: `sellary-backend/repositories/inventory_repository.py`
- Test: `sellary-backend/tests/unit/test_inventory_ledger_service.py`

- [ ] **Step 1: Write failing quantity/value tests**

Add tests for positive receipt, FIFO consumption across two layers, release, and zero-stock cost behavior:

```python
def test_consume_fifo_updates_layers_stock_and_value(db_session, ledger_product, admin_user):
    service = InventoryLedgerService(db_session, ledger_product.company_id)
    service.add_layer(ledger_product, Decimal("5"), Decimal("10"), "opening_balance", None, admin_user.id)
    service.add_layer(ledger_product, Decimal("5"), Decimal("20"), "purchase_receipt_item", 11, admin_user.id)

    consumption = service.consume_fifo(
        product=ledger_product,
        quantity=Decimal("7"),
        consumer_type="sale_item",
        consumer_id=41,
        sale_item_id=41,
        user_id=admin_user.id,
        reason="Sale #9",
        reference_type="sale",
        reference_id=9,
    )

    assert [a.quantity for a in consumption.allocations] == [Decimal("5"), Decimal("2")]
    assert consumption.value == Decimal("90.0000")
    assert ledger_product.stock_quantity == Decimal("3")
    assert ledger_product.inventory_value == Decimal("60.0000")
```

```python
def test_release_allocations_restores_original_layers(db_session, allocated_sale_item, admin_user):
    service = InventoryLedgerService(db_session, allocated_sale_item.sale.company_id)
    service.release_sale_item(
        allocated_sale_item,
        Decimal("3"),
        user_id=admin_user.id,
        reason="Аннулирование продажи",
        reference_type="sale_void",
        reference_id=allocated_sale_item.sale_id,
    )
    assert sum(a.released_quantity for a in allocated_sale_item.allocations) == Decimal("3")
```

- [ ] **Step 2: Run tests and confirm RED**

```powershell
.venv\Scripts\pytest.exe tests/unit/test_inventory_ledger_service.py -v
```

Expected: FAIL because ledger repository/service do not exist.

- [ ] **Step 3: Implement deterministic ledger repository methods**

Required methods:

```python
class InventoryLedgerRepository:
    def lock_available_layers(self, company_id: int, product_id: int) -> list[InventoryLayer]:
        return (
            self.db.query(InventoryLayer)
            .filter(
                InventoryLayer.company_id == company_id,
                InventoryLayer.product_id == product_id,
                InventoryLayer.remaining_quantity > 0,
                InventoryLayer.reversed_at.is_(None),
            )
            .order_by(InventoryLayer.created_at, InventoryLayer.id)
            .with_for_update()
            .all()
        )

    def active_allocations_for_layers(self, layer_ids: list[int]) -> list[InventoryAllocation]:
        return (
            self.db.query(InventoryAllocation)
            .filter(
                InventoryAllocation.layer_id.in_(layer_ids),
                InventoryAllocation.quantity > InventoryAllocation.released_quantity,
            )
            .with_for_update()
            .all()
        )
```

- [ ] **Step 4: Implement the ledger service**

Centralize all balance arithmetic:

```python
MONEY_QUANT = Decimal("0.0001")
PRICE_QUANT = Decimal("0.01")


def _apply_balance(self, product, quantity_change: Decimal, value_change: Decimal) -> None:
    new_quantity = product.stock_quantity + quantity_change
    new_value = (product.inventory_value + value_change).quantize(MONEY_QUANT)
    if new_quantity < 0:
        raise ValueError(f"Insufficient stock for product '{product.name}'")
    if new_value < Decimal("-0.0001"):
        raise ValueError(f"Inventory value cannot become negative for '{product.name}'")

    product.stock_quantity = new_quantity
    product.inventory_value = max(new_value, Decimal("0.0000"))
    if new_quantity > 0:
        product.cost_price = (product.inventory_value / new_quantity).quantize(PRICE_QUANT)
    else:
        product.inventory_value = Decimal("0.0000")
```

Add an `InventoryConsumption` result containing `allocations` and exact four-decimal `value`. `consume_fifo` must first prove layer availability, then decrement layers, create allocations, calculate value as `sum(allocation.quantity * layer.unit_cost)`, call `_apply_balance` with the negative quantity/value, and create one inventory log. `release_sale_item` restores allocations in reverse allocation order and derives the restored value from each allocation's source layer; callers never provide an independently rounded value.

- [ ] **Step 5: Run ledger tests**

```powershell
.venv\Scripts\pytest.exe tests/unit/test_inventory_ledger_service.py -v
```

Expected: PASS for FIFO, release, value, insufficient-layer, and zero-stock cases.

- [ ] **Step 6: Commit ledger core**

```powershell
git add sellary-backend/repositories/inventory_ledger_repository.py sellary-backend/repositories/inventory_repository.py sellary-backend/services/inventory_ledger_service.py sellary-backend/tests/unit/test_inventory_ledger_service.py
git commit -m "feat: add fifo inventory ledger service"
```

---

## Task 3: Route Product Creation And Manual Adjustments Through The Ledger

**Files:**
- Modify: `sellary-backend/services/inventory_service.py`
- Modify: `sellary-backend/services/product_service.py`
- Modify: `sellary-backend/repositories/product_repository.py`
- Modify: `sellary-backend/repositories/inventory_repository.py`
- Modify: `sellary-backend/schemas/inventory_log.py`
- Modify: `sellary-backend/api/products.py`
- Modify: `sellary-backend/tests/conftest.py`
- Test: `sellary-backend/tests/unit/test_product_service.py`
- Test: `sellary-backend/tests/unit/test_inventory_service.py`
- Test: `sellary-backend/tests/integration/test_product_endpoints.py`
- Test: `sellary-backend/tests/integration/test_inventory_endpoints.py`

- [ ] **Step 1: Write failing product and adjustment tests**

```python
def test_product_initial_stock_creates_opening_layer(db_session, default_company, test_category, admin_user):
    product = ProductService(db_session, default_company.id).create(
        ProductCreate(
            name="Новый товар",
            category_id=test_category.id,
            cost_price=Decimal("12.50"),
            sell_price=Decimal("20.00"),
            stock_quantity=Decimal("8"),
        ),
        user_id=admin_user.id,
    )
    stored = db_session.get(Product, product.id)
    assert stored.inventory_value == Decimal("100.0000")
    assert stored.inventory_layers[0].source_type == "product_initial"
    assert stored.inventory_layers[0].remaining_quantity == Decimal("8")


def test_cost_price_change_requires_zero_stock(db_session, test_product):
    with pytest.raises(ValueError, match="stock is zero"):
        ProductService(db_session, test_product.company_id).update(
            test_product.id,
            ProductUpdate(cost_price=Decimal("11.00")),
        )
```

```python
def test_positive_adjustment_creates_layer_and_preserves_average_cost(db_session, test_product, admin_user):
    before_cost = test_product.cost_price
    result = InventoryService(db_session, test_product.company_id).adjust_stock(
        InventoryAdjustment(product_id=test_product.id, quantity_change=Decimal("4"), reason="Инвентаризация"),
        admin_user.id,
    )
    assert result["new_quantity"] == test_product.stock_quantity
    assert test_product.cost_price == before_cost
    assert test_product.inventory_layers[-1].source_type == "manual_adjustment"


def test_negative_adjustment_consumes_fifo_layers(db_session, layered_product, admin_user):
    InventoryService(db_session, layered_product.company_id).adjust_stock(
        InventoryAdjustment(product_id=layered_product.id, quantity_change=Decimal("-3"), reason="Списание"),
        admin_user.id,
    )
    assert sum(a.quantity for a in layered_product.inventory_allocations) == Decimal("3")
```

- [ ] **Step 2: Run targeted tests and confirm RED**

```powershell
.venv\Scripts\pytest.exe tests/unit/test_product_service.py tests/unit/test_inventory_service.py tests/integration/test_product_endpoints.py tests/integration/test_inventory_endpoints.py -v
```

- [ ] **Step 3: Make product creation ledger-aware**

Change `ProductService.create` to accept `user_id`; pass `auth.user.id` from `api/products.py`. Remove `stock_quantity` from the values passed to the initial `Product` insert, create the row with zero quantity/value, flush it, and then call `ledger.add_layer` with `source_type="product_initial"` when the requested initial quantity is positive. When reactivating an inactive product, never assign `stock_quantity` directly; apply only the requested delta through the ledger.

Change the targeted `ProductRepository.create` and `update` methods from internal commits to `flush()`. `ProductService` only flushes; `api/products.py` commits after the product row, initial layer, value, and inventory log are all ready, and rolls back on failure. Update existing direct unit-test calls for the new `user_id` argument. Unit tests continue to use fixture rollback and must not add explicit commits.

Reject a changed `cost_price` while `stock_quantity > 0`. The supported workflow is the one already exposed by the product UI: adjust stock to zero first, edit cost, then receive a new purchase. This prevents catalog edits from silently rewriting historical inventory value or purchase-layer costs.

- [ ] **Step 4: Replace direct adjustment arithmetic**

In `InventoryService.adjust_stock`:

```python
if adjustment.quantity_change > 0:
    product = self.ledger.add_layer(
        product=product,
        quantity=adjustment.quantity_change,
        unit_cost=product.cost_price,
        source_type="manual_adjustment",
        source_id=None,
        user_id=user_id,
        reason=adjustment.reason,
    )
else:
    self.ledger.consume_fifo(
        product=product,
        quantity=-adjustment.quantity_change,
        consumer_type="manual_adjustment",
        consumer_id=inventory_log_id,
        sale_item_id=None,
        user_id=user_id,
        reason=adjustment.reason,
        reference_type="manual_adjust",
        reference_id=inventory_log_id,
    )
```

Generate/flush the log before using its ID for a negative adjustment. Return `value_change` in inventory log responses.

- [ ] **Step 5: Keep shared test fixtures ledger-consistent**

Add a small fixture helper that gives directly-created products matching `inventory_value` and an `opening_balance` layer. Update `test_product` and `test_products_bulk` to use it. Update the shared `test_sale` fixture to consume its two units through `InventoryLedgerService.consume_fifo` after flushing the `SaleItem`, instead of decrementing `stock_quantity` directly. This keeps old endpoint tests valid under the new invariants.

- [ ] **Step 6: Run tests and commit**

```powershell
.venv\Scripts\pytest.exe tests/unit/test_product_service.py tests/unit/test_inventory_service.py tests/integration/test_product_endpoints.py tests/integration/test_inventory_endpoints.py -v
git add sellary-backend/services/product_service.py sellary-backend/services/inventory_service.py sellary-backend/repositories/product_repository.py sellary-backend/repositories/inventory_repository.py sellary-backend/schemas/inventory_log.py sellary-backend/api/products.py sellary-backend/tests/conftest.py sellary-backend/tests/unit/test_product_service.py sellary-backend/tests/unit/test_inventory_service.py sellary-backend/tests/integration/test_product_endpoints.py sellary-backend/tests/integration/test_inventory_endpoints.py
git commit -m "refactor: track product inventory in ledger"
```

---

## Task 4: Record Purchase Receipt Events And Layers

**Files:**
- Modify: `sellary-backend/services/purchase_order_service.py`
- Modify: `sellary-backend/repositories/purchase_order_repository.py`
- Modify: `sellary-backend/core/state_machine.py`
- Test: `sellary-backend/tests/unit/test_purchase_order_service.py`
- Test: `sellary-backend/tests/integration/test_purchase_order_endpoints.py`

- [ ] **Step 1: Write failing receipt tests**

```python
def test_receive_creates_receipt_items_layers_and_value(db_session, sent_purchase_order, admin_user):
    service = PurchaseOrderService(db_session, sent_purchase_order.company_id)
    item = sent_purchase_order.items[0]
    before_value = item.product.inventory_value
    service.receive_items(
        sent_purchase_order.id,
        ReceiveItemsRequest(items=[{"item_id": item.id, "quantity_to_receive": "4"}]),
        admin_user.id,
    )
    receipt = db_session.query(PurchaseReceipt).filter_by(purchase_order_id=sent_purchase_order.id).one()
    assert receipt.items[0].quantity == Decimal("4")
    assert receipt.items[0].inventory_layer.remaining_quantity == Decimal("4")
    assert item.product.inventory_value == before_value + Decimal("4") * item.unit_cost
```

```python
def test_partially_received_purchase_cannot_use_plain_cancel(client, partially_received_po, admin_headers):
    response = client.post(
        f"/api/purchase-orders/{partially_received_po.id}/cancel",
        headers={**admin_headers, "Idempotency-Key": "cancel-received-0001"},
    )
    assert response.status_code == 409
```

- [ ] **Step 2: Run tests and confirm RED**

```powershell
.venv\Scripts\pytest.exe tests/unit/test_purchase_order_service.py tests/integration/test_purchase_order_endpoints.py -v
```

- [ ] **Step 3: Create receipt events inside `receive_items`**

For each receive request, create one `PurchaseReceipt`; for every accepted line create `PurchaseReceiptItem`, flush it, then call:

```python
self.ledger.add_layer(
    product=product,
    quantity=quantity_to_receive,
    unit_cost=po_item.unit_cost,
    source_type="purchase_receipt_item",
    source_id=receipt_item.id,
    purchase_receipt_item_id=receipt_item.id,
    user_id=user_id,
    reason=f"Restock via PO #{po_id}",
    reference_type="po_receive",
    reference_id=po_id,
)
```

Remove the duplicated weighted-average formula from `PurchaseOrderService`; the ledger service becomes the only quantity/value calculator.

- [ ] **Step 4: Tighten cancellation state rules**

Change `PO_TRANSITIONS` so only `draft` and unreceived `sent` orders can transition to `cancelled`. In `cancel`, reject any order where an item has `quantity_received > 0` with:

```python
raise StateTransitionError(
    entity_type="Purchase Order",
    entity_id=po_id,
    current_status=purchase_order.status.value,
    target_status="void_required",
)
```

- [ ] **Step 5: Run tests and commit**

```powershell
.venv\Scripts\pytest.exe tests/unit/test_purchase_order_service.py tests/integration/test_purchase_order_endpoints.py -v
git add sellary-backend/services/purchase_order_service.py sellary-backend/repositories/purchase_order_repository.py sellary-backend/core/state_machine.py sellary-backend/tests/unit/test_purchase_order_service.py sellary-backend/tests/integration/test_purchase_order_endpoints.py
git commit -m "feat: record purchase receipt inventory layers"
```

---

## Task 5: Allocate Online And Offline Sales Through FIFO

**Files:**
- Modify: `sellary-backend/services/sale_service.py`
- Modify: `sellary-backend/services/sync_service.py`
- Modify: `sellary-backend/repositories/sale_repository.py`
- Test: `sellary-backend/tests/unit/test_sale_service.py`
- Test: `sellary-backend/tests/unit/test_sync_service.py`
- Test: `sellary-backend/tests/integration/test_sales_endpoints.py`
- Test: `sellary-backend/tests/integration/test_sync_endpoints.py`

- [ ] **Step 1: Write failing allocation tests**

```python
def test_sale_creates_fifo_allocations_and_reduces_inventory_value(db_session, layered_product, cashier_user):
    result = SaleService(db_session, layered_product.company_id).create(
        make_sale(product_id=layered_product.id, quantity="3"),
        cashier_user.id,
    )
    sale_item = db_session.query(SaleItem).filter_by(sale_id=result.id).one()
    assert sum(a.quantity for a in sale_item.allocations) == Decimal("3")
    assert [a.layer.unit_cost for a in sale_item.allocations] == [Decimal("10.00"), Decimal("20.00")]
    assert sale_item.cost_total_at_sale == Decimal("40.00")
    assert layered_product.inventory_value == Decimal("40.0000")


def test_synced_sale_rejects_unallocated_oversell(db_session, company, cashier_user, layered_product):
    result = SyncService(db_session).sync_sales(company, cashier_user, make_sync_sale(quantity="999"))
    assert result.results[0].status == "failed"
    assert "Insufficient stock" in result.results[0].error
```

- [ ] **Step 2: Run tests and confirm RED**

```powershell
.venv\Scripts\pytest.exe tests/unit/test_sale_service.py tests/unit/test_sync_service.py tests/integration/test_sales_endpoints.py tests/integration/test_sync_endpoints.py -v
```

- [ ] **Step 3: Flush sale items before consuming stock**

Keep price/tax calculation in `SaleService`, but stop changing `product.stock_quantity` directly. Create and flush the sale/items, then consume each item through:

```python
consumption = self.ledger.consume_fifo(
    product=product_map[item.product_id],
    quantity=item.quantity,
    consumer_type="sale_item",
    consumer_id=item.id,
    sale_item_id=item.id,
    user_id=cashier_id,
    reason=f"Sale #{sale.id}",
    reference_type="sale",
    reference_id=sale.id,
)
item.cost_total_at_sale = consumption.value.quantize(Decimal("0.01"))
item.unit_cost_at_sale = (consumption.value / item.quantity).quantize(Decimal("0.01"))
```

Build the test product with two units at `10.00` and three units at `20.00`, so the assertions prove FIFO value consumption rather than only quantity allocation. Apply the same path in `SyncService`. Exact ledger accounting cannot support unallocated negative stock, so synced overselling must return a failed result even when the old `SYNC_ALLOW_OVERSELL` flag is true. Keep a warning in startup/docs that the flag no longer overrides ledger safety.

- [ ] **Step 4: Run sales/sync tests and commit**

```powershell
.venv\Scripts\pytest.exe tests/unit/test_sale_service.py tests/unit/test_sync_service.py tests/integration/test_sales_endpoints.py tests/integration/test_sync_endpoints.py -v
git add sellary-backend/services/sale_service.py sellary-backend/services/sync_service.py sellary-backend/repositories/sale_repository.py sellary-backend/tests/unit/test_sale_service.py sellary-backend/tests/unit/test_sync_service.py sellary-backend/tests/integration/test_sales_endpoints.py sellary-backend/tests/integration/test_sync_endpoints.py
git commit -m "refactor: allocate sales from inventory layers"
```

---

## Task 6: Release Allocations For Product Returns

**Files:**
- Modify: `sellary-backend/services/sale_return_service.py`
- Test: `sellary-backend/tests/unit/test_sale_return_service.py`
- Test: `sellary-backend/tests/integration/test_return_endpoints.py`

- [ ] **Step 1: Write failing new-ledger and legacy return tests**

```python
def test_return_releases_original_sale_allocation(db_session, allocated_sale, admin_user):
    item = allocated_sale.items[0]
    SaleReturnService(db_session, allocated_sale.company_id).process_return(
        allocated_sale.id,
        make_return(item.id, quantity="1"),
        admin_user.id,
    )
    assert sum(a.released_quantity for a in item.allocations) == Decimal("1")


def test_legacy_return_creates_return_layer(db_session, legacy_sale, admin_user):
    item = legacy_sale.items[0]
    SaleReturnService(db_session, legacy_sale.company_id).process_return(
        legacy_sale.id,
        make_return(item.id, quantity="1"),
        admin_user.id,
    )
    layer = db_session.query(InventoryLayer).filter_by(source_type="sale_return").one()
    assert layer.original_quantity == Decimal("1")
```

- [ ] **Step 2: Run tests and confirm RED**

```powershell
.venv\Scripts\pytest.exe tests/unit/test_sale_return_service.py tests/integration/test_return_endpoints.py -v
```

- [ ] **Step 3: Replace direct return stock changes**

For sale items with allocations, call `release_sale_item`; it restores exact source-layer quantity and value. For legacy items without allocations, add a `sale_return` layer at `unit_cost_at_sale`. Preserve existing refund calculations and `quantity_returned` behavior.

- [ ] **Step 4: Run tests and commit**

```powershell
.venv\Scripts\pytest.exe tests/unit/test_sale_return_service.py tests/integration/test_return_endpoints.py -v
git add sellary-backend/services/sale_return_service.py sellary-backend/tests/unit/test_sale_return_service.py sellary-backend/tests/integration/test_return_endpoints.py
git commit -m "refactor: restore returned stock to inventory layers"
```

---

## Task 7: Implement Sale Annulment Preview And Execution

**Files:**
- Create: `sellary-backend/schemas/reversal.py`
- Create: `sellary-backend/services/transaction_reversal_service.py`
- Modify: `sellary-backend/api/sales.py`
- Modify: `sellary-backend/schemas/sale.py`
- Modify: `sellary-backend/services/sale_service.py`
- Test: `sellary-backend/tests/unit/test_transaction_reversal_service.py`
- Test: `sellary-backend/tests/integration/test_transaction_reversal_endpoints.py`
- Test: `sellary-backend/tests/integration/test_sales_endpoints.py`

- [ ] **Step 1: Define failing service tests**

```python
def test_void_sale_restores_only_outstanding_quantity(db_session, partially_returned_sale, admin_user):
    service = TransactionReversalService(db_session, partially_returned_sale.company_id)
    before = partially_returned_sale.items[0].product.stock_quantity
    result = service.void_sale(partially_returned_sale.id, "Тестовая продажа", admin_user.id)
    assert result.entity_type == "sale"
    assert partially_returned_sale.items[0].product.stock_quantity == before + Decimal("7")
    assert partially_returned_sale.status == SaleStatus.CANCELLED
    assert partially_returned_sale.void_reason == "Тестовая продажа"


def test_void_sale_is_rejected_twice(db_session, voided_sale, admin_user):
    with pytest.raises(ReversalConflict, match="Продажа уже аннулирована"):
        TransactionReversalService(db_session, voided_sale.company_id).void_sale(
            voided_sale.id, "Повтор", admin_user.id
        )
```

- [ ] **Step 2: Define failing endpoint tests**

```python
@pytest.mark.parametrize("headers_fixture", ["manager_headers", "cashier_headers"])
def test_sale_void_requires_admin(client, request, test_sale, headers_fixture):
    headers = {**request.getfixturevalue(headers_fixture), "Idempotency-Key": "sale-void-forbid-01"}
    response = client.post(f"/api/sales/{test_sale.id}/void", json={"reason": "Тест"}, headers=headers)
    assert response.status_code == 403


def test_sale_void_is_idempotent(client, test_sale, admin_headers):
    headers = {**admin_headers, "Idempotency-Key": "sale-void-idempotent-01"}
    first = client.post(f"/api/sales/{test_sale.id}/void", json={"reason": "Тестовая продажа"}, headers=headers)
    second = client.post(f"/api/sales/{test_sale.id}/void", json={"reason": "Тестовая продажа"}, headers=headers)
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
```

- [ ] **Step 3: Run tests and confirm RED**

```powershell
.venv\Scripts\pytest.exe tests/unit/test_transaction_reversal_service.py tests/integration/test_transaction_reversal_endpoints.py -v
```

- [ ] **Step 4: Add reversal schemas**

```python
class VoidRequest(BaseModel):
    reason: str = Field(..., min_length=3, max_length=500)


class InventoryImpact(BaseModel):
    product_id: int
    product_name: str
    quantity_change: Decimal
    value_change: Decimal
    resulting_stock: Decimal


class ReversalBlocker(BaseModel):
    blocker_type: Literal["sale", "inventory_adjustment", "legacy_history"]
    reference_id: int | None
    product_id: int
    product_name: str
    quantity: Decimal
    created_at: datetime | None
    message: str


class VoidPreview(BaseModel):
    can_void: bool
    is_legacy: bool
    impacts: list[InventoryImpact]
    blockers: list[ReversalBlocker]


class VoidResult(BaseModel):
    operation_id: int
    entity_type: Literal["sale", "purchase_order"]
    entity_id: int
    status: str
    voided_at: datetime
```

- [ ] **Step 5: Implement sale preview and void**

`preview_sale` calculates outstanding quantity and value without mutation. `void_sale` locks sale/items/products, releases exact allocations when present, creates `sale_void` layers for legacy items, writes a `ReversalOperation`, links inventory logs to it, and sets audit fields.

Use this legacy branch:

```python
if not item.allocations:
    self.ledger.add_layer(
        product=item.product,
        quantity=outstanding,
        unit_cost=item.unit_cost_at_sale,
        source_type="sale_void",
        source_id=item.id,
        user_id=user_id,
        reason=f"Аннулирование продажи #{sale.id}: {reason}",
        reference_type="sale_void",
        reference_id=sale.id,
        reversal_operation_id=operation.id,
    )
else:
    self.ledger.release_sale_item(
        item, outstanding, user_id,
        f"Аннулирование продажи #{sale.id}: {reason}",
        "sale_void", sale.id, operation.id,
    )
```

- [ ] **Step 6: Add admin-only endpoints**

Add:

```python
@router.get("/{sale_id}/void-preview", response_model=VoidPreview)
def preview_sale_void(
    sale_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_admin),
):
    return TransactionReversalService(db, auth.company_id).preview_sale(sale_id)


@router.post("/{sale_id}/void", response_model=VoidResult)
def void_sale(
    sale_id: int,
    payload: VoidRequest,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_admin),
    idempotency_key: str = Depends(require_idempotency_key),
):
    endpoint = f"/api/sales/{sale_id}/void"
    request_body = payload.model_dump()
    idempotency = IdempotencyService(db)
    try:
        cached = idempotency.get_cached_response(
            key=idempotency_key,
            company_id=auth.company_id,
            user_id=auth.user.id,
            endpoint=endpoint,
            request_body=request_body,
        )
    except IdempotencyConflictError as exc:
        raise HTTPException(status_code=409, detail=exc.message)
    if cached:
        return VoidResult(**cached[0])

    try:
        result = TransactionReversalService(db, auth.company_id).void_sale(
            sale_id, payload.reason, auth.user.id
        )
        idempotency.store_response(
            key=idempotency_key,
            company_id=auth.company_id,
            user_id=auth.user.id,
            endpoint=endpoint,
            request_body=request_body,
            response_body=result,
            status_code=200,
        )
        db.commit()
        return result
    except ReversalBlocked as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=exc.to_response())
    except (IdempotencyConflictError, StateTransitionError) as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=exc.message)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
```

Keep `POST /sales/{id}/cancel` for one compatibility release, mark it deprecated, require admin and a `VoidRequest`, and route it through the same service. It must no longer permit cashier cancellation.

- [ ] **Step 7: Expose audit fields in sale responses**

Add optional `voided_at`, `voided_by_user_id`, `void_reason`, and `reversal_operation_id` fields to `SaleResponse` and populate them in `_to_response`.

- [ ] **Step 8: Run tests and commit**

```powershell
.venv\Scripts\pytest.exe tests/unit/test_transaction_reversal_service.py tests/integration/test_transaction_reversal_endpoints.py tests/integration/test_sales_endpoints.py -v
git add sellary-backend/schemas/reversal.py sellary-backend/services/transaction_reversal_service.py sellary-backend/api/sales.py sellary-backend/schemas/sale.py sellary-backend/services/sale_service.py sellary-backend/tests/unit/test_transaction_reversal_service.py sellary-backend/tests/integration/test_transaction_reversal_endpoints.py sellary-backend/tests/integration/test_sales_endpoints.py
git commit -m "feat: add admin sale annulment"
```

---

## Task 8: Implement Purchase Annulment Blockers And Execution

**Files:**
- Modify: `sellary-backend/services/transaction_reversal_service.py`
- Modify: `sellary-backend/repositories/inventory_ledger_repository.py`
- Modify: `sellary-backend/api/purchase_orders.py`
- Modify: `sellary-backend/schemas/purchase_order.py`
- Test: `sellary-backend/tests/unit/test_transaction_reversal_service.py`
- Test: `sellary-backend/tests/integration/test_transaction_reversal_endpoints.py`

- [ ] **Step 1: Write failing blocker tests**

```python
def test_purchase_preview_lists_sales_consuming_its_layers(db_session, received_po_with_sale):
    preview = TransactionReversalService(
        db_session, received_po_with_sale.company_id
    ).preview_purchase(received_po_with_sale.id)
    assert preview.can_void is False
    assert preview.blockers[0].blocker_type == "sale"
    assert preview.blockers[0].reference_id == received_po_with_sale.blocking_sale_id


def test_purchase_void_succeeds_after_blocking_sale_is_voided(db_session, received_po_with_voided_sale, admin_user):
    service = TransactionReversalService(db_session, received_po_with_voided_sale.company_id)
    preview = service.preview_purchase(received_po_with_voided_sale.id)
    assert preview.can_void is True
    result = service.void_purchase(received_po_with_voided_sale.id, "Тестовая закупка", admin_user.id)
    assert result.status == "cancelled"
```

```python
def test_legacy_purchase_with_later_negative_movement_is_blocked(db_session, legacy_received_po):
    preview = TransactionReversalService(db_session, legacy_received_po.company_id).preview_purchase(legacy_received_po.id)
    assert preview.can_void is False
    assert any(b.blocker_type == "legacy_history" for b in preview.blockers)
```

- [ ] **Step 2: Run tests and confirm RED**

```powershell
.venv\Scripts\pytest.exe tests/unit/test_transaction_reversal_service.py -k purchase -v
```

- [ ] **Step 3: Implement exact blocker query**

For ledger-backed purchases, inspect active allocations on layers selected by `InventoryLayer.purchase_receipt_item_id` for that purchase. Join sale allocations to `SaleItem` and `Sale`; report only non-cancelled sale consumption. Report active manual-adjustment consumption as `inventory_adjustment` blockers.

Treat a received purchase as legacy when it has received quantities and `purchase_receipts` is empty. Do not infer this from `purchase_order.created_at`, because an old draft can be received after ledger cutover. Permit legacy reversal only when all are true:

```python
safe = (
    no_purchase_receipt_events
    and po_receive_logs_exist
    and no_unreversed_later_negative_logs
    and no_active_post_cutover_opening_layer_allocations
    and every_product_current_stock_gte_received_quantity
)
```

- [ ] **Step 4: Implement purchase void**

Inside one transaction:

```python
preview = self.preview_purchase(po_id, for_update=True)
if not preview.can_void:
    raise ReversalBlocked(preview.blockers)

operation = self._create_operation("purchase_order", po_id, "purchase_void", reason, user_id, preview)
for receipt_item in receipt_items:
    self.ledger.reverse_unconsumed_layer(
        layer=receipt_item.inventory_layer,
        product=receipt_item.product,
        quantity=receipt_item.quantity,
        user_id=user_id,
        reason=f"Аннулирование закупки #{po_id}: {reason}",
        reference_type="po_void",
        reference_id=po_id,
        reversal_operation_id=operation.id,
    )
```

For a safe legacy purchase, decrement the affected opening-balance layer and apply `quantity_received * unit_cost` as the negative value. Mark all receipt records/layers `reversed_at` and link them to the reversal operation. Set PO audit fields and status `cancelled`.

- [ ] **Step 5: Add purchase endpoints and response audit fields**

Add admin-only `GET /purchase-orders/{id}/void-preview` and idempotent `POST /purchase-orders/{id}/void`. Include optional void audit fields in `PurchaseOrderResponse`.

- [ ] **Step 6: Run tests and commit**

```powershell
.venv\Scripts\pytest.exe tests/unit/test_transaction_reversal_service.py tests/integration/test_transaction_reversal_endpoints.py tests/integration/test_purchase_order_endpoints.py -v
git add sellary-backend/services/transaction_reversal_service.py sellary-backend/repositories/inventory_ledger_repository.py sellary-backend/api/purchase_orders.py sellary-backend/schemas/purchase_order.py sellary-backend/tests/unit/test_transaction_reversal_service.py sellary-backend/tests/integration/test_transaction_reversal_endpoints.py sellary-backend/tests/integration/test_purchase_order_endpoints.py
git commit -m "feat: add guarded purchase annulment"
```

---

## Task 9: Make Reports And Valuation Reversal-Aware

**Files:**
- Modify: `sellary-backend/services/report_service.py`
- Modify: `sellary-backend/repositories/inventory_repository.py`
- Modify: `sellary-backend/services/inventory_service.py`
- Test: `sellary-backend/tests/unit/test_transaction_reversal_service.py`
- Test: create `sellary-backend/tests/unit/test_report_service.py` if no focused report test exists.

- [ ] **Step 1: Write failing report tests**

```python
def test_annulled_sale_and_its_returns_are_excluded_from_reports(db_session, voided_returned_sale):
    report = ReportService(db_session, voided_returned_sale.company_id).get_profit_report(
        voided_returned_sale.created_at - timedelta(days=1),
        voided_returned_sale.created_at + timedelta(days=1),
    )
    assert report.revenue == Decimal("0.00")
    assert report.sales_count == 0


def test_inventory_valuation_uses_inventory_value(db_session, test_product):
    test_product.inventory_value = Decimal("123.4500")
    assert InventoryService(db_session, test_product.company_id).get_inventory_value()["total_value"] == Decimal("123.4500")
```

- [ ] **Step 2: Run tests and confirm RED**

```powershell
.venv\Scripts\pytest.exe tests/unit/test_report_service.py -v
```

- [ ] **Step 3: Update report and valuation queries**

Keep `NON_CANCELLED_STATUSES` as the single status contract. Filter the refund subquery through a join to non-cancelled sales so cancelled-sale returns cannot leak into aggregate refund values:

```python
.join(Sale, Sale.id == SaleReturn.sale_id)
.filter(
    SaleReturn.company_id == self.company_id,
    Sale.status.in_(NON_CANCELLED_STATUSES),
)
```

Change inventory valuation to:

```python
func.sum(Product.inventory_value)
```

Do not recompute value from rounded `stock_quantity * cost_price`.

- [ ] **Step 4: Run tests and commit**

```powershell
.venv\Scripts\pytest.exe tests/unit/test_report_service.py tests/unit/test_transaction_reversal_service.py -v
git add sellary-backend/services/report_service.py sellary-backend/repositories/inventory_repository.py sellary-backend/services/inventory_service.py sellary-backend/tests/unit/test_report_service.py sellary-backend/tests/unit/test_transaction_reversal_service.py
git commit -m "fix: exclude annulled transactions from reports"
```

---

## Task 10: Add Frontend Contracts And Reusable Russian Dialog

**Files:**
- Modify: `sellary-frontend/src/lib/types.ts`
- Modify: `sellary-frontend/src/lib/api.ts`
- Create: `sellary-frontend/src/components/transactions/AnnulmentDialog.tsx`
- Create: `sellary-frontend/src/components/transactions/__tests__/AnnulmentDialog.test.tsx`

- [ ] **Step 1: Write failing dialog tests**

```tsx
it('requires a Russian annulment reason before confirmation', async () => {
  const onConfirm = vi.fn();
  render(<AnnulmentDialog open title="Аннулирование продажи" preview={preview} onClose={vi.fn()} onConfirm={onConfirm} />);
  expect(screen.getByRole('button', { name: 'Аннулировать' })).toBeDisabled();
  await userEvent.type(screen.getByLabelText('Причина аннулирования'), 'Тестовая продажа');
  expect(screen.getByRole('button', { name: 'Аннулировать' })).toBeEnabled();
});


it('disables confirmation and renders linked sale blockers', () => {
  render(<AnnulmentDialog open title="Аннулирование закупки" preview={blockedPreview} onClose={vi.fn()} onConfirm={vi.fn()} />);
  expect(screen.getByText('Связанные продажи')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Продажа #42' })).toHaveAttribute('href', '/sales?saleId=42');
  expect(screen.getByRole('button', { name: 'Аннулировать' })).toBeDisabled();
});
```

- [ ] **Step 2: Run test and confirm RED**

```powershell
npx vitest run src/components/transactions/__tests__/AnnulmentDialog.test.tsx
```

- [ ] **Step 3: Add typed API contracts**

```typescript
export interface InventoryImpact {
  product_id: number;
  product_name: string;
  quantity_change: string;
  value_change: string;
  resulting_stock: string;
}

export interface ReversalBlocker {
  blocker_type: 'sale' | 'inventory_adjustment' | 'legacy_history';
  reference_id?: number | null;
  product_id: number;
  product_name: string;
  quantity: string;
  created_at?: string | null;
  message: string;
}

export interface VoidPreview {
  can_void: boolean;
  is_legacy: boolean;
  impacts: InventoryImpact[];
  blockers: ReversalBlocker[];
}
```

```typescript
previewVoid: (id: number) => api.get<VoidPreview>(`/sales/${id}/void-preview`),
void: (id: number, reason: string, idempotencyKey = generateIdempotencyKey()) =>
  api.post<VoidResult>(`/sales/${id}/void`, { reason }, { headers: { 'Idempotency-Key': idempotencyKey } }),
```

Add equivalent purchase methods.

- [ ] **Step 4: Implement `AnnulmentDialog`**

The component owns the reason text, resets it when closed, renders `Влияние на остатки`, optionally renders `Влияние на остатки и себестоимость`, and exposes blocker links. Use exact Russian labels from the design and the warning `Операция необратима. Документ останется в истории.`

- [ ] **Step 5: Run tests and commit**

```powershell
npx vitest run src/components/transactions/__tests__/AnnulmentDialog.test.tsx
git add sellary-frontend/src/lib/types.ts sellary-frontend/src/lib/api.ts sellary-frontend/src/components/transactions
git commit -m "feat: add transaction annulment dialog"
```

---

## Task 11: Add Admin Sale Annulment UI

**Files:**
- Modify: `sellary-frontend/src/app/(protected)/sales/page.tsx`
- Create: `sellary-frontend/src/app/(protected)/sales/__tests__/page.test.tsx`

- [ ] **Step 1: Write failing role and action tests**

```tsx
it('shows annul action only for admins', async () => {
  mockAuthRole('admin');
  renderSalesPage();
  await userEvent.click(screen.getByText('Чек #7'));
  expect(screen.getByRole('button', { name: 'Аннулировать продажу' })).toBeInTheDocument();
});


it('hides annul action from managers', async () => {
  mockAuthRole('manager');
  renderSalesPage();
  await userEvent.click(screen.getByText('Чек #7'));
  expect(screen.queryByRole('button', { name: 'Аннулировать продажу' })).not.toBeInTheDocument();
});


it('voids a sale and excludes it from visible turnover totals', async () => {
  mockAuthRole('admin');
  renderSalesPage();
  await openAndConfirmSaleVoid();
  expect(salesApi.void).toHaveBeenCalledWith(7, 'Тестовая продажа', expect.any(String));
  expect(queryClient.invalidateQueries).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test and confirm RED**

```powershell
npx vitest run 'src/app/(protected)/sales/__tests__/page.test.tsx'
```

- [ ] **Step 3: Implement admin sale flow**

Use:

```typescript
const isAdmin = useAuthStore((state) => state.currentCompany?.role === 'admin');
const financialSales = visibleSales.filter((sale) => sale.status !== 'cancelled');
```

Open the preview before showing the dialog. On success invalidate `sales`, `products`, `dashboard`, and report query prefixes, close detail, and show `Продажа аннулирована`.

Read `saleId` from `useSearchParams`; once sales load, open that sale so purchase blocker links lead directly to the document.

Change the sales status label from `Отменён` to `Аннулирован`.

- [ ] **Step 4: Run test and commit**

```powershell
npx vitest run 'src/app/(protected)/sales/__tests__/page.test.tsx'
git add 'sellary-frontend/src/app/(protected)/sales/page.tsx' 'sellary-frontend/src/app/(protected)/sales/__tests__/page.test.tsx'
git commit -m "feat: add admin sale annulment ui"
```

---

## Task 12: Add Guarded Purchase Annulment UI

**Files:**
- Modify: `sellary-frontend/src/app/(protected)/purchase-orders/[id]/page.tsx`
- Modify: `sellary-frontend/src/components/purchase-orders/PurchaseOrderStatusBadge.tsx`
- Create: `sellary-frontend/src/app/(protected)/purchase-orders/[id]/__tests__/page.test.tsx`

- [ ] **Step 1: Write failing purchase UI tests**

```tsx
it('renders blockers and prevents purchase annulment', async () => {
  mockAuthRole('admin');
  purchaseOrdersApi.previewVoid.mockResolvedValue({ data: blockedPreview });
  renderPurchaseDetail(receivedOrder);
  await userEvent.click(screen.getByRole('button', { name: 'Аннулировать закупку' }));
  expect(screen.getByText('Сначала аннулируйте связанные продажи.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Продажа #42' })).toHaveAttribute('href', '/sales?saleId=42');
  expect(screen.getByRole('button', { name: 'Аннулировать' })).toBeDisabled();
});


it('annuls an unconsumed received purchase', async () => {
  mockAuthRole('admin');
  purchaseOrdersApi.previewVoid.mockResolvedValue({ data: allowedPreview });
  renderPurchaseDetail(receivedOrder);
  await openAndConfirmPurchaseVoid();
  expect(purchaseOrdersApi.void).toHaveBeenCalledWith(receivedOrder.id, 'Тестовая закупка', expect.any(String));
});
```

- [ ] **Step 2: Run test and confirm RED**

```powershell
npx vitest run 'src/app/(protected)/purchase-orders/[id]/__tests__/page.test.tsx'
```

- [ ] **Step 3: Implement purchase actions by lifecycle**

- `draft`: existing `Удалить` and `Отменить` behavior.
- unreceived `sent`: existing `Отменить` behavior.
- `partially_received` or `received`: admin-only `Аннулировать закупку`.
- non-admin: no annul action.
- `cancelled` with `voided_at`: badge `Аннулирована`.
- `cancelled` without `voided_at`: badge `Отменена`.

On success invalidate `purchaseOrders`, `purchaseOrder`, `products`, `inventory`, `dashboard`, and reports; show `Закупка аннулирована`.

- [ ] **Step 4: Run tests and commit**

```powershell
npx vitest run 'src/app/(protected)/purchase-orders/[id]/__tests__/page.test.tsx' 'src/app/(protected)/purchase-orders/__tests__/page.test.tsx'
git add 'sellary-frontend/src/app/(protected)/purchase-orders/[id]/page.tsx' 'sellary-frontend/src/app/(protected)/purchase-orders/[id]/__tests__/page.test.tsx' sellary-frontend/src/components/purchase-orders/PurchaseOrderStatusBadge.tsx
git commit -m "feat: add guarded purchase annulment ui"
```

---

## Task 13: Full Verification, Documentation, Migration, And Deployment

**Files:**
- Modify: `sellary-backend/README.md`
- Modify: `sellary-backend/RUNBOOK.md`
- Modify: `DOCUMENTATION.md`
- Do not modify/stage: local `sellary-backend/railway.json`

- [ ] **Step 1: Document the operational contract**

Add:

- admin-only preview/void endpoints;
- Russian UI labels;
- draft delete versus posted reversal distinction;
- purchase blocker behavior;
- migration precondition that no product may have negative stock;
- ledger cutover and conservative legacy purchase rule;
- `POST /sales/{id}/cancel` deprecation;
- Training Mode as future work.

- [ ] **Step 2: Run backend compile and focused tests**

```powershell
cd sellary-backend
.venv\Scripts\python.exe -m compileall api core models repositories schemas services main.py
.venv\Scripts\pytest.exe tests/unit/test_inventory_ledger_service.py tests/unit/test_transaction_reversal_service.py tests/unit/test_report_service.py tests/integration/test_transaction_reversal_endpoints.py -v
```

Expected: exit 0, no failed tests.

- [ ] **Step 3: Run the complete backend suite**

```powershell
.venv\Scripts\pytest.exe tests/integration tests/unit
```

Expected: all tests pass.

- [ ] **Step 4: Verify migration round-trip on the test database**

```powershell
.venv\Scripts\alembic.exe current
.venv\Scripts\alembic.exe downgrade d6220dc5b3cb
.venv\Scripts\alembic.exe upgrade 7e3f1c9a4b20
.venv\Scripts\alembic.exe current
```

Expected: final current revision is `7e3f1c9a4b20`. Do not run downgrade against production.

- [ ] **Step 5: Run complete frontend tests and build**

```powershell
cd ..\sellary-frontend
npx vitest run
npm run build
```

Expected: all Vitest files pass and Next.js production build exits 0.

- [ ] **Step 6: Browser-verify the complete workflow**

Use Playwright CLI against local frontend/backend with an isolated test company:

1. Receive a purchase of 10 units.
2. Sell 3 units and verify stock is 7.
3. Open purchase annulment; verify a concrete blocker such as `Продажа #42` blocks confirmation.
4. Open the linked sale; annul it with `Тестовая продажа`; verify stock is 10.
5. Return to the purchase; annul it with `Тестовая закупка`; verify stock returns to its pre-purchase value.
6. Verify both records remain visible as `Аннулирован`/`Аннулирована`.
7. Verify manager and cashier sessions do not show annul actions.

Capture request bodies for both void endpoints and a final screenshot under `output/playwright/transaction-reversal/`, then remove temporary artifacts before commit.

- [ ] **Step 7: Commit documentation**

```powershell
git add sellary-backend/README.md sellary-backend/RUNBOOK.md DOCUMENTATION.md
git commit -m "docs: document transaction annulment"
```

- [ ] **Step 8: Inspect the final diff and preserve unrelated changes**

```powershell
git status -sb
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
```

Confirm `sellary-backend/railway.json`, `.codex-remote-attachments/`, and `.superpowers/` are not staged or committed.

- [ ] **Step 9: Push and deploy in dependency order**

1. Push the feature branch/approved commits.
2. Let Railway run the committed repository configuration `alembic upgrade head`; the uncommitted local pinned `railway.json` must not be pushed.
3. Verify Railway `/health` and one authenticated preview endpoint.
4. Deploy frontend from repository root with `npx netlify deploy --prod --message "add transaction annulment"`.
5. Verify `/sales`, `/purchase-orders`, and `/health` return HTTP 200.

- [ ] **Step 10: Final evidence report**

Report:

- migration revision;
- backend/frontend test counts;
- build result;
- browser scenario result;
- backend health URL;
- Netlify production and unique deploy URLs;
- commit hashes;
- any legacy purchases blocked by conservative safety rules.

---

## Plan Self-Review

- Spec coverage: permissions, audit metadata, sale net restoration, purchase blockers, FIFO lineage and valuation, displayed average cost, legacy cutover, Russian UI, idempotency, reports, tests, and deployment each have explicit tasks.
- Type consistency: `VoidRequest`, `VoidPreview`, `ReversalBlocker`, `InventoryImpact`, and `VoidResult` are defined once and used by both backend endpoints and frontend contracts.
- Transaction consistency: every stock path is migrated to `InventoryLedgerService` before reversal endpoints are added.
- Safety consistency: negative stock and unallocated overselling are rejected; purchase preview is rechecked under locks at execution time.
- Placeholder scan: no deferred implementation markers remain.
