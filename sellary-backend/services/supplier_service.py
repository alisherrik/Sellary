from typing import List, Tuple, Optional
from sqlalchemy.orm import Session
from repositories.supplier_repository import SupplierRepository
from repositories.purchase_order_repository import PurchaseOrderRepository
from models.supplier import Supplier
from schemas.supplier import SupplierCreate, SupplierUpdate, SupplierResponse


class SupplierService:
    def __init__(self, db: Session):
        self.db = db
        self.supplier_repo = SupplierRepository(db)
        self.po_repo = PurchaseOrderRepository(db)

    def get_by_id(self, supplier_id: int) -> Optional[SupplierResponse]:
        supplier = self.supplier_repo.get_by_id(supplier_id)
        if not supplier:
            return None
        return self._to_response(supplier)

    def get_all(
        self,
        skip: int = 0,
        limit: int = 50,
        search: Optional[str] = None,
    ) -> Tuple[List[SupplierResponse], int]:
        suppliers, total = self.supplier_repo.get_all(
            skip=skip, limit=limit, search=search
        )
        return [self._to_response(s) for s in suppliers], total

    def create(self, supplier_create: SupplierCreate) -> SupplierResponse:
        supplier = Supplier(**supplier_create.model_dump())
        supplier = self.supplier_repo.create(supplier)
        return self._to_response(supplier)

    def update(
        self, supplier_id: int, supplier_update: SupplierUpdate
    ) -> SupplierResponse:
        supplier = self.supplier_repo.get_by_id(supplier_id)
        if not supplier:
            raise ValueError(f"Supplier with id {supplier_id} not found")

        update_data = supplier_update.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(supplier, field, value)

        supplier = self.supplier_repo.update(supplier)
        return self._to_response(supplier)

    def delete(self, supplier_id: int) -> bool:
        supplier = self.supplier_repo.get_by_id(supplier_id)
        if not supplier:
            raise ValueError(f"Supplier with id {supplier_id} not found")

        # Check if supplier has existing purchase orders
        from models.purchase_order import PurchaseOrder
        po_count = (
            self.db.query(PurchaseOrder)
            .filter(PurchaseOrder.supplier_id == supplier_id)
            .count()
        )

        if po_count > 0:
            raise ValueError(
                f"Cannot delete supplier with {po_count} existing purchase order(s)"
            )

        return self.supplier_repo.delete(supplier_id)

    def _to_response(self, supplier: Supplier) -> SupplierResponse:
        return SupplierResponse(
            id=supplier.id,
            name=supplier.name,
            contact_person=supplier.contact_person,
            email=supplier.email,
            phone=supplier.phone,
            address=supplier.address,
            payment_terms=supplier.payment_terms,
            is_active=supplier.is_active,
            created_at=supplier.created_at,
            updated_at=supplier.updated_at,
        )
