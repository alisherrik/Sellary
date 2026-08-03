"""One-time guarded reconcile of FIFO layer/balance drift for company 2.

Four products carry more units in their open FIFO layers than on their product
balance. Every case was created by a June path that has since been fixed:

  * product 5  (+100) — 2026-06-15 "Корректировка остатка при редактировании
    товара" zeroed a 100-unit balance without draining the layers behind it.
  * product 34 (+1)   — same edit path on 2026-06-16 (1 unit).
  * product 36 (+6)   — the 2026-06-15 ledger backfill wrote a 30-unit
    opening_balance layer for a product whose balance was 0, and the PO #9
    receive (2026-06-16) raised the balance by 24 without creating a layer.
  * product 250 (+6)  — a pre-fix delete/recreate zeroed a 12-unit balance while
    layer #247 still held 6 units.

The balance is the truth: it is what the POS, every report and the physical
count are measured against. So this script shrinks the excess out of the oldest
open layers (FIFO order) and leaves stock_quantity, inventory_value and
cost_price untouched — no money figure the owner sees changes.

Both ``original_quantity`` and ``remaining_quantity`` shrink by the same amount,
so ``original = remaining + net allocations`` still holds and the layer keeps
saying how many units it actually put into the balance. That matters for a later
purchase void: ``reverse_unconsumed_layer`` subtracts ``original_quantity`` from
the balance, and subtracting the pre-repair 24 from a balance that only ever
received 18 would fail. The rejected alternative — parking the excess in a new
``ledger_repair`` allocation — would have blocked the void forever, because
nothing in the app can release such an allocation (only ``product_delete`` /
``product_recreate`` are releasable; see INTERNAL_WRITEOFF_CONSUMER_TYPES).

Note this repairs the drift in the opposite direction to repair_purchase_15.py,
which lifted a balance up to its layer. There the layer was a real purchase
receipt of goods that had arrived; here the surplus units never existed.

It never invents stock: layers only ever shrink, so nothing becomes sellable
that was not sellable before. It makes no business decision about how much is
on the shelf — a physical count is still an ordinary «Корректировка» in the app.

Safety: one transaction, rollback-only by default (--apply commits). The exact
production state is locked and validated before anything is touched, and the
post-conditions are re-checked before the commit. Uses DATABASE_PUBLIC_URL /
DATABASE_URL from the environment (injected by `railway run`); prints no secrets.
"""
from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import create_engine, func, text
from sqlalchemy.orm import Session, sessionmaker

from models.company_membership import CompanyMembership
from models.inventory_layer import InventoryAllocation, InventoryLayer
from models.inventory_log import InventoryLog
from models.product import Product
from models.user import User

QUANTITY_DRIFT_SQL = text(
    """
    select p.id, p.stock_quantity, coalesce(sum(l.remaining_quantity), 0) as layer_quantity
    from products p
    left join inventory_layers l
      on l.product_id = p.id and l.reversed_at is null
    where p.company_id = :company_id
    group by p.id, p.stock_quantity
    having coalesce(sum(l.remaining_quantity), 0) <> p.stock_quantity
    order by p.id
    """
)

# Every layer must still balance: original = remaining + net allocated.
LAYER_BALANCE_SQL = text(
    """
    select l.id, l.original_quantity, l.remaining_quantity, coalesce(a.net, 0) as net
    from inventory_layers l
    left join (
        select layer_id, sum(quantity - released_quantity) as net
        from inventory_allocations where company_id = :company_id group by layer_id
    ) a on a.layer_id = l.id
    where l.company_id = :company_id
      and l.reversed_at is null
      and l.remaining_quantity + coalesce(a.net, 0) <> l.original_quantity
    """
)

COMPANY_ID = 2
USER_ID = 4  # shohrom — company 2 admin, the user on the existing ledger logs
REFERENCE_TYPE = "ledger_repair"
REASON = "Ремонт реестра: снятие фантомных остатков со слоёв FIFO (баланс не изменён)"


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
    source_type: str
    original_quantity: Decimal
    remaining_quantity: Decimal
    unit_cost: Decimal


@dataclass(frozen=True)
class ProductExpectation:
    product_id: int
    name: str
    is_active: bool
    stock_quantity: Decimal
    inventory_value: Decimal
    cost_price: Decimal
    excess: Decimal
    layers: tuple[LayerExpectation, ...]


