"""The read-only tools against real data.

Same harness as `test_mcp_tools.py`: tools are called as plain functions, the
access token is stubbed, and the session factory is swapped so the suite's
transaction survives the tool's own commit.
"""

from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from fastmcp.exceptions import ToolError
from mcp.server.auth.provider import AccessToken

from mcp_server import SCOPE_PURCHASING, SCOPE_RECORDS, SCOPE_REPORTS
from mcp_server import context as mcp_context
from mcp_server import (
    tools_admin,
    tools_customers,
    tools_finance,
    tools_inventory,
    tools_purchasing,
    tools_sales,
)
from models.sale import PaymentMethod, Sale, SaleStatus
from tests.conftest import add_sale_tenders


class _SharedSession:
    def __init__(self, session):
        self._session = session

    def __getattr__(self, name):
        return getattr(self._session, name)

    def commit(self):
        self._session.flush()

    def close(self):
        pass

    def rollback(self):
        pass


@pytest.fixture
def as_user(monkeypatch, db_session):
    def _install(
        user, company, scopes=(SCOPE_REPORTS, SCOPE_RECORDS, SCOPE_PURCHASING)
    ):
        token = AccessToken(
            token="test-token",
            client_id="test-client",
            scopes=list(scopes),
            subject=str(user.id),
            claims={
                "user_id": user.id,
                "company_id": company.id,
                "mcp": True,
                "scopes": list(scopes),
            },
        )
        monkeypatch.setattr(mcp_context, "get_access_token", lambda: token)
        monkeypatch.setattr(
            mcp_context, "SessionLocal", lambda: _SharedSession(db_session)
        )
        return token

    return _install


def _call(tool, **kwargs):
    """`@mcp.tool` registers and returns the function unchanged."""
    return tool(**kwargs)


@pytest.fixture
def a_sale(db_session, cashier_user):
    sale = Sale(
        cashier_id=cashier_user.id,
        subtotal=Decimal("25.00"),
        tax_amount=Decimal("0.00"),
        total_amount=Decimal("25.00"),
        payment_method=PaymentMethod.CASH,
        status=SaleStatus.COMPLETED,
        created_at=datetime.utcnow() - timedelta(hours=1),
    )
    db_session.add(sale)
    db_session.flush()
    return add_sale_tenders(db_session, sale)


class TestSalesTools:
    def test_get_sale_returns_the_receipt(
        self, as_user, admin_user, default_company, a_sale
    ):
        as_user(admin_user, default_company)

        result = _call(tools_sales.get_sale, sale_id=a_sale.id)

        assert result["id"] == a_sale.id
        assert result["total_amount"] == "25.00"

    def test_get_sale_does_not_reach_another_company(
        self, as_user, admin_user, default_company, secondary_company, db_session, cashier_user
    ):
        other = Sale(
            company_id=secondary_company.id,
            cashier_id=cashier_user.id,
            subtotal=Decimal("9.00"),
            tax_amount=Decimal("0.00"),
            total_amount=Decimal("9.00"),
            payment_method=PaymentMethod.CASH,
            status=SaleStatus.COMPLETED,
        )
        db_session.add(other)
        db_session.flush()
        as_user(admin_user, default_company)

        with pytest.raises(ToolError):
            _call(tools_sales.get_sale, sale_id=other.id)

    def test_list_sales_finds_it(self, as_user, admin_user, default_company, a_sale):
        as_user(admin_user, default_company)

        result = _call(tools_sales.list_sales, period="today")

        assert result["total"] >= 1
        assert any(row["id"] == a_sale.id for row in result["sales"])

    def test_the_records_scope_is_required(
        self, as_user, admin_user, default_company, a_sale
    ):
        as_user(admin_user, default_company, scopes=(SCOPE_REPORTS,))

        with pytest.raises(ToolError) as exc:
            _call(tools_sales.get_sale, sale_id=a_sale.id)

        assert "разрешение" in str(exc.value)

    def test_returns_on_an_unknown_sale_is_an_error_not_an_empty_answer(
        self, as_user, admin_user, default_company
    ):
        as_user(admin_user, default_company)

        with pytest.raises(ToolError):
            _call(tools_sales.list_sale_returns, sale_id=99999)


