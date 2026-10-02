"""Closed-period reports retain UTC bounds and both report end conventions."""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from models.purchase_order import PurchaseOrder, PurchaseOrderStatus
from models.purchase_order_item import PurchaseOrderItem
from models.purchase_receipt import PurchaseReceipt, PurchaseReceiptItem
from models.reconciliation import Reconciliation
from models.sale import PaymentMethod, Sale, SaleStatus
from models.sale_item import SaleItem
from models.sale_return import SaleReturn
from services.company_time import local_day_bounds
from services.period_report_service import PeriodReportService
from services.report_service import ReportService
from tests.conftest import add_sale_tenders


def _sale(db, company, cashier, at, amount, arrival):
    sale = Sale(company_id=company.id, cashier_id=cashier.id, created_at=at,
                subtotal=Decimal(amount), total_amount=Decimal(amount),
                payment_method=PaymentMethod.CASH, status=SaleStatus.COMPLETED)
    db.add(sale); db.flush()
    add_sale_tenders(db, sale)
    for payment in sale.payments:
        payment.created_at = arrival
    db.flush()
    return sale


@pytest.mark.parametrize("zone", ["UTC", "Asia/Dushanbe"])
def test_period_includes_final_instant_without_entering_the_next_local_day(
    db_session, default_company, cashier_user, test_supplier, test_product, zone,
):
    default_company.timezone = zone
    first = Reconciliation(company_id=default_company.id, effective_from=date(2026, 1, 1),
                           created_at=datetime(2026, 1, 2))
    closed = Reconciliation(company_id=default_company.id, effective_from=date(2026, 2, 1),
                            created_at=datetime(2026, 2, 2))
    db_session.add_all([first, closed]); db_session.flush()
    start, _ = local_day_bounds(ZoneInfo(zone), date(2026, 1, 1))
    _, end = local_day_bounds(ZoneInfo(zone), date(2026, 1, 31))
    start = start.astimezone(timezone.utc).replace(tzinfo=None)
    end = end.astimezone(timezone.utc).replace(tzinfo=None)
    instants = [start - timedelta(microseconds=1), start, end, end + timedelta(microseconds=1)]
    sales = [_sale(db_session, default_company, cashier_user, at, amount,
                   datetime(2026, 2, 3) if index >= 2 else datetime(2026, 1, 15))
             for index, (at, amount) in enumerate(zip(instants, ["11", "13", "17", "19"]))]
    db_session.add(SaleReturn(company_id=default_company.id, sale_id=sales[2].id,
                              user_id=cashier_user.id, total_refund_amount=Decimal("2"),
                              refund_method=PaymentMethod.CASH, created_at=datetime(2026, 2, 4)))
    order = PurchaseOrder(company_id=default_company.id, supplier_id=test_supplier.id,
                          status=PurchaseOrderStatus.RECEIVED, total_amount=Decimal("140"))
    db_session.add(order); db_session.flush()
    item = PurchaseOrderItem(purchase_order_id=order.id, product_id=test_product.id,
                             quantity_ordered=Decimal("4"), quantity_received=Decimal("4"),
                             unit_cost=Decimal("35"), subtotal=Decimal("140"))
    db_session.add(item); db_session.flush()
    for at, amount in zip(instants, ["20", "30", "40", "50"]):
        receipt = PurchaseReceipt(company_id=default_company.id, purchase_order_id=order.id,
                                   user_id=cashier_user.id, created_at=at)
        db_session.add(receipt); db_session.flush()
        db_session.add(PurchaseReceiptItem(purchase_receipt_id=receipt.id,
            purchase_order_item_id=item.id, product_id=test_product.id,
            quantity=Decimal("1"), unit_cost=Decimal(amount)))
    db_session.flush()
    service = PeriodReportService(db_session, default_company.id)
    row = service.list(limit=1).periods[0]
    detail = service.detail(closed.id)
    assert row.sold == detail.sold == Decimal("28.00")
    assert row.purchased == detail.purchased == Decimal("70.00")
    assert detail.sales_count == detail.receipts_count == 2
    assert detail.returns_total == Decimal("2.00")
    assert detail.late_arrivals.count == 1
    assert detail.late_arrivals.total == Decimal("17.00")


def test_top_product_labels_and_pagination_survive_report_merge(
    db_session, default_company, cashier_user, test_product,
):
    start = datetime(2026, 1, 31, 19, tzinfo=timezone.utc)
    end = start + timedelta(days=1) - timedelta(microseconds=1)
    sale = _sale(db_session, default_company, cashier_user, start.replace(tzinfo=None),
                 "5", datetime(2026, 2, 1))
    db_session.add(SaleItem(sale_id=sale.id, product_id=test_product.id, quantity=Decimal("1"),
        unit_price=Decimal("5"), subtotal=Decimal("5"), total=Decimal("5"),
        cost_total_at_sale=Decimal("2"), unit_cost_at_sale=Decimal("2")))
    db_session.flush()
    report = ReportService(db_session, default_company.id).get_top_products(
        start, end, limit=1, offset=1)
    assert report.period_start == report.period_end == "2026-02-01"
    assert report.product_count == 1
    assert report.top_products == []