# Exact production state as read on 2026-08-03 (read-only forensic dump).
PRODUCTS: tuple[ProductExpectation, ...] = (
    ProductExpectation(
        product_id=5,
        name="Rc Cola Сабз 1.5л",
        is_active=False,
        stock_quantity=Decimal("0.000"),
        inventory_value=Decimal("0.0000"),
        cost_price=Decimal("9.8214"),
        excess=Decimal("100.000"),
        layers=(
            LayerExpectation(40, "opening_balance", Decimal("98.000"), Decimal("98.000"), Decimal("11.0000")),
            LayerExpectation(85, "sale_void", Decimal("2.000"), Decimal("2.000"), Decimal("11.0000")),
        ),
    ),
    ProductExpectation(
        product_id=34,
        name="Кока Кола 1.5л",
        is_active=True,
        stock_quantity=Decimal("1.000"),
        inventory_value=Decimal("10.5000"),
        cost_price=Decimal("10.5000"),
        excess=Decimal("1.000"),
        layers=(
            LayerExpectation(109, "purchase_receipt_item", Decimal("18.000"), Decimal("2.000"), Decimal("10.5000")),
        ),
    ),
    ProductExpectation(
        product_id=36,
        name="Shifotea 0.5л",
        is_active=True,
        stock_quantity=Decimal("5.000"),
        inventory_value=Decimal("6.0826"),
        cost_price=Decimal("1.2165"),
        excess=Decimal("6.000"),
        layers=(
            LayerExpectation(274, "purchase_receipt_item", Decimal("24.000"), Decimal("11.000"), Decimal("1.9166")),
        ),
    ),
    ProductExpectation(
        product_id=250,
        name="РС Кола Сабз 1л",
        is_active=True,
        stock_quantity=Decimal("20.000"),
        inventory_value=Decimal("159.4490"),
        cost_price=Decimal("7.9724"),
        excess=Decimal("6.000"),
        layers=(
            LayerExpectation(587, "purchase_receipt_item", Decimal("24.000"), Decimal("18.000"), Decimal("8.3333")),
            LayerExpectation(687, "manual_adjustment", Decimal("8.000"), Decimal("8.000"), Decimal("8.0557")),
        ),
    ),
)
EXPECTED_PRODUCT_IDS = tuple(p.product_id for p in PRODUCTS)


def _open_layers(db: Session, product_id: int, lock: bool) -> list[InventoryLayer]:
    query = (
        db.query(InventoryLayer)
        .filter(
            InventoryLayer.company_id == COMPANY_ID,
            InventoryLayer.product_id == product_id,
            InventoryLayer.reversed_at.is_(None),
            InventoryLayer.remaining_quantity > 0,
        )
        .order_by(InventoryLayer.created_at, InventoryLayer.id)
    )
    if lock:
        query = query.with_for_update()
    return query.all()


def _drifted_products(db: Session) -> list[tuple[int, Decimal, Decimal]]:
    """Every company-2 product whose open layers disagree with its balance.

    One statement on purpose: read as two, an ordinary sale committing in
    between shows up as a balance from after it against layers from before it.
    """
    rows = db.execute(QUANTITY_DRIFT_SQL, {"company_id": COMPANY_ID}).fetchall()
    return [(row[0], _dec(row[1]), _dec(row[2])) for row in rows]


def _validate_actor(db: Session) -> None:
    user = db.query(User).filter(User.id == USER_ID).one_or_none()
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


def _lock_and_validate(db: Session) -> dict[int, Product]:
    _validate_actor(db)

    drifted = _drifted_products(db)
    _require(
        [row[0] for row in drifted] == sorted(EXPECTED_PRODUCT_IDS),
        f"Drifted products changed: expected {sorted(EXPECTED_PRODUCT_IDS)}, found {[r[0] for r in drifted]}",
    )

    # Drop anything the unlocked scan above may have cached, so the locked reads
    # below validate the row as it is under the lock, not a pre-lock snapshot.
    db.expire_all()
    products = (
        db.query(Product)
        .filter(Product.company_id == COMPANY_ID, Product.id.in_(EXPECTED_PRODUCT_IDS))
        .order_by(Product.id)
        .with_for_update()
        .all()
    )
    _require({p.id for p in products} == set(EXPECTED_PRODUCT_IDS), "Expected products changed")
    products_by_id = {p.id: p for p in products}

    for exp in PRODUCTS:
        product = products_by_id[exp.product_id]
        _require(product.name == exp.name, f"Product #{product.id} name changed")
        _require(product.is_active is exp.is_active, f"Product #{product.id} active flag changed")
        _require(_dec(product.stock_quantity) == exp.stock_quantity, f"Product #{product.id} balance changed")
        _require(_dec(product.inventory_value) == exp.inventory_value, f"Product #{product.id} value changed")
        _require(_dec(product.cost_price) == exp.cost_price, f"Product #{product.id} cost changed")

        layers = _open_layers(db, exp.product_id, lock=True)
        _require(
            [layer.id for layer in layers] == [exp_layer.layer_id for exp_layer in exp.layers],
            f"Product #{product.id}: open layers changed",
        )
        for layer, exp_layer in zip(layers, exp.layers):
            _require(layer.source_type == exp_layer.source_type, f"Layer #{layer.id} source changed")
            _require(_dec(layer.original_quantity) == exp_layer.original_quantity, f"Layer #{layer.id} original changed")
            _require(_dec(layer.remaining_quantity) == exp_layer.remaining_quantity, f"Layer #{layer.id} remaining changed")
            _require(_dec(layer.unit_cost) == exp_layer.unit_cost, f"Layer #{layer.id} cost changed")

        open_total = sum((_dec(l.remaining_quantity) for l in layers), Decimal("0"))
        _require(
            open_total - exp.stock_quantity == exp.excess,
            f"Product #{product.id}: excess is {open_total - exp.stock_quantity}, expected {exp.excess}",
        )
        _require(exp.excess > 0, f"Product #{product.id}: nothing to drain")

    return products_by_id


