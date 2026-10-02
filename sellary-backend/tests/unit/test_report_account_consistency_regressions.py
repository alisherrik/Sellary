"""Money and report figures must agree with the documents that created them."""
from datetime import date, datetime, timedelta
from decimal import Decimal
import importlib.util
from pathlib import Path

import pytest

from models.cash_shift import CashShift, CashShiftStatus
from models.money_account import MoneyAccount, MoneyMovement
from models.product import Product
from models.reconciliation import Reconciliation
from models.sale import CardType, PaymentMethod, Sale, SaleStatus
from models.sale_item import SaleItem
from models.sale_return import SaleReturn, SaleReturnItem
from schemas.sale import SaleCreate
from schemas.sale_return import SaleReturnCreate
from schemas.sync import SyncSaleCreate, SyncSalesRequest
from services import reconciliation
from services.consistency_service import ConsistencyService
from services.money_service import MoneyService
from services.report_service import ReportService
from services.sale_return_service import SaleReturnService
from services.sale_service import SaleService
from services.sync_service import SyncService
from tests.conftest import add_sale_tenders

START, END = datetime(2000, 1, 1), datetime(2100, 1, 1)


def sell(db, company, cashier, product, quantity="3", **fields):
    return SaleService(db, company.id).create(
        SaleCreate(
            items=[{"product_id": product.id, "quantity": quantity,
                    "unit_price": "30.00", **fields.pop("line", {})}],
            payment_method="cash", **fields,
        ), cashier.id,
    )


def refund(db, company, cashier, sale, quantity="1"):
    return SaleReturnService(db, company.id).process_return(
        sale.id,
        SaleReturnCreate(items=[{"sale_item_id": sale.items[0].id, "quantity": quantity}],
                         refund_method="cash"), cashier.id,
    )


def raw_sale(db, company, cashier, product, *, quantity="3", cost="20.00",
             unit_cost="6.67", returned="0", total="30.00", at=None, offline=False):
    sale = Sale(company_id=company.id, cashier_id=cashier.id, subtotal=Decimal(total),
                total_amount=Decimal(total), payment_method=PaymentMethod.CASH,
                status=SaleStatus.PARTIALLY_RETURNED if Decimal(returned) else SaleStatus.COMPLETED,
                created_at=at or datetime(2026, 7, 10, 12),
                client_sale_id="report-offline" if offline else None)
    db.add(sale); db.flush()
    item = SaleItem(sale_id=sale.id, product_id=product.id, quantity=Decimal(quantity),
                    quantity_returned=Decimal(returned), unit_price=Decimal("10.00"),
                    subtotal=Decimal(total), total=Decimal(total),
                    unit_cost_at_sale=Decimal(unit_cost), cost_total_at_sale=Decimal(cost))
    db.add(item); db.flush()
    add_sale_tenders(db, sale)
    return sale, item


def test_dashboard_accepts_low_stock_goods_without_barcode(db_session, default_company):
    product = Product(company_id=default_company.id, name="Loose rice", barcode=None,
                      cost_price=Decimal("1"), sell_price=Decimal("2"), stock_quantity=0)
    db_session.add(product); db_session.flush()
    result = ReportService(db_session, default_company.id).get_dashboard_widgets()
    assert result.low_stock_items[0].barcode is None


def test_profit_preserves_exact_fifo_total(db_session, default_company, cashier_user, layered_product):
    sell(db_session, default_company, cashier_user, layered_product)
    report = ReportService(db_session, default_company.id).get_profit_report(START, END)
    assert report.cost == Decimal("40.00")
    assert report.profit == Decimal("50.00")


def test_partial_return_removes_the_actual_restored_fifo_cost(
    db_session, default_company, cashier_user, layered_product,
):
    sale = sell(db_session, default_company, cashier_user, layered_product)
    refund(db_session, default_company, cashier_user, sale)
    service = ReportService(db_session, default_company.id)
    assert service.get_profit_report(START, END).cost == Decimal("20.00")
    assert service.get_top_products(START, END).top_products[0].profit == Decimal("40.00")


