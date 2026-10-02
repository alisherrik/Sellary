"""MCP reads must cover whole datasets and keep document-level access scoped."""

import asyncio
from datetime import date, datetime
from decimal import Decimal

import pytest
from fastmcp.exceptions import ToolError
from freezegun import freeze_time

from mcp_server import tools_catalog, tools_reports
from mcp_server.periods import resolve_period
from mcp_server.server import mcp
from models.inventory_log import InventoryLog
from models.product import Product
from models.reconciliation import Reconciliation
from models.supplier import Supplier
from tests.integration.test_mcp_tools import as_user, catalogue
from tests.unit.test_mcp_periods import FakeService


@freeze_time("2026-10-01 08:00:00+05:00")
def test_named_history_before_reconciliation_preserves_requested_days():
    start, end, echo = resolve_period(FakeService(open_from=date(2026, 10, 1)), "last_month")
    assert start <= end
    assert echo["start_date"] == "2026-09-01"
    assert echo["end_date"] == "2026-09-30"
    assert echo["reconciled_from"] == "2026-10-01"


@freeze_time("2026-10-01 08:00:00+05:00")
def test_explicit_dates_select_custom_without_an_extra_flag():
    _, _, echo = resolve_period(FakeService(), "today", "2026-01-01", "2026-01-31")
    assert echo["period"] == "custom"
    assert echo["start_date"] == "2026-01-01"
    with pytest.raises(ToolError):
        resolve_period(FakeService(), "today", "2026-01-01", None)
    with pytest.raises(ToolError):
        resolve_period(FakeService(), "custom", "2026-01-01junk", "2026-01-31")


def test_products_and_search_can_continue_beyond_fifty(as_user, db_session, admin_user, default_company):
    for index in range(55):
        db_session.add(Product(company_id=default_company.id, name=f"MCP item {index:03}",
                               cost_price=1, sell_price=2, stock_quantity=1, min_stock_level=5))
    db_session.flush()
    as_user(admin_user, default_company)
    first = tools_catalog.search_products("MCP item", limit=50)
    assert first["total"] == 55 and first["has_more"]
    second = tools_catalog.search_products("MCP item", limit=50, offset=first["next_offset"])
    assert second["count"] == 5 and not second["has_more"]
    ids = [row["id"] for row in first["products"] + second["products"]]
    assert len(set(ids)) == 55
    listed = tools_catalog.list_products(query="MCP item", limit=10, offset=50, with_totals=True)
    assert listed["total"] == 55 and listed["count"] == 5
    assert listed["products"][0]["ledger_stock_quantity"] is not None
    low = tools_catalog.get_low_stock(limit=10)
    assert low["count"] == 10 and low["total"] >= 55 and low["has_more"]


def test_suppliers_have_stable_continuation(as_user, db_session, admin_user, default_company):
    for index in range(3):
        db_session.add(Supplier(company_id=default_company.id, name=f"MCP supplier {index}", phone=str(index)))
    db_session.flush()
    as_user(admin_user, default_company)
    first = tools_catalog.list_suppliers(query="MCP supplier", limit=2)
    second = tools_catalog.list_suppliers(query="MCP supplier", limit=2, offset=first["next_offset"])
    assert first["total"] == 3 and second["total"] == 3
    assert len({row["id"] for row in first["suppliers"] + second["suppliers"]}) == 3


def test_product_detail_rejects_other_tenants(as_user, db_session, admin_user, default_company, secondary_company, catalogue):
    as_user(admin_user, default_company)
    mine = tools_catalog.get_product(catalogue["products"][0].id)
    assert mine["id"] == catalogue["products"][0].id
    other = Product(company_id=secondary_company.id, name="Other tenant", cost_price=1, sell_price=2, stock_quantity=0)
    db_session.add(other)
    db_session.flush()
    with pytest.raises(ToolError, match="не найден"):
        tools_catalog.get_product(other.id)