class TestCustomerTools:
    def test_list_customers_returns_the_shop_s_customers(
        self, as_user, admin_user, default_company, db_session
    ):
        from models.customer import Customer

        db_session.add(
            Customer(company_id=default_company.id, name="Иван Петров", phone="+992900000002")
        )
        db_session.flush()
        as_user(admin_user, default_company)

        result = _call(tools_customers.list_customers)

        assert any(row["name"] == "Иван Петров" for row in result["customers"])

    def test_total_is_the_real_count_not_the_page_size(
        self, as_user, admin_user, default_company, db_session
    ):
        """`get_all` is paged; `total` must not just be `len()` of that page."""
        from models.customer import Customer

        for i in range(3):
            db_session.add(Customer(company_id=default_company.id, name=f"Клиент {i}"))
        db_session.flush()
        as_user(admin_user, default_company)

        result = _call(tools_customers.list_customers, limit=2)

        assert len(result["customers"]) == 2
        assert result["total"] >= 3

    def test_a_customer_with_no_debt_reports_zero(
        self, as_user, admin_user, default_company, db_session
    ):
        from models.customer import Customer

        customer = Customer(company_id=default_company.id, name="Без долга")
        db_session.add(customer)
        db_session.flush()
        as_user(admin_user, default_company)

        result = _call(tools_customers.get_customer_debt, customer_id=customer.id)

        assert result["balance"] == "0.00"
        assert result["entries"] == []

    def test_the_customers_module_is_required(
        self, as_user, admin_user, default_company, db_session
    ):
        from models.company_module import CompanyModule

        as_user(admin_user, default_company)
        db_session.query(CompanyModule).filter(
            CompanyModule.company_id == default_company.id,
            CompanyModule.module == "customers",
        ).delete()
        db_session.flush()

        with pytest.raises(ToolError) as exc:
            _call(tools_customers.list_customers)

        assert "Клиенты" in str(exc.value)


class TestFinanceTools:
    def test_movements_come_back_for_the_period(
        self, as_user, admin_user, default_company
    ):
        as_user(admin_user, default_company)

        result = _call(tools_finance.get_money_movements, period="this_month")

        assert "movements" in result
        assert result["period"] == "this_month"

    def test_the_finance_module_is_required(
        self, as_user, admin_user, default_company, db_session
    ):
        from models.company_module import CompanyModule

        as_user(admin_user, default_company)
        db_session.query(CompanyModule).filter(
            CompanyModule.company_id == default_company.id,
            CompanyModule.module == "finance",
        ).delete()
        db_session.flush()

        with pytest.raises(ToolError) as exc:
            _call(tools_finance.get_money_movements)

        assert "Финансы" in str(exc.value)


