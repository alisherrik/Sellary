from datetime import date, datetime
from decimal import Decimal
from typing import List

from sqlalchemy import and_, case, func
from sqlalchemy.orm import Session

from models.product import Product
from models.sale import Sale, SaleStatus
from models.sale_item import SaleItem
from models.sale_return import SaleReturn
from repositories.inventory_repository import InventoryRepository
from repositories.product_repository import ProductRepository
from repositories.sale_repository import SaleRepository
from schemas.report import (
    DailySalesData,
    DailySalesReport,
    DashboardWidgets,
    LowStockItem,
    ProfitReport,
    TopProductItem,
    TopProductReport,
)
from services.calculation_service import CalculationService
from services.tenant import resolve_company_id


NON_CANCELLED_STATUSES = [SaleStatus.COMPLETED, SaleStatus.PARTIALLY_RETURNED, SaleStatus.RETURNED]


class ReportService:
    def __init__(self, db: Session, company_id: int | None = None):
        self.db = db
        self.company_id = resolve_company_id(db, company_id)
        self.sale_repo = SaleRepository(db)
        self.product_repo = ProductRepository(db)
        self.inventory_repo = InventoryRepository(db)
        self.calc = CalculationService

    def _net_revenue_subquery(self):
        refund_sub = (
            self.db.query(
                SaleReturn.sale_id,
                func.coalesce(func.sum(SaleReturn.total_refund_amount), Decimal("0.00")).label("refund_total"),
            )
            .filter(SaleReturn.company_id == self.company_id)
            .group_by(SaleReturn.sale_id)
            .subquery()
        )
        return refund_sub

    def get_dashboard_widgets(self) -> DashboardWidgets:
        today_start = datetime.combine(date.today(), datetime.min.time())
        today_end = datetime.combine(date.today(), datetime.max.time())

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

        results = (
            self.db.query(
                func.date(Sale.created_at).label("sale_date"),
                func.count(Sale.id).label("count"),
                func.sum(
                    Sale.total_amount - func.coalesce(refund_sub.c.refund_total, Decimal("0.00"))
                ).label("total"),
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
            .group_by(func.date(Sale.created_at))
            .order_by(func.date(Sale.created_at))
            .all()
        )

        data = [
            DailySalesData(
                date=str(result.sale_date),
                sales_count=result.count,
                total_sales=result.total,
                total_profit=Decimal("0.00"),
            )
            for result in results
        ]

        return DailySalesReport(
            period_start=start_date.isoformat(),
            period_end=end_date.isoformat(),
            data=data,
            total_sales=sum(result.total_sales for result in data),
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

        return ProfitReport(
            period_start=start_date.isoformat(),
            period_end=end_date.isoformat(),
            revenue=revenue,
            cost=cost,
            profit=profit,
            profit_margin_percent=profit_margin.quantize(Decimal("0.01")),
            sales_count=sales_count,
        )

    def get_top_products(
        self,
        start_date: datetime,
        end_date: datetime,
        limit: int = 10,
    ) -> TopProductReport:
        return TopProductReport(
            period_start=start_date.isoformat(),
            period_end=end_date.isoformat(),
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
            profit_per_unit = (
                Decimal(str(result.sell_price)) - Decimal(str(result.cost_price))
                if result.sell_price and result.cost_price
                else Decimal("0.00")
            )
            profit = profit_per_unit * result.qty

            items.append(
                TopProductItem(
                    product_id=result.id,
                    product_name=result.name,
                    barcode=result.barcode,
                    quantity_sold=int(result.qty),
                    revenue=Decimal(str(result.revenue)) if result.revenue else Decimal("0.00"),
                    profit=profit.quantize(Decimal("0.01")),
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
