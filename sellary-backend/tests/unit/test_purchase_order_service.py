from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

from core.state_machine import StateTransitionError
from models.product import Product
from models.purchase_order import PurchaseOrder, PurchaseOrderStatus
from models.purchase_order_item import PurchaseOrderItem
from models.purchase_receipt import PurchaseReceipt
from models.supplier import Supplier
from schemas.purchase_order import (
    PurchaseOrderCreate,
    PurchaseOrderItemCreate,
    ReceiveItemsRequest,
)
from services.purchase_order_service import PurchaseOrderService


class TestPurchaseOrderReceiveItems:
    def test_receive_updates_product_cost(self, db_session: Session):
        product = Product(
            name="Test Product",
            barcode="TEST_PO_001",
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=Decimal("0"),
            min_stock_level=0,
            is_active=True,
        )
        db_session.add(product)

        supplier = Supplier(
            name="Test Supplier",
            email="supplier@test.com",
            phone="1234567890",
        )
        db_session.add(supplier)
        db_session.flush()

        # PO1: order 5 @ 10.00 each
        po1 = PurchaseOrder(
            supplier_id=supplier.id,
            status=PurchaseOrderStatus.SENT,
            total_amount=Decimal("50.00"),
        )
        db_session.add(po1)
        db_session.flush()

        po1_item = PurchaseOrderItem(
            purchase_order_id=po1.id,
            product_id=product.id,
            quantity_ordered=Decimal("5"),
            quantity_received=Decimal("0"),
            unit_cost=Decimal("10.00"),
            subtotal=Decimal("50.00"),
        )
        db_session.add(po1_item)
        db_session.flush()

        service = PurchaseOrderService(db_session)
        service.receive_items(
            po_id=po1.id,
            receive_request=ReceiveItemsRequest(items=[{"item_id": po1_item.id, "quantity_to_receive": 5}]),
            user_id=1,
        )

        db_session.refresh(product)
        assert product.stock_quantity == Decimal("5")
        assert product.cost_price == Decimal("10.00")

        # PO2: order 5 @ 20.00 each
        po2 = PurchaseOrder(
            supplier_id=supplier.id,
            status=PurchaseOrderStatus.SENT,
            total_amount=Decimal("100.00"),
        )
        db_session.add(po2)
        db_session.flush()

        po2_item = PurchaseOrderItem(
            purchase_order_id=po2.id,
            product_id=product.id,
            quantity_ordered=Decimal("5"),
            quantity_received=Decimal("0"),
            unit_cost=Decimal("20.00"),
            subtotal=Decimal("100.00"),
        )
        db_session.add(po2_item)
        db_session.flush()

        service = PurchaseOrderService(db_session)
        service.receive_items(
            po_id=po2.id,
            receive_request=ReceiveItemsRequest(items=[{"item_id": po2_item.id, "quantity_to_receive": 5}]),
            user_id=1,
        )

        db_session.refresh(product)
        assert product.stock_quantity == Decimal("10")
        # Moving average: (5*10 + 5*20) / 10 = 15
        assert product.cost_price == Decimal("15.00")


class TestPurchaseOrderWholesalePricing:
    def test_create_accepts_four_decimal_unit_cost_with_exact_subtotal(
        self, db_session: Session
    ):
        # Оптовая закупка: упаковка за 45 при 24 штуках => 1.8750 за штуку,
        # 4 знака убирают остаток (24 * 1.8750 = 45.0000 ровно).
        product = Product(
            name="Cola wholesale",
            barcode="TEST_PO_WS",
            cost_price=Decimal("1.00"),
            sell_price=Decimal("2.00"),
            stock_quantity=Decimal("0"),
            min_stock_level=0,
            is_active=True,
        )
        db_session.add(product)
        supplier = Supplier(
            name="WS Supplier",
            email="ws@test.com",
            phone="000",
        )
        db_session.add(supplier)
        db_session.flush()

        service = PurchaseOrderService(db_session)
        result = service.create(
            PurchaseOrderCreate(
                supplier_id=supplier.id,
                items=[
                    PurchaseOrderItemCreate(
                        product_id=product.id,
                        quantity_ordered=Decimal("24"),
                        unit_cost=Decimal("1.8750"),
                    )
                ],
            )
        )

        assert result.items[0].unit_cost == Decimal("1.8750")
        assert result.items[0].subtotal == Decimal("45.0000")
        assert result.total_amount == Decimal("45.0000")


class TestPurchaseOrderReceiptLayers:
    def test_receive_creates_receipt_items_layers_and_value(
        self, db_session, sent_purchase_order, admin_user
    ):
        service = PurchaseOrderService(db_session, sent_purchase_order.company_id)
        item = sent_purchase_order.items[0]
        before_value = item.product.inventory_value

        service.receive_items(
            sent_purchase_order.id,
            ReceiveItemsRequest(items=[{"item_id": item.id, "quantity_to_receive": "4"}]),
            admin_user.id,
        )

        receipt = (
            db_session.query(PurchaseReceipt)
            .filter_by(purchase_order_id=sent_purchase_order.id)
            .one()
        )
        assert receipt.user_id == admin_user.id
        assert receipt.company_id == sent_purchase_order.company_id
        assert len(receipt.items) == 1
        receipt_item = receipt.items[0]
        assert receipt_item.purchase_order_item_id == item.id
        assert receipt_item.product_id == item.product_id
        assert receipt_item.quantity == Decimal("4")
        assert receipt_item.unit_cost == item.unit_cost
        assert receipt_item.inventory_layer is not None
        assert receipt_item.inventory_layer.remaining_quantity == Decimal("4")
        assert receipt_item.inventory_layer.original_quantity == Decimal("4")
        assert receipt_item.inventory_layer.unit_cost == item.unit_cost

        db_session.refresh(item.product)
        assert item.product.inventory_value == before_value + Decimal("4") * item.unit_cost
        assert item.quantity_received == Decimal("4")

    def test_cancel_partially_received_raises_state_error(
        self, db_session, partially_received_po
    ):
        service = PurchaseOrderService(db_session, partially_received_po.company_id)
        with pytest.raises(StateTransitionError):
            service.cancel(partially_received_po.id)
