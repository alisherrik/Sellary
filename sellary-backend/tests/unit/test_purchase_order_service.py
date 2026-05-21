from decimal import Decimal

from sqlalchemy.orm import Session

from models.product import Product, ProductType
from models.purchase_order import PurchaseOrder, PurchaseOrderStatus
from models.purchase_order_item import PurchaseOrderItem
from models.supplier import Supplier
from schemas.purchase_order import ReceiveItemsRequest
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
            product_type=ProductType.ITEM,
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
