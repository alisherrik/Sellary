"""One-time guarded value reconcile for company 2, products 36 and 250.

Companion to reconcile_ledger_drift.py, which fixed the quantity side. Two
products are left whose inventory_value is lower than the FIFO layers behind it:

    36  Shifotea 0.5л    5 units:  balance 6.0826   layers 9.5830
    250 РС Кола Сабз 1л  20 units: balance 159.4490 layers 164.4452

Both come from the 2026-06-16 PO #9 receive, which raised the balance quantity
with value_change 0.0000 (see inventory_logs #243, #239) — units arrived on the
balance for free, so cost_price has been understated ever since.

This is not cosmetic. ``consume_fifo`` prices a sale from the LAYERS and then
subtracts that value from the BALANCE, so any consumption large enough hits
``Inventory value cannot become negative`` and is rejected. Zeroing product 36
after a physical count fails today for exactly this reason.

The fix sets inventory_value to what the open layers hold and derives cost_price
from it, the same arithmetic ``_apply_balance`` uses. Quantities are untouched.
Company 2's active inventory value rises by 8.4966 — the understatement being
removed, not new stock.

Safety: one transaction, rollback-only by default (--apply commits), exact
preconditions locked and validated first, post-conditions checked before commit.
Uses DATABASE_PUBLIC_URL / DATABASE_URL from the environment (injected by
`railway run`); prints no secrets.
"""
from __future__ import annotations

import argparse
import json
import os
from decimal import Decimal

from sqlalchemy import create_engine, func, text
from sqlalchemy.orm import Session, sessionmaker

from models.inventory_layer import InventoryLayer
from models.product import Product
from services.inventory_ledger_service import MONEY_QUANT, PRICE_QUANT

COMPANY_ID = 2

# product_id -> (name, stock_quantity, inventory_value, cost_price) as read on
# 2026-08-03, after reconcile_ledger_drift.py was applied.
EXPECTED = {
    36: ("Shifotea 0.5л", Decimal("5.000"), Decimal("6.0826"), Decimal("1.2165")),
    250: ("РС Кола Сабз 1л", Decimal("20.000"), Decimal("159.4490"), Decimal("7.9724")),
}


class RepairPreconditionError(RuntimeError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise RepairPreconditionError(message)


def _dec(value) -> Decimal:
    return Decimal(str(value))


# One statement, so an ordinary sale committing mid-scan cannot be read as a
# product balance from after it against layer totals from before it.
VALUE_DRIFT_SQL = text(
    """
    select p.id,
           p.inventory_value,
           round(coalesce(sum(l.remaining_quantity * l.unit_cost), 0), 4) as layer_value,
           coalesce(sum(l.remaining_quantity), 0) as layer_quantity
    from products p
    left join inventory_layers l
      on l.product_id = p.id and l.reversed_at is null
    where p.company_id = :company_id
    group by p.id, p.inventory_value
    having abs(round(coalesce(sum(l.remaining_quantity * l.unit_cost), 0), 4) - p.inventory_value) > 0.0001
    order by p.id
    """
)


def _value_drifted(db: Session) -> list[tuple[int, Decimal, Decimal]]:
    rows = db.execute(VALUE_DRIFT_SQL, {"company_id": COMPANY_ID}).fetchall()
    return [(row[0], _dec(row[1]), _dec(row[2])) for row in rows]


def _lock_layers(db: Session, product_id: int) -> tuple[Decimal, Decimal]:
    """Lock a product's open layers and return their (quantity, value).

    A sale locks the same rows through ``lock_available_layers``, so holding
    them here is what stops one from landing between the read and the write.
    """
    layers = (
        db.query(InventoryLayer)
        .filter(
            InventoryLayer.company_id == COMPANY_ID,
            InventoryLayer.product_id == product_id,
            InventoryLayer.reversed_at.is_(None),
        )
        .order_by(InventoryLayer.id)
        .with_for_update()
        .all()
    )
    quantity = sum((_dec(l.remaining_quantity) for l in layers), Decimal("0"))
    value = sum((_dec(l.remaining_quantity) * _dec(l.unit_cost) for l in layers), Decimal("0"))
    return quantity, value.quantize(MONEY_QUANT)


def reconcile(db: Session) -> dict:
    db.expire_all()
    products = (
        db.query(Product)
        .filter(Product.company_id == COMPANY_ID, Product.id.in_(EXPECTED))
        .order_by(Product.id)
        .with_for_update()
        .all()
    )
    _require({p.id for p in products} == set(EXPECTED), "Expected products changed")

    report = {}
    for product in products:
        name, quantity, value, cost = EXPECTED[product.id]
        layer_qty, layer_value = _lock_layers(db, product.id)
        _require(product.name == name, f"Product #{product.id} name changed")
        _require(_dec(product.stock_quantity) == quantity, f"Product #{product.id} quantity changed")
        _require(_dec(product.inventory_value) == value, f"Product #{product.id} value changed")
        _require(_dec(product.cost_price) == cost, f"Product #{product.id} cost changed")
        _require(layer_qty == quantity, f"Product #{product.id}: layers disagree on quantity")
        _require(layer_value > value, f"Product #{product.id}: layer value is not the higher one")

        product.inventory_value = layer_value
        product.cost_price = (layer_value / layer_qty).quantize(PRICE_QUANT)
        report[str(product.id)] = {
            "name": product.name,
            "stock_quantity": str(product.stock_quantity),
            "inventory_value": {"before": str(value), "after": str(product.inventory_value)},
            "cost_price": {"before": str(cost), "after": str(product.cost_price)},
        }
    db.flush()

    return {"products": report, "post_checks": verify_state(db)}


def verify_state(db: Session) -> dict:
    drifted = _value_drifted(db)
    _require(not drifted, f"Company {COMPANY_ID} still has value drift: {drifted}")

    negative = (
        db.query(func.count(Product.id))
        .filter(
            Product.company_id == COMPANY_ID,
            (Product.stock_quantity < 0) | (Product.inventory_value < 0) | (Product.cost_price < 0),
        )
        .scalar()
    )
    _require(negative == 0, "Product quantity, value or cost went negative")

    totals = (
        db.query(func.sum(Product.stock_quantity), func.sum(Product.inventory_value))
        .filter(Product.company_id == COMPANY_ID, Product.is_active.is_(True))
        .one()
    )
    return {
        "value_drifted_products": 0,
        "active_stock_units": str(totals[0]),
        "active_inventory_value": str(totals[1]),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Guarded inventory-value reconcile for company 2")
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
