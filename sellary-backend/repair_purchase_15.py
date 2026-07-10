"""One-time guarded repair + void for production purchase order #15 (company 2).

Purchase #15 cannot be voided through the app because of two historical ledger
anomalies created by the (now-fixed) product-delete path:

  * products 279 and 280 were deleted, leaving ``product_delete`` allocations
    (#29, #27) on the purchase's layers (246, 249). The hardened void path now
    releases these automatically.
  * product 252 is a "ghost": its purchase layer (248) still holds 6 units while
    the product balance is 0. Reversing that layer would drive the balance
    negative, so the void safely rolls back. This script reconciles the 6 ghost
    units back onto the balance first, then runs the normal hardened void.

Safety: every mutation runs in ONE transaction. The script locks and validates
the exact expected production state before touching anything, and rolls back on
any mismatch. It is rollback-only (dry-run) by default; pass ``--apply`` to
commit. Uses DATABASE_PUBLIC_URL / DATABASE_URL from the environment (injected by
`railway run`); it never prints secrets.
"""
from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass, field
from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from models.company_membership import CompanyMembership
from models.inventory_layer import InventoryAllocation, InventoryLayer
from models.inventory_log import InventoryLog
from models.product import Product
from models.purchase_order import PurchaseOrder, PurchaseOrderStatus
from models.purchase_receipt import PurchaseReceipt, PurchaseReceiptItem
from models.user import User
from services.inventory_ledger_service import MONEY_QUANT, InventoryLedgerService
from services.transaction_reversal_service import TransactionReversalService

COMPANY_ID = 2
PO_ID = 15
RECEIPT_ID = 5
USER_ID = 4  # shohrom (company 2 admin)
REASON = "Аннулирование закупки #15: ремонт реестра (release product_delete + ghost 252)"

GHOST_LAYER_ID = 248
GHOST_PRODUCT_ID = 252
GHOST_QUANTITY = Decimal("6")


