"""What the shop bought, from whom, and at what price.

Built on `purchase_receipts` / `purchase_receipt_items` rather than on orders:
an order is an intention, a receipt is goods that actually arrived and money
that was actually owed. A reversed receipt is excluded, the same way a
cancelled sale never counts as turnover.

The per-product view carries the first and last unit cost inside the period,
because the question an owner actually asks is not only "how much did we spend
on sugar" but "what is sugar costing us now compared with the start of the
month".
"""
from decimal import Decimal
from typing import Optional

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from models.inventory_layer import InventoryLayer
from models.product import Product
from models.purchase_order import PurchaseOrder
from models.purchase_receipt import PurchaseReceipt, PurchaseReceiptItem
from models.supplier import Supplier
from schemas.purchase_report import (
    PurchaseByProductRow,
    PurchaseBySupplierRow,
    PurchaseDayRow,
    PurchaseSummary,
)
from services import reconciliation
from services.company_time import company_tz, local_day_bounds, period_range, to_local
from services.tenant import resolve_company_id

ZERO = Decimal("0.00")
MONEY = Decimal("0.01")


def _money(value) -> Decimal:
    return (Decimal(value or 0)).quantize(MONEY)


def _share(part: Decimal, whole: Decimal) -> Decimal:
    if whole == 0:
        return ZERO
    return (part / whole * 100).quantize(MONEY)


