# Purchase Order #15 Production Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the three known ledger anomalies around production purchase order `#15` and void it atomically as admin `shohrom` (`user_id=4`).

**Architecture:** Add a production-specific maintenance script whose repair function accepts an explicit immutable state specification. It locks and validates every target row, repairs balances through the existing ledger arithmetic, calls the normal purchase reversal service, validates postconditions, and leaves commit/rollback to the CLI. The CLI is rollback-only by default, requires `--apply` to commit, and supports an independent `--verify` pass.

**Tech Stack:** Python 3, SQLAlchemy ORM, PostgreSQL row locks, existing Sellary inventory ledger and transaction reversal services, pytest.

---

## File structure

- Create `sellary-backend/repair_purchase_15.py`: immutable production repair specification, precondition validation, repair orchestration, postcondition verification, and dry-run/apply/verify CLI.
- Create `sellary-backend/tests/unit/test_purchase_15_repair.py`: a ledger-backed reproduction covering successful atomic repair plus refusal on changed downstream state.
- Do not modify general purchase, product, or ledger behavior in this emergency repair. The permanent product-delete fix remains separate follow-up scope.

### Task 1: Add the failing repair regression tests

**Files:**
- Create: `sellary-backend/tests/unit/test_purchase_15_repair.py`
- Test: `sellary-backend/tests/unit/test_purchase_15_repair.py`

- [ ] **Step 1: Write the production-shape fixture and success test**

Create `sellary-backend/tests/unit/test_purchase_15_repair.py` with this content:

