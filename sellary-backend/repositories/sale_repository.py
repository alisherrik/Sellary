from decimal import Decimal
from sqlalchemy import String, cast, or_
from sqlalchemy.orm import Session, joinedload
from models.sale import Sale, SaleStatus
from models.sale_item import SaleItem
from models.sale_return import SaleReturn
from models.product import Product
from models.customer import Customer
from models.user import User
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
        search_terms: Optional[List[str]] = None,
        status_group: Optional[str] = None,
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
        if status_group == "returns":
            query = query.filter(
                Sale.status.in_([SaleStatus.RETURNED, SaleStatus.PARTIALLY_RETURNED])
            )
        if search_terms:
            conditions = []
            for term in search_terms:
                pattern = f"%{term}%"
                conditions.extend(
                    [
                        cast(Sale.id, String).ilike(pattern),
                        cast(Sale.created_at, String).ilike(pattern),
                        cast(Sale.voided_at, String).ilike(pattern),
                        cast(Sale.subtotal, String).ilike(pattern),
                        cast(Sale.tax_amount, String).ilike(pattern),
                        cast(Sale.discount_amount, String).ilike(pattern),
                        cast(Sale.total_amount, String).ilike(pattern),
                        cast(Sale.payment_method, String).ilike(pattern),
                        cast(Sale.card_type, String).ilike(pattern),
                        cast(Sale.status, String).ilike(pattern),
                        Sale.notes.ilike(pattern),
                        Sale.void_reason.ilike(pattern),
                        Sale.cashier.has(
                            or_(
                                User.username.ilike(pattern),
                                User.full_name.ilike(pattern),
                                User.email.ilike(pattern),
                            )
                        ),
                        Sale.customer.has(
                            or_(
                                Customer.name.ilike(pattern),
                                Customer.phone.ilike(pattern),
                                Customer.email.ilike(pattern),
                            )
                        ),
                        Sale.items.any(
                            SaleItem.product.has(
                                or_(
                                    Product.name.ilike(pattern),
                                    Product.barcode.ilike(pattern),
                                )
                            )
                        ),
                        Sale.returns.any(
                            cast(SaleReturn.total_refund_amount, String).ilike(pattern)
                        ),
                    ]
                )
            query = query.filter(or_(*conditions))

        query = query.order_by(Sale.created_at.desc())

        total = query.count()
        sales = query.offset(skip).limit(limit).all()

        return sales, total

    def get_search_candidates(self, company_id: int) -> list[tuple[str, str, str]]:
        """Return distinct suggestion values that occur in this tenant's sales."""

        candidates: list[tuple[str, str, str]] = []

        product_rows = (
            self.db.query(Product.name, Product.barcode)
            .join(SaleItem, SaleItem.product_id == Product.id)
            .join(Sale, Sale.id == SaleItem.sale_id)
            .filter(Sale.company_id == company_id)
            .distinct()
            .all()
        )
        for name, barcode in product_rows:
            if name:
                candidates.append(("product", name, name))
            if barcode:
                candidates.append(("product", f"{name} · {barcode}", barcode))

        customer_rows = (
            self.db.query(Customer.name, Customer.phone, Customer.email)
            .join(Sale, Sale.customer_id == Customer.id)
            .filter(Sale.company_id == company_id)
            .distinct()
            .all()
        )
        for name, phone, email in customer_rows:
            if name:
                candidates.append(("customer", name, name))
            if phone:
                candidates.append(("customer", f"{name} · {phone}", phone))
            if email:
                candidates.append(("customer", f"{name} · {email}", email))

        cashier_rows = (
            self.db.query(User.username, User.full_name, User.email)
            .join(Sale, Sale.cashier_id == User.id)
            .filter(Sale.company_id == company_id)
            .distinct()
            .all()
        )
        for username, full_name, email in cashier_rows:
            display_name = full_name or username
            candidates.append(("cashier", display_name, display_name))
            if username and username != display_name:
                candidates.append(("cashier", f"{display_name} · {username}", username))
            if email:
                candidates.append(("cashier", f"{display_name} · {email}", email))

        return candidates

    def create(self, sale: Sale, items: List[SaleItem]) -> Sale:
        """Persist a sale and its items, flushing so both get primary keys.

        The trailing flush is load-bearing: callers (SaleService, SyncService)
        consume each item's stock through the FIFO ledger immediately after,
        and ``InventoryAllocation.sale_item_id`` requires the item ``id`` to be
        assigned. Do not drop this flush.
        """
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
