from sqlalchemy.orm import Session
from sqlalchemy import or_
from models.customer import Customer
from typing import Optional, List


class CustomerRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, customer_id: int) -> Optional[Customer]:
        return self.db.query(Customer).filter(Customer.id == customer_id).first()

    def get_by_phone(self, phone: str) -> Optional[Customer]:
        return self.db.query(Customer).filter(Customer.phone == phone).first()

    def get_all(
        self, skip: int = 0, limit: int = 50, search: Optional[str] = None
    ) -> List[Customer]:
        query = self.db.query(Customer)
        if search:
            query = query.filter(
                or_(
                    Customer.name.ilike(f"%{search}%"),
                    Customer.phone.ilike(f"%{search}%"),
                    Customer.email.ilike(f"%{search}%"),
                )
            )
        return query.offset(skip).limit(limit).all()

    def create(self, customer: Customer) -> Customer:
        self.db.add(customer)
        self.db.commit()
        self.db.refresh(customer)
        return customer

    def update(self, customer: Customer) -> Customer:
        self.db.commit()
        self.db.refresh(customer)
        return customer

    def delete(self, customer_id: int) -> bool:
        customer = self.get_by_id(customer_id)
        if customer:
            self.db.delete(customer)
            self.db.commit()
            return True
        return False
