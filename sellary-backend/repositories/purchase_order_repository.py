from decimal import Decimal
from sqlalchemy.orm import Session, joinedload
from models.purchase_order import PurchaseOrder, PurchaseOrderStatus
from models.purchase_order_item import PurchaseOrderItem
from typing import Optional, List
from datetime import datetime


class PurchaseOrderRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, company_id: int, po_id: int) -> Optional[PurchaseOrder]:
        return (
            self.db.query(PurchaseOrder)
            .options(
                joinedload(PurchaseOrder.supplier),
                joinedload(PurchaseOrder.items).joinedload(PurchaseOrderItem.product),
            )
            .filter(
                PurchaseOrder.company_id == company_id,
                PurchaseOrder.id == po_id,
            )
            .first()
        )

    def get_by_id_for_update(self, company_id: int, po_id: int) -> Optional[PurchaseOrder]:
        return (
            self.db.query(PurchaseOrder)
            .filter(
                PurchaseOrder.company_id == company_id,
                PurchaseOrder.id == po_id,
            )
            .with_for_update()
            .first()
        )

    def get_po_items_for_update(self, po_id: int) -> List[PurchaseOrderItem]:
        return (
            self.db.query(PurchaseOrderItem)
            .filter(PurchaseOrderItem.purchase_order_id == po_id)
            .order_by(PurchaseOrderItem.id)
            .with_for_update()
            .all()
        )

    def get_all(
        self,
        company_id: int,
        skip: int = 0,
        limit: int = 50,
        supplier_id: Optional[int] = None,
        status: Optional[PurchaseOrderStatus] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> tuple[List[PurchaseOrder], int]:
        query = self.db.query(PurchaseOrder).filter(
            PurchaseOrder.company_id == company_id,
            PurchaseOrder.is_active == True,
        )

        if supplier_id:
            query = query.filter(PurchaseOrder.supplier_id == supplier_id)

        if status:
            query = query.filter(PurchaseOrder.status == status)

        if start_date:
            query = query.filter(PurchaseOrder.order_date >= start_date)

        if end_date:
            query = query.filter(PurchaseOrder.order_date <= end_date)

        total = query.count()
        purchase_orders = (
            query.options(joinedload(PurchaseOrder.supplier))
            .order_by(PurchaseOrder.order_date.desc())
            .offset(skip)
            .limit(limit)
            .all()
        )

        return purchase_orders, total

    def create(self, purchase_order: PurchaseOrder) -> PurchaseOrder:
        self.db.add(purchase_order)
        self.db.commit()
        self.db.refresh(purchase_order)
        return purchase_order

    def create_with_items(
        self, purchase_order: PurchaseOrder, items: List[PurchaseOrderItem]
    ) -> PurchaseOrder:
        self.db.add(purchase_order)
        self.db.flush()  # Get the ID without committing

        for item in items:
            item.purchase_order_id = purchase_order.id
            self.db.add(item)

        self.db.commit()
        self.db.refresh(purchase_order)
        return purchase_order

    def update(self, purchase_order: PurchaseOrder) -> PurchaseOrder:
        self.db.commit()
        self.db.refresh(purchase_order)
        return purchase_order

    def update_status(
        self,
        company_id: int,
        po_id: int,
        status: PurchaseOrderStatus,
    ) -> Optional[PurchaseOrder]:
        po = self.get_by_id(company_id, po_id)
        if po:
            po.status = status
            self.db.commit()
            self.db.refresh(po)
        return po

    def delete(self, company_id: int, po_id: int) -> bool:
        po = self.get_by_id(company_id, po_id)
        if po:
            self.db.delete(po)
            self.db.commit()
            return True
        return False

    def get_items_by_po_id(self, po_id: int) -> List[PurchaseOrderItem]:
        return (
            self.db.query(PurchaseOrderItem)
            .options(joinedload(PurchaseOrderItem.product))
            .filter(PurchaseOrderItem.purchase_order_id == po_id)
            .all()
        )

    def update_items(self, po_id: int, items: List[PurchaseOrderItem]) -> List[PurchaseOrderItem]:
        # Delete existing items
        self.db.query(PurchaseOrderItem).filter(
            PurchaseOrderItem.purchase_order_id == po_id
        ).delete()

        # Add new items
        for item in items:
            item.purchase_order_id = po_id
            self.db.add(item)

        self.db.commit()
        return self.get_items_by_po_id(po_id)
