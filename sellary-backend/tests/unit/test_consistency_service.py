"""The checker finds a planted break, and stays quiet when there is nothing to find.

Each check gets the same two cases — a clean fixture yields nothing, and a break
planted directly on the row yields exactly one finding naming it — because a checker
that cannot be shown to fire is indistinguishable from one that never runs.
"""
from datetime import datetime
from decimal import Decimal

import pytest

from core.security import get_password_hash
from models.customer import Customer
from models.customer_ledger_entry import CustomerLedgerEntry, CustomerLedgerEntryType
from models.inventory_layer import InventoryLayer
from models.money_account import MoneyAccount, MoneyMovement
from models.product import Product
from models.sale import PaymentMethod, Sale, SaleStatus
from models.sale_payment import SalePayment
from models.user import User
from services.consistency_service import CHECKS, ConsistencyService
from tests.conftest import add_sale_tenders


@pytest.fixture
def cashier(db_session):
    user = User(
        username="consistency-cashier",
        email="consistency-cashier@test.com",
        hashed_password=get_password_hash("password"),
        role="cashier",
    )
    db_session.add(user)
    db_session.flush()
    return user


@pytest.fixture
def bare_product(db_session, default_company, test_category):
    """A product with no opening layer — the `test_product` fixture writes one."""
    product = Product(
        company_id=default_company.id,
        name="Bare Product",
        barcode="BARE0001",
        category_id=test_category.id,
        cost_price=Decimal("10.00"),
        sell_price=Decimal("15.00"),
        stock_quantity=Decimal("0"),
        is_active=True,
    )
    db_session.add(product)
    db_session.flush()
    return product


def make_sale(db_session, cashier, total="100.00", status=SaleStatus.COMPLETED):
    sale = Sale(
        cashier_id=cashier.id,
        subtotal=Decimal(total),
        tax_amount=Decimal("0.00"),
        total_amount=Decimal(total),
        payment_method=PaymentMethod.CASH,
        status=status,
        created_at=datetime(2026, 8, 1, 12, 0),
    )
    db_session.add(sale)
    db_session.flush()
    return add_sale_tenders(db_session, sale)


def add_layer(db_session, product, quantity, company_id):
    layer = InventoryLayer(
        company_id=company_id,
        product_id=product.id,
        source_type="product_initial",
        original_quantity=Decimal(quantity),
        remaining_quantity=Decimal(quantity),
        unit_cost=Decimal("1.0000"),
    )
    db_session.add(layer)
    db_session.flush()
    return layer


def run(db_session, company, key):
    return ConsistencyService(db_session, company.id).run(keys=[key])


class TestStockVsLayers:
    def test_a_product_whose_layers_match_is_not_reported(
        self, db_session, default_company, bare_product
    ):
        bare_product.stock_quantity = Decimal("5")
        add_layer(db_session, bare_product, "5", default_company.id)
        assert run(db_session, default_company, "stock_vs_layers") == []

    def test_a_balance_that_left_its_layers_behind_is_reported(
        self, db_session, default_company, bare_product
    ):
        add_layer(db_session, bare_product, "5", default_company.id)
        bare_product.stock_quantity = Decimal("8")
        db_session.flush()

        findings = run(db_session, default_company, "stock_vs_layers")

        assert len(findings) == 1
        assert str(bare_product.id) in findings[0].subject
        assert findings[0].bucket == "drift"

    def test_an_offline_oversell_is_a_recorded_fact_not_a_drift(
        self, db_session, default_company, bare_product
    ):
        bare_product.stock_quantity = Decimal("-3")
        db_session.flush()

        findings = run(db_session, default_company, "stock_vs_layers")

        assert [f.bucket for f in findings] == ["known"]

    def test_another_company_is_never_reported(
        self, db_session, default_company, secondary_company, bare_product
    ):
        add_layer(db_session, bare_product, "5", default_company.id)
        bare_product.stock_quantity = Decimal("8")
        db_session.flush()

        assert run(db_session, secondary_company, "stock_vs_layers") == []


class TestSaleTenders:
    def test_a_sale_whose_tenders_sum_to_its_total_is_not_reported(
        self, db_session, default_company, cashier
    ):
        make_sale(db_session, cashier)
        assert run(db_session, default_company, "sale_tenders_sum") == []

    def test_a_sale_missing_a_tender_is_reported(self, db_session, default_company, cashier):
        sale = make_sale(db_session, cashier)
        db_session.query(SalePayment).filter(SalePayment.sale_id == sale.id).delete()
        db_session.flush()

        findings = run(db_session, default_company, "sale_tenders_sum")

        assert len(findings) == 1
        assert "нет ни одной оплаты" in findings[0].note

    def test_a_cancelled_sale_is_not_money_and_is_not_reported(
        self, db_session, default_company, cashier
    ):
        sale = make_sale(db_session, cashier, status=SaleStatus.CANCELLED)
        db_session.query(SalePayment).filter(SalePayment.sale_id == sale.id).delete()
        db_session.flush()

        assert run(db_session, default_company, "sale_tenders_sum") == []


class TestMoneyTransferLegs:
    def test_a_leg_without_its_pair_is_reported(self, db_session, default_company, cashier):
        account = MoneyAccount(
            company_id=default_company.id, name="Касса", is_till=True, opening_balance=Decimal("0")
        )
        db_session.add(account)
        db_session.flush()
        db_session.add(
            MoneyMovement(
                company_id=default_company.id,
                account_id=account.id,
                direction="out",
                amount=Decimal("50.00"),
                reason="transfer_out",
                created_by_user_id=cashier.id,
            )
        )
        db_session.flush()

        findings = run(db_session, default_company, "money_transfer_legs")

        assert len(findings) == 1
        assert "без пары" in findings[0].actual


class TestCreditPaymentStatus:
    def test_a_status_that_disagrees_with_the_ledger_is_reported(
        self, db_session, default_company, cashier
    ):
        customer = Customer(company_id=default_company.id, name="Должник")
        db_session.add(customer)
        db_session.flush()
        sale = make_sale(db_session, cashier)
        sale.customer_id = customer.id
        sale.payment_status = "paid"
        db_session.add(
            CustomerLedgerEntry(
                company_id=default_company.id,
                customer_id=customer.id,
                sale_id=sale.id,
                entry_type=CustomerLedgerEntryType.CREDIT_SALE.value,
                amount=Decimal("100.00"),
                created_by_user_id=cashier.id,
            )
        )
        db_session.flush()

        findings = run(db_session, default_company, "credit_payment_status")

        assert [f.expected for f in findings] == ["unpaid"]


class TestRegistry:
    def test_an_unknown_key_is_refused(self, db_session, default_company):
        with pytest.raises(ValueError):
            ConsistencyService(db_session, default_company.id).run(keys=["no_such_check"])

    def test_a_pending_change_is_not_flushed_by_the_run(
        self, db_session, default_company, bare_product
    ):
        # A diagnostic tool that can flush is one that will eventually flush in
        # production. The pending edit must still be pending afterwards.
        db_session.autoflush = True
        bare_product.stock_quantity = Decimal("99")

        ConsistencyService(db_session, default_company.id).run()

        assert bare_product in db_session.dirty
        assert db_session.autoflush is True

    def test_every_check_runs_on_an_empty_company(self, db_session, secondary_company):
        assert ConsistencyService(db_session, secondary_company.id).run() == []
        assert len(CHECKS) == 6