def test_read_tools_are_discoverable_with_typed_periods_and_read_annotations():
    from mcp_server import tools_history
    registered = {tool.name: tool for tool in asyncio.run(mcp.list_tools())}
    required = {"list_products", "get_product", "list_sales", "get_sale", "list_stock_movements",
                "list_reconciliations", "get_reconciliation", "check_consistency", "list_customers",
                "get_customer_ledger", "list_money_movements", "list_purchase_orders", "get_purchase_order",
                "list_write_offs", "get_write_off", "get_write_off_summary"}
    assert required <= set(registered)
    assert "last_month" in registered["get_sales_summary"].parameters["properties"]["period"]["enum"]
    for name in required:
        assert registered[name].annotations.readOnlyHint is True
    assert registered["list_products"].output_schema["properties"]["products"]


def test_sale_details_include_tenders_and_returns(as_user, admin_user, default_company, test_sale):
    from mcp_server import tools_history
    as_user(admin_user, default_company)
    detail = tools_history.get_sale(test_sale.id)
    assert detail["id"] == test_sale.id and detail["payments"] and "returns" in detail
    page = tools_history.list_sales(sale_id=test_sale.id, limit=1)
    assert page["total"] == 1 and page["sales"][0]["id"] == test_sale.id


def test_stock_history_respects_company_days_and_sale_reference_types(as_user, db_session, admin_user, default_company, catalogue):
    from mcp_server import tools_history
    for kind in ("sale", "purchase_receive"):
        db_session.add(InventoryLog(company_id=default_company.id, product_id=catalogue["products"][0].id,
                                     user_id=admin_user.id, quantity_change=1, previous_quantity=0, new_quantity=1,
                                     reason="History test", reference_type=kind, reference_id=99,
                                     created_at=datetime(2026, 9, 29, 19, 30)))
    db_session.flush()
    as_user(admin_user, default_company)
    page = tools_history.list_stock_movements(sale_id=99, start_date="2026-09-30", end_date="2026-09-30")
    assert page["total"] == 1 and page["movements"][0]["reference_type"] == "sale"


def test_reconciliation_history_is_paginated_and_restricted(as_user, db_session, admin_user, cashier_user, default_company):
    from mcp_server import tools_history
    for day in range(1, 5):
        db_session.add(Reconciliation(company_id=default_company.id, effective_from=date(2026, 9, day),
                                       note=f"Reconciliation {day}", created_by_user_id=admin_user.id))
    db_session.flush()
    as_user(admin_user, default_company)
    first = tools_history.list_reconciliations(limit=2)
    second = tools_history.list_reconciliations(limit=2, offset=first["next_offset"])
    assert first["total"] == 4 and len(second["reconciliations"]) == 2
    latest = tools_history.get_reconciliation()
    assert latest["effective_from"] == "2026-09-04" and latest["note"] == "Reconciliation 4"
    as_user(cashier_user, default_company)
    with pytest.raises(ToolError):
        tools_history.list_reconciliations()


def test_purchase_unit_prices_keep_four_decimals():
    from mcp_server.serialization import json_safe
    result = json_safe({name: Decimal("1.2345") for name in ("average_cost", "first_cost", "last_cost", "min_cost", "max_cost")})
    assert set(result.values()) == {"1.2345"}


def test_shift_discrepancy_counts_the_whole_period_not_the_page(as_user, db_session, admin_user, default_company):
    from models.cash_shift import CashShift, CashShiftStatus
    for index in range(3):
        db_session.add(CashShift(company_id=default_company.id, shift_number=index + 1,
            opened_by_user_id=admin_user.id, opened_at=datetime(2026, 9, 25, 5, index),
            closed_at=datetime(2026, 9, 25, 6, index), status=CashShiftStatus.CLOSED,
            opening_cash=0, discrepancy=Decimal("-2.00")))
    db_session.flush()
    as_user(admin_user, default_company)
    first = tools_reports.list_shifts(start_date="2026-09-25", end_date="2026-09-25", limit=1)
    assert first["total"] == 3 and first["total_discrepancy"] == "-6.00"
    assert first["has_more"] and first["next_offset"] == 1


def test_purchase_report_pages_do_not_lose_period_shares(as_user, admin_user, default_company, monkeypatch):
    from services.purchase_report_service import PurchaseReportService
    # Exercise the tool contract: explicit offsets reach the bounded service;
    # service arithmetic is independently tested in purchase report tests.
    def products(self, start, end, supplier_id=None, limit=200, offset=0):
        assert limit == 2 and offset == 2
        return []
    monkeypatch.setattr(PurchaseReportService, "by_product", products)
    monkeypatch.setattr(PurchaseReportService, "product_count", lambda *args: 4)
    as_user(admin_user, default_company)
    result = tools_reports.get_purchases_by_product(limit=2, offset=2)
    assert result["total"] == 4 and result["offset"] == 2