def test_daily_profits_use_the_same_fifo_cost(db_session, default_company, cashier_user, layered_product):
    sell(db_session, default_company, cashier_user, layered_product)
    report = ReportService(db_session, default_company.id).get_daily_sales(START, END)
    assert [row.total_profit for row in report.data] == [Decimal("50.00")]
    assert report.total_profit == Decimal("50.00")


@pytest.mark.parametrize("line,sale_discount,revenue,profit", [
    ({}, "15.00", "15.00", "5.00"),
    ({"tax_percent": "10.00"}, "0.00", "33.00", "23.00"),
    ({"discount_amount": "15.00"}, "15.00", "15.00", "5.00"),
])
def test_top_products_report_charged_revenue(
    db_session, default_company, cashier_user, layered_product, line, sale_discount, revenue, profit,
):
    sell(db_session, default_company, cashier_user, layered_product, quantity="1",
         line=line, discount_amount=sale_discount)
    service = ReportService(db_session, default_company.id)
    item = service.get_top_products(START, END).top_products[0]
    assert item.revenue == Decimal(revenue)
    assert item.profit == Decimal(profit)
    assert item.revenue == service.get_profit_report(START, END).revenue


def test_top_product_subtracts_the_recorded_cent_refund(
    db_session, default_company, cashier_user, test_product,
):
    sale, item = raw_sale(db_session, default_company, cashier_user, test_product,
                          total="1.00", returned="1", cost="0.00", unit_cost="0.00")
    returned = SaleReturn(company_id=default_company.id, sale_id=sale.id,
                          user_id=cashier_user.id, total_refund_amount=Decimal("0.33"),
                          refund_method=PaymentMethod.CASH)
    returned.items = [SaleReturnItem(sale_item_id=item.id, quantity_returned=Decimal("1"),
                                     refund_amount=Decimal("0.33"))]
    db_session.add(returned); db_session.flush()
    result = ReportService(db_session, default_company.id).get_top_products(START, END)
    assert result.top_products[0].revenue == Decimal("0.67")


def test_top_products_preserve_line_discounts_across_other_goods(
    db_session, default_company, cashier_user, test_product, layered_product,
):
    sale = SaleService(db_session, default_company.id).create(SaleCreate(
        items=[
            {"product_id": test_product.id, "quantity": "1", "unit_price": "30", "discount_amount": "15"},
            {"product_id": layered_product.id, "quantity": "1", "unit_price": "30"},
        ], payment_method="cash", discount_amount=Decimal("15"),
    ), cashier_user.id)
    SaleReturnService(db_session, default_company.id).process_return(sale.id, SaleReturnCreate(
        items=[{"sale_item_id": sale.items[0].id, "quantity": "1"}], refund_method="cash",
    ), cashier_user.id)
    service = ReportService(db_session, default_company.id)
    rows = service.get_top_products(START, END).top_products
    assert {row.product_id: row.revenue for row in rows} == {
        test_product.id: Decimal("0.00"), layered_product.id: Decimal("30.00"),
    }
    assert sum(row.revenue for row in rows) == service.get_profit_report(START, END).revenue
    assert sum(row.profit for row in rows) == service.get_profit_report(START, END).profit


def test_top_products_page_keeps_tied_rows_stable_and_counts_all_matches(
    db_session, default_company, secondary_company, cashier_user, test_product, layered_product,
):
    third = Product(company_id=default_company.id, name="Third sold good", stock_quantity=5,
                    cost_price=Decimal("1"), sell_price=Decimal("2"))
    foreign = Product(company_id=secondary_company.id, name="Other company's good", stock_quantity=5,
                      cost_price=Decimal("1"), sell_price=Decimal("2"))
    db_session.add_all([third, foreign]); db_session.flush()
    for product in (third, layered_product, test_product):
        raw_sale(db_session, default_company, cashier_user, product)
    raw_sale(db_session, secondary_company, cashier_user, foreign)
    service = ReportService(db_session, default_company.id)
    first = service.get_top_products(START, END, limit=1)
    second = service.get_top_products(START, END, limit=1, offset=1)
    assert first.product_count == second.product_count == 3
    assert [first.top_products[0].product_id, second.top_products[0].product_id] == sorted(
        [third.id, layered_product.id, test_product.id])[:2]
    assert service.get_top_products(START, END, limit=1, offset=3).top_products == []