```python
from decimal import Decimal

import pytest

from models.inventory_layer import InventoryAllocation
from models.inventory_log import InventoryLog
from models.product import Product
from models.purchase_order import PurchaseOrderStatus
from models.purchase_order_item import PurchaseOrderItem
from models.purchase_receipt import PurchaseReceiptItem
from repair_purchase_15 import (
    GhostBalanceExpectation,
    ProductExpectation,
    ReleaseExpectation,
    RepairPreconditionError,
    RepairSpec,
    repair_and_void,
)
from services.inventory_ledger_service import InventoryLedgerService
from services.product_service import ProductService
from services.transaction_reversal_service import TransactionReversalService


def build_broken_purchase_case(
    db_session,
    partially_received_po,
    admin_user,
    test_category,
):
    purchase = partially_received_po
    company_id = purchase.company_id
    receipt = purchase.receipts[0]
    deleted_product = purchase.items[0].product
    deleted_layer = receipt.items[0].inventory_layer

    # Reproduce the normal product-delete blocker: the receipt layer is fully
    # consumed and its allocation remains active.
    assert ProductService(db_session, company_id).delete(
        deleted_product.id,
        admin_user.id,
    )
    db_session.flush()
    deleted_allocation = (
        db_session.query(InventoryAllocation)
        .filter(
            InventoryAllocation.layer_id == deleted_layer.id,
            InventoryAllocation.consumer_type == "product_delete",
        )
        .one()
    )

    # Reproduce the delete fallback drift: product balance is zero, while the
    # purchase layer still contains all six units.
    ghost_product = Product(
        company_id=company_id,
        name="Ghost receipt product",
        barcode="GHOST-PO-REPAIR",
        category_id=test_category.id,
        cost_price=Decimal("3.0000"),
        sell_price=Decimal("9.00"),
        stock_quantity=Decimal("0"),
        inventory_value=Decimal("0.0000"),
        min_stock_level=Decimal("0"),
        is_active=True,
    )
    db_session.add(ghost_product)
    db_session.flush()
    po_item = PurchaseOrderItem(
        purchase_order_id=purchase.id,
        product_id=ghost_product.id,
        quantity_ordered=Decimal("6"),
        quantity_received=Decimal("6"),
        unit_cost=Decimal("7.0000"),
        subtotal=Decimal("42.00"),
    )
    db_session.add(po_item)
    db_session.flush()
    receipt_item = PurchaseReceiptItem(
        purchase_receipt_id=receipt.id,
        purchase_order_item_id=po_item.id,
        product_id=ghost_product.id,
        quantity=Decimal("6"),
        unit_cost=Decimal("7.0000"),
    )
    db_session.add(receipt_item)
    db_session.flush()
    ledger = InventoryLedgerService(db_session, company_id)
    ledger.add_layer(
        product=ghost_product,
        quantity=Decimal("6"),
        unit_cost=Decimal("7.0000"),
        source_type="purchase_receipt_item",
        source_id=receipt_item.id,
        user_id=admin_user.id,
        reason=f"Restock via PO #{purchase.id}",
        reference_type="po_receive",
        reference_id=purchase.id,
        purchase_receipt_item_id=receipt_item.id,
    )
    ghost_layer = receipt_item.inventory_layer
    ghost_product.stock_quantity = Decimal("0")
    ghost_product.inventory_value = Decimal("0.0000")
    ghost_product.is_active = False
    db_session.flush()

    db_session.expire_all()
    deleted_product = db_session.get(Product, deleted_product.id)
    ghost_product = db_session.get(Product, ghost_product.id)
    spec = RepairSpec(
        company_id=company_id,
        po_id=purchase.id,
        receipt_id=receipt.id,
        user_id=admin_user.id,
        reason="Approved ledger repair for purchase test",
        expected_layer_ids=(deleted_layer.id, ghost_layer.id),
        products=(
            ProductExpectation(
                product_id=deleted_product.id,
                pre_quantity=Decimal(deleted_product.stock_quantity),
                pre_value=Decimal(deleted_product.inventory_value),
                pre_cost=Decimal(deleted_product.cost_price),
                is_active=False,
                final_quantity=Decimal("0"),
                final_value=Decimal("0.0000"),
                final_cost=Decimal(deleted_product.cost_price),
            ),
            ProductExpectation(
                product_id=ghost_product.id,
                pre_quantity=Decimal("0"),
                pre_value=Decimal("0.0000"),
                pre_cost=Decimal(ghost_product.cost_price),
                is_active=False,
                final_quantity=Decimal("0"),
                final_value=Decimal("0.0000"),
                final_cost=Decimal(ghost_product.cost_price),
            ),
        ),
        releases=(
            ReleaseExpectation(
                allocation_id=deleted_allocation.id,
                layer_id=deleted_layer.id,
                product_id=deleted_product.id,
                quantity=Decimal("4"),
            ),
        ),
        ghosts=(
            GhostBalanceExpectation(
                layer_id=ghost_layer.id,
                product_id=ghost_product.id,
                quantity=Decimal("6"),
            ),
        ),
    )
    return spec


def test_repair_releases_delete_allocation_repairs_ghost_and_voids(
    db_session,
    partially_received_po,
    admin_user,
    test_category,
):
    spec = build_broken_purchase_case(
        db_session,
        partially_received_po,
        admin_user,
        test_category,
    )
    before = TransactionReversalService(db_session, spec.company_id).preview_purchase(
        spec.po_id
    )
    assert before.can_void is False
    assert len(before.blockers) == 1

    report = repair_and_void(db_session, spec)

    assert report["purchase_status"] == "cancelled"
    assert report["voided_by_user_id"] == admin_user.id
    purchase = partially_received_po
    db_session.refresh(purchase)
    assert purchase.status == PurchaseOrderStatus.CANCELLED
    for expectation in spec.products:
        product = db_session.get(Product, expectation.product_id)
        assert Decimal(product.stock_quantity) == expectation.final_quantity
        assert Decimal(product.inventory_value) == expectation.final_value
        assert Decimal(product.cost_price) == expectation.final_cost
        assert product.is_active is expectation.is_active
    allocation = db_session.get(InventoryAllocation, spec.releases[0].allocation_id)
    assert allocation.released_quantity == allocation.quantity
    repair_logs = (
        db_session.query(InventoryLog)
        .filter(
            InventoryLog.reference_type == "purchase_void_repair",
            InventoryLog.reference_id == spec.po_id,
            InventoryLog.reversal_operation_id == purchase.reversal_operation_id,
        )
        .all()
    )
    assert len(repair_logs) == 2


def test_repair_refuses_changed_allocation_before_mutating(
    db_session,
    partially_received_po,
    admin_user,
    test_category,
):
    spec = build_broken_purchase_case(
        db_session,
        partially_received_po,
        admin_user,
        test_category,
    )
    allocation = db_session.get(InventoryAllocation, spec.releases[0].allocation_id)
    allocation.consumer_type = "manual_adjustment"
    db_session.flush()
    stocks_before = {
        item.product_id: Decimal(db_session.get(Product, item.product_id).stock_quantity)
        for item in spec.products
    }

    with pytest.raises(RepairPreconditionError, match="consumer_type"):
        repair_and_void(db_session, spec)

    for expectation in spec.products:
        product = db_session.get(Product, expectation.product_id)
        assert Decimal(product.stock_quantity) == stocks_before[expectation.product_id]
```

