"""Unit tests for TransactionReversalService — admin sale annulment (void)."""
from decimal import Decimal

import pytest

from models.inventory_layer import InventoryLayer
from models.inventory_log import InventoryLog
from models.reversal_operation import ReversalOperation
from models.sale import SaleStatus
from services.transaction_reversal_service import (
    ReversalBlocked,
    ReversalConflict,
    TransactionReversalService,
)


def test_void_sale_restores_only_outstanding_quantity(db_session, partially_returned_sale, admin_user):
    service = TransactionReversalService(db_session, partially_returned_sale.company_id)
    before = partially_returned_sale.items[0].product.stock_quantity
    result = service.void_sale(partially_returned_sale.id, "Тестовая продажа", admin_user.id)
    assert result.entity_type == "sale"
    assert partially_returned_sale.items[0].product.stock_quantity == before + Decimal("7")
    assert partially_returned_sale.status == SaleStatus.CANCELLED
    assert partially_returned_sale.void_reason == "Тестовая продажа"


def test_void_sale_is_rejected_twice(db_session, voided_sale, admin_user):
    with pytest.raises(ReversalConflict, match="Продажа уже аннулирована"):
        TransactionReversalService(db_session, voided_sale.company_id).void_sale(
            voided_sale.id, "Повтор", admin_user.id
        )


def test_void_sale_sets_audit_fields_and_operation(db_session, test_sale, admin_user):
    service = TransactionReversalService(db_session, test_sale.company_id)
    result = service.void_sale(test_sale.id, "Аудит-причина", admin_user.id)

    db_session.refresh(test_sale)
    assert test_sale.status == SaleStatus.CANCELLED
    assert test_sale.voided_at is not None
    assert test_sale.voided_by_user_id == admin_user.id
    assert test_sale.void_reason == "Аудит-причина"
    assert test_sale.reversal_operation_id == result.operation_id

    operation = db_session.get(ReversalOperation, result.operation_id)
    assert operation is not None
    assert operation.entity_type == "sale"
    assert operation.operation_type == "sale_void"
    assert operation.entity_id == test_sale.id
    assert operation.reason == "Аудит-причина"
    assert operation.user_id == admin_user.id
    # impact JSON carries per-item lineage used by reports/audit
    assert operation.impact["entity_type"] == "sale"
    assert operation.impact["entity_id"] == test_sale.id
    assert isinstance(operation.impact["impacts"], list)
    assert operation.impact["impacts"][0]["product_id"] == test_sale.items[0].product_id


def test_void_ledger_backed_sale_releases_allocations_and_restores_value(
    db_session, test_sale, admin_user
):
    """Regression: voiding a ledger-backed sale must release allocations
    (not direct stock bump) and restore stock AND inventory value exactly."""
    item = test_sale.items[0]
    product = item.product
    stock_before = product.stock_quantity
    value_before = product.inventory_value

    service = TransactionReversalService(db_session, test_sale.company_id)
    service.void_sale(test_sale.id, "Возврат на склад", admin_user.id)

    db_session.refresh(product)
    db_session.refresh(item)

    # 2 units sold @ cost 10.00 -> released back fully
    assert product.stock_quantity == stock_before + Decimal("2")
    assert product.inventory_value == value_before + Decimal("20.0000")
    # allocations were released, not duplicated into a new layer
    assert sum(a.released_quantity for a in item.allocations) == Decimal("2")
    void_layers = (
        db_session.query(InventoryLayer)
        .filter_by(source_type="sale_void", product_id=product.id)
        .all()
    )
    assert void_layers == []


def test_void_legacy_sale_creates_void_layer(db_session, admin_user, default_company):
    """A pre-ledger sale (item without allocations) must restock by adding a
    fresh sale_void layer valued at the recorded cost-at-sale."""
    from datetime import datetime

    from models.category import Category
    from models.customer import Customer
    from models.product import Product
    from models.sale import PaymentMethod, Sale
    from models.sale_item import SaleItem

    category = Category(name="Legacy Void Category")
    db_session.add(category)
    db_session.flush()

    product = Product(
        name="Legacy Void Product",
        barcode="LEGVOID1",
        category_id=category.id,
        cost_price=Decimal("10.00"),
        sell_price=Decimal("15.00"),
        stock_quantity=Decimal("8"),
        inventory_value=Decimal("0.0000"),
    )
    db_session.add(product)
    db_session.flush()

    customer = Customer(name="Legacy Void Customer")
    db_session.add(customer)
    db_session.flush()

    sale = Sale(
        customer_id=customer.id,
        cashier_id=admin_user.id,
        subtotal=Decimal("30.00"),
        tax_amount=Decimal("3.00"),
        total_amount=Decimal("33.00"),
        payment_method=PaymentMethod.CASH,
        status=SaleStatus.COMPLETED,
        created_at=datetime.now(),
    )
    db_session.add(sale)
    db_session.flush()

    sale_item = SaleItem(
        sale_id=sale.id,
        product_id=product.id,
        quantity=Decimal("2"),
        unit_price=Decimal("15.00"),
        tax_percent=Decimal("10.00"),
        tax_amount=Decimal("3.00"),
        subtotal=Decimal("30.00"),
        total=Decimal("33.00"),
        unit_cost_at_sale=Decimal("10.00"),
        cost_total_at_sale=Decimal("20.00"),
        created_at=datetime.now(),
    )
    db_session.add(sale_item)
    db_session.flush()

    service = TransactionReversalService(db_session, default_company.id)
    service.void_sale(sale.id, "Аннулирование старой продажи", admin_user.id)

    db_session.refresh(product)
    assert product.stock_quantity == Decimal("10")  # 8 + 2 restored
    layer = (
        db_session.query(InventoryLayer)
        .filter_by(source_type="sale_void", product_id=product.id)
        .one()
    )
    assert layer.original_quantity == Decimal("2")
    assert layer.unit_cost == Decimal("10.00")


def test_void_sale_not_found_raises_value_error(db_session, default_company, admin_user):
    with pytest.raises(ValueError, match="not found"):
        TransactionReversalService(db_session, default_company.id).void_sale(
            999999, "нет такой продажи", admin_user.id
        )


class TestPreviewSale:
    def test_preview_sale_outstanding_only_no_mutation(
        self, db_session, partially_returned_sale
    ):
        service = TransactionReversalService(db_session, partially_returned_sale.company_id)
        stock_before = partially_returned_sale.items[0].product.stock_quantity

        preview = service.preview_sale(partially_returned_sale.id)

        assert preview.can_void is True
        assert preview.is_legacy is False
        assert preview.blockers == []
        assert len(preview.impacts) == 1
        impact = preview.impacts[0]
        # outstanding = 10 sold - 3 returned = 7
        assert impact.quantity_change == Decimal("7")
        assert impact.resulting_stock == stock_before + Decimal("7")
        # preview must NOT mutate stock
        db_session.refresh(partially_returned_sale.items[0].product)
        assert partially_returned_sale.items[0].product.stock_quantity == stock_before

    def test_preview_already_voided_sale_cannot_void(self, db_session, voided_sale):
        preview = TransactionReversalService(
            db_session, voided_sale.company_id
        ).preview_sale(voided_sale.id)
        assert preview.can_void is False

    def test_preview_returned_sale_cannot_void(self, db_session, test_sale):
        test_sale.status = SaleStatus.RETURNED
        db_session.flush()
        preview = TransactionReversalService(
            db_session, test_sale.company_id
        ).preview_sale(test_sale.id)
        assert preview.can_void is False
