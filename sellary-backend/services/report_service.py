from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable, List
from zoneinfo import ZoneInfo

from sqlalchemy import and_, func
from sqlalchemy.orm import Session, selectinload

from models.inventory_layer import InventoryAllocation
from models.sale import Sale
from models.sale_item import SaleItem
from repositories.inventory_repository import InventoryRepository
from repositories.product_repository import ProductRepository
from repositories.sale_repository import NON_CANCELLED_STATUSES, SaleRepository
from repositories.stock_write_off_repository import StockWriteOffRepository
from schemas.report import (
    DailySalesData,
    DailySalesReport,
    DashboardWidgets,
    LowStockItem,
    ProfitReport,
    TopProductItem,
    TopProductReport,
)
from services import reconciliation
from services.calculation_service import CalculationService
from services.company_time import company_tz, local_day_bounds, period_range, to_local
from services.tenant import resolve_company_id


class ReportService:
    def __init__(self, db: Session, company_id: int | None = None):
        self.db = db
        self.company_id = resolve_company_id(db, company_id)
        self.sale_repo = SaleRepository(db)
        self.product_repo = ProductRepository(db)
        self.inventory_repo = InventoryRepository(db)
        self.calc = CalculationService

    def tz(self) -> ZoneInfo:
        """The company's business clock. Never the server's."""
        return company_tz(self.db, self.company_id)

    def local_day_bounds(self, day=None) -> tuple[datetime, datetime]:
        return local_day_bounds(self.tz(), day)

    def open_from(self):
        """The first day the open period covers, or None before any reconciliation."""
        return reconciliation.open_from(self.db, self.company_id)

    def default_range(self, start_date, end_date, days: int) -> tuple[datetime, datetime]:
        """Fill in a missing range as the last `days` local business days.

        Anchored on the company's clock — `datetime.now()` here would anchor on
        the server's UTC day and cut the range at the wrong boundary. Today
        counts as one of the days, so «30 дней» is 30 and not 31, which is also
        what the MCP connector's `last_30_days` means.
        """
        return period_range(self, start_date, end_date, days)

    def _net_revenue_subquery(self):
        return self.sale_repo.refund_totals_subquery(self.company_id)

    def _financial_sales(self, start_date: datetime, end_date: datetime) -> Iterable[Sale]:
        """Load the frozen line costs and their releases in bounded queries.

        selectinload avoids one query per receipt/line and avoids multiplying
        rows by joining allocations, refunds and products together.
        """
        return (
            self.db.query(Sale)
            .options(
                selectinload(Sale.items).selectinload(SaleItem.allocations).joinedload(InventoryAllocation.layer),
                selectinload(Sale.items).selectinload(SaleItem.return_items),
                selectinload(Sale.items).joinedload(SaleItem.product),
            )
            .filter(
                Sale.company_id == self.company_id,
                Sale.created_at >= start_date,
                Sale.created_at <= end_date,
                Sale.status.in_(NON_CANCELLED_STATUSES),
            )
            .yield_per(200)
        )

    @staticmethod
    def _item_cost(item: SaleItem) -> Decimal:
        """Frozen FIFO cost less the actual layers restored by a return.

        A unit cost rounded to cents cannot recover a line's original cost.
        Offline shortfalls have no allocation: their frozen residual is kept.
        Old lines without allocations use their total snapshot proportionally,
        falling back to the old unit snapshot only when no total was recorded.
        """
        zero, cents = Decimal("0"), Decimal("0.01")
        quantity = Decimal(item.quantity)
        returned = Decimal(item.quantity_returned or 0)
        if quantity <= 0 or returned >= quantity:
            return Decimal("0.00")
        allocations = item.allocations
        allocated_quantity = sum((Decimal(row.quantity) for row in allocations), zero)
        allocated_cost = sum((Decimal(row.quantity) * Decimal(row.layer.unit_cost) for row in allocations), zero)
        total = Decimal(item.cost_total_at_sale or 0)
        if not total:
            total = allocated_cost if allocations else quantity * Decimal(item.unit_cost_at_sale or 0)
        total = total.quantize(cents, rounding=ROUND_HALF_UP)
        if not returned:
            return total
        released_quantity = sum((Decimal(row.released_quantity or 0) for row in allocations), zero)
        released_cost = sum((Decimal(row.released_quantity or 0) * Decimal(row.layer.unit_cost) for row in allocations), zero)
        shortfall = max(zero, quantity - allocated_quantity)
        unallocated_return = max(zero, returned - released_quantity)
        if allocations and (unallocated_return == 0 or shortfall >= unallocated_return > 0):
            residual_refund = (
                max(zero, total - allocated_cost) * unallocated_return / shortfall
                if unallocated_return else zero
            )
            remaining_cost = total - released_cost - residual_refund
        else:
            remaining_cost = total * (quantity - returned) / quantity
        return max(zero, remaining_cost).quantize(cents, rounding=ROUND_HALF_UP)

    @staticmethod
    def _line_revenues(sale: Sale) -> dict[int, Decimal]:
        """Attribute the charged receipt total, then subtract recorded refunds.

        POS line discounts and the same sale discount can both be present.
        Only its unattributed part is allocated again, as the return service
        does. A final cent residue reconciles old line shapes to the receipt.
        """
        zero, cents = Decimal("0"), Decimal("0.01")
        items = sorted(sale.items, key=lambda item: item.id)
        if not items:
            return {}
        discount = Decimal(sale.discount_amount or 0)
        unattributed = max(zero, discount - sum((Decimal(item.discount_amount or 0) for item in items), zero))
        charged = {}
        for item in items:
            share = (
                (Decimal(item.allocated_sale_discount_amount or 0) * unattributed / discount)
                .quantize(cents, rounding=ROUND_HALF_UP) if discount and unattributed else zero
            )
            charged[item.id] = max(zero, Decimal(item.total) - share)
        charged_sum = sum(charged.values(), zero)
        total = Decimal(sale.total_amount)
        if charged_sum != total:
            for item in items:
                charged[item.id] = (
                    (total * charged[item.id] / charged_sum).quantize(cents, rounding=ROUND_HALF_UP)
                    if charged_sum else zero
                )
            charged[items[-1].id] += total - sum(charged.values(), zero)
        result = {}
        for item in items:
            if item.return_items:
                refunded = sum((Decimal(row.refund_amount) for row in item.return_items), zero)
            else:
                refunded = (
                    charged[item.id] * Decimal(item.quantity_returned or 0) / Decimal(item.quantity)
                    if item.quantity else zero
                ).quantize(cents, rounding=ROUND_HALF_UP)
            result[item.id] = charged[item.id] - refunded
        return result

    def get_dashboard_widgets(self) -> DashboardWidgets:
        today_start, today_end = self.local_day_bounds()

        refund_sub = self._net_revenue_subquery()

        today_sales = (
            self.db.query(
                func.coalesce(
                    func.sum(
                        Sale.total_amount - func.coalesce(refund_sub.c.refund_total, Decimal("0.00"))
                    ),
                    Decimal("0.00"),
                )
            )
            .outerjoin(refund_sub, Sale.id == refund_sub.c.sale_id)
            .filter(
                and_(
                    Sale.company_id == self.company_id,
                    Sale.created_at >= today_start,
                    Sale.created_at <= today_end,
                    Sale.status.in_(NON_CANCELLED_STATUSES),
                )
            )
            .scalar()
        )

        today_sales_count = (
            self.db.query(func.count(Sale.id))
            .filter(
                and_(
                    Sale.company_id == self.company_id,
                    Sale.created_at >= today_start,
                    Sale.created_at <= today_end,
                    Sale.status.in_(NON_CANCELLED_STATUSES),
                )
            )
            .scalar()
            or 0
        )

        today_profit = self._calculate_profit(today_start, today_end)
        low_stock_products, low_stock_count = self.product_repo.get_all(
            self.company_id, low_stock_only=True, limit=10,
        )
        top_products = self._get_top_products(today_start, today_end, limit=5)

        recent_sales = (
            self.db.query(Sale)
            .filter(
                Sale.company_id == self.company_id,
                Sale.status.in_(NON_CANCELLED_STATUSES),
            )
            .order_by(Sale.created_at.desc())
            .limit(10)
            .all()
        )

        return DashboardWidgets(
            today_sales=Decimal(str(today_sales)) if today_sales else Decimal("0.00"),
            today_profit=today_profit,
            today_sales_count=today_sales_count,
            low_stock_count=low_stock_count,
            low_stock_items=[
                LowStockItem(
                    product_id=product.id,
                    product_name=product.name,
                    barcode=product.barcode,
                    current_stock=product.stock_quantity,
                    min_stock_level=product.min_stock_level,
                )
                for product in low_stock_products
            ],
            top_products=top_products,
            recent_sales=[
                {
                    "id": sale.id,
                    "total_amount": str(sale.total_amount),
                    "payment_method": sale.payment_method,
                    "created_at": sale.created_at.isoformat(),
                }
                for sale in recent_sales
            ],
        )

    def get_daily_sales(self, start_date: datetime, end_date: datetime) -> DailySalesReport:
        refund_sub = self._net_revenue_subquery()

        rows = (
            self.db.query(
                Sale.created_at,
                Sale.total_amount.label("gross"),
                func.coalesce(refund_sub.c.refund_total, Decimal("0.00")).label("refund"),
            )
            .outerjoin(refund_sub, Sale.id == refund_sub.c.sale_id)
            .filter(
                and_(
                    Sale.company_id == self.company_id,
                    Sale.created_at >= start_date,
                    Sale.created_at <= end_date,
                    Sale.status.in_(NON_CANCELLED_STATUSES),
                )
            )
            .yield_per(200)
        )

        # Bucketed in Python, not by `func.date(created_at)`: that grouped on
        # the DB session's UTC day, so a sale at 23:30 UTC (04:30 local, next
        # day) was reported a day early. Converting a timestamptz to a named
        # zone in SQL is Postgres-only and would break the SQLite test engine.
        tz = self.tz()
        cost_by_day: dict = {}
        for sale in self._financial_sales(start_date, end_date):
            local_date = to_local(sale.created_at, tz).date()
            cost_by_day[local_date] = cost_by_day.get(local_date, Decimal("0.00")) + sum(
                (self._item_cost(item) for item in sale.items), Decimal("0.00")
            )
        buckets: dict = {}
        gross_turnover = Decimal("0.00")
        refunds = Decimal("0.00")
        for row in rows:
            local_date = to_local(row.created_at, tz).date()
            bucket = buckets.setdefault(local_date, {"count": 0, "total": Decimal("0.00")})
            bucket["count"] += 1
            bucket["total"] += (row.gross or Decimal("0.00")) - (row.refund or Decimal("0.00"))
            gross_turnover += row.gross or Decimal("0.00")
            refunds += row.refund or Decimal("0.00")

        data = [
            DailySalesData(
                date=str(local_date),
                sales_count=bucket["count"],
                total_sales=bucket["total"],
                total_profit=bucket["total"] - cost_by_day.get(local_date, Decimal("0.00")),
            )
            for local_date, bucket in sorted(buckets.items())
        ]

        return DailySalesReport(
            period_start=to_local(start_date, self.tz()).date().isoformat(),
            period_end=to_local(end_date, self.tz()).date().isoformat(),
            data=data,
            total_sales=sum(result.total_sales for result in data),
            gross_turnover=gross_turnover,
            refunds=refunds,
            total_profit=sum((result.total_profit for result in data), Decimal("0.00")),
            sales_count=sum(result.sales_count for result in data),
        )

    def get_profit_report(self, start_date: datetime, end_date: datetime) -> ProfitReport:
        refund_sub = self._net_revenue_subquery()

        revenue = (
            self.db.query(
                func.coalesce(
                    func.sum(
                        Sale.total_amount - func.coalesce(refund_sub.c.refund_total, Decimal("0.00"))
                    ),
                    Decimal("0.00"),
                )
            )
            .outerjoin(refund_sub, Sale.id == refund_sub.c.sale_id)
            .filter(
                and_(
                    Sale.company_id == self.company_id,
                    Sale.created_at >= start_date,
                    Sale.created_at <= end_date,
                    Sale.status.in_(NON_CANCELLED_STATUSES),
                )
            )
            .scalar()
        ) or Decimal("0.00")

        cost = self._calculate_cost(start_date, end_date)
        profit = revenue - cost
        profit_margin = (profit / revenue * 100) if revenue > 0 else Decimal("0")

        sales_count = (
            self.db.query(func.count(Sale.id))
            .filter(
                and_(
                    Sale.company_id == self.company_id,
                    Sale.created_at >= start_date,
                    Sale.created_at <= end_date,
                    Sale.status.in_(NON_CANCELLED_STATUSES),
                )
            )
            .scalar()
            or 0
        )

        write_off_cost = StockWriteOffRepository(self.db).total_cost(
            self.company_id, start_date, end_date
        )

        return ProfitReport(
            period_start=to_local(start_date, self.tz()).date().isoformat(),
            period_end=to_local(end_date, self.tz()).date().isoformat(),
            revenue=revenue,
            cost=cost,
            profit=profit,
            profit_margin_percent=profit_margin.quantize(Decimal("0.01")),
            sales_count=sales_count,
            write_off_cost=write_off_cost,
            profit_after_write_offs=profit - write_off_cost,
        )

    def get_top_products(
        self,
        start_date: datetime,
        end_date: datetime,
        limit: int = 10,
        offset: int = 0,
    ) -> TopProductReport:
        product_count = self.db.query(func.count(func.distinct(SaleItem.product_id))).join(
            Sale, SaleItem.sale_id == Sale.id,
        ).filter(
            Sale.company_id == self.company_id,
            Sale.created_at >= start_date,
            Sale.created_at <= end_date,
            Sale.status.in_(NON_CANCELLED_STATUSES),
        ).scalar() or 0
        return TopProductReport(
            period_start=to_local(start_date, self.tz()).date().isoformat(),
            period_end=to_local(end_date, self.tz()).date().isoformat(),
            top_products=self._get_top_products(start_date, end_date, limit, offset),
            product_count=product_count,
        )

    def _get_top_products(
        self,
        start_date: datetime,
        end_date: datetime,
        limit: int = 10,
        offset: int = 0,
    ) -> List[TopProductItem]:
        totals: dict = {}
        for sale in self._financial_sales(start_date, end_date):
            revenues = self._line_revenues(sale)
            for item in sale.items:
                bucket = totals.setdefault(item.product_id, {
                    "product": item.product, "quantity": Decimal("0"),
                    "revenue": Decimal("0.00"), "cost": Decimal("0.00"),
                })
                bucket["quantity"] += item.quantity - item.quantity_returned
                bucket["revenue"] += revenues[item.id]
                bucket["cost"] += self._item_cost(item)
        rows = sorted(totals.values(), key=lambda row: (-row["quantity"], row["product"].id))[offset:offset + limit]
        return [
            TopProductItem(
                product_id=row["product"].id,
                product_name=row["product"].name,
                barcode=row["product"].barcode,
                quantity_sold=row["quantity"],
                revenue=row["revenue"],
                profit=row["revenue"] - row["cost"],
            )
            for row in rows
        ]

    def _calculate_profit(self, start_date: datetime, end_date: datetime) -> Decimal:
        refund_sub = self._net_revenue_subquery()

        revenue = (
            self.db.query(
                func.coalesce(
                    func.sum(
                        Sale.total_amount - func.coalesce(refund_sub.c.refund_total, Decimal("0.00"))
                    ),
                    Decimal("0.00"),
                )
            )
            .outerjoin(refund_sub, Sale.id == refund_sub.c.sale_id)
            .filter(
                and_(
                    Sale.company_id == self.company_id,
                    Sale.created_at >= start_date,
                    Sale.created_at <= end_date,
                    Sale.status.in_(NON_CANCELLED_STATUSES),
                )
            )
            .scalar()
        ) or Decimal("0.00")

        cost = self._calculate_cost(start_date, end_date)
        return revenue - cost

    def _calculate_cost(self, start_date: datetime, end_date: datetime) -> Decimal:
        return sum(
            (self._item_cost(item) for sale in self._financial_sales(start_date, end_date) for item in sale.items),
            Decimal("0.00"),
        )
