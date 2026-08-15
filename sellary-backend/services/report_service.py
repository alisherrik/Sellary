from datetime import datetime, timedelta
from decimal import Decimal
from typing import List
from zoneinfo import ZoneInfo

from sqlalchemy import and_, case, func
from sqlalchemy.orm import Session

from models.product import Product
from models.sale import Sale, SaleStatus
from models.sale_item import SaleItem
from models.sale_return import SaleReturn
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
        low_stock_products = self.product_repo.get_low_stock_products(self.company_id)
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
            low_stock_count=len(low_stock_products),
            low_stock_items=[
                LowStockItem(
                    product_id=product.id,
                    product_name=product.name,
                    barcode=product.barcode,
                    current_stock=product.stock_quantity,
                    min_stock_level=product.min_stock_level,
                )
                for product in low_stock_products[:10]
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
            .all()
        )

        # Bucketed in Python, not by `func.date(created_at)`: that grouped on
        # the DB session's UTC day, so a sale at 23:30 UTC (04:30 local, next
        # day) was reported a day early. Converting a timestamptz to a named
        # zone in SQL is Postgres-only and would break the SQLite test engine.
        tz = self.tz()
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
                total_profit=Decimal("0.00"),
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
            total_profit=self._calculate_profit(start_date, end_date),
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
    ) -> TopProductReport:
        return TopProductReport(
            period_start=to_local(start_date, self.tz()).date().isoformat(),
            period_end=to_local(end_date, self.tz()).date().isoformat(),
            top_products=self._get_top_products(start_date, end_date, limit),
        )

    def _get_top_products(
        self,
        start_date: datetime,
        end_date: datetime,
        limit: int = 10,
    ) -> List[TopProductItem]:
        results = (
            self.db.query(
                Product.id,
                Product.name,
                Product.barcode,
                Product.cost_price,
                Product.sell_price,
                func.sum(SaleItem.quantity - SaleItem.quantity_returned).label("qty"),
                func.sum(
                    SaleItem.subtotal
                    * (SaleItem.quantity - SaleItem.quantity_returned)
                    / func.nullif(SaleItem.quantity, 0)
                ).label("revenue"),
                # What the goods cost when they left, exactly as the profit
                # report counts it — not today's cost card, which changes with
                # every delivery and made this profit disagree with that one.
                func.sum(
                    (SaleItem.quantity - SaleItem.quantity_returned)
                    * SaleItem.unit_cost_at_sale
                ).label("cost"),
            )
            .join(SaleItem, Product.id == SaleItem.product_id)
            .join(Sale, SaleItem.sale_id == Sale.id)
            .filter(
                and_(
                    Sale.company_id == self.company_id,
                    Sale.created_at >= start_date,
                    Sale.created_at <= end_date,
                    Sale.status.in_(NON_CANCELLED_STATUSES),
                )
            )
            .group_by(Product.id)
            .order_by(func.sum(SaleItem.quantity - SaleItem.quantity_returned).desc())
            .limit(limit)
            .all()
        )

        items: List[TopProductItem] = []
        for result in results:
            revenue = Decimal(str(result.revenue)) if result.revenue else Decimal("0.00")
            cost = Decimal(str(result.cost)) if result.cost else Decimal("0.00")

            items.append(
                TopProductItem(
                    product_id=result.id,
                    product_name=result.name,
                    barcode=result.barcode,
                    # Weight and volume sell in fractions; int() turned 43.142 kg
                    # into 43 and quietly lost the rest.
                    quantity_sold=Decimal(str(result.qty)),
                    revenue=revenue,
                    profit=(revenue - cost).quantize(Decimal("0.01")),
                )
            )

        return items

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
        result = (
            self.db.query(
                func.sum(
                    (SaleItem.quantity - SaleItem.quantity_returned) * SaleItem.unit_cost_at_sale
                )
            )
            .join(Sale, SaleItem.sale_id == Sale.id)
            .filter(
                and_(
                    Sale.company_id == self.company_id,
                    Sale.created_at >= start_date,
                    Sale.created_at <= end_date,
                    Sale.status.in_(NON_CANCELLED_STATUSES),
                )
            )
            .scalar()
        )
        return result or Decimal("0.00")
