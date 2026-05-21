from decimal import Decimal
from sqlalchemy.orm import Session, joinedload
from models.sale import Sale, SaleStatus, SaleContextType
from models.sale_item import SaleItem
from typing import Optional, List, Tuple
from datetime import datetime


class SaleRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, company_id: int, sale_id: int) -> Optional[Sale]:
        return (
            self.db.query(Sale)
            .options(joinedload(Sale.items), joinedload(Sale.customer), joinedload(Sale.cashier))
            .filter(Sale.company_id == company_id, Sale.id == sale_id)
            .first()
        )

    def get_by_id_for_update(self, company_id: int, sale_id: int) -> Optional[Sale]:
        return (
            self.db.query(Sale)
            .filter(Sale.company_id == company_id, Sale.id == sale_id)
            .with_for_update()
            .first()
        )

    def get_sale_items_for_update(self, sale_id: int) -> List[SaleItem]:
        return (
            self.db.query(SaleItem)
            .filter(SaleItem.sale_id == sale_id)
            .order_by(SaleItem.id)
            .with_for_update()
            .all()
        )

    def get_all(
        self,
        company_id: int,
        skip: int = 0,
        limit: int = 50,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        cashier_id: Optional[int] = None,
        status: Optional[SaleStatus] = None,
        context_type: Optional[SaleContextType] = None,
    ) -> Tuple[List[Sale], int]:
        query = self.db.query(Sale).options(
            joinedload(Sale.items),
            joinedload(Sale.cashier),
        ).filter(Sale.company_id == company_id)

        if start_date:
            query = query.filter(Sale.created_at >= start_date)
        if end_date:
            query = query.filter(Sale.created_at <= end_date)
        if cashier_id:
            query = query.filter(Sale.cashier_id == cashier_id)
        if status:
            query = query.filter(Sale.status == status)
        if context_type:
            query = query.filter(Sale.context_type == context_type)

        query = query.order_by(Sale.created_at.desc())

        total = query.count()
        sales = query.offset(skip).limit(limit).all()

        return sales, total

    def create(self, sale: Sale, items: List[SaleItem]) -> Sale:
        self.db.add(sale)
        self.db.flush()

        for item in items:
            item.sale_id = sale.id
            self.db.add(item)

        self.db.flush()
        return sale

    def update(self, sale: Sale) -> Sale:
        self.db.commit()
        self.db.refresh(sale)
        return sale

    def get_daily_sales(
        self, company_id: int, start_date: datetime, end_date: datetime
    ) -> List[tuple[datetime, int, Decimal, Decimal]]:
        result = (
            self.db.query(
                Sale.created_at,
                Sale.id,
                Sale.total_amount,
            )
            .filter(
                Sale.company_id == company_id,
                Sale.created_at >= start_date,
                Sale.created_at <= end_date,
            )
            .filter(Sale.status == SaleStatus.COMPLETED)
            .order_by(Sale.created_at)
            .all()
        )
        return result

    def get_top_products(
        self, company_id: int, start_date: datetime, end_date: datetime, limit: int = 10
    ) -> List[tuple]:
        from models.product import Product

        result = (
            self.db.query(
                Product.id,
                Product.name,
                Product.barcode,
                SaleItem.quantity,
                SaleItem.subtotal,
            )
            .join(SaleItem, Product.id == SaleItem.product_id)
            .join(Sale, SaleItem.sale_id == Sale.id)
            .filter(
                Sale.company_id == company_id,
                Sale.created_at >= start_date,
                Sale.created_at <= end_date,
            )
            .filter(Sale.status == SaleStatus.COMPLETED)
            .order_by(SaleItem.quantity.desc())
            .limit(limit)
            .all()
        )
        return result
