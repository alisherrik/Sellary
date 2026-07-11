"""Unit tests for line-level (item-scoped) purchase annulment.

Covers ``TransactionReversalService.preview_purchase_item`` /
``void_purchase_item``: previewing/reversing a single received purchase line
without touching sibling lines, the sale/manual-adjustment/legacy blockers, the
"reverse after the blocking sale line is released" flow, purchase total/status
recomputation, audit fields, and idempotent/second-attempt rejection.
"""
from decimal import Decimal

import pytest

from models.inventory_layer import InventoryAllocation
from models.purchase_order import PurchaseOrderStatus
from models.reversal_operation import ReversalOperation
from services.transaction_reversal_service import (
    ReversalBlocked,
    ReversalConflict,
    TransactionReversalService,
)


def _line(po, index):
    return po.items[index]


class TestPreviewPurchaseItem:
    def test_preview_affects_only_selected_line(self, db_session, multi_line_received_po):
        po = multi_line_received_po
        service = TransactionReversalService(db_session, po.company_id)
        line0 = _line(po, 0)

        preview = service.preview_purchase_item(po.id, line0.id)

        assert preview.can_void is True
        assert preview.is_legacy is False
        assert preview.blockers == []
        assert len(preview.impacts) == 1
        impact = preview.impacts[0]
        assert impact.product_id == line0.product_id
        assert impact.quantity_change == Decimal("-6")

    def test_preview_does_not_mutate_stock(self, db_session, multi_line_received_po):
        po = multi_line_received_po
        product = _line(po, 0).product
        stock_before = product.stock_quantity
        TransactionReversalService(db_session, po.company_id).preview_purchase_item(
            po.id, _line(po, 0).id
        )
        db_session.refresh(product)
        assert product.stock_quantity == stock_before

    def test_preview_unreceived_line_cannot_void(self, db_session, sent_purchase_order):
        po = sent_purchase_order  # SENT, nothing received
        preview = TransactionReversalService(
            db_session, po.company_id
        ).preview_purchase_item(po.id, po.items[0].id)
        assert preview.can_void is False
        assert preview.impacts == []

    def test_preview_legacy_line_blocked(self, db_session, sent_purchase_order):
        """A line marked received but with no traceable receipt layer is legacy
        history and must be blocked."""
        po = sent_purchase_order
        item = po.items[0]
        item.quantity_received = Decimal("10")
        po.status = PurchaseOrderStatus.RECEIVED
        db_session.flush()

        preview = TransactionReversalService(
            db_session, po.company_id
        ).preview_purchase_item(po.id, item.id)
        assert preview.can_void is False
        assert preview.is_legacy is True
        assert preview.blockers[0].blocker_type == "legacy_history"

    def test_preview_item_not_in_parent_raises(
        self, db_session, multi_line_received_po, sent_purchase_order
    ):
        # An item id that belongs to a different purchase order is rejected.
        foreign_item_id = sent_purchase_order.items[0].id
        with pytest.raises(ValueError, match="not found"):
            TransactionReversalService(
                db_session, multi_line_received_po.company_id
            ).preview_purchase_item(multi_line_received_po.id, foreign_item_id)