- [ ] **Step 2: Run the focused tests and verify they fail for the missing module**

Run from `sellary-backend`:

```powershell
.venv\Scripts\pytest.exe tests/unit/test_purchase_15_repair.py -v
```

Expected: collection fails with `ModuleNotFoundError: No module named 'repair_purchase_15'`.

- [ ] **Step 3: Commit the red test**

```powershell
git add -- tests/unit/test_purchase_15_repair.py
git commit -m "test: reproduce purchase 15 ledger repair"
```

### Task 2: Implement the guarded one-time repair

**Files:**
- Create: `sellary-backend/repair_purchase_15.py`
- Test: `sellary-backend/tests/unit/test_purchase_15_repair.py`

- [ ] **Step 1: Create the immutable specification and repair implementation**

Create `sellary-backend/repair_purchase_15.py` with this content:

```python
from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from core.config import settings
from models.company_membership import CompanyMembership
from models.inventory_layer import InventoryAllocation, InventoryLayer
from models.inventory_log import InventoryLog
from models.product import Product
from models.purchase_order import PurchaseOrder, PurchaseOrderStatus
from models.purchase_receipt import PurchaseReceipt, PurchaseReceiptItem
from models.user import User
from services.inventory_ledger_service import InventoryLedgerService, MONEY_QUANT
from services.transaction_reversal_service import TransactionReversalService


class RepairPreconditionError(RuntimeError):
    pass


@dataclass(frozen=True)
class ProductExpectation:
    product_id: int
    pre_quantity: Decimal
    pre_value: Decimal
    pre_cost: Decimal
    is_active: bool
    final_quantity: Decimal
    final_value: Decimal
    final_cost: Decimal


@dataclass(frozen=True)
class ReleaseExpectation:
    allocation_id: int
    layer_id: int
    product_id: int
    quantity: Decimal


@dataclass(frozen=True)
class GhostBalanceExpectation:
    layer_id: int
    product_id: int
    quantity: Decimal


@dataclass(frozen=True)
class RepairSpec:
    company_id: int
    po_id: int
    receipt_id: int
    user_id: int
    reason: str
    expected_layer_ids: tuple[int, ...]
    products: tuple[ProductExpectation, ...]
    releases: tuple[ReleaseExpectation, ...]
    ghosts: tuple[GhostBalanceExpectation, ...]


PRODUCTION_SPEC = RepairSpec(
    company_id=2,
    po_id=15,
    receipt_id=5,
    user_id=4,
    reason="Approved ledger repair for purchase #15",
    expected_layer_ids=(246, 247, 248, 249),
    products=(
        ProductExpectation(279, Decimal("6"), Decimal("73.2000"), Decimal("12.2000"), True, Decimal("6"), Decimal("73.2000"), Decimal("12.2000")),
        ProductExpectation(250, Decimal("12"), Decimal("104.9958"), Decimal("8.7496"), True, Decimal("6"), Decimal("49.9998"), Decimal("8.3333")),
        ProductExpectation(252, Decimal("0"), Decimal("0.0000"), Decimal("1.8333"), False, Decimal("0"), Decimal("0.0000"), Decimal("1.8333")),
        ProductExpectation(280, Decimal("0"), Decimal("0.0000"), Decimal("11.5000"), False, Decimal("0"), Decimal("0.0000"), Decimal("11.5000")),
    ),
    releases=(
        ReleaseExpectation(29, 246, 279, Decimal("10")),
        ReleaseExpectation(27, 249, 280, Decimal("5")),
    ),
    ghosts=(GhostBalanceExpectation(248, 252, Decimal("6")),),
)


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise RepairPreconditionError(message)


def _lock_and_validate(db: Session, spec: RepairSpec):
    po = (
        db.query(PurchaseOrder)
        .filter(
            PurchaseOrder.company_id == spec.company_id,
            PurchaseOrder.id == spec.po_id,
        )
        .with_for_update()
        .one_or_none()
    )
    _require(po is not None, f"Purchase #{spec.po_id} not found")
    _require(po.voided_at is None, f"Purchase #{spec.po_id} is already voided")
    _require(
        po.status in (PurchaseOrderStatus.PARTIALLY_RECEIVED, PurchaseOrderStatus.RECEIVED),
        f"Unexpected purchase status: {po.status}",
    )

    user = db.query(User).filter(User.id == spec.user_id).with_for_update().one_or_none()
    membership = (
        db.query(CompanyMembership)
        .filter(
            CompanyMembership.company_id == spec.company_id,
            CompanyMembership.user_id == spec.user_id,
            CompanyMembership.role == "admin",
            CompanyMembership.is_active.is_(True),
        )
        .one_or_none()
    )
    _require(user is not None and user.is_active, f"User #{spec.user_id} is not active")
    _require(membership is not None, f"User #{spec.user_id} is not an active company admin")

    receipt = (
        db.query(PurchaseReceipt)
        .filter(
            PurchaseReceipt.id == spec.receipt_id,
            PurchaseReceipt.company_id == spec.company_id,
            PurchaseReceipt.purchase_order_id == spec.po_id,
        )
        .with_for_update()
        .one_or_none()
    )
    _require(receipt is not None, f"Receipt #{spec.receipt_id} not found")
    _require(receipt.reversed_at is None, f"Receipt #{spec.receipt_id} is already reversed")
    receipt_items = (
        db.query(PurchaseReceiptItem)
        .filter(PurchaseReceiptItem.purchase_receipt_id == spec.receipt_id)
        .order_by(PurchaseReceiptItem.id)
        .with_for_update()
        .all()
    )
    layers = (
        db.query(InventoryLayer)
        .filter(InventoryLayer.id.in_(spec.expected_layer_ids))
        .order_by(InventoryLayer.id)
        .with_for_update()
        .all()
    )
    _require(
        {layer.id for layer in layers} == set(spec.expected_layer_ids),
        "Expected purchase layers changed",
    )
    _require(
        {layer.purchase_receipt_item_id for layer in layers}
        == {item.id for item in receipt_items},
        "Receipt items no longer match expected layers",
    )
    for layer in layers:
        _require(layer.company_id == spec.company_id, f"Layer #{layer.id} company mismatch")
        _require(layer.reversed_at is None, f"Layer #{layer.id} is already reversed")

    product_ids = [item.product_id for item in spec.products]
    products = (
        db.query(Product)
        .filter(
            Product.company_id == spec.company_id,
            Product.id.in_(product_ids),
        )
        .order_by(Product.id)
        .with_for_update()
        .all()
    )
    _require({product.id for product in products} == set(product_ids), "Expected products changed")
    products_by_id = {product.id: product for product in products}
    for expectation in spec.products:
        product = products_by_id[expectation.product_id]
        _require(Decimal(product.stock_quantity) == expectation.pre_quantity, f"Product #{product.id} quantity changed")
        _require(Decimal(product.inventory_value) == expectation.pre_value, f"Product #{product.id} value changed")
        _require(Decimal(product.cost_price) == expectation.pre_cost, f"Product #{product.id} cost changed")
        _require(product.is_active is expectation.is_active, f"Product #{product.id} active flag changed")

    active_allocations = (
        db.query(InventoryAllocation)
        .filter(
            InventoryAllocation.layer_id.in_(spec.expected_layer_ids),
            InventoryAllocation.quantity > InventoryAllocation.released_quantity,
        )
        .order_by(InventoryAllocation.id)
        .with_for_update()
        .all()
    )
    expected_allocation_ids = {item.allocation_id for item in spec.releases}
    _require(
        {allocation.id for allocation in active_allocations} == expected_allocation_ids,
        "Active downstream allocations changed",
    )
    allocations_by_id = {allocation.id: allocation for allocation in active_allocations}
    layers_by_id = {layer.id: layer for layer in layers}
    for expectation in spec.releases:
        allocation = allocations_by_id[expectation.allocation_id]
        layer = layers_by_id[expectation.layer_id]
        _require(allocation.layer_id == expectation.layer_id, f"Allocation #{allocation.id} layer changed")
        _require(allocation.product_id == expectation.product_id, f"Allocation #{allocation.id} product changed")
        _require(allocation.consumer_type == "product_delete", f"Allocation #{allocation.id} consumer_type changed")
        _require(allocation.consumer_id == expectation.product_id, f"Allocation #{allocation.id} consumer changed")
        _require(allocation.sale_item_id is None, f"Allocation #{allocation.id} unexpectedly belongs to a sale")
        _require(Decimal(allocation.quantity) == expectation.quantity, f"Allocation #{allocation.id} quantity changed")
        _require(Decimal(allocation.released_quantity) == Decimal("0"), f"Allocation #{allocation.id} was already released")
        _require(
            Decimal(layer.remaining_quantity) + expectation.quantity == Decimal(layer.original_quantity),
            f"Layer #{layer.id} does not match its delete allocation",
        )
    for expectation in spec.ghosts:
        layer = layers_by_id[expectation.layer_id]
        _require(layer.product_id == expectation.product_id, f"Ghost layer #{layer.id} product changed")
        _require(Decimal(layer.original_quantity) == expectation.quantity, f"Ghost layer #{layer.id} original quantity changed")
        _require(Decimal(layer.remaining_quantity) == expectation.quantity, f"Ghost layer #{layer.id} remaining quantity changed")
    repaired_layer_ids = {item.layer_id for item in spec.releases} | {item.layer_id for item in spec.ghosts}
    for layer in layers:
        if layer.id not in repaired_layer_ids:
            _require(
                Decimal(layer.remaining_quantity) == Decimal(layer.original_quantity),
                f"Layer #{layer.id} gained downstream consumption",
            )
    return po, receipt, layers_by_id, products_by_id, allocations_by_id


def verify_completed_repair(db: Session, spec: RepairSpec) -> dict:
    po = db.query(PurchaseOrder).filter(PurchaseOrder.id == spec.po_id).one()
    _require(po.status == PurchaseOrderStatus.CANCELLED, "Purchase is not cancelled")
    _require(po.voided_at is not None, "Purchase has no void timestamp")
    _require(po.voided_by_user_id == spec.user_id, "Purchase void user mismatch")
    _require(po.reversal_operation_id is not None, "Purchase has no reversal operation")
    receipt = db.query(PurchaseReceipt).filter(PurchaseReceipt.id == spec.receipt_id).one()
    _require(receipt.reversed_at is not None, "Receipt is not reversed")
    _require(receipt.reversal_operation_id == po.reversal_operation_id, "Receipt reversal operation mismatch")
    layers = db.query(InventoryLayer).filter(InventoryLayer.id.in_(spec.expected_layer_ids)).all()
    for layer in layers:
        _require(layer.reversed_at is not None, f"Layer #{layer.id} is not reversed")
        _require(Decimal(layer.remaining_quantity) == Decimal("0"), f"Layer #{layer.id} is not empty")
        _require(layer.reversal_operation_id == po.reversal_operation_id, f"Layer #{layer.id} reversal operation mismatch")
    for expectation in spec.releases:
        allocation = db.query(InventoryAllocation).filter(InventoryAllocation.id == expectation.allocation_id).one()
        _require(Decimal(allocation.released_quantity) == Decimal(allocation.quantity), f"Allocation #{allocation.id} is still active")
    product_state = {}
    for expectation in spec.products:
        product = db.query(Product).filter(Product.id == expectation.product_id).one()
        _require(Decimal(product.stock_quantity) == expectation.final_quantity, f"Product #{product.id} final quantity mismatch")
        _require(Decimal(product.inventory_value) == expectation.final_value, f"Product #{product.id} final value mismatch")
        _require(Decimal(product.cost_price) == expectation.final_cost, f"Product #{product.id} final cost mismatch")
        _require(product.is_active is expectation.is_active, f"Product #{product.id} active flag changed")
        _require(Decimal(product.stock_quantity) >= 0, f"Product #{product.id} has negative stock")
        _require(Decimal(product.inventory_value) >= 0, f"Product #{product.id} has negative value")
        product_state[str(product.id)] = {
            "quantity": str(product.stock_quantity),
            "inventory_value": str(product.inventory_value),
            "cost_price": str(product.cost_price),
            "is_active": product.is_active,
        }
    repair_log_count = (
        db.query(InventoryLog)
        .filter(
            InventoryLog.reference_type == "purchase_void_repair",
            InventoryLog.reference_id == spec.po_id,
            InventoryLog.reversal_operation_id == po.reversal_operation_id,
        )
        .count()
    )
    _require(repair_log_count == len(spec.releases) + len(spec.ghosts), "Repair audit log count mismatch")
    return {
        "purchase_id": po.id,
        "purchase_status": po.status.value,
        "voided_by_user_id": po.voided_by_user_id,
        "reversal_operation_id": po.reversal_operation_id,
        "products": product_state,
        "repair_log_count": repair_log_count,
    }


def repair_and_void(db: Session, spec: RepairSpec) -> dict:
    _, _, layers, products, allocations = _lock_and_validate(db, spec)
    ledger = InventoryLedgerService(db, spec.company_id)
    repair_logs = []
    for expectation in spec.releases:
        allocation = allocations[expectation.allocation_id]
        layer = layers[expectation.layer_id]
        product = products[expectation.product_id]
        value = (expectation.quantity * Decimal(layer.unit_cost)).quantize(MONEY_QUANT)
        allocation.released_quantity = Decimal(allocation.released_quantity) + expectation.quantity
        layer.remaining_quantity = Decimal(layer.remaining_quantity) + expectation.quantity
        previous_quantity, new_quantity = ledger._apply_balance(product, expectation.quantity, value)
        repair_logs.append(
            ledger.repo.create_log(
                company_id=spec.company_id,
                product_id=product.id,
                user_id=spec.user_id,
                quantity_change=expectation.quantity,
                value_change=value,
                previous_quantity=previous_quantity,
                new_quantity=new_quantity,
                reason=f"One-time repair before purchase #{spec.po_id} void: release product_delete allocation #{allocation.id}",
                reference_type="purchase_void_repair",
                reference_id=spec.po_id,
            )
        )
    for expectation in spec.ghosts:
        layer = layers[expectation.layer_id]
        product = products[expectation.product_id]
        value = (expectation.quantity * Decimal(layer.unit_cost)).quantize(MONEY_QUANT)
        previous_quantity, new_quantity = ledger._apply_balance(product, expectation.quantity, value)
        repair_logs.append(
            ledger.repo.create_log(
                company_id=spec.company_id,
                product_id=product.id,
                user_id=spec.user_id,
                quantity_change=expectation.quantity,
                value_change=value,
                previous_quantity=previous_quantity,
                new_quantity=new_quantity,
                reason=f"One-time repair before purchase #{spec.po_id} void: restore ghost receipt layer #{layer.id}",
                reference_type="purchase_void_repair",
                reference_id=spec.po_id,
            )
        )
    db.flush()
    preview = TransactionReversalService(db, spec.company_id).preview_purchase(spec.po_id)
    _require(preview.can_void, "Purchase preview is still blocked after repair")
    _require(not preview.blockers, "Purchase preview returned blockers after repair")
    projected = {impact.product_id: Decimal(impact.resulting_stock) for impact in preview.impacts}
    for expectation in spec.products:
        _require(projected.get(expectation.product_id) == expectation.final_quantity, f"Product #{expectation.product_id} projection mismatch")
        _require(expectation.final_quantity >= 0, f"Product #{expectation.product_id} projection is negative")

    result = TransactionReversalService(db, spec.company_id).void_purchase(
        spec.po_id,
        spec.reason,
        spec.user_id,
    )
    for log in repair_logs:
        log.reversal_operation_id = result.operation_id
    for expectation in spec.products:
        if expectation.final_quantity == 0:
            products[expectation.product_id].cost_price = expectation.final_cost
    db.flush()
    return verify_completed_repair(db, spec)


def main() -> int:
    parser = argparse.ArgumentParser(description="Guarded repair and void for production purchase #15")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="Commit the repair; default is rollback-only dry-run")
    mode.add_argument("--verify", action="store_true", help="Verify an already committed repair without mutations")
    args = parser.parse_args()
    database_url = os.getenv("DATABASE_PUBLIC_URL") or settings.DATABASE_URL
    engine = create_engine(database_url, pool_pre_ping=True)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = SessionLocal()
    try:
        if args.verify:
            report = verify_completed_repair(db, PRODUCTION_SPEC)
            db.rollback()
            mode_name = "VERIFIED"
        else:
            report = repair_and_void(db, PRODUCTION_SPEC)
            if args.apply:
                db.commit()
                mode_name = "APPLIED"
            else:
                db.rollback()
                mode_name = "DRY_RUN_ROLLED_BACK"
        print(f"{mode_name} {json.dumps(report, ensure_ascii=False, default=str, sort_keys=True)}")
        return 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run the focused tests and verify they pass**

```powershell
.venv\Scripts\pytest.exe tests/unit/test_purchase_15_repair.py -v
```

Expected: `2 passed`.

- [ ] **Step 3: Run adjacent reversal tests**

```powershell
.venv\Scripts\pytest.exe tests/unit/test_transaction_reversal_service.py -v
```

Expected: all tests pass.

- [ ] **Step 4: Run the backend compile check**

```powershell
.venv\Scripts\python.exe -m compileall api core models repositories schemas services repair_purchase_15.py main.py
```

Expected: exit code `0`, with no syntax errors.

- [ ] **Step 5: Commit the implementation**

```powershell
git add -- repair_purchase_15.py tests/unit/test_purchase_15_repair.py
git commit -m "fix: add guarded purchase 15 ledger repair"
```

### Task 3: Execute the rollback-only production dry-run

**Files:**
- Use: `sellary-backend/repair_purchase_15.py`
- Verify: Railway production PostgreSQL rows scoped to company `2`, purchase `15`

- [ ] **Step 1: Confirm the worktree contains only intended committed changes**

Run from the repository root:

```powershell
git status --short
git log -3 --oneline
```

Expected: empty status; the repair test and implementation commits are the latest relevant commits.

- [ ] **Step 2: Run the production repair without `--apply`**

Run from `sellary-backend`:

```powershell
railway run --service Postgres --environment production -- .venv\Scripts\python.exe repair_purchase_15.py
```

Expected: exit code `0`, prefix `DRY_RUN_ROLLED_BACK`, purchase status `cancelled` inside the projection, `voided_by_user_id` equal to `4`, and final quantities `279=6`, `250=6`, `252=0`, `280=0`.

- [ ] **Step 3: Confirm dry-run rollback from a fresh connection**

```powershell
railway run --service Postgres --environment production -- .venv\Scripts\python.exe -c "import os; from sqlalchemy import create_engine,text; e=create_engine(os.environ['DATABASE_PUBLIC_URL']); c=e.connect(); print(dict(c.execute(text('SELECT id,status,voided_at,reversal_operation_id FROM purchase_orders WHERE id=15')).mappings().one())); c.close(); e.dispose()"
```

Expected: `status='received'`, `voided_at=None`, and `reversal_operation_id=None`.

### Task 4: Apply and independently verify the production repair

**Files:**
- Use: `sellary-backend/repair_purchase_15.py`
- Mutate: only the locked company `2` / purchase `15` rows described in the approved design

- [ ] **Step 1: Apply the exact dry-run transaction**

Run from `sellary-backend`:

```powershell
railway run --service Postgres --environment production -- .venv\Scripts\python.exe repair_purchase_15.py --apply
```

Expected: exit code `0`, prefix `APPLIED`, purchase status `cancelled`, `voided_by_user_id=4`, one reversal operation, three repair audit logs, and the approved final product quantities and values.

- [ ] **Step 2: Verify committed state from a new database session**

```powershell
railway run --service Postgres --environment production -- .venv\Scripts\python.exe repair_purchase_15.py --verify
```

Expected: exit code `0`, prefix `VERIFIED`, and the same reversal operation and product state reported by the apply command.

- [ ] **Step 3: Confirm the public API remains healthy**

```powershell
(Invoke-WebRequest -UseBasicParsing -Uri 'https://sellary-production-30ec.up.railway.app/health' -TimeoutSec 15).Content
```

Expected: `{"status":"healthy","name":"Sellary","version":"1.0.0"}`.

- [ ] **Step 4: Record the operation result without exposing secrets**

Report the reversal operation ID, final purchase status, audit user `shohrom`, final quantities for products `279`, `250`, `252`, and `280`, focused/adjacent test results, and health-check result. Do not print or store Railway database URLs or credentials.
