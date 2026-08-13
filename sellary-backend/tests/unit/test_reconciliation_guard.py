"""Settled documents refuse to change — and everything that carries forward still works."""
from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest

from models.reconciliation import Reconciliation
from models.sale import PaymentMethod, Sale, SaleStatus
from models.sale_item import SaleItem
from schemas.sale_return import SaleReturnCreate
from services import reconciliation
from services.reconciliation import ReconciliationClosed
from services.sale_return_service import SaleReturnService
from services.transaction_reversal_service import TransactionReversalService
from tests.conftest import add_sale_tenders


def declare(db_session, company, day):
    db_session.add(Reconciliation(company_id=company.id, effective_from=day))
    db_session.flush()
    reconciliation.invalidate(db_session, company.id)


@pytest.fixture
def settled_sale(db_session, default_company, cashier_user, test_product):
    """A completed sale ten days ago, with the shop reconciled two days ago."""
    sale = Sale(
        cashier_id=cashier_user.id,
        subtotal=Decimal("15.00"),
        tax_amount=Decimal("0.00"),
        total_amount=Decimal("15.00"),
        payment_method=PaymentMethod.CASH,
        status=SaleStatus.COMPLETED,
        created_at=datetime.utcnow() - timedelta(days=10),
    )
    db_session.add(sale)
    db_session.flush()
    db_session.add(
        SaleItem(
            sale_id=sale.id,
            product_id=test_product.id,
            quantity=Decimal("1"),
            unit_price=Decimal("15.00"),
            tax_percent=Decimal("0.00"),
            tax_amount=Decimal("0.00"),
            subtotal=Decimal("15.00"),
            total=Decimal("15.00"),
        )
    )
    add_sale_tenders(db_session, sale)
    declare(db_session, default_company, (datetime.utcnow() - timedelta(days=2)).date())
    return sale


class TestVoidSale:
    def test_a_settled_receipt_cannot_be_annulled(
        self, db_session, default_company, settled_sale, test_product, cashier_user
    ):
        before = Decimal(test_product.stock_quantity)

        with pytest.raises(ReconciliationClosed) as exc:
            TransactionReversalService(db_session, default_company.id).void_sale(
                settled_sale.id, "передумали", cashier_user.id
            )

        assert "до сверки" in str(exc.value)
        assert Decimal(test_product.stock_quantity) == before
        assert settled_sale.status == SaleStatus.COMPLETED

    def test_the_preview_says_the_same_thing_the_executor_raises(
        self, db_session, default_company, settled_sale
    ):
        preview = TransactionReversalService(db_session, default_company.id).preview_sale(
            settled_sale.id
        )

        assert preview.can_void is False
        assert "до сверки" in preview.block_reason


class TestProcessReturn:
    def test_a_settled_receipt_cannot_be_returned(
        self, db_session, default_company, settled_sale, cashier_user
    ):
        item = settled_sale.items[0]

        with pytest.raises(ReconciliationClosed):
            SaleReturnService(db_session, default_company.id).process_return(
                settled_sale.id,
                SaleReturnCreate(
                    items=[{"sale_item_id": item.id, "quantity": Decimal("1")}],
                    reason="брак",
                    refund_method=PaymentMethod.CASH,
                ),
                cashier_user.id,
            )


class TestCarriesForward:
    """The freeze forbids editing settled documents — and nothing else."""

    def test_a_debt_against_a_settled_sale_is_still_payable(
        self, db_session, default_company, cashier_user, settled_sale
    ):
        from models.customer import Customer
        from models.customer_ledger_entry import (
            CustomerLedgerEntry,
            CustomerLedgerEntryType,
        )
        from schemas.customer_ledger import CustomerPaymentCreate
        from services.customer_ledger_service import CustomerLedgerService

        from models.sale_payment import SalePayment

        customer = Customer(company_id=default_company.id, name="Должник")
        db_session.add(customer)
        db_session.flush()
        settled_sale.customer_id = customer.id
        settled_sale.payment_status = "unpaid"
        # The debt is matched by the credit tender, not by `payment_method`.
        db_session.query(SalePayment).filter(
            SalePayment.sale_id == settled_sale.id
        ).update({SalePayment.method: PaymentMethod.CREDIT})
        db_session.add(
            CustomerLedgerEntry(
                company_id=default_company.id,
                customer_id=customer.id,
                sale_id=settled_sale.id,
                entry_type=CustomerLedgerEntryType.CREDIT_SALE.value,
                amount=Decimal("15.00"),
                created_by_user_id=cashier_user.id,
            )
        )
        db_session.flush()

        CustomerLedgerService(db_session, default_company.id).record_payment(
            customer.id,
            CustomerPaymentCreate(amount=Decimal("15.00"), payment_method=PaymentMethod.CASH),
            cashier_user.id,
        )

        assert settled_sale.payment_status == "settled"

    def test_a_new_sale_still_consumes_a_settled_fifo_layer(
        self, db_session, default_company, cashier_user, test_product, settled_sale
    ):
        from schemas.sale import SaleCreate, SaleItemCreate
        from services.sale_service import SaleService

        before = Decimal(test_product.stock_quantity)

        SaleService(db_session, default_company.id).create(
            SaleCreate(
                customer_id=None,
                items=[
                    SaleItemCreate(
                        product_id=test_product.id,
                        quantity=Decimal("2"),
                        unit_price=Decimal("15.00"),
                        tax_percent=Decimal("0.00"),
                        discount_amount=Decimal("0.00"),
                    )
                ],
                payment_method=PaymentMethod.CASH,
                discount_amount=Decimal("0.00"),
            ),
            cashier_user.id,
        )

        assert Decimal(test_product.stock_quantity) == before - 2