def test_customer_ledger_page_balance_is_global(as_user, db_session, admin_user, default_company, test_customer):
    from mcp_server import tools_history
    from models.customer_ledger_entry import CustomerLedgerEntry
    for day, amount, kind in [(1, 50, "credit_sale"), (2, -10, "payment"), (3, -5, "payment")]:
        db_session.add(CustomerLedgerEntry(company_id=default_company.id, customer_id=test_customer.id,
            entry_type=kind, amount=amount, payment_method="cash" if amount < 0 else None,
            created_by_user_id=admin_user.id, created_at=datetime(2026, 9, day, 5)))
    db_session.flush()
    as_user(admin_user, default_company)
    result = tools_history.get_customer_ledger(test_customer.id, start_date="2026-09-02",
        end_date="2026-09-03", limit=1)
    assert result["total"] == 2 and result["balance"] == "35.00" and result["has_more"]
    assert result["entries"][0]["amount"] == "-5.00"
    customers = tools_history.list_customers(limit=1)
    assert customers["customers"][0]["balance"] == "35.00"


def test_money_history_includes_last_instant_and_continues(as_user, db_session, admin_user, default_company):
    from mcp_server import tools_history
    from models.money_account import MoneyAccount, MoneyMovement
    account = MoneyAccount(company_id=default_company.id, name="History bank", opening_balance=0,
                           opening_at=datetime(2026, 1, 1))
    db_session.add(account)
    db_session.flush()
    for timestamp in [datetime(2026, 9, 29, 19), datetime(2026, 9, 30, 18, 59, 59, 999999)]:
        db_session.add(MoneyMovement(company_id=default_company.id, account_id=account.id,
            direction="in", reason="other_income", amount=1, created_by_user_id=admin_user.id,
            created_at=timestamp))
    db_session.flush()
    as_user(admin_user, default_company)
    first = tools_history.list_money_movements(account_id=account.id, start_date="2026-09-30",
        end_date="2026-09-30", limit=1)
    second = tools_history.list_money_movements(account_id=account.id, start_date="2026-09-30",
        end_date="2026-09-30", limit=1, offset=first["next_offset"])
    assert first["has_more"] and second["count"] == 1 and not second["has_more"]


def test_document_reads_reject_other_tenants(as_user, db_session, admin_user, default_company, secondary_company):
    from mcp_server import tools_history
    from models.customer import Customer
    from models.purchase_order import PurchaseOrder
    from models.stock_write_off import StockWriteOff
    supplier = Supplier(company_id=secondary_company.id, name="Other supplier", phone="other")
    customer = Customer(company_id=secondary_company.id, name="Other customer", phone="other")
    db_session.add_all([supplier, customer])
    db_session.flush()
    order = PurchaseOrder(company_id=secondary_company.id, supplier_id=supplier.id, total_amount=10)
    write_off = StockWriteOff(company_id=secondary_company.id, disposition="disposed",
        reason_code="spoilage", total_cost=10, created_by_user_id=admin_user.id)
    db_session.add_all([order, write_off])
    db_session.flush()
    as_user(admin_user, default_company)
    for tool, args in [(tools_history.get_customer_ledger, {"customer_id": customer.id}),
                       (tools_history.get_purchase_order, {"order_id": order.id}),
                       (tools_history.get_write_off, {"write_off_id": write_off.id})]:
        with pytest.raises(ToolError):
            tool(**args)
    assert tools_history.list_purchase_orders()["total"] == 0
    assert tools_history.list_write_offs()["total"] == 0


