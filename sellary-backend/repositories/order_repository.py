"""Order repository — DB-layer queries for the marketplace order domain."""
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session, joinedload

from models.order import Order, OrderStatus
from models.order_item import OrderItem


class OrderRepository:
    def __init__(self, db: Session):
        self.db = db

    def _base_query(self):
        return self.db.query(Order).options(
            joinedload(Order.items).joinedload(OrderItem.product),
            joinedload(Order.company),
            joinedload(Order.telegram_user),
            joinedload(Order.customer),
        )

    def get_by_id(self, company_id: int, order_id: int) -> Optional[Order]:
        return (
            self._base_query()
            .filter(Order.company_id == company_id, Order.id == order_id)
            .first()
        )

    def get_by_id_for_update(self, company_id: int, order_id: int) -> Optional[Order]:
        """Load with a row-level lock for mutation (e.g. status changes)."""
        return (
            self.db.query(Order)
            .with_for_update()
            .filter(Order.company_id == company_id, Order.id == order_id)
            .first()
        )

    def get_by_id_global(self, order_id: int) -> Optional[Order]:
        """Load without tenant scope (used by shopper 'my orders' path)."""
        return self._base_query().filter(Order.id == order_id).first()

    def get_all_for_company(
        self,
        company_id: int,
        *,
        skip: int = 0,
        limit: int = 50,
        status: Optional[str] = None,
    ) -> Tuple[List[Order], int]:
        query = self._base_query().filter(Order.company_id == company_id)
        if status:
            query = query.filter(Order.status == status)
        total = query.count()
        orders = (
            query.order_by(Order.created_at.desc()).offset(skip).limit(limit).all()
        )
        return orders, total

    def get_all_for_shopper(
        self,
        telegram_user_id: int,
        *,
        skip: int = 0,
        limit: int = 50,
    ) -> Tuple[List[Order], int]:
        query = self._base_query().filter(
            Order.telegram_user_id == telegram_user_id
        )
        total = query.count()
        orders = (
            query.order_by(Order.created_at.desc()).offset(skip).limit(limit).all()
        )
        return orders, total

    def next_order_number(self, company_id: int) -> int:
        """Return the next sequential order number for a company (1-based)."""
        last = (
            self.db.query(Order.order_number)
            .filter(Order.company_id == company_id)
            .order_by(Order.order_number.desc())
            .with_for_update()
            .scalar()
        )
        return (last or 0) + 1

    def create(self, order: Order, items: List[OrderItem]) -> Order:
        self.db.add(order)
        self.db.flush()
        for item in items:
            item.order_id = order.id
            self.db.add(item)
        self.db.flush()
        self.db.refresh(order)
        return order