def test_report_cost_and_daily_profit_keep_every_sale_across_load_batches(
    db_session, default_company, cashier_user, test_product,
):
    for _ in range(201):
        raw_sale(db_session, default_company, cashier_user, test_product, cost="19.99")
    service = ReportService(db_session, default_company.id)
    assert service.get_profit_report(START, END).cost == Decimal("4017.99")
    daily = service.get_daily_sales(START, END)
    assert daily.sales_count == 201
    assert daily.total_profit == Decimal("2012.01")
    assert service.get_top_products(START, END).top_products[0].quantity_sold == Decimal("603")


@pytest.mark.parametrize("cost,unit_cost,returned,want", [
    ("20.00", "6.67", "1", "13.33"),
    ("0.00", "6.00", "1", "12.00"),
    ("19.99", "6.66", "0", "19.99"),
])
def test_no_allocation_legacy_or_offline_cost_fallback(
    db_session, default_company, cashier_user, test_product, cost, unit_cost, returned, want,
):
    raw_sale(db_session, default_company, cashier_user, test_product,
             cost=cost, unit_cost=unit_cost, returned=returned)
    assert ReportService(db_session, default_company.id).get_profit_report(START, END).cost == Decimal(want)


def test_lazy_dc_account_includes_sales_before_first_finance_read(
    db_session, default_company, cashier_user, test_product,
):
    sale, _ = raw_sale(db_session, default_company, cashier_user, test_product, total="100.00")
    sale.payment_method, sale.card_type = PaymentMethod.CARD, CardType.DC
    sale.payments[0].method, sale.payments[0].card_type = PaymentMethod.CARD, CardType.DC
    db_session.flush()
    first = MoneyService(db_session, default_company.id).overview()
    assert next(row.balance for row in first.accounts if row.card_type == "dc") == Decimal("100.00")


def test_new_account_does_not_change_existing_manual_opening_anchor(
    db_session, default_company, cashier_user, test_product,
):
    raw_sale(db_session, default_company, cashier_user, test_product)
    anchor = datetime(2026, 8, 1)
    account = MoneyAccount(company_id=default_company.id, name="Counted drawer", is_till=True,
                           opening_balance=Decimal("123.00"), opening_at=anchor)
    db_session.add(account); db_session.flush()
    overview = MoneyService(db_session, default_company.id).overview()
    assert next(row.balance for row in overview.accounts if row.id == account.id) == Decimal("123.00")
    assert account.opening_at == anchor


def test_real_offline_oversell_with_depleted_layers_is_known(
    db_session, default_company, cashier_user, layered_product,
):
    result = SyncService(db_session).sync_sales(default_company, cashier_user, SyncSalesRequest(sales=[
        SyncSaleCreate(client_sale_id="proven-oversell", idempotency_key="proven-oversell-key",
                       created_at_client=datetime(2026, 7, 10, 12), payment_method="cash",
                       paid_amount=Decimal("210.00"), items=[{"product_id": layered_product.id,
                                                           "quantity": "7", "sell_price": "30"}])
    ]))
    assert result.results[0].status == "synced"
    findings = ConsistencyService(db_session, default_company.id).run(keys=["stock_vs_layers"])
    assert [finding.bucket for finding in findings] == ["known"]
    assert ReportService(db_session, default_company.id).get_profit_report(START, END).cost == Decimal("112.00")


def test_unproven_negative_stock_remains_drift(db_session, default_company):
    product = Product(company_id=default_company.id, name="Unexplained stock", stock_quantity=-3,
                      cost_price=Decimal("1"), sell_price=Decimal("2"))
    db_session.add(product); db_session.flush()
    findings = ConsistencyService(db_session, default_company.id).run(keys=["stock_vs_layers"])
    assert [finding.bucket for finding in findings] == ["drift"]


def test_local_open_day_receipt_is_not_a_pre_freeze_late_arrival(
    db_session, default_company, cashier_user, test_product,
):
    db_session.add(Reconciliation(company_id=default_company.id, effective_from=date(2026, 8, 13),
                                   created_at=datetime(2026, 8, 13, 0)))
    raw_sale(db_session, default_company, cashier_user, test_product,
             at=datetime(2026, 8, 12, 20), offline=True)
    db_session.flush()
    reconciliation.invalidate(db_session, default_company.id)
    assert ConsistencyService(db_session, default_company.id).run(keys=["late_arrivals_after_freeze"]) == []