class TestInventoryTools:
    def test_the_catalogue_can_be_browsed_without_a_query(
        self, as_user, admin_user, default_company, test_product
    ):
        as_user(admin_user, default_company)

        result = _call(tools_inventory.list_products, limit=10)

        assert result["total"] >= 1
        assert any(row["id"] == test_product.id for row in result["products"])

    def test_search_products_still_requires_its_query(self):
        """The existing tool's meaning must not change under connected agents."""
        import inspect

        from mcp_server import tools_catalog

        signature = inspect.signature(tools_catalog.search_products)
        assert signature.parameters["query"].default is inspect.Parameter.empty

    def test_stock_movements_come_back(
        self, as_user, admin_user, default_company, test_product
    ):
        as_user(admin_user, default_company)

        result = _call(tools_inventory.get_stock_movements, product_id=test_product.id)

        assert "movements" in result

    def test_write_offs_summarise_by_reason(
        self, as_user, admin_user, default_company
    ):
        as_user(admin_user, default_company)

        result = _call(tools_inventory.get_write_off_summary, period="this_month")

        assert result["period"] == "this_month"

    def test_list_write_offs_returns_real_fields_not_object_reprs(
        self, as_user, admin_user, default_company, db_session, test_product
    ):
        from models.stock_write_off import StockWriteOff, StockWriteOffItem

        write_off = StockWriteOff(
            company_id=default_company.id,
            disposition="disposed",
            reason_code="damaged",
            total_cost=Decimal("15.0000"),
            created_by_user_id=admin_user.id,
        )
        db_session.add(write_off)
        db_session.flush()
        db_session.add(
            StockWriteOffItem(
                write_off_id=write_off.id,
                product_id=test_product.id,
                unit_quantity=Decimal("3.000"),
                quantity=Decimal("3.000"),
                unit_cost=Decimal("5.0000"),
                line_cost=Decimal("15.0000"),
            )
        )
        db_session.flush()
        as_user(admin_user, default_company)

        result = _call(tools_inventory.list_write_offs, period="this_month")

        row = next(r for r in result["write_offs"] if r["id"] == write_off.id)
        assert row["reason_code"] == "damaged"
        assert row["total_cost"] == "15.00"
        assert row["items"][0]["product_id"] == test_product.id

    def test_valuation_reports_what_the_stock_is_worth(
        self, as_user, admin_user, default_company
    ):
        as_user(admin_user, default_company)

        result = _call(tools_inventory.get_inventory_valuation)

        assert result is not None

    def test_categories_come_back(self, as_user, admin_user, default_company, test_category):
        as_user(admin_user, default_company)

        result = _call(tools_inventory.list_categories)

        assert any(row["id"] == test_category.id for row in result["categories"])


class TestPurchasingTools:
    def test_an_order_can_be_read_back_after_it_is_created(
        self, as_user, admin_user, default_company, db_session
    ):
        from models.purchase_order import PurchaseOrder, PurchaseOrderStatus
        from models.supplier import Supplier

        supplier = Supplier(
            company_id=default_company.id,
            name="ООО Ромашка",
            phone="+992900000003",
            is_active=True,
        )
        db_session.add(supplier)
        db_session.flush()
        order = PurchaseOrder(
            company_id=default_company.id,
            supplier_id=supplier.id,
            status=PurchaseOrderStatus.RECEIVED,
            total_amount=Decimal("100.00"),
        )
        db_session.add(order)
        db_session.flush()
        as_user(admin_user, default_company)

        result = _call(tools_purchasing.get_purchase_order, purchase_order_id=order.id)

        assert result["id"] == order.id
        assert result["total_amount"] == "100.00"

    def test_an_unknown_order_is_an_error_not_an_empty_answer(
        self, as_user, admin_user, default_company
    ):
        as_user(admin_user, default_company)

        with pytest.raises(ToolError):
            _call(tools_purchasing.get_purchase_order, purchase_order_id=99999)


class TestAdminTools:
    def test_shop_orders_come_back(self, as_user, admin_user, default_company):
        as_user(admin_user, default_company)

        result = _call(tools_admin.list_shop_orders)

        assert "orders" in result

    def test_the_checker_reports_clean_or_not(
        self, as_user, admin_user, default_company
    ):
        as_user(admin_user, default_company)

        result = _call(tools_admin.run_consistency_check)

        assert isinstance(result["clean"], bool)
        assert isinstance(result["findings"], list)

    def test_the_checker_is_refused_to_a_manager(
        self, as_user, manager_user, default_company
    ):
        """It spans stock and cash, so it mirrors its REST guard: admin only."""
        as_user(manager_user, default_company)

        with pytest.raises(ToolError):
            _call(tools_admin.run_consistency_check)

    def test_a_shift_that_does_not_exist_is_an_error(
        self, as_user, admin_user, default_company
    ):
        as_user(admin_user, default_company)

        with pytest.raises(ToolError):
            _call(tools_admin.get_shift, shift_id=99999)

    @pytest.mark.no_auto_shift
    def test_get_shift_returns_real_fields_not_an_object_repr(
        self, as_user, admin_user, default_company, db_session
    ):
        """A raw ORM row is not JSON — json_safe alone renders it unusable."""
        from models.cash_shift import CashShift, CashShiftStatus

        shift = CashShift(
            company_id=default_company.id,
            shift_number=1,
            status=CashShiftStatus.OPEN,
            opened_by_user_id=admin_user.id,
            opening_cash=Decimal("100.00"),
        )
        db_session.add(shift)
        db_session.flush()
        as_user(admin_user, default_company)

        result = _call(tools_admin.get_shift, shift_id=shift.id)

        assert result["shift"]["id"] == shift.id
        assert result["shift"]["opening_cash"] == "100.00"
        assert result["shift"]["status"] == "open"


