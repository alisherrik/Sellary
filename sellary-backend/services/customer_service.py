"""Tenant-scoped customer reads; balances come from the customer ledger."""

from decimal import Decimal
from sqlalchemy import func
from models.customer_ledger_entry import CustomerLedgerEntry
from repositories.customer_repository import CustomerRepository
from schemas.customer import Customer
from services.tenant import resolve_company_id


class CustomerService:
    def __init__(self, db, company_id=None):
        self.db = db
        self.company_id = resolve_company_id(db, company_id)
        self.repo = CustomerRepository(db)

    def get_all(self, skip=0, limit=50, search=None):
        rows, total = self.repo.get_page(self.company_id, skip, limit, search)
        ids = [row.id for row in rows]
        balances = dict(self.db.query(CustomerLedgerEntry.customer_id,
                                      func.sum(CustomerLedgerEntry.amount)).filter(
            CustomerLedgerEntry.company_id == self.company_id,
            CustomerLedgerEntry.customer_id.in_(ids)).group_by(CustomerLedgerEntry.customer_id).all()) if ids else {}
        result = []
        for row in rows:
            response = Customer.model_validate(row)
            response.balance = Decimal(balances.get(row.id, 0)).quantize(Decimal("0.01"))
            result.append(response)
        return result, total