class RepairPreconditionError(RuntimeError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise RepairPreconditionError(message)


def _dec(value) -> Decimal:
    return Decimal(str(value))


@dataclass(frozen=True)
class LayerExpectation:
    layer_id: int
    product_id: int
    original_quantity: Decimal
    remaining_quantity: Decimal
    unit_cost: Decimal


@dataclass(frozen=True)
class AllocationExpectation:
    allocation_id: int
    layer_id: int
    product_id: int
    quantity: Decimal


@dataclass(frozen=True)
class ProductExpectation:
    product_id: int
    is_active: bool
    pre_quantity: Decimal
    pre_value: Decimal
    pre_cost: Decimal
    final_quantity: Decimal
    final_value: Decimal
    final_cost: Decimal


LAYERS = (
    LayerExpectation(246, 279, Decimal("10"), Decimal("0"), Decimal("12.2000")),
    LayerExpectation(247, 250, Decimal("6"), Decimal("6"), Decimal("9.1660")),
    LayerExpectation(248, 252, Decimal("6"), Decimal("6"), Decimal("9.1666")),
    LayerExpectation(249, 280, Decimal("5"), Decimal("0"), Decimal("11.5000")),
)
ALLOCATIONS = (
    AllocationExpectation(29, 246, 279, Decimal("10")),
    AllocationExpectation(27, 249, 280, Decimal("5")),
)
PRODUCTS = (
    ProductExpectation(279, True, Decimal("6"), Decimal("73.2000"), Decimal("12.2000"),
                       Decimal("6"), Decimal("73.2000"), Decimal("12.2000")),
    ProductExpectation(250, True, Decimal("12"), Decimal("104.9958"), Decimal("8.7496"),
                       Decimal("6"), Decimal("49.9998"), Decimal("8.3333")),
    ProductExpectation(252, False, Decimal("0"), Decimal("0.0000"), Decimal("1.8333"),
                       Decimal("0"), Decimal("0.0000"), Decimal("1.8333")),
    ProductExpectation(280, False, Decimal("0"), Decimal("0.0000"), Decimal("11.5000"),
                       Decimal("0"), Decimal("0.0000"), Decimal("11.5000")),
)
EXPECTED_LAYER_IDS = tuple(sorted(layer.layer_id for layer in LAYERS))


def _lock_and_validate(db: Session):
    po = (
        db.query(PurchaseOrder)
        .filter(PurchaseOrder.company_id == COMPANY_ID, PurchaseOrder.id == PO_ID)
        .with_for_update()
        .one_or_none()
    )
    _require(po is not None, f"Purchase #{PO_ID} not found")
    _require(po.voided_at is None, f"Purchase #{PO_ID} is already voided")
    _require(po.status == PurchaseOrderStatus.RECEIVED, f"Unexpected purchase status: {po.status}")

    user = db.query(User).filter(User.id == USER_ID).with_for_update().one_or_none()
    _require(user is not None and user.is_active, f"User #{USER_ID} is not active")
    membership = (
        db.query(CompanyMembership)
        .filter(
            CompanyMembership.company_id == COMPANY_ID,
            CompanyMembership.user_id == USER_ID,
            CompanyMembership.is_active.is_(True),
        )
        .one_or_none()
    )
    _require(membership is not None, f"User #{USER_ID} has no active membership in company #{COMPANY_ID}")

    receipt = (
        db.query(PurchaseReceipt)
        .filter(
            PurchaseReceipt.id == RECEIPT_ID,
            PurchaseReceipt.company_id == COMPANY_ID,
            PurchaseReceipt.purchase_order_id == PO_ID,
        )
        .with_for_update()
        .one_or_none()
    )
    _require(receipt is not None, f"Receipt #{RECEIPT_ID} not found")
    _require(receipt.reversed_at is None, f"Receipt #{RECEIPT_ID} is already reversed")

    layers = (
        db.query(InventoryLayer)
        .filter(InventoryLayer.id.in_(EXPECTED_LAYER_IDS))
        .order_by(InventoryLayer.id)
        .with_for_update()
        .all()
    )
    _require({l.id for l in layers} == set(EXPECTED_LAYER_IDS), "Expected purchase layers changed")
    layers_by_id = {l.id: l for l in layers}
    for exp in LAYERS:
        layer = layers_by_id[exp.layer_id]
        _require(layer.company_id == COMPANY_ID, f"Layer #{layer.id} company mismatch")
        _require(layer.reversed_at is None, f"Layer #{layer.id} already reversed")
        _require(layer.product_id == exp.product_id, f"Layer #{layer.id} product changed")
        _require(_dec(layer.original_quantity) == exp.original_quantity, f"Layer #{layer.id} original_quantity changed")
        _require(_dec(layer.remaining_quantity) == exp.remaining_quantity, f"Layer #{layer.id} remaining_quantity changed")
        _require(_dec(layer.unit_cost) == exp.unit_cost, f"Layer #{layer.id} unit_cost changed")

    active_allocations = (
        db.query(InventoryAllocation)
        .filter(
            InventoryAllocation.layer_id.in_(EXPECTED_LAYER_IDS),
            InventoryAllocation.quantity > InventoryAllocation.released_quantity,
        )
        .order_by(InventoryAllocation.id)
        .with_for_update()
        .all()
    )
    _require(
        {a.id for a in active_allocations} == {a.allocation_id for a in ALLOCATIONS},
        "Active downstream allocations changed",
    )
    allocations_by_id = {a.id: a for a in active_allocations}
    for exp in ALLOCATIONS:
        alloc = allocations_by_id[exp.allocation_id]
        _require(alloc.layer_id == exp.layer_id, f"Allocation #{alloc.id} layer changed")
        _require(alloc.product_id == exp.product_id, f"Allocation #{alloc.id} product changed")
        _require(alloc.consumer_type == "product_delete", f"Allocation #{alloc.id} consumer_type changed")
        _require(alloc.sale_item_id is None, f"Allocation #{alloc.id} unexpectedly belongs to a sale")
        _require(_dec(alloc.quantity) == exp.quantity, f"Allocation #{alloc.id} quantity changed")
        _require(_dec(alloc.released_quantity) == Decimal("0"), f"Allocation #{alloc.id} already released")

    products = (
        db.query(Product)
        .filter(Product.company_id == COMPANY_ID, Product.id.in_([p.product_id for p in PRODUCTS]))
        .order_by(Product.id)
        .with_for_update()
        .all()
    )
    _require({p.id for p in products} == {p.product_id for p in PRODUCTS}, "Expected products changed")
    products_by_id = {p.id: p for p in products}
    for exp in PRODUCTS:
        product = products_by_id[exp.product_id]
        _require(product.is_active is exp.is_active, f"Product #{product.id} active flag changed")
        _require(_dec(product.stock_quantity) == exp.pre_quantity, f"Product #{product.id} quantity changed")
        _require(_dec(product.inventory_value) == exp.pre_value, f"Product #{product.id} value changed")
        _require(_dec(product.cost_price) == exp.pre_cost, f"Product #{product.id} cost changed")

    return po, receipt, layers_by_id, products_by_id


def verify_completed(db: Session) -> dict:
    po = db.query(PurchaseOrder).filter(PurchaseOrder.id == PO_ID).one()
    _require(po.status == PurchaseOrderStatus.CANCELLED, "Purchase is not cancelled")
    _require(po.voided_at is not None, "Purchase has no void timestamp")
    _require(po.voided_by_user_id == USER_ID, "Purchase void user mismatch")
    _require(po.reversal_operation_id is not None, "Purchase has no reversal operation")

    receipt = db.query(PurchaseReceipt).filter(PurchaseReceipt.id == RECEIPT_ID).one()
    _require(receipt.reversed_at is not None, "Receipt is not reversed")
    _require(receipt.reversal_operation_id == po.reversal_operation_id, "Receipt reversal operation mismatch")

    layers = db.query(InventoryLayer).filter(InventoryLayer.id.in_(EXPECTED_LAYER_IDS)).all()
    for layer in layers:
        _require(layer.reversed_at is not None, f"Layer #{layer.id} is not reversed")
        _require(_dec(layer.remaining_quantity) == Decimal("0"), f"Layer #{layer.id} is not empty")
        _require(layer.reversal_operation_id == po.reversal_operation_id, f"Layer #{layer.id} reversal op mismatch")

    for exp in ALLOCATIONS:
        alloc = db.query(InventoryAllocation).filter(InventoryAllocation.id == exp.allocation_id).one()
        _require(_dec(alloc.released_quantity) == _dec(alloc.quantity), f"Allocation #{alloc.id} is still active")

    product_state = {}
    for exp in PRODUCTS:
        product = db.query(Product).filter(Product.id == exp.product_id).one()
        _require(_dec(product.stock_quantity) == exp.final_quantity, f"Product #{product.id} final quantity mismatch")
        _require(_dec(product.inventory_value) == exp.final_value, f"Product #{product.id} final value mismatch")
        _require(_dec(product.cost_price) == exp.final_cost, f"Product #{product.id} final cost mismatch")
        _require(product.is_active is exp.is_active, f"Product #{product.id} active flag changed")
        _require(_dec(product.stock_quantity) >= 0, f"Product #{product.id} has negative stock")
        _require(_dec(product.inventory_value) >= 0, f"Product #{product.id} has negative value")
        product_state[str(product.id)] = {
            "quantity": str(product.stock_quantity),
            "inventory_value": str(product.inventory_value),
            "cost_price": str(product.cost_price),
            "is_active": product.is_active,
        }

    return {
        "purchase_id": po.id,
        "purchase_status": po.status.value,
        "voided_by_user_id": po.voided_by_user_id,
        "reversal_operation_id": po.reversal_operation_id,
        "products": product_state,
    }


def repair_and_void(db: Session) -> dict:
    po, receipt, layers, products = _lock_and_validate(db)
    ledger = InventoryLedgerService(db, COMPANY_ID)

    # 1) Reconcile the ghost: restore layer 248's 6 units onto product 252 so the
    #    balance matches the layer before the void reverses it. Preserve the
    #    original cost_price (product ends at zero stock, so cost is vestigial).
    ghost_layer = layers[GHOST_LAYER_ID]
    ghost_product = products[GHOST_PRODUCT_ID]
    original_cost = _dec(ghost_product.cost_price)
    ghost_value = (GHOST_QUANTITY * _dec(ghost_layer.unit_cost)).quantize(MONEY_QUANT)
    prev_qty, new_qty = ledger._apply_balance(ghost_product, GHOST_QUANTITY, ghost_value)
    ghost_log = ledger.repo.create_log(
        company_id=COMPANY_ID,
        product_id=ghost_product.id,
        user_id=USER_ID,
        quantity_change=GHOST_QUANTITY,
        value_change=ghost_value,
        previous_quantity=prev_qty,
        new_quantity=new_qty,
        reason=f"One-time repair before purchase #{PO_ID} void: restore ghost receipt layer #{ghost_layer.id}",
        reference_type="purchase_void_repair",
        reference_id=PO_ID,
    )
    db.flush()

    # 2) Run the hardened, standard void. It releases the product_delete
    #    allocations (#29, #27) and reverses all four receipt layers.
    result = TransactionReversalService(db, COMPANY_ID).void_purchase(PO_ID, REASON, USER_ID)

    # 3) Tie the ghost-repair log to the same reversal operation and restore the
    #    product's original cost_price (now zero-stock).
    ghost_log.reversal_operation_id = result.operation_id
    ghost_product.cost_price = original_cost
    db.flush()

    report = verify_completed(db)
    report["ghost_repair_log_id"] = ghost_log.id
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Guarded repair + void for production purchase #15")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="Commit the repair; default is a rollback-only dry-run")
    mode.add_argument("--verify", action="store_true", help="Verify an already-committed repair (read-only)")
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_PUBLIC_URL") or os.getenv("DATABASE_URL")
    if not database_url:
        raise SystemExit("No DATABASE_PUBLIC_URL/DATABASE_URL in environment")
    engine = create_engine(database_url, pool_pre_ping=True)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = SessionLocal()
    try:
        if args.verify:
            report = verify_completed(db)
            db.rollback()
            mode_name = "VERIFIED"
        else:
            report = repair_and_void(db)
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