class TestVoidPurchaseItem:
    def test_void_line_leaves_sibling_intact(
        self, db_session, multi_line_received_po, admin_user
    ):
        po = multi_line_received_po
        line0, line1 = _line(po, 0), _line(po, 1)
        product0, product1 = line0.product, line1.product
        p1_stock_before = product1.stock_quantity
        p1_value_before = product1.inventory_value

        service = TransactionReversalService(db_session, po.company_id)
        result = service.void_purchase_item(po.id, line0.id, "Ошибочная позиция", admin_user.id)

        db_session.refresh(product0)
        db_session.refresh(product1)
        db_session.refresh(line0)
        db_session.refresh(line1)

        # Selected line fully reversed; sibling untouched.
        assert product0.stock_quantity == Decimal("0")
        assert product1.stock_quantity == p1_stock_before
        assert product1.inventory_value == p1_value_before
        assert line0.voided_at is not None
        assert line1.voided_at is None

        # Result points at the parent purchase order.
        assert result.entity_type == "purchase_order"
        assert result.entity_id == po.id

        # Layer of the voided line is reversed; sibling's layer is not.
        assert line0.receipt_items[0].inventory_layer.reversed_at is not None
        assert line1.receipt_items[0].inventory_layer.reversed_at is None

    def test_void_line_recomputes_total_and_status(
        self, db_session, multi_line_received_po, admin_user
    ):
        po = multi_line_received_po
        line1_subtotal = _line(po, 1).subtotal
        service = TransactionReversalService(db_session, po.company_id)

        service.void_purchase_item(po.id, _line(po, 0).id, "Пересчёт", admin_user.id)
        db_session.refresh(po)

        # Only the active sibling line contributes to the net total.
        assert po.total_amount == line1_subtotal
        # Sibling is still fully received -> RECEIVED.
        assert po.status == PurchaseOrderStatus.RECEIVED

    def test_void_all_lines_makes_po_cancelled(
        self, db_session, multi_line_received_po, admin_user
    ):
        po = multi_line_received_po
        service = TransactionReversalService(db_session, po.company_id)
        service.void_purchase_item(po.id, _line(po, 0).id, "Первая", admin_user.id)
        service.void_purchase_item(po.id, _line(po, 1).id, "Вторая", admin_user.id)
        db_session.refresh(po)
        assert po.status == PurchaseOrderStatus.CANCELLED
        assert po.total_amount == Decimal("0.00")

    def test_void_records_operation_and_audit_fields(
        self, db_session, multi_line_received_po, admin_user
    ):
        po = multi_line_received_po
        line0 = _line(po, 0)
        service = TransactionReversalService(db_session, po.company_id)
        result = service.void_purchase_item(po.id, line0.id, "Аудит-причина", admin_user.id)

        db_session.refresh(line0)
        assert line0.void_reason == "Аудит-причина"
        assert line0.voided_by_user_id == admin_user.id
        assert line0.reversal_operation_id == result.operation_id

        operation = db_session.get(ReversalOperation, result.operation_id)
        assert operation.operation_type == "purchase_item_void"
        assert operation.entity_type == "purchase_order_item"
        assert operation.entity_id == line0.id
        assert operation.reason == "Аудит-причина"

    def test_second_void_attempt_rejected(
        self, db_session, multi_line_received_po, admin_user
    ):
        po = multi_line_received_po
        line0 = _line(po, 0)
        service = TransactionReversalService(db_session, po.company_id)
        service.void_purchase_item(po.id, line0.id, "Первое", admin_user.id)
        db_session.flush()
        with pytest.raises(ReversalConflict, match="уже аннулирована"):
            service.void_purchase_item(po.id, line0.id, "Второе", admin_user.id)


