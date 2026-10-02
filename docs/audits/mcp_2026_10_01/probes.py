r"""Diagnostic probes for the MCP audit, not desired-behavior regression tests.

These assertions document defects observed on 2026-10-01. Run from the backend:
  $env:DATABASE_URL='sqlite:///:memory:'
  $env:SELLARY_ENV='development'
  .venv\Scripts\python.exe -m pytest ../docs/audits/mcp_2026_10_01/probes.py -o addopts='' -q -s -p no:cacheprovider

Only isolated in-memory SQLite databases are used. No production data is read.
"""

from datetime import date, datetime
from decimal import Decimal

import pytest
from fastmcp.exceptions import ToolError
from freezegun import freeze_time
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from core.database import Base
from core.security import create_access_token, decode_access_token
from core.modules import MODULES
from mcp_server import SCOPE_REPORTS
from mcp_server import context as mcp_context
from mcp_server import tools_catalog, tools_purchase
from mcp_server.oauth import routes as oauth_routes
from mcp_server.oauth.transaction import MAX_LOGIN_ATTEMPTS, encode_txn
from mcp_server.periods import resolve_period
from models.company import Company
from models.company_membership import CompanyMembership
from models.company_module import CompanyModule
from models.idempotency_key import IdempotencyKey
from models.product import Product
from models.purchase_order import PurchaseOrder
from models.sale import PaymentMethod, Sale, SaleStatus
from models.sale_item import SaleItem
from models.supplier import Supplier
from models.user import User
from services.auth_service import AuthService
from services.purchase_order_service import PurchaseOrderService
from services.report_service import ReportService
from tests.conftest import add_sale_tenders
from tests.integration.test_mcp_tools import as_user, catalogue, _SharedSession
from tests.unit.test_mcp_periods import FakeService

pytest_plugins = ["tests.conftest"]


def _mcp_token(user, company):
    return create_access_token({
        "sub": user.username, "user_id": user.id, "company_id": company.id,
        "role": "admin", "global_role": "standard", "mcp": True,
        "scopes": [SCOPE_REPORTS], "mcp_client_id": "audit-client",
    })


@freeze_time("2026-10-01 08:00:00+05:00")
def test_probe_named_period_can_be_reversed():
    start, end, echo = resolve_period(FakeService(open_from=date(2026, 10, 1)), "yesterday")
    assert start > end
    print("period:", echo["start_date"], echo["end_date"], "start > end")


@freeze_time("2026-10-01 08:00:00+05:00")
def test_probe_custom_dates_ignored_without_custom_period():
    _, _, echo = resolve_period(FakeService(), "today", "2026-01-01", "2026-01-31")
    assert echo["start_date"] == "2026-10-01"
    print("explicit dates ignored:", echo["start_date"], echo["end_date"])


def test_probe_reports_token_refreshes_into_web_token(client, db_session, admin_user, default_company):
    token = _mcp_token(admin_user, default_company)
    db_session.query(CompanyModule).filter_by(company_id=default_company.id, module="ai").delete()
    db_session.flush()
    result = client.post("/api/auth/refresh", headers={"Authorization": f"Bearer {token}"})
    assert result.status_code == 200, result.text
    claims = decode_access_token(result.json()["access_token"])
    assert "mcp" not in claims and "scopes" not in claims
    print("reports-only MCP token, ai disabled: /auth/refresh = 200; MCP restrictions removed")


def test_probe_reports_token_switches_delegated_company(client, db_session, admin_user, default_company, secondary_company):
    db_session.add(CompanyMembership(user_id=admin_user.id, company_id=secondary_company.id, role="admin", is_active=True))
    db_session.flush()
    result = client.post("/api/auth/switch-company", json={"company_id": secondary_company.id},
                         headers={"Authorization": f"Bearer {_mcp_token(admin_user, default_company)}"})
    assert result.status_code == 200, result.text
    claims = decode_access_token(result.json()["access_token"])
    assert claims["company_id"] == secondary_company.id and "mcp" not in claims
    print("company-scoped MCP token: /auth/switch-company = 200; token issued for other membership")


def test_probe_replaying_login_transaction_evades_attempt_cap(client, monkeypatch, db_session):
    monkeypatch.setattr(oauth_routes, "SessionLocal", lambda: _SharedSession(db_session))
    monkeypatch.setattr(AuthService, "authenticate", lambda *args: None)
    original = encode_txn({"attempts": 0, "client_name": "audit", "client_id": "audit"})
    statuses = [client.post("/mcp/oauth/login", data={"txn": original, "username": "audit", "password": "wrong"}).status_code
                for _ in range(MAX_LOGIN_ATTEMPTS + 2)]
    assert set(statuses) == {401}
    print("same original login transaction:", statuses, "no 429")


