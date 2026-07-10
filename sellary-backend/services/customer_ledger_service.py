from decimal import Decimal
from typing import Iterable

from sqlalchemy import func
from sqlalchemy.orm import Session

from models.customer import Customer
from models.customer_ledger_entry import CustomerLedgerEntry, CustomerLedgerEntryType
from models.sale import PaymentMethod, Sale
from schemas.customer_ledger import (
    CustomerLedgerEntryResponse,
    CustomerLedgerResponse,
    CustomerPaymentCreate,
    CustomerPaymentResponse,
)
from services.tenant import resolve_company_id


ZERO = Decimal("0.00")


class CustomerLedgerService:
    def __init__(self, db: Session, company_id: int | None = None):
        self.db = db
        self.company_id = resolve_company_id(db, company_id)

    def get_customer_balance(self, customer_id: int) -> Decimal:
        self._require_customer(customer_id)
        return self._customer_balance(customer_id)

    def get_customer_ledger(self, customer_id: int) -> CustomerLedgerResponse:
        self._require_customer(customer_id)
        entries = self._entries_for_customer(customer_id)
        return CustomerLedgerResponse(
            customer_id=customer_id,
            balance=self._customer_balance(customer_id),
            entries=[self._entry_response(entry) for entry in entries],
        )

    def record_credit_sale(
        self,
        sale: Sale,
        user_id: int,
        initial_payment_amount: Decimal = ZERO,
        initial_payment_method: PaymentMethod | None = None,
    ) -> CustomerLedgerEntry | None:
        if sale.payment_method != PaymentMethod.CREDIT:
            sale.payment_status = "paid"
            return None
        if not sale.customer_id:
            raise ValueError("Customer is required for credit sales")

        initial_payment = Decimal(initial_payment_amount or ZERO).quantize(Decimal("0.01"))
        if initial_payment > Decimal(sale.total_amount).quantize(Decimal("0.01")):
            raise ValueError("Initial payment exceeds sale total")
        if initial_payment > ZERO and not initial_payment_method:
            raise ValueError("initial_payment_method is required when paid_amount is greater than zero")
        if initial_payment_method == PaymentMethod.CREDIT:
            raise ValueError("initial_payment_method cannot be credit")

        self._require_customer(sale.customer_id)
        entry = self._add_entry(
            customer_id=sale.customer_id,
            sale_id=sale.id,
            entry_type=CustomerLedgerEntryType.CREDIT_SALE,
            amount=Decimal(sale.total_amount).quantize(Decimal("0.01")),
            payment_method=None,
            user_id=user_id,
            description=f"Продажа в долг #{sale.id}",
        )
        if initial_payment > ZERO:
            self._add_entry(
                customer_id=sale.customer_id,
                sale_id=sale.id,
                entry_type=CustomerLedgerEntryType.PAYMENT,
                amount=-initial_payment,
                payment_method=initial_payment_method.value,
                user_id=user_id,
                description=f"Первый платеж по продаже #{sale.id}",
            )
        self._refresh_sale_payment_status(sale)
        return entry

    def record_payment(
        self,
        customer_id: int,
        payment: CustomerPaymentCreate,
        user_id: int,
    ) -> CustomerPaymentResponse:
        self._require_customer(customer_id)
        amount = Decimal(payment.amount).quantize(Decimal("0.01"))
        balance = self._customer_balance(customer_id)
        if amount > balance:
            raise ValueError("Payment exceeds customer debt")

        remaining = amount
        created: list[CustomerLedgerEntry] = []
        changed_sales: set[int] = set()
        for sale in self._open_credit_sales(customer_id):
            if remaining <= ZERO:
                break
            sale_remaining = self.sale_credit_summary(sale)["remaining"]
            if sale_remaining <= ZERO:
                continue
            applied = min(remaining, sale_remaining)
            created.append(
                self._add_entry(
                    customer_id=customer_id,
                    sale_id=sale.id,
                    entry_type=CustomerLedgerEntryType.PAYMENT,
                    amount=-applied,
                    payment_method=payment.payment_method.value,
                    user_id=user_id,
                    description=payment.description,
                )
            )
            remaining -= applied
            changed_sales.add(sale.id)

        for sale_id in changed_sales:
            sale = self.db.get(Sale, sale_id)
            if sale:
                self._refresh_sale_payment_status(sale)

        self.db.flush()
        return CustomerPaymentResponse(
            customer_id=customer_id,
            balance=self._customer_balance(customer_id),
            entries=[self._entry_response(entry) for entry in created],
        )

    def record_return_adjustment(
        self,
        sale: Sale,
        amount: Decimal,
        user_id: int,
        description: str | None = None,
    ) -> CustomerLedgerEntry | None:
        if sale.payment_method != PaymentMethod.CREDIT or not sale.customer_id:
            return None
        adjustment = min(
            Decimal(amount).quantize(Decimal("0.01")),
            self.sale_credit_summary(sale)["remaining"],
        )
        if adjustment <= ZERO:
            return None
        entry = self._add_entry(
            customer_id=sale.customer_id,
            sale_id=sale.id,
            entry_type=CustomerLedgerEntryType.RETURN_ADJUSTMENT,
            amount=-adjustment,
            payment_method=None,
            user_id=user_id,
            description=description or f"Возврат по продаже #{sale.id}",
        )
        self._refresh_sale_payment_status(sale)
        return entry

    def record_cancel_adjustment(
        self,
        sale: Sale,
        user_id: int,
        description: str | None = None,
    ) -> CustomerLedgerEntry | None:
        if sale.payment_method != PaymentMethod.CREDIT or not sale.customer_id:
            return None
        remaining = self.sale_credit_summary(sale)["remaining"]
        if remaining <= ZERO:
            return None
        entry = self._add_entry(
            customer_id=sale.customer_id,
            sale_id=sale.id,
            entry_type=CustomerLedgerEntryType.CANCEL_ADJUSTMENT,
            amount=-remaining,
            payment_method=None,
            user_id=user_id,
            description=description or f"Аннулирование продажи #{sale.id}",
        )
        self._refresh_sale_payment_status(sale)
        return entry

    def sale_credit_summary(self, sale: Sale) -> dict[str, Decimal]:
        if sale.payment_method != PaymentMethod.CREDIT:
            return {"amount": ZERO, "paid": ZERO, "remaining": ZERO}

        entries = self._entries_for_sale(sale.id)
        credit_amount = sum(
            (Decimal(entry.amount) for entry in entries if entry.entry_type == CustomerLedgerEntryType.CREDIT_SALE.value),
            ZERO,
        ).quantize(Decimal("0.01"))
        balance = sum((Decimal(entry.amount) for entry in entries), ZERO).quantize(Decimal("0.01"))
        remaining = max(ZERO, balance)
        paid = max(ZERO, credit_amount - remaining).quantize(Decimal("0.01"))
        return {"amount": credit_amount, "paid": paid, "remaining": remaining}

    def _refresh_sale_payment_status(self, sale: Sale) -> None:
        if sale.payment_method != PaymentMethod.CREDIT:
            sale.payment_status = "paid"
            return

        summary = self.sale_credit_summary(sale)
        if summary["remaining"] <= ZERO:
            sale.payment_status = "settled"
        elif summary["paid"] <= ZERO:
            sale.payment_status = "unpaid"
        else:
            sale.payment_status = "partial"

    def _open_credit_sales(self, customer_id: int) -> Iterable[Sale]:
        return (
            self.db.query(Sale)
            .filter(
                Sale.company_id == self.company_id,
                Sale.customer_id == customer_id,
                Sale.payment_method == PaymentMethod.CREDIT,
                Sale.payment_status.in_(["unpaid", "partial"]),
            )
            .order_by(Sale.created_at.asc(), Sale.id.asc())
            .all()
        )

    def _entries_for_customer(self, customer_id: int) -> list[CustomerLedgerEntry]:
        return (
            self.db.query(CustomerLedgerEntry)
            .filter(
                CustomerLedgerEntry.company_id == self.company_id,
                CustomerLedgerEntry.customer_id == customer_id,
            )
            .order_by(CustomerLedgerEntry.created_at.asc(), CustomerLedgerEntry.id.asc())
            .all()
        )

    def _entries_for_sale(self, sale_id: int) -> list[CustomerLedgerEntry]:
        return (
            self.db.query(CustomerLedgerEntry)
            .filter(
                CustomerLedgerEntry.company_id == self.company_id,
                CustomerLedgerEntry.sale_id == sale_id,
            )
            .order_by(CustomerLedgerEntry.created_at.asc(), CustomerLedgerEntry.id.asc())
            .all()
        )

    def _customer_balance(self, customer_id: int) -> Decimal:
        balance = (
            self.db.query(func.coalesce(func.sum(CustomerLedgerEntry.amount), 0))
            .filter(
                CustomerLedgerEntry.company_id == self.company_id,
                CustomerLedgerEntry.customer_id == customer_id,
            )
            .scalar()
        )
        return Decimal(balance or 0).quantize(Decimal("0.01"))

    def _require_customer(self, customer_id: int) -> Customer:
        customer = (
            self.db.query(Customer)
            .filter(
                Customer.company_id == self.company_id,
                Customer.id == customer_id,
                Customer.is_active == True,
            )
            .first()
        )
        if not customer:
            raise ValueError(f"Customer with id {customer_id} not found")
        return customer

    def _add_entry(
        self,
        *,
        customer_id: int,
        sale_id: int | None,
        entry_type: CustomerLedgerEntryType,
        amount: Decimal,
        payment_method: str | None,
        user_id: int,
        description: str | None,
    ) -> CustomerLedgerEntry:
        entry = CustomerLedgerEntry(
            company_id=self.company_id,
            customer_id=customer_id,
            sale_id=sale_id,
            entry_type=entry_type.value,
            amount=Decimal(amount).quantize(Decimal("0.01")),
            payment_method=payment_method,
            created_by_user_id=user_id,
            description=description,
        )
        self.db.add(entry)
        self.db.flush()
        return entry

    @staticmethod
    def _entry_response(entry: CustomerLedgerEntry) -> CustomerLedgerEntryResponse:
        return CustomerLedgerEntryResponse(
            id=entry.id,
            customer_id=entry.customer_id,
            sale_id=entry.sale_id,
            entry_type=entry.entry_type,
            amount=entry.amount,
            payment_method=entry.payment_method,
            description=entry.description,
            created_by_user_id=entry.created_by_user_id,
            created_at=entry.created_at,
        )