@pytest.mark.asyncio
async def test_mcp_protocol_validates_every_read_response(as_user, db_session, admin_user, default_company,
    test_sale, test_customer, sent_purchase_order):
    from fastmcp import Client
    from mcp_server import tools_history
    from models.stock_write_off import StockWriteOff
    reconciliation = Reconciliation(company_id=default_company.id, effective_from=date(2026, 1, 1),
                                    created_by_user_id=admin_user.id)
    write_off = StockWriteOff(company_id=default_company.id, disposition="disposed", reason_code="spoilage",
        total_cost=0, created_by_user_id=admin_user.id)
    db_session.add_all([reconciliation, write_off])
    db_session.flush()
    as_user(admin_user, default_company)
    args_by_name = {"search_products": {"query": "Test"}, "get_product": {"product_id": test_sale.items[0].product_id},
        "get_sale": {"sale_id": test_sale.id}, "get_customer_ledger": {"customer_id": test_customer.id},
        "get_purchase_order": {"order_id": sent_purchase_order.id}, "get_write_off": {"write_off_id": write_off.id}}
    async with Client(mcp) as client:
        registered = await client.list_tools()
        reads = [tool for tool in registered if tool.annotations and tool.annotations.readOnlyHint
                 and tool.name != "purchase_preview"]
        assert len(reads) == 31
        for tool in reads:
            result = await client.call_tool(tool.name, args_by_name.get(tool.name, {}), raise_on_error=False)
            assert result.is_error is False, (tool.name, result.content)
            assert result.structured_content is not None, tool.name
        invalid = await client.call_tool("list_products", {"limit": 201}, raise_on_error=False)
        assert invalid.is_error


def test_consistency_filtered_page_keeps_global_clean_status(as_user, db_session, admin_user, default_company):
    from mcp_server import tools_history
    db_session.add(Product(company_id=default_company.id, name="Unexplained stock", stock_quantity=7,
        cost_price=1, sell_price=2, inventory_value=7))
    db_session.flush()
    as_user(admin_user, default_company)
    first = tools_history.check_consistency(limit=1)
    assert first["clean"] is False and first["count"] == 1
    known = tools_history.check_consistency(bucket="known", limit=1)
    assert known["clean"] is False
    assert all(f["bucket"] == "known" for f in known["findings"])
    assert not db_session.new and not db_session.dirty


def test_top_products_contract_has_continuation(as_user, admin_user, default_company, test_sale):
    from mcp_server import tools_reports
    as_user(admin_user, default_company)
    first = tools_reports.get_top_products(period="custom", start_date="2020-01-01", end_date="2030-01-01", limit=1)
    assert first["total"] == 1 and first["count"] == 1
    after = tools_reports.get_top_products(period="custom", start_date="2020-01-01", end_date="2030-01-01", limit=1, offset=1)
    assert after["total"] == 1 and after["count"] == 0 and not after["has_more"]


@pytest.mark.parametrize("quantity", [Decimal("3"), Decimal("0.001")])
def test_purchase_weighted_unit_cost_uses_unrounded_spend(as_user, db_session, admin_user, default_company,
    sent_purchase_order, quantity):
    from models.purchase_receipt import PurchaseReceipt, PurchaseReceiptItem
    receipt = PurchaseReceipt(company_id=default_company.id, purchase_order_id=sent_purchase_order.id,
        user_id=admin_user.id, created_at=datetime(2026, 9, 30, 18, 59, 59, 999999))
    db_session.add(receipt)
    db_session.flush()
    item = sent_purchase_order.items[0]
    db_session.add(PurchaseReceiptItem(purchase_receipt_id=receipt.id, purchase_order_item_id=item.id,
        product_id=item.product_id, quantity=quantity, unit_cost=Decimal("1.2345")))
    db_session.flush()
    as_user(admin_user, default_company)
    result = tools_reports.get_purchases_by_product(start_date="2026-09-30", end_date="2026-09-30")
    assert result["total"] == 1
    assert result["rows"][0]["average_cost"] == "1.2345"


def test_catalogue_page_does_not_query_units_per_product(as_user, db_session, admin_user, default_company):
    from sqlalchemy import event, insert
    db_session.execute(insert(Product), [dict(company_id=default_company.id, name=f"Page query {i:03}",
        cost_price=1, sell_price=2, stock_quantity=0) for i in range(100)])
    db_session.flush()
    as_user(admin_user, default_company)
    statements = []
    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)
    event.listen(db_session.bind, "after_cursor_execute", capture)
    try:
        result = tools_catalog.list_products(query="Page query", limit=100)
    finally:
        event.remove(db_session.bind, "after_cursor_execute", capture)
    assert result["count"] == 100
    assert len(statements) <= 12, len(statements)