def test_money_anchor_migration_recovers_only_unused_automatic_accounts(
    db_session, default_company, cashier_user, test_product, monkeypatch,
):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    raw_sale(db_session, default_company, cashier_user, test_product, total="100.00")
    at = datetime(2026, 8, 1)
    automatic = MoneyAccount(company_id=default_company.id, name="Касса", is_till=True,
                             opening_balance=Decimal("0"), opening_at=at, created_at=at)
    manual = MoneyAccount(company_id=default_company.id, name="Counted safe", is_till=False,
                          opening_balance=Decimal("0"), opening_at=at, created_at=at)
    corrected = MoneyAccount(company_id=default_company.id, name="Банк · DC", card_type="dc",
                             opening_balance=Decimal("0"), opening_at=at, created_at=at)
    explicit = MoneyAccount(company_id=default_company.id, name="Банк · Alif", card_type="alif",
                            opening_balance=Decimal("0"), opening_at=at, created_at=at + timedelta(days=1))
    db_session.add_all([automatic, manual, corrected, explicit]); db_session.flush()
    db_session.add(MoneyMovement(company_id=default_company.id, account_id=corrected.id,
                                  direction="in", amount=Decimal("25"), reason="adjustment_in",
                                  created_by_user_id=cashier_user.id))
    db_session.flush()
    path = Path(__file__).parents[2] / "alembic/versions/20261001_1600-f9a0b1c2d3e4_reanchor_unused_system_money_accounts.py"
    spec = importlib.util.spec_from_file_location("money_anchor_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "op", Operations(MigrationContext.configure(db_session.connection())))
    module.upgrade()
    db_session.expire_all()
    assert automatic.opening_at == datetime(2026, 7, 10, 12)
    assert manual.opening_at == corrected.opening_at == explicit.opening_at == at
    assert MoneyService(db_session, default_company.id).overview().cash_total == Decimal("100.00")


def test_money_anchor_migration_preserves_reconciled_companies(
    db_session, default_company, cashier_user, test_product, monkeypatch,
):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    raw_sale(db_session, default_company, cashier_user, test_product)
    at = datetime(2026, 8, 1)
    account = MoneyAccount(company_id=default_company.id, name="Касса", is_till=True,
                           opening_balance=Decimal("0"), opening_at=at, created_at=at)
    db_session.add(account)
    db_session.add(Reconciliation(company_id=default_company.id, effective_from=date(2026, 8, 13)))
    db_session.flush()
    path = Path(__file__).parents[2] / "alembic/versions/20261001_1600-f9a0b1c2d3e4_reanchor_unused_system_money_accounts.py"
    spec = importlib.util.spec_from_file_location("frozen_money_anchor_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "op", Operations(MigrationContext.configure(db_session.connection())))
    module.upgrade()
    db_session.expire_all()
    assert account.opening_at == at


def test_money_anchor_migration_preserves_a_physically_counted_drawer(
    db_session, default_company, cashier_user, test_product, monkeypatch,
):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    raw_sale(db_session, default_company, cashier_user, test_product)
    at = datetime(2026, 8, 1)
    account = MoneyAccount(company_id=default_company.id, name="Касса", is_till=True,
                           opening_balance=Decimal("0"), opening_at=at, created_at=at)
    db_session.add(account)
    db_session.add(CashShift(company_id=default_company.id, shift_number=1, status=CashShiftStatus.CLOSED,
                            opening_cash=Decimal("25"), opened_by_user_id=cashier_user.id,
                            opened_at=datetime(2026, 7, 1), closed_at=datetime(2026, 7, 10)))
    db_session.flush()
    path = Path(__file__).parents[2] / "alembic/versions/20261001_1600-f9a0b1c2d3e4_reanchor_unused_system_money_accounts.py"
    spec = importlib.util.spec_from_file_location("counted_money_anchor_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "op", Operations(MigrationContext.configure(db_session.connection())))
    module.upgrade()
    db_session.expire_all()
    assert account.opening_at == at