def reconcile(db: Session) -> dict:
    products_by_id = _lock_and_validate(db)
    report: dict[str, dict] = {}

    for exp in PRODUCTS:
        product = products_by_id[exp.product_id]
        layers = _open_layers(db, exp.product_id, lock=True)

        # Shrink the excess out of the oldest layers first, mirroring the FIFO
        # order a sale would have consumed them in. Both quantities move by the
        # same amount so the layer stays internally consistent; the balance is
        # deliberately NOT touched — these units never existed on it.
        to_drain = exp.excess
        drained: list[dict] = []
        for layer in layers:
            if to_drain <= 0:
                break
            take = min(_dec(layer.remaining_quantity), to_drain)
            if take <= 0:
                continue
            layer.original_quantity = _dec(layer.original_quantity) - take
            layer.remaining_quantity = _dec(layer.remaining_quantity) - take
            drained.append(
                {
                    "layer_id": layer.id,
                    "quantity": str(take),
                    "unit_cost": str(layer.unit_cost),
                    "original_quantity": str(layer.original_quantity),
                    "remaining_quantity": str(layer.remaining_quantity),
                }
            )
            to_drain -= take
        _require(to_drain == 0, f"Product #{product.id}: could not drain the full excess")
        db.flush()

        remaining = _open_layers(db, exp.product_id, lock=False)
        layer_qty = sum((_dec(l.remaining_quantity) for l in remaining), Decimal("0"))
        _require(layer_qty == _dec(product.stock_quantity), f"Product #{product.id}: layers still disagree")

        db.add(
            InventoryLog(
                company_id=COMPANY_ID,
                product_id=product.id,
                user_id=USER_ID,
                quantity_change=Decimal("0"),
                value_change=Decimal("0.0000"),
                previous_quantity=_dec(product.stock_quantity),
                new_quantity=_dec(product.stock_quantity),
                reason=f"{REASON}: {exp.excess} ед.",
                reference_type=REFERENCE_TYPE,
                reference_id=product.id,
            )
        )
        db.flush()

        report[str(product.id)] = {
            "name": product.name,
            "drained": drained,
            "excess": str(exp.excess),
            "stock_quantity": str(product.stock_quantity),
            "layer_quantity": str(layer_qty),
            "inventory_value": str(product.inventory_value),
            "cost_price": str(product.cost_price),
        }

    report_all = {"products": report, "post_checks": verify_state(db)}
    return report_all


def verify_state(db: Session) -> dict:
    """Post-conditions. Read-only; safe to run on its own after a commit."""
    drifted = _drifted_products(db)
    _require(not drifted, f"Company {COMPANY_ID} still has drifted products: {drifted}")

    negative_layers = (
        db.query(func.count(InventoryLayer.id))
        .filter(
            InventoryLayer.company_id == COMPANY_ID,
            (InventoryLayer.remaining_quantity < 0)
            | (InventoryLayer.remaining_quantity > InventoryLayer.original_quantity),
        )
        .scalar()
    )
    _require(negative_layers == 0, "Layers out of bounds")

    over_released = (
        db.query(func.count(InventoryAllocation.id))
        .filter(
            InventoryAllocation.company_id == COMPANY_ID,
            InventoryAllocation.released_quantity > InventoryAllocation.quantity,
        )
        .scalar()
    )
    _require(over_released == 0, "Allocations over-released")

    imbalanced = db.execute(LAYER_BALANCE_SQL, {"company_id": COMPANY_ID}).fetchall()
    _require(not imbalanced, f"Layer/allocation imbalance: {[tuple(r) for r in imbalanced]}")

    negative_products = (
        db.query(func.count(Product.id))
        .filter(
            Product.company_id == COMPANY_ID,
            (Product.stock_quantity < 0) | (Product.inventory_value < 0),
        )
        .scalar()
    )
    _require(negative_products == 0, "Product balance or value went negative")

    totals = db.query(
        func.sum(Product.stock_quantity), func.sum(Product.inventory_value)
    ).filter(Product.company_id == COMPANY_ID, Product.is_active.is_(True)).one()
    return {
        "drifted_products": 0,
        "active_stock_units": str(totals[0]),
        "active_inventory_value": str(totals[1]),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Guarded FIFO layer/balance reconcile for company 2")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="Commit; default is a rollback-only dry-run")
    mode.add_argument("--verify", action="store_true", help="Check an already-committed reconcile (read-only)")
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_PUBLIC_URL") or os.getenv("DATABASE_URL")
    if not database_url:
        raise SystemExit("No DATABASE_PUBLIC_URL/DATABASE_URL in environment")
    engine = create_engine(database_url, pool_pre_ping=True)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = SessionLocal()
    try:
        if args.verify:
            report = verify_state(db)
            db.rollback()
            mode_name = "VERIFIED"
        else:
            report = reconcile(db)
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
