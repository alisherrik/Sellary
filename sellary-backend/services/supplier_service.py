from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from models.purchase_order import PurchaseOrder
from models.supplier import Supplier
from repositories.purchase_order_repository import PurchaseOrderRepository
from repositories.supplier_repository import SupplierRepository
from schemas.supplier import SupplierCreate, SupplierResponse, SupplierUpdate
from services.tenant import resolve_company_id


class SupplierService:
    def __init__(self, db: Session, company_id: int | None = None):
        self.db = db
        self.company_id = resolve_company_id(db, company_id)
        self.supplier_repo = SupplierRepository(db)
        self.po_repo = PurchaseOrderRepository(db)

    def get_by_id(self, supplier_id: int) -> Optional[SupplierResponse]:
        supplier = self.supplier_repo.get_by_id(self.company_id, supplier_id)
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
            self.company_id,
            skip=skip,
            limit=limit,
            search=search,
        )
        return [self._to_response(supplier) for supplier in suppliers], total

    def create(self, supplier_create: SupplierCreate) -> SupplierResponse:
        supplier = Supplier(company_id=self.company_id, **supplier_create.model_dump())
        supplier = self.supplier_repo.create(supplier)
        return self._to_response(supplier)

    def update(self, supplier_id: int, supplier_update: SupplierUpdate) -> SupplierResponse:
        supplier = self.supplier_repo.get_by_id(self.company_id, supplier_id)
        if not supplier:
            raise ValueError(f"Supplier with id {supplier_id} not found")

        update_data = supplier_update.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(supplier, field, value)

        supplier = self.supplier_repo.update(supplier)
        return self._to_response(supplier)

    def delete(self, supplier_id: int) -> bool:
        supplier = self.supplier_repo.get_by_id(self.company_id, supplier_id)
        if not supplier:
            raise ValueError(f"Supplier with id {supplier_id} not found")

        po_count = (
            self.db.query(PurchaseOrder)
            .filter(
                PurchaseOrder.company_id == self.company_id,
                PurchaseOrder.supplier_id == supplier_id,
            )
            .count()
        )

        if po_count > 0:
            raise ValueError(
                f"Cannot delete supplier with {po_count} existing purchase order(s)"
            )

        return self.supplier_repo.delete(self.company_id, supplier_id)

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
