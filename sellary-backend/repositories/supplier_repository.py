from sqlalchemy.orm import Session
from sqlalchemy import or_
from models.supplier import Supplier
from typing import Optional, List


class SupplierRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, company_id: int, supplier_id: int) -> Optional[Supplier]:
        return self.db.query(Supplier).filter(
            Supplier.company_id == company_id,
            Supplier.id == supplier_id,
        ).first()

    def get_all(
        self,
        company_id: int,
        skip: int = 0,
        limit: int = 50,
        search: Optional[str] = None,
        active_only: bool = True,
    ) -> tuple[List[Supplier], int]:
        query = self.db.query(Supplier).filter(Supplier.company_id == company_id)

        if active_only:
            query = query.filter(Supplier.is_active == True)

        if search:
            query = query.filter(
                or_(
                    Supplier.name.ilike(f"%{search}%"),
                    Supplier.contact_person.ilike(f"%{search}%"),
                    Supplier.phone.ilike(f"%{search}%"),
                    Supplier.email.ilike(f"%{search}%"),
                )
            )

        total = query.count()
        suppliers = query.offset(skip).limit(limit).all()

        return suppliers, total

    def create(self, supplier: Supplier) -> Supplier:
        self.db.add(supplier)
        self.db.commit()
        self.db.refresh(supplier)
        return supplier

    def update(self, supplier: Supplier) -> Supplier:
        self.db.commit()
        self.db.refresh(supplier)
        return supplier

    def delete(self, company_id: int, supplier_id: int) -> bool:
        supplier = self.get_by_id(company_id, supplier_id)
        if supplier:
            self.db.delete(supplier)
            self.db.commit()
            return True
        return False