def test_probe_new_product_commit_replay_fails(as_user, admin_user, default_company, catalogue):
    as_user(admin_user, default_company)
    preview = tools_purchase.purchase_preview(supplier="Ромашка", items=[
        {"query": "Audit entirely new product", "quantity": 1, "unit_cost": "10"}])
    first = tools_purchase.purchase_commit(preview["draft_token"])
    with pytest.raises(ToolError, match="параметрами"):
        tools_purchase.purchase_commit(preview["draft_token"])
    print("new product: first commit succeeds; same draft replay rejected; order", first["purchase_order_id"])


def test_probe_product_search_silently_truncates(as_user, db_session, admin_user, default_company):
    for index in range(55):
        db_session.add(Product(company_id=default_company.id, name=f"Audit match {index:03}",
                               cost_price=1, sell_price=2, stock_quantity=1, min_stock_level=0))
    db_session.flush()
    as_user(admin_user, default_company)
    result = tools_catalog.search_products("Audit match", limit=1000)
    assert result["count"] == 50 and "total" not in result and "has_more" not in result
    print("55 matching products: 50 returned, count=50, no total/continuation")


def test_probe_duplicate_name_matches_arbitrary_product(db_session, default_company):
    from mcp_server.purchase_resolve import resolve_lines
    products = [Product(company_id=default_company.id, name="Audit same name", barcode=barcode,
                        cost_price=1, sell_price=2, stock_quantity=1, min_stock_level=0)
                for barcode in ("AUDIT001", "AUDIT002")]
    db_session.add_all(products)
    db_session.flush()
    lines, _ = resolve_lines(db_session, default_company.id, [
        {"query": "Audit same name", "quantity": 1, "unit_cost": "1"}])
    assert lines[0].status == "matched" and not lines[0].candidates
    assert lines[0].product_id in {product.id for product in products}
    print("two exact identical names: silently matched product", lines[0].product_id)


def test_probe_daily_profit_zero_and_rounded_cogs(db_session, admin_user, default_company, catalogue):
    moment = datetime(2026, 9, 15, 10)
    sale = Sale(company_id=default_company.id, cashier_id=admin_user.id, subtotal=60,
                total_amount=60, payment_method=PaymentMethod.CASH,
                status=SaleStatus.COMPLETED, created_at=moment)
    db_session.add(sale)
    db_session.flush()
    add_sale_tenders(db_session, sale)
    db_session.add(SaleItem(sale_id=sale.id, product_id=catalogue["products"][0].id,
                           quantity=3, quantity_returned=0, unit_price=20, subtotal=60, total=60,
                           unit_cost_at_sale=Decimal("13.33"), cost_total_at_sale=Decimal("40.00"), created_at=moment))
    db_session.flush()
    service = ReportService(db_session, default_company.id)
    start, end = datetime(2026, 9, 15), datetime(2026, 9, 16)
    assert service._calculate_cost(start, end) == Decimal("39.99")
    daily = service.get_daily_sales(start, end)
    assert daily.total_profit == Decimal("20.01") and daily.data[0].total_profit == 0
    print("exact saved cost=40.00; report cost=39.99; profit=20.01; daily row profit=0.00")


@pytest.mark.no_auto_shift
def test_probe_receipt_failure_persists_purchase_and_retry_duplicates(monkeypatch):
    # A separate engine with actual commits is essential: shared test fixtures
    # replace commits with flush and otherwise hide the partial transaction.
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as setup:
        company = Company(name="Audit", slug="audit-isolated", is_active=True)
        user = User(username="audit", email="audit@example.test", hashed_password="unused", role="admin", is_active=True)
        setup.add_all([company, user])
        setup.flush()
        company_id, user_id = company.id, user.id
        setup.add(CompanyMembership(company_id=company_id, user_id=user_id, role="admin", is_active=True))
        setup.add_all([CompanyModule(company_id=company_id, module=module) for module in MODULES])
        setup.add(Supplier(company_id=company_id, name="Audit Supplier", phone="+992000000000", is_active=True))
        setup.add(Product(company_id=company_id, name="Audit Existing", cost_price=1, sell_price=2,
                          stock_quantity=1, min_stock_level=0, is_active=True))
        setup.commit()
    from mcp.server.auth.provider import AccessToken
    from mcp_server import SCOPE_PURCHASING
    token = AccessToken(token="audit", client_id="audit", scopes=[SCOPE_REPORTS, SCOPE_PURCHASING],
                        claims={"user_id": user_id, "company_id": company_id, "mcp": True,
                                "scopes": [SCOPE_REPORTS, SCOPE_PURCHASING]})
    monkeypatch.setattr(mcp_context, "get_access_token", lambda: token)
    monkeypatch.setattr(mcp_context, "SessionLocal", lambda: Session(engine))
    preview = tools_purchase.purchase_preview(supplier="Audit Supplier", items=[
        {"query": "Audit Existing", "quantity": 1, "unit_cost": "1"}])
    def fail_receipt(*args, **kwargs):
        raise ValueError("Audit injected receipt failure")
    monkeypatch.setattr(PurchaseOrderService, "receive_items", fail_receipt)
    for _ in range(2):
        with pytest.raises(ToolError, match="Audit injected receipt failure"):
            tools_purchase.purchase_commit(preview["draft_token"])
    with Session(engine) as check:
        assert check.query(PurchaseOrder).count() == 2
        assert check.query(IdempotencyKey).count() == 0
        print("two failed receipts with same draft: 2 persisted orders, 0 idempotency records")
    engine.dispose()