class PurchaseReportService:
    def __init__(self, db: Session, company_id: int | None = None):
        self.db = db
        self.company_id = resolve_company_id(db, company_id)

    def tz(self):
        return company_tz(self.db, self.company_id)

    def local_day_bounds(self, day=None):
        return local_day_bounds(self.tz(), day)

    def open_from(self):
        return reconciliation.open_from(self.db, self.company_id)

    def default_range(self, start_date, end_date, days: int):
        return period_range(self, start_date, end_date, days)

    # ----------------------------------------------------------------- base

    def _items(self, start, end, supplier_id: Optional[int] = None):
        """Every received line in the window, joined to what it belongs to."""
        query = (
            self.db.query(PurchaseReceiptItem)
            .join(PurchaseReceipt, PurchaseReceipt.id == PurchaseReceiptItem.purchase_receipt_id)
            .join(PurchaseOrder, PurchaseOrder.id == PurchaseReceipt.purchase_order_id)
            # A voided purchase LINE leaves its receipt row standing and reverses
            # only the layer it created. PO #56 kept 28 such receipts, and the
            # report billed the shop for goods the ledger had already sent back.
            # Items with no layer at all (the June PO #9 receives) still count.
            .outerjoin(
                InventoryLayer,
                InventoryLayer.purchase_receipt_item_id == PurchaseReceiptItem.id,
            )
            .filter(
                PurchaseReceipt.company_id == self.company_id,
                # A reversed receipt is goods that went back; it bought nothing.
                PurchaseReceipt.reversed_at.is_(None),
                InventoryLayer.reversed_at.is_(None),
            )
        )
        if start is not None:
            query = query.filter(PurchaseReceipt.created_at >= start)
        if end is not None:
            query = query.filter(PurchaseReceipt.created_at < end)
        if supplier_id is not None:
            query = query.filter(PurchaseOrder.supplier_id == supplier_id)
        return query

    @staticmethod
    def _line_total():
        return PurchaseReceiptItem.quantity * PurchaseReceiptItem.unit_cost

    # -------------------------------------------------------------- summary

    def summary(self, start, end, supplier_id: Optional[int] = None) -> PurchaseSummary:
        row = self._items(start, end, supplier_id).with_entities(
            func.coalesce(func.sum(self._line_total()), ZERO),
            func.count(func.distinct(PurchaseReceipt.id)),
            func.count(func.distinct(PurchaseOrder.id)),
            func.count(func.distinct(PurchaseOrder.supplier_id)),
            func.count(func.distinct(PurchaseReceiptItem.product_id)),
            func.count(PurchaseReceiptItem.id),
        ).one()
        total, receipts, orders, suppliers, products, lines = row
        total = _money(total)

        return PurchaseSummary(
            total_spend=total,
            receipts_count=int(receipts or 0),
            orders_count=int(orders or 0),
            suppliers_count=int(suppliers or 0),
            products_count=int(products or 0),
            lines_count=int(lines or 0),
            average_receipt=_money(total / receipts) if receipts else ZERO,
            period_start=to_local(start, self.tz()).date().isoformat(),
            period_end=to_local(end, self.tz()).date().isoformat(),
            by_day=self.by_day(start, end, supplier_id),
        )

    def by_day(self, start, end, supplier_id: Optional[int] = None) -> list[PurchaseDayRow]:
        rows = (
            self._items(start, end, supplier_id)
            .with_entities(
                PurchaseReceipt.id,
                PurchaseReceipt.created_at,
                self._line_total(),
            )
            .all()
        )

        # Bucketed in Python, as get_daily_sales does and for the same reason:
        # `func.date(created_at)` groups on the session's UTC day, so a delivery
        # booked at 23:30 local lands a day early — and converting a timestamptz
        # to a named zone in SQL is Postgres-only, which the SQLite test engine
        # cannot run.
        tz = self.tz()
        spend_by_day: dict = {}
        receipts_by_day: dict = {}
        for receipt_id, created_at, line_total in rows:
            day = to_local(created_at, tz).date()
            spend_by_day[day] = spend_by_day.get(day, ZERO) + Decimal(line_total or 0)
            receipts_by_day.setdefault(day, set()).add(receipt_id)

        return [
            PurchaseDayRow(
                day=day,
                spend=_money(spend_by_day[day]),
                receipts=len(receipts_by_day[day]),
            )
            for day in sorted(spend_by_day)
        ]

    # ----------------------------------------------------------- by product

    def by_product(
        self, start, end, supplier_id: Optional[int] = None, limit: int = 200
    ) -> list[PurchaseByProductRow]:
        rows = (
            self._items(start, end, supplier_id)
            .join(Product, Product.id == PurchaseReceiptItem.product_id)
            .with_entities(
                Product.id,
                Product.name,
                Product.uom,
                Product.sell_price,
                Product.cost_price,
                func.coalesce(func.sum(PurchaseReceiptItem.quantity), ZERO),
                func.coalesce(func.sum(self._line_total()), ZERO),
                func.min(PurchaseReceiptItem.unit_cost),
                func.max(PurchaseReceiptItem.unit_cost),
                func.count(PurchaseReceiptItem.id),
                func.max(PurchaseReceipt.created_at),
            )
            .group_by(Product.id, Product.name, Product.uom, Product.sell_price, Product.cost_price)
            .order_by(func.sum(self._line_total()).desc())
            .limit(limit)
            .all()
        )

        # The share is of the period's whole spend, not of the rows that fit on
        # the page: summing the truncated list made every share too big.
        total = Decimal(
            self._items(start, end, supplier_id)
            .with_entities(func.coalesce(func.sum(self._line_total()), ZERO))
            .scalar()
            or 0
        )
        first_last = self._first_and_last_cost(start, end, supplier_id)

        result = []
        for (
            product_id,
            name,
            uom,
            sell_price,
            cost_price,
            quantity,
            spend,
            min_cost,
            max_cost,
            deliveries,
            last_at,
        ) in rows:
            quantity = Decimal(quantity or 0)
            spend = _money(spend)
            first_cost, last_cost = first_last.get(product_id, (None, None))
            change = None
            if first_cost and last_cost and first_cost != 0:
                change = ((last_cost - first_cost) / first_cost * 100).quantize(MONEY)
            result.append(
                PurchaseByProductRow(
                    product_id=product_id,
                    name=name,
                    uom=uom,
                    quantity=quantity,
                    spend=spend,
                    share_percent=_share(spend, total),
                    average_cost=(spend / quantity).quantize(Decimal("0.0001"))
                    if quantity
                    else ZERO,
                    min_cost=Decimal(min_cost or 0),
                    max_cost=Decimal(max_cost or 0),
                    first_cost=first_cost,
                    last_cost=last_cost,
                    cost_change_percent=change,
                    current_cost_price=Decimal(cost_price or 0),
                    current_sell_price=Decimal(sell_price or 0),
                    deliveries=int(deliveries or 0),
                    last_received_at=last_at,
                )
            )
        return result

    def _first_and_last_cost(
        self, start, end, supplier_id: Optional[int] = None
    ) -> dict[int, tuple[Optional[Decimal], Optional[Decimal]]]:
        """The unit cost on the earliest and latest delivery of each product.

        min/max would answer a different question: the cheapest and dearest the
        shop ever paid, not the direction the price is moving.
        """
        rows = (
            self._items(start, end, supplier_id)
            .with_entities(
                PurchaseReceiptItem.product_id,
                PurchaseReceipt.created_at,
                PurchaseReceiptItem.unit_cost,
            )
            .order_by(PurchaseReceiptItem.product_id, PurchaseReceipt.created_at, PurchaseReceiptItem.id)
            .all()
        )
        result: dict[int, tuple[Optional[Decimal], Optional[Decimal]]] = {}
        for product_id, _created, unit_cost in rows:
            cost = Decimal(unit_cost or 0)
            if product_id not in result:
                result[product_id] = (cost, cost)
            else:
                result[product_id] = (result[product_id][0], cost)
        return result

    # ---------------------------------------------------------- by supplier

    def by_supplier(self, start, end) -> list[PurchaseBySupplierRow]:
        rows = (
            self._items(start, end)
            .join(Supplier, Supplier.id == PurchaseOrder.supplier_id)
            .with_entities(
                Supplier.id,
                Supplier.name,
                func.coalesce(func.sum(self._line_total()), ZERO),
                func.count(func.distinct(PurchaseReceipt.id)),
                func.count(func.distinct(PurchaseReceiptItem.product_id)),
                func.max(PurchaseReceipt.created_at),
            )
            .group_by(Supplier.id, Supplier.name)
            .order_by(func.sum(self._line_total()).desc())
            .all()
        )
        total = sum((Decimal(r[2] or 0) for r in rows), ZERO)
        return [
            PurchaseBySupplierRow(
                supplier_id=supplier_id,
                name=name,
                spend=_money(spend),
                share_percent=_share(_money(spend), total),
                receipts=int(receipts or 0),
                products=int(products or 0),
                last_received_at=last_at,
            )
            for supplier_id, name, spend, receipts, products, last_at in rows
        ]

    # --------------------------------------------------------- open orders

    def outstanding(self) -> list[dict]:
        """Orders sent but not fully received — money committed, goods not in.

        Excluded from every total above: nothing has been bought yet.
        """
        from models.purchase_order_item import PurchaseOrderItem

        rows = (
            self.db.query(
                PurchaseOrder.id,
                PurchaseOrder.order_date,
                Supplier.name,
                PurchaseOrder.total_amount,
                func.coalesce(
                    func.sum(
                        case(
                            (
                                PurchaseOrderItem.quantity_received
                                < PurchaseOrderItem.quantity_ordered,
                                1,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ),
            )
            .join(Supplier, Supplier.id == PurchaseOrder.supplier_id)
            .outerjoin(PurchaseOrderItem, PurchaseOrderItem.purchase_order_id == PurchaseOrder.id)
            .filter(
                PurchaseOrder.company_id == self.company_id,
                PurchaseOrder.status.in_(["sent", "partially_received"]),
                PurchaseOrder.voided_at.is_(None),
            )
            .group_by(PurchaseOrder.id, PurchaseOrder.order_date, Supplier.name)
            .order_by(PurchaseOrder.order_date.desc())
            .all()
        )
        return [
            {
                "order_id": order_id,
                "order_date": order_date,
                "supplier_name": supplier_name,
                "total_amount": _money(total_amount),
                "pending_lines": int(pending or 0),
            }
            for order_id, order_date, supplier_name, total_amount, pending in rows
        ]