def test_ten_thousand_products_can_be_read_without_gaps(as_user, db_session, admin_user, default_company, secondary_company):
    from sqlalchemy import insert
    db_session.execute(insert(Product), [dict(company_id=default_company.id, name=f"Scale product {i:05}",
        cost_price=1, sell_price=2, stock_quantity=0) for i in range(10003)])
    db_session.execute(insert(Product), [dict(company_id=secondary_company.id, name="Scale product foreign",
        cost_price=1, sell_price=2, stock_quantity=0)])
    db_session.flush()
    as_user(admin_user, default_company)
    ids, offset = set(), 0
    while True:
        page = tools_catalog.list_products(query="Scale product", limit=200, offset=offset)
        assert page["total"] == 10003 and page["count"] <= 200
        page_ids = {row["id"] for row in page["products"]}
        assert not ids & page_ids
        assert all(row["name"] != "Scale product foreign" for row in page["products"])
        ids.update(page_ids)
        if not page["has_more"]:
            break
        assert page["next_offset"] > offset
        offset = page["next_offset"]
    assert len(ids) == 10003


def test_authenticated_http_initialize_discover_and_read(monkeypatch, db_session, admin_user, default_company):
    """The exact /mcp route must work through its mounted HTTP lifespan."""
    import json
    from contextlib import asynccontextmanager
    from fastapi.testclient import TestClient
    from starlette.applications import Starlette
    from starlette.routing import Mount
    from core.security import create_access_token, MCP_ACCESS_TOKEN_TYPE
    from mcp_server import context
    from mcp_server.server import ExactPathRoute, auth_provider, mcp, well_known_routes
    from tests.integration.test_mcp_tools import _SharedSession

    monkeypatch.setattr(context, "SessionLocal", lambda: _SharedSession(db_session))
    http_app = mcp.http_app(path="/")
    @asynccontextmanager
    async def lifespan(app):
        async with http_app.lifespan(app):
            yield
    app = Starlette(routes=[ExactPathRoute("/mcp", http_app), Mount("/mcp", http_app),
                            *well_known_routes()], lifespan=lifespan)
    token = create_access_token(data={"user_id": admin_user.id, "company_id": default_company.id,
        "mcp": True, "scopes": ["sellary:reports"], "aud": auth_provider._resource_identifier,
        "iss": str(auth_provider.issuer_url).rstrip("/")}, token_type=MCP_ACCESS_TOKEN_TYPE)
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json, text/event-stream"}

    def rpc(client, request_id, method, params):
        response = client.post("/mcp", headers=headers,
            json={"jsonrpc": "2.0", "id": request_id, "method": method, "params": params},
            follow_redirects=False)
        assert response.status_code == 200, response.text
        if response.headers.get("mcp-session-id"):
            headers["mcp-session-id"] = response.headers["mcp-session-id"]
        if response.headers["content-type"].startswith("text/event-stream"):
            messages = [json.loads(line[5:].strip()) for line in response.text.splitlines() if line.startswith("data:")]
            return next(message["result"] for message in messages if message.get("id") == request_id)
        return response.json()["result"]

    with TestClient(app) as client:
        assert client.get("/.well-known/oauth-protected-resource/mcp").status_code == 200
        initialized = rpc(client, 1, "initialize", {"protocolVersion": "2025-11-25",
            "capabilities": {}, "clientInfo": {"name": "Sellary HTTP regression", "version": "1"}})
        headers["mcp-protocol-version"] = initialized["protocolVersion"]
        notified = client.post("/mcp", headers=headers, json={"jsonrpc": "2.0", "method": "notifications/initialized"})
        assert notified.status_code == 202
        listed = rpc(client, 2, "tools/list", {})
        assert len(listed["tools"]) == 33
        read = rpc(client, 3, "tools/call", {"name": "list_products", "arguments": {"limit": 1}})
        assert read.get("isError", False) is False
        assert read["structuredContent"]["total"] == 0
        invalid = client.post("/mcp", headers={**headers, "Authorization": "Bearer invalid"},
            json={"jsonrpc": "2.0", "id": 4, "method": "tools/list", "params": {}}, follow_redirects=False)
        assert invalid.status_code == 401
