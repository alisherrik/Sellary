from decimal import Decimal
from typing import List
from datetime import datetime, date
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from repositories.sale_repository import SaleRepository
from repositories.product_repository import ProductRepository
from repositories.inventory_repository import InventoryRepository
from models.sale import Sale, SaleStatus
from models.sale_item import SaleItem
from models.product import Product
from schemas.report import (
    DailySalesReport,
    DailySalesData,
    ProfitReport,
    TopProductReport,
    TopProductItem,
    DashboardWidgets,
    LowStockItem,
)
from services.calculation_service import CalculationService


class ReportService:
    def __init__(self, db: Session):
        self.db = db
        self.sale_repo = SaleRepository(db)
        self.product_repo = ProductRepository(db)
        self.inventory_repo = InventoryRepository(db)
        self.calc = CalculationService

    def get_dashboard_widgets(self) -> DashboardWidgets:
        today_start = datetime.combine(date.today(), datetime.min.time())
        today_end = datetime.combine(date.today(), datetime.max.time())

        today_sales = (
            self.db.query(func.sum(Sale.total_amount))
            .filter(
                and_(
                    Sale.created_at >= today_start,
                    Sale.created_at <= today_end,
                    Sale.status == SaleStatus.COMPLETED,
                )
            )
            .scalar()
            or Decimal("0.00")
        )

        today_sales_count = (
            self.db.query(func.count(Sale.id))
            .filter(
                and_(
                    Sale.created_at >= today_start,
                    Sale.created_at <= today_end,
                    Sale.status == SaleStatus.COMPLETED,
                )
            )
            .scalar()
            or 0
        )

        today_profit = self._calculate_profit(today_start, today_end)

        low_stock_products = self.product_repo.get_low_stock_products()

        top_products = self._get_top_products(today_start, today_end, limit=5)

        recent_sales = (
            self.db.query(Sale)
            .filter(Sale.status == SaleStatus.COMPLETED)
            .order_by(Sale.created_at.desc())
            .limit(10)
            .all()
        )

        return DashboardWidgets(
            today_sales=today_sales,
            today_profit=today_profit,
            today_sales_count=today_sales_count,
            low_stock_count=len(low_stock_products),
            low_stock_items=[
                LowStockItem(
                    product_id=p.id,
                    product_name=p.name,
                    barcode=p.barcode,
                    current_stock=p.stock_quantity,
                    min_stock_level=p.min_stock_level,
                )
                for p in low_stock_products[:10]
            ],
            top_products=top_products,
            recent_sales=[
                {
                    "id": s.id,
                    "total_amount": str(s.total_amount),
                    "payment_method": s.payment_method,
                    "created_at": s.created_at.isoformat(),
                }
                for s in recent_sales
            ],
        )

    def get_daily_sales(
        self, start_date: datetime, end_date: datetime
    ) -> DailySalesReport:
        results = (
            self.db.query(
                func.date(Sale.created_at).label("sale_date"),
                func.count(Sale.id).label("count"),
                func.sum(Sale.total_amount).label("total"),
            )
            .filter(
                and_(
                    Sale.created_at >= start_date,
                    Sale.created_at <= end_date,
                    Sale.status == SaleStatus.COMPLETED,
                )
            )
            .group_by(func.date(Sale.created_at))
            .order_by(func.date(Sale.created_at))
            .all()
        )

        data = [
            DailySalesData(
                date=str(r.sale_date),
                sales_count=r.count,
                total_sales=r.total,
                total_profit=Decimal("0.00"),
            )
            for r in results
        ]

        return DailySalesReport(
            period_start=start_date.isoformat(),
            period_end=end_date.isoformat(),
            data=data,
            total_sales=sum(r.total_sales for r in data),
            total_profit=self._calculate_profit(start_date, end_date),
            sales_count=sum(r.sales_count for r in data),
        )

    def get_profit_report(
        self, start_date: datetime, end_date: datetime
    ) -> ProfitReport:
        revenue = (
            self.db.query(func.sum(Sale.total_amount))
            .filter(
                and_(
                    Sale.created_at >= start_date,
                    Sale.created_at <= end_date,
                    Sale.status == SaleStatus.COMPLETED,
                )
            )
            .scalar()
            or Decimal("0.00")
        )

        cost = self._calculate_cost(start_date, end_date)
        profit = revenue - cost
        profit_margin = (profit / revenue * 100) if revenue > 0 else Decimal("0")

        sales_count = (
            self.db.query(func.count(Sale.id))
            .filter(
                and_(
                    Sale.created_at >= start_date,
                    Sale.created_at <= end_date,
                    Sale.status == SaleStatus.COMPLETED,
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
        self, start_date: datetime, end_date: datetime, limit: int = 10
    ) -> TopProductReport:
        return TopProductReport(
            period_start=start_date.isoformat(),
            period_end=end_date.isoformat(),
            top_products=self._get_top_products(start_date, end_date, limit),
        )

    def _get_top_products(
        self, start_date: datetime, end_date: datetime, limit: int = 10
    ) -> List[TopProductItem]:
        results = (
            self.db.query(
                Product.id,
                Product.name,
                Product.barcode,
                func.sum(SaleItem.quantity).label("qty"),
                func.sum(SaleItem.subtotal).label("revenue"),
            )
            .join(SaleItem, Product.id == SaleItem.product_id)
            .join(Sale, SaleItem.sale_id == Sale.id)
            .filter(
                and_(
                    Sale.created_at >= start_date,
                    Sale.created_at <= end_date,
                    Sale.status == SaleStatus.COMPLETED,
                )
            )
            .group_by(Product.id)
            .order_by(func.sum(SaleItem.quantity).desc())
            .limit(limit)
            .all()
        )

        items = []
        for r in results:
            product = self.product_repo.get_by_id(r.id)
            profit_per_unit = product.sell_price - product.cost_price
            profit = profit_per_unit * r.qty

            items.append(
                TopProductItem(
                    product_id=r.id,
                    product_name=r.name,
                    barcode=r.barcode,
                    quantity_sold=int(r.qty),
                    revenue=r.revenue,
                    profit=profit.quantize(Decimal("0.01")),
                )
            )

        return items

    def _calculate_profit(
        self, start_date: datetime, end_date: datetime
    ) -> Decimal:
        revenue = (
            self.db.query(func.sum(Sale.total_amount))
            .filter(
                and_(
                    Sale.created_at >= start_date,
                    Sale.created_at <= end_date,
                    Sale.status == SaleStatus.COMPLETED,
                )
            )
            .scalar()
            or Decimal("0.00")
        )

        cost = self._calculate_cost(start_date, end_date)
        return revenue - cost

    def _calculate_cost(
        self, start_date: datetime, end_date: datetime
    ) -> Decimal:
        result = (
            self.db.query(
                func.sum(SaleItem.quantity * Product.cost_price)
            )
            .join(Sale, SaleItem.sale_id == Sale.id)
            .join(Product, SaleItem.product_id == Product.id)
            .filter(
                and_(
                    Sale.created_at >= start_date,
                    Sale.created_at <= end_date,
                    Sale.status == SaleStatus.COMPLETED,
                )
            )
            .scalar()
        )
        return result or Decimal("0.00")