class TestPeriodTools:
    def test_periods_are_empty_before_the_first_сверка(
        self, as_user, admin_user, default_company
    ):
        as_user(admin_user, default_company)

        result = _call(tools_admin.list_periods)

        assert result["total"] == 0

    def test_a_period_reports_bought_and_sold(
        self, as_user, admin_user, default_company, db_session
    ):
        from datetime import date

        from models.reconciliation import Reconciliation
        from services import reconciliation

        row = Reconciliation(company_id=default_company.id, effective_from=date(2026, 6, 1))
        db_session.add(row)
        db_session.flush()
        reconciliation.invalidate(db_session, default_company.id)
        as_user(admin_user, default_company)

        listed = _call(tools_admin.list_periods)
        detail = _call(tools_admin.get_period_report, reconciliation_id=row.id)

        assert listed["total"] == 1
        assert detail["end_day"] == "2026-05-31"
        assert "purchased" in detail
        assert "sold" in detail

    def test_an_unknown_period_is_an_error(
        self, as_user, admin_user, default_company
    ):
        as_user(admin_user, default_company)

        with pytest.raises(ToolError):
            _call(tools_admin.get_period_report, reconciliation_id=9999)

    def test_checker_report_stays_hidden_from_a_reports_grant_without_the_role(
        self, as_user, cashier_user, default_company, db_session, grant_module
    ):
        """A `reports:manager` module grant opens the report, not the audit trail.

        `require_module` checks a per-membership grant, an axis independent of
        company role — a cashier can hold it. `checker_report` is consistency-
        checker drift, gated everywhere else at admin/manager; this tool must
        not become a side door around that, matching the same fix already made
        on GET /api/reconciliation/periods/{id}.
        """
        from datetime import date

        from models.reconciliation import Reconciliation
        from services import reconciliation

        row = Reconciliation(
            company_id=default_company.id,
            effective_from=date(2026, 6, 1),
            checker_report=[{"bucket": "drift", "check": "stock_vs_layers"}],
        )
        db_session.add(row)
        db_session.flush()
        reconciliation.invalidate(db_session, default_company.id)
        grant_module(cashier_user, default_company, "reports", "manager")
        as_user(cashier_user, default_company)

        detail = _call(tools_admin.get_period_report, reconciliation_id=row.id)

        assert detail["checker_report"] is None


EXPECTED_TOOLS = {
    # aggregates — sellary:reports
    "get_dashboard",
    "get_sales_summary",
    "get_daily_sales",
    "get_profit_report",
    "get_top_products",
    "get_purchase_summary",
    "get_purchases_by_product",
    "get_purchases_by_supplier",
    "get_outstanding_orders",
    "get_low_stock",
    "get_money_accounts",
    "get_current_shift",
    "list_shifts",
    "search_products",
    "list_suppliers",
    "list_products",
    "list_categories",
    "get_write_off_summary",
    "get_inventory_valuation",
    "list_periods",
    "get_period_report",
    # rows — sellary:records
    "get_sale",
    "list_sales",
    "list_sale_returns",
    "list_customers",
    "get_customer_debt",
    "get_money_movements",
    "get_stock_movements",
    "list_write_offs",
    "get_purchase_order",
    "list_purchase_orders",
    "list_shop_orders",
    "get_shift",
    "run_consistency_check",
    # the only writes
    "purchase_preview",
    "purchase_commit",
}


async def test_the_tool_surface_is_exactly_what_we_meant_to_ship():
    """A new tool on this connector is a deliberate act, not a side effect."""
    from mcp_server.server import build_mcp_app, mcp

    build_mcp_app()
    tools = await mcp.list_tools()

    assert {tool.name for tool in tools} == EXPECTED_TOOLS