class TestPurchaseItemBlockers:
    def test_manual_adjustment_blocks_line(self, db_session, multi_line_received_po):
        po = multi_line_received_po
        line0 = _line(po, 0)
        layer = line0.receipt_items[0].inventory_layer
        layer.remaining_quantity = Decimal(layer.remaining_quantity) - Decimal("1")
        db_session.add(
            InventoryAllocation(
                company_id=po.company_id,
                product_id=line0.product_id,
                layer_id=layer.id,
                consumer_type="manual_adjustment",
                consumer_id=777,
                sale_item_id=None,
                quantity=Decimal("1"),
                released_quantity=Decimal("0"),
            )
        )
        db_session.flush()

        preview = TransactionReversalService(
            db_session, po.company_id
        ).preview_purchase_item(po.id, line0.id)
        assert preview.can_void is False
        assert preview.blockers[0].blocker_type == "inventory_adjustment"

    def test_sold_stock_blocks_line_and_names_sale(
        self, db_session, multi_line_received_po, test_customer, cashier_user
    ):
        from schemas.sale import (
            PaymentMethod as SchemaPaymentMethod,
            SaleCreate,
            SaleItemCreate,
        )
        from services.sale_service import SaleService

        po = multi_line_received_po
        line0 = _line(po, 0)
        product0 = line0.product

        sale = SaleService(db_session, po.company_id).create(
            SaleCreate(
                customer_id=test_customer.id,
                items=[
                    SaleItemCreate(
                        product_id=product0.id,
                        quantity=Decimal("2"),
                        unit_price=Decimal("25.00"),
                        tax_percent=Decimal("0.00"),
                        discount_amount=Decimal("0.00"),
                    )
                ],
                payment_method=SchemaPaymentMethod.CASH,
                discount_amount=Decimal("0.00"),
            ),
            cashier_user.id,
        )
        db_session.flush()

        preview = TransactionReversalService(
            db_session, po.company_id
        ).preview_purchase_item(po.id, line0.id)
        assert preview.can_void is False
        blocker = preview.blockers[0]
        assert blocker.blocker_type == "sale"
        assert blocker.reference_id == sale.id
        assert blocker.sale_item_id == sale.items[0].id

    def test_void_raises_blocked_when_sold(
        self, db_session, multi_line_received_po, test_customer, cashier_user, admin_user
    ):
        from schemas.sale import (
            PaymentMethod as SchemaPaymentMethod,
            SaleCreate,
            SaleItemCreate,
        )
        from services.sale_service import SaleService

        po = multi_line_received_po
        line0 = _line(po, 0)
        SaleService(db_session, po.company_id).create(
            SaleCreate(
                customer_id=test_customer.id,
                items=[
                    SaleItemCreate(
                        product_id=line0.product_id,
                        quantity=Decimal("2"),
                        unit_price=Decimal("25.00"),
                        tax_percent=Decimal("0.00"),
                        discount_amount=Decimal("0.00"),
                    )
                ],
                payment_method=SchemaPaymentMethod.CASH,
                discount_amount=Decimal("0.00"),
            ),
            cashier_user.id,
        )
        db_session.flush()

        with pytest.raises(ReversalBlocked):
            TransactionReversalService(db_session, po.company_id).void_purchase_item(
                po.id, line0.id, "Заблокировано", admin_user.id
            )

    def test_succeeds_after_blocking_sale_line_reversed(
        self, db_session, multi_line_received_po, test_customer, cashier_user, admin_user
    ):
        """The documented recovery flow: sell the received stock, then annul the
        sale line (releasing it back to the original FIFO layer), and the
        purchase line becomes voidable again."""
        from models.sale import PaymentMethod
        from schemas.sale import (
            PaymentMethod as SchemaPaymentMethod,
            SaleCreate,
            SaleItemCreate,
        )
        from schemas.sale_return import SaleReturnCreate, SaleReturnItemCreate
        from services.sale_return_service import SaleReturnService
        from services.sale_service import SaleService

        po = multi_line_received_po
        line0 = _line(po, 0)
        product0 = line0.product

        sale = SaleService(db_session, po.company_id).create(
            SaleCreate(
                customer_id=test_customer.id,
                items=[
                    SaleItemCreate(
                        product_id=product0.id,
                        quantity=Decimal("2"),
                        unit_price=Decimal("25.00"),
                        tax_percent=Decimal("0.00"),
                        discount_amount=Decimal("0.00"),
                    )
                ],
                payment_method=SchemaPaymentMethod.CASH,
                discount_amount=Decimal("0.00"),
            ),
            cashier_user.id,
        )
        db_session.flush()

        # Annul the dependent sale line (full outstanding qty) — releases stock
        # back to the purchase's original FIFO layer.
        SaleReturnService(db_session, po.company_id).process_return(
            sale.id,
            SaleReturnCreate(
                items=[
                    SaleReturnItemCreate(
                        sale_item_id=sale.items[0].id, quantity=Decimal("2")
                    )
                ],
                refund_method=PaymentMethod.CASH,
                notes="Аннулирование позиции продажи",
            ),
            admin_user.id,
        )
        db_session.flush()

        service = TransactionReversalService(db_session, po.company_id)
        preview = service.preview_purchase_item(po.id, line0.id)
        assert preview.can_void is True
        assert preview.blockers == []

        service.void_purchase_item(po.id, line0.id, "После возврата продажи", admin_user.id)
        db_session.refresh(product0)
        assert product0.stock_quantity == Decimal("0")