def test_probe_dashboard_rejects_valid_low_stock_without_barcode(as_user, admin_user, default_company, catalogue):
    from pydantic import ValidationError
    from mcp_server import tools_reports
    as_user(admin_user, default_company)
    with pytest.raises(ValidationError) as error:
        tools_reports.get_dashboard()
    assert any(item["loc"] == ("barcode",) for item in error.value.errors())
    print("valid low-stock product barcode=None: whole dashboard fails validation")


def test_probe_first_card_account_read_omits_earlier_tender(db_session, admin_user, default_company):
    from models.sale import CardType
    from services.money_service import MoneyService
    sale = Sale(company_id=default_company.id, cashier_id=admin_user.id, subtotal=100,
                total_amount=100, payment_method=PaymentMethod.CARD, card_type=CardType.DC,
                status=SaleStatus.COMPLETED, created_at=datetime(2000, 1, 1, 12))
    db_session.add(sale)
    db_session.flush()
    add_sale_tenders(db_session, sale)
    overview = MoneyService(db_session, default_company.id).overview()
    account = next(account for account in overview.accounts if account.card_type == "dc")
    assert account.opening_at > sale.created_at and account.balance == Decimal("0.00")
    print("first DC account read: earlier tender=100.00, account balance=0.00")


def test_probe_purchase_price_serialization_loses_precision():
    from mcp_server.serialization import json_safe
    result = json_safe({"average_cost": Decimal("1.2345"), "last_cost": Decimal("1.2345"),
                        "current_cost_price": Decimal("1.2345")})
    assert result == {"average_cost": "1.23", "last_cost": "1.23", "current_cost_price": "1.2345"}
    print("purchase average/last unit cost: 1.2345 serialized as 1.23")


def test_probe_top_product_profit_ignores_discount(db_session, admin_user, default_company, catalogue):
    moment = datetime(2026, 9, 15, 10)
    sale = Sale(company_id=default_company.id, cashier_id=admin_user.id, subtotal=100,
                discount_amount=50, total_amount=50, payment_method=PaymentMethod.CASH,
                status=SaleStatus.COMPLETED, created_at=moment)
    db_session.add(sale)
    db_session.flush()
    add_sale_tenders(db_session, sale)
    db_session.add(SaleItem(sale_id=sale.id, product_id=catalogue["products"][0].id,
                           quantity=1, quantity_returned=0, unit_price=100, discount_amount=50,
                           subtotal=100, total=50, unit_cost_at_sale=40, cost_total_at_sale=40,
                           created_at=moment))
    db_session.flush()
    service = ReportService(db_session, default_company.id)
    start, end = datetime(2026, 9, 15), datetime(2026, 9, 16)
    overall = service.get_profit_report(start, end)
    top = service._get_top_products(start, end)
    assert overall.profit == Decimal("10.00") and top[0].profit == Decimal("60.00")
    print("discounted sale: overall profit=10.00, same top product profit=60.00")


def test_probe_allowed_oversell_with_depleted_layers_is_classified_as_drift(db_session, layered_product, admin_user):
    from services.consistency_service import ConsistencyService
    from services.inventory_ledger_service import InventoryLedgerService
    consumption = InventoryLedgerService(db_session, layered_product.company_id).consume_fifo(
        product=layered_product, quantity=Decimal("8"), consumer_type="sale_item",
        consumer_id=1, sale_item_id=None, user_id=admin_user.id, reason="audit offline oversell",
        reference_type="sale", reference_id=1, allow_oversell=True)
    db_session.flush()
    assert consumption.shortfall_quantity == Decimal("3")
    findings = ConsistencyService(db_session, layered_product.company_id).run(keys=["stock_vs_layers"])
    assert any(finding.bucket == "drift" and str(layered_product.id) in finding.subject for finding in findings)
    print("allowed FIFO oversell: stock=-3, depleted layers retained; checker classifies drift")
