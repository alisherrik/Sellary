"""Purchasing reports: what was bought, from whom, at what price.

Everything here counts received goods. A placed order is an intention and a
reversed receipt is goods that went back — neither is money spent.
"""
from datetime import timedelta
from decimal import Decimal

import pytest

from models.purchase_receipt import PurchaseReceipt, PurchaseReceiptItem
from services.company_time import utc_now


@pytest.fixture
def received_goods(db_session, default_company, test_product, test_supplier, admin_user):
    """Two deliveries of the same product, the second dearer than the first."""
    from models.purchase_order import PurchaseOrder, PurchaseOrderStatus
    from models.purchase_order_item import PurchaseOrderItem

    order = PurchaseOrder(
        company_id=default_company.id,
        supplier_id=test_supplier.id,
        status=PurchaseOrderStatus.RECEIVED,
        total_amount=Decimal("0.00"),
    )
    db_session.add(order)
    db_session.flush()

    item = PurchaseOrderItem(
        purchase_order_id=order.id,
        product_id=test_product.id,
        quantity_ordered=Decimal("30"),
        quantity_received=Decimal("30"),
        unit_cost=Decimal("10.0000"),
        subtotal=Decimal("300.00"),
    )
    db_session.add(item)
    db_session.flush()

    now = utc_now()
    for index, (quantity, cost, when) in enumerate(
        [
            (Decimal("10"), Decimal("10.0000"), now - timedelta(days=2)),
            (Decimal("20"), Decimal("12.5000"), now - timedelta(hours=1)),
        ]
    ):
        receipt = PurchaseReceipt(
            company_id=default_company.id,
            purchase_order_id=order.id,
            user_id=admin_user.id,
            created_at=when,
        )
        db_session.add(receipt)
        db_session.flush()
        db_session.add(
            PurchaseReceiptItem(
                purchase_receipt_id=receipt.id,
                purchase_order_item_id=item.id,
                product_id=test_product.id,
                quantity=quantity,
                unit_cost=cost,
            )
        )
    db_session.flush()
    return order


class TestSummary:
    def test_spend_is_quantity_times_cost_across_deliveries(
        self, client, received_goods, admin_headers
    ):
        response = client.get("/api/reports/purchases", headers=admin_headers)
        assert response.status_code == 200, response.text
        body = response.json()
        # 10 × 10.00 + 20 × 12.50 = 100 + 250
        assert Decimal(body["total_spend"]) == Decimal("350.00")
        assert body["receipts_count"] == 2
        assert body["orders_count"] == 1
        assert body["suppliers_count"] == 1
        assert body["products_count"] == 1
        assert Decimal(body["average_receipt"]) == Decimal("175.00")

    def test_days_are_broken_out(self, client, received_goods, admin_headers):
        body = client.get("/api/reports/purchases", headers=admin_headers).json()
        assert len(body["by_day"]) == 2
        assert sum(Decimal(d["spend"]) for d in body["by_day"]) == Decimal("350.00")

    def test_a_reversed_receipt_bought_nothing(
        self, client, db_session, received_goods, admin_headers
    ):
        receipt = (
            db_session.query(PurchaseReceipt)
            .order_by(PurchaseReceipt.created_at.desc())
            .first()
        )
        receipt.reversed_at = utc_now()
        db_session.flush()

        body = client.get("/api/reports/purchases", headers=admin_headers).json()
        assert Decimal(body["total_spend"]) == Decimal("100.00")
        assert body["receipts_count"] == 1

    def test_an_empty_period_reports_zero_rather_than_failing(self, client, admin_headers):
        body = client.get("/api/reports/purchases?days=1", headers=admin_headers).json()
        assert Decimal(body["total_spend"]) == Decimal("0.00")
        assert Decimal(body["average_receipt"]) == Decimal("0.00")


class TestByProduct:
    def test_quantity_spend_and_average_cost(self, client, received_goods, admin_headers):
        rows = client.get(
            "/api/reports/purchases/by-product", headers=admin_headers
        ).json()
        assert len(rows) == 1
        row = rows[0]
        assert Decimal(row["quantity"]) == Decimal("30.000")
        assert Decimal(row["spend"]) == Decimal("350.00")
        # 350 / 30 — the blended cost, not either delivery's price.
        assert Decimal(row["average_cost"]) == Decimal("11.6667")
        assert Decimal(row["share_percent"]) == Decimal("100.00")
        assert row["deliveries"] == 2

    def test_the_price_move_is_first_to_last_not_cheapest_to_dearest(
        self, client, received_goods, admin_headers
    ):
        row = client.get(
            "/api/reports/purchases/by-product", headers=admin_headers
        ).json()[0]
        assert Decimal(row["first_cost"]) == Decimal("10.0000")
        assert Decimal(row["last_cost"]) == Decimal("12.5000")
        # 10.00 → 12.50 is +25%: what the owner needs to see.
        assert Decimal(row["cost_change_percent"]) == Decimal("25.00")

    def test_the_current_catalogue_prices_travel_with_the_row(
        self, client, received_goods, test_product, admin_headers
    ):
        row = client.get(
            "/api/reports/purchases/by-product", headers=admin_headers
        ).json()[0]
        assert Decimal(row["current_sell_price"]) == Decimal(test_product.sell_price)
        assert Decimal(row["current_cost_price"]) == Decimal(test_product.cost_price)


class TestBySupplier:
    def test_spend_and_share(self, client, received_goods, test_supplier, admin_headers):
        rows = client.get(
            "/api/reports/purchases/by-supplier", headers=admin_headers
        ).json()
        assert len(rows) == 1
        assert rows[0]["name"] == test_supplier.name
        assert Decimal(rows[0]["spend"]) == Decimal("350.00")
        assert Decimal(rows[0]["share_percent"]) == Decimal("100.00")
        assert rows[0]["receipts"] == 2


class TestOutstanding:
    def test_a_sent_order_is_committed_not_bought(
        self, client, db_session, default_company, test_supplier, test_product, admin_headers
    ):
        from models.purchase_order import PurchaseOrder, PurchaseOrderStatus
        from models.purchase_order_item import PurchaseOrderItem

        order = PurchaseOrder(
            company_id=default_company.id,
            supplier_id=test_supplier.id,
            status=PurchaseOrderStatus.SENT,
            total_amount=Decimal("500.00"),
        )
        db_session.add(order)
        db_session.flush()
        db_session.add(
            PurchaseOrderItem(
                purchase_order_id=order.id,
                product_id=test_product.id,
                quantity_ordered=Decimal("50"),
                quantity_received=Decimal("0"),
                unit_cost=Decimal("10.0000"),
                subtotal=Decimal("500.00"),
            )
        )
        db_session.flush()

        outstanding = client.get(
            "/api/reports/purchases/outstanding", headers=admin_headers
        ).json()
        assert len(outstanding) == 1
        assert Decimal(outstanding[0]["total_amount"]) == Decimal("500.00")
        assert outstanding[0]["pending_lines"] == 1

        # And it is not counted as spend anywhere.
        summary = client.get("/api/reports/purchases", headers=admin_headers).json()
        assert Decimal(summary["total_spend"]) == Decimal("0.00")


class TestAccess:
    def test_a_company_without_purchasing_is_closed(
        self, client, db_session, default_company, admin_headers
    ):
        from models.company_module import CompanyModule

        db_session.query(CompanyModule).filter(
            CompanyModule.company_id == default_company.id,
            CompanyModule.module == "purchasing",
        ).delete()
        db_session.flush()
        response = client.get("/api/reports/purchases", headers=admin_headers)
        assert response.status_code == 403
