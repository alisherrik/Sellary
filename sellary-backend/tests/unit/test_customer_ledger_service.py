from decimal import Decimal

import pytest

from models.customer_ledger_entry import CustomerLedgerEntry, CustomerLedgerEntryType
from models.sale import PaymentMethod
from schemas.customer_ledger import CustomerPaymentCreate
from schemas.sale import SaleCreate, SaleItemCreate
from services.customer_ledger_service import CustomerLedgerService
from services.sale_service import SaleService


def _credit_sale_payload(customer_id: int, product_id: int, quantity: str = "2") -> SaleCreate:
    return SaleCreate(
        customer_id=customer_id,
        items=[
            SaleItemCreate(
                product_id=product_id,
                quantity=Decimal(quantity),
                unit_price=Decimal("15.00"),
                tax_percent=Decimal("0.00"),
                discount_amount=Decimal("0.00"),
            )
        ],
        payment_method=PaymentMethod.CREDIT,
        discount_amount=Decimal("0.00"),
    )


def test_credit_sale_records_positive_customer_balance(
    db_session,
    default_company,
    test_customer,
    cashier_user,
    test_product,
):
    sale = SaleService(db_session, default_company.id).create(
        _credit_sale_payload(test_customer.id, test_product.id),
        cashier_user.id,
    )

    ledger = CustomerLedgerService(db_session, default_company.id)

    assert sale.payment_method == PaymentMethod.CREDIT
    assert sale.payment_status == "unpaid"
    assert sale.credit_amount == Decimal("30.00")
    assert sale.credit_paid_amount == Decimal("0.00")
    assert sale.credit_remaining_amount == Decimal("30.00")
    assert ledger.get_customer_balance(test_customer.id) == Decimal("30.00")

    entry = db_session.query(CustomerLedgerEntry).one()
    assert entry.customer_id == test_customer.id
    assert entry.sale_id == sale.id
    assert entry.entry_type == CustomerLedgerEntryType.CREDIT_SALE
    assert entry.amount == Decimal("30.00")


def test_credit_sale_requires_customer(db_session, default_company, cashier_user, test_product):
    payload = _credit_sale_payload(customer_id=0, product_id=test_product.id)
    payload.customer_id = None

    with pytest.raises(ValueError, match="Customer is required"):
        SaleService(db_session, default_company.id).create(payload, cashier_user.id)


def test_customer_payment_reduces_balance_and_updates_sale_status(
    db_session,
    default_company,
    test_customer,
    cashier_user,
    test_product,
):
    sale = SaleService(db_session, default_company.id).create(
        _credit_sale_payload(test_customer.id, test_product.id),
        cashier_user.id,
    )

    result = CustomerLedgerService(db_session, default_company.id).record_payment(
        test_customer.id,
        CustomerPaymentCreate(
            amount=Decimal("10.00"),
            payment_method=PaymentMethod.CASH,
            description="Частичная оплата",
        ),
        cashier_user.id,
    )
    refreshed = SaleService(db_session, default_company.id).get_by_id(sale.id)

    assert result.balance == Decimal("20.00")
    assert refreshed.payment_status == "partial"
    assert refreshed.credit_paid_amount == Decimal("10.00")
    assert refreshed.credit_remaining_amount == Decimal("20.00")


def test_overpayment_is_rejected(
    db_session,
    default_company,
    test_customer,
    cashier_user,
    test_product,
):
    SaleService(db_session, default_company.id).create(
        _credit_sale_payload(test_customer.id, test_product.id, quantity="1"),
        cashier_user.id,
    )

    with pytest.raises(ValueError, match="Payment exceeds customer debt"):
        CustomerLedgerService(db_session, default_company.id).record_payment(
            test_customer.id,
            CustomerPaymentCreate(
                amount=Decimal("100.00"),
                payment_method=PaymentMethod.CASH,
            ),
            cashier_user.id,
        )
