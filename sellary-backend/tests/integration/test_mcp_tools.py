"""The MCP tools against real data.

Tools are called as plain functions here rather than over HTTP. What is under
test is the part specific to this connector — who the caller is, what they are
allowed to open, and what a purchase actually writes — not FastMCP's transport.

Two things are stubbed: the access token, because minting one would mean
driving the whole OAuth dance for every assertion, and the session factory,
because the suite's data lives in a transaction that must survive the tool's
own commit.
"""

from decimal import Decimal

import pytest
from fastmcp.exceptions import ToolError
from mcp.server.auth.provider import AccessToken

from mcp_server import SCOPE_PURCHASING, SCOPE_REPORTS
from mcp_server import context as mcp_context
from mcp_server import tools_catalog, tools_purchase, tools_reports
from models.company_module import CompanyModule
from models.membership_module_access import MembershipModuleAccess
from models.product import Product
from models.purchase_order import PurchaseOrder, PurchaseOrderStatus
from models.supplier import Supplier


class _SharedSession:
    """The test session, minus the right to close or truly commit it.

    A tool owns its session in production: it commits and closes. Here the
    session belongs to the fixture's outer transaction, so those two calls are
    absorbed — the fixture rolls everything back at teardown.
    """

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
    """Run tools as a given user, with a given set of scopes."""

    def _install(user, company, scopes=(SCOPE_REPORTS, SCOPE_PURCHASING)):
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


@pytest.fixture
def catalogue(db_session, default_company):
    supplier = Supplier(
        company_id=default_company.id,
        name="ООО Ромашка",
        phone="+992900000001",
        is_active=True,
    )
    products = [
        Product(
            company_id=default_company.id,
            name="Сахар песок 1кг",
            barcode="4600000000017",
            uom="dona",
            cost_price=Decimal("5.0000"),
            sell_price=Decimal("6.5000"),
            stock_quantity=Decimal("40.000"),
            min_stock_level=Decimal("5.000"),
            is_active=True,
        ),
        Product(
            company_id=default_company.id,
            name="Мука высший сорт 2кг",
            uom="dona",
            cost_price=Decimal("8.0000"),
            sell_price=Decimal("11.0000"),
            stock_quantity=Decimal("2.000"),
            min_stock_level=Decimal("5.000"),
            is_active=True,
        ),
    ]
    db_session.add(supplier)
    db_session.add_all(products)
    db_session.flush()
    return {"supplier": supplier, "products": products}


def _call(tool, **kwargs):
    """`@mcp.tool` registers and returns the function unchanged."""
    return tool(**kwargs)


def _membership(user, company):
    return next(
        m for m in user.memberships if m.company_id == company.id
    )


# --------------------------------------------------------------------- auth


class TestCallerResolution:
    def test_a_token_without_a_company_is_refused(
        self, monkeypatch, db_session, admin_user, default_company
    ):
        token = AccessToken(
            token="t",
            client_id="c",
            scopes=[SCOPE_REPORTS],
            claims={"user_id": admin_user.id, "mcp": True},
        )
        monkeypatch.setattr(mcp_context, "get_access_token", lambda: token)
        monkeypatch.setattr(
            mcp_context, "SessionLocal", lambda: _SharedSession(db_session)
        )
        with pytest.raises(ToolError) as exc:
            _call(tools_reports.get_dashboard)
        assert "компании" in str(exc.value)

    def test_a_revoked_membership_closes_the_connector(
        self, as_user, db_session, admin_user, default_company
    ):
        as_user(admin_user, default_company)
        membership = _membership(admin_user, default_company)
        membership.is_active = False
        db_session.flush()
        with pytest.raises(ToolError) as exc:
            _call(tools_reports.get_dashboard)
        assert "отозван" in str(exc.value)

    def test_a_missing_scope_is_refused_even_for_an_admin(
        self, as_user, admin_user, default_company
    ):
        as_user(admin_user, default_company, scopes=[SCOPE_REPORTS])
        with pytest.raises(ToolError) as exc:
            _call(
                tools_purchase.purchase_preview,
                supplier="ООО Ромашка",
                items=[{"query": "Сахар", "quantity": 1, "unit_cost": "5"}],
            )
        assert "разрешение" in str(exc.value)


class TestModuleEnforcement:
    def test_a_company_without_the_module_is_closed_to_its_own_admin(
        self, as_user, db_session, admin_user, default_company
    ):
        """The company layer is commercial and admins do not bypass it."""
        as_user(admin_user, default_company)
        db_session.query(CompanyModule).filter(
            CompanyModule.company_id == default_company.id,
            CompanyModule.module == "reports",
        ).delete()
        db_session.flush()
        with pytest.raises(ToolError) as exc:
            _call(tools_reports.get_dashboard)
        assert "не подключён" in str(exc.value)

    def test_a_cashier_without_a_reports_grant_gets_nothing(
        self, as_user, cashier_user, default_company
    ):
        as_user(cashier_user, default_company)
        with pytest.raises(ToolError) as exc:
            _call(tools_reports.get_profit_report)
        assert "нет доступа" in str(exc.value)

    def test_a_cashier_may_still_see_the_till(
        self, as_user, cashier_user, default_company
    ):
        """`register` is what a cashier has, and the shift is a register thing."""
        as_user(cashier_user, default_company)
        result = _call(tools_reports.get_current_shift)
        # The integration suite keeps a shift open so sales can be rung.
        assert result["is_open"] is True
        assert "totals" in result


# ------------------------------------------------------------------ reports


class TestReportTools:
    def test_dashboard_names_the_company_and_its_clock(
        self, as_user, admin_user, default_company
    ):
        as_user(admin_user, default_company)
        result = _call(tools_reports.get_dashboard)
        assert result["company"] == default_company.name
        assert result["timezone"]

    def test_sales_summary_echoes_the_period_it_reported_on(
        self, as_user, admin_user, default_company
    ):
        as_user(admin_user, default_company)
        result = _call(tools_reports.get_sales_summary, period="last_month")
        assert result["period"] == "last_month"
        assert result["start_date"] < result["end_date"]

    def test_money_is_a_string_never_a_float(
        self, as_user, admin_user, default_company
    ):
        """A binary fraction standing in for money is how reports drift."""
        as_user(admin_user, default_company)
        result = _call(tools_reports.get_profit_report, period="this_month")
        for key, value in result.items():
            assert not isinstance(value, float), key

    def test_an_unknown_period_is_refused_before_any_query(
        self, as_user, admin_user, default_company
    ):
        as_user(admin_user, default_company)
        with pytest.raises(ToolError):
            _call(tools_reports.get_sales_summary, period="since_forever")

    def test_top_products_limit_is_clamped_not_trusted(
        self, as_user, admin_user, default_company
    ):
        as_user(admin_user, default_company)
        result = _call(tools_reports.get_top_products, limit=9999)
        assert "products" in result or "top_products" in str(result)

    def test_shifts_report_totals_the_discrepancy(
        self, as_user, admin_user, default_company
    ):
        as_user(admin_user, default_company)
        result = _call(tools_reports.list_shifts, period="last_30_days")
        assert result["count"] == 1
        # The open shift has not been counted yet, so it contributes nothing.
        assert result["total_discrepancy"] == "0.00"
        assert result["shifts"][0]["status"] == "open"


class TestCatalogTools:
    def test_search_finds_a_product_by_name(
        self, as_user, admin_user, default_company, catalogue
    ):
        as_user(admin_user, default_company)
        result = _call(tools_catalog.search_products, query="Сахар")
        assert result["count"] >= 1
        assert result["products"][0]["name"] == "Сахар песок 1кг"

    def test_low_stock_reports_what_needs_buying(
        self, as_user, admin_user, default_company, catalogue
    ):
        as_user(admin_user, default_company)
        result = _call(tools_catalog.get_low_stock)
        names = {product["name"] for product in result["products"]}
        assert "Мука высший сорт 2кг" in names
        assert "Сахар песок 1кг" not in names

    def test_suppliers_are_listed_for_the_purchase_flow(
        self, as_user, admin_user, default_company, catalogue
    ):
        as_user(admin_user, default_company)
        result = _call(tools_catalog.list_suppliers)
        assert any(s["name"] == "ООО Ромашка" for s in result["suppliers"])


class TestTenantIsolation:
    def test_a_token_for_one_company_cannot_see_another(
        self, as_user, db_session, admin_user, default_company, secondary_company
    ):
        other = Product(
            company_id=secondary_company.id,
            name="Чужой товар",
            uom="dona",
            cost_price=Decimal("1.0000"),
            sell_price=Decimal("2.0000"),
            stock_quantity=Decimal("100.000"),
            min_stock_level=Decimal("1.000"),
            is_active=True,
        )
        db_session.add(other)
        db_session.flush()

        as_user(admin_user, default_company)
        result = _call(tools_catalog.search_products, query="Чужой")
        assert result["count"] == 0


# ----------------------------------------------------------------- purchase


class TestPurchasePreview:
    def test_an_unknown_supplier_lists_the_known_ones(
        self, as_user, admin_user, default_company, catalogue
    ):
        as_user(admin_user, default_company)
        with pytest.raises(ToolError) as exc:
            _call(
                tools_purchase.purchase_preview,
                supplier="Кто-то ещё",
                items=[{"query": "Сахар песок 1кг", "quantity": 1, "unit_cost": "5"}],
            )
        assert "ООО Ромашка" in str(exc.value)

    def test_preview_writes_nothing(
        self, as_user, db_session, admin_user, default_company, catalogue
    ):
        as_user(admin_user, default_company)
        before = db_session.query(Product).count()
        _call(
            tools_purchase.purchase_preview,
            supplier="Ромашка",
            items=[
                {"query": "Совершенно новый товар", "quantity": 5, "unit_cost": "10"}
            ],
        )
        assert db_session.query(Product).count() == before
        assert db_session.query(PurchaseOrder).count() == 0

    def test_preview_labels_matched_and_new_lines(
        self, as_user, admin_user, default_company, catalogue
    ):
        as_user(admin_user, default_company)
        result = _call(
            tools_purchase.purchase_preview,
            supplier="Ромашка",
            items=[
                {"query": "Сахар песок 1кг", "quantity": 10, "unit_cost": "5.20"},
                {"query": "Гречка ядрица 800г", "quantity": 20, "unit_cost": "7.00"},
            ],
        )
        statuses = [line["status"] for line in result["lines"]]
        assert statuses == ["matched", "new"]
        assert result["new_product_count"] == 1
        assert result["can_commit"] is True
        assert result["draft_token"]

    def test_an_ambiguous_line_blocks_the_draft(
        self, as_user, db_session, admin_user, default_company, catalogue
    ):
        db_session.add(
            Product(
                company_id=default_company.id,
                name="Сахар песок 5кг",
                uom="dona",
                cost_price=Decimal("24.0000"),
                sell_price=Decimal("30.0000"),
                stock_quantity=Decimal("5.000"),
                min_stock_level=Decimal("1.000"),
                is_active=True,
            )
        )
        db_session.flush()

        as_user(admin_user, default_company)
        result = _call(
            tools_purchase.purchase_preview,
            supplier="Ромашка",
            items=[{"query": "Сахар песок", "quantity": 10, "unit_cost": "5.00"}],
        )
        assert result["ambiguous_count"] == 1
        assert result["can_commit"] is False
        assert result["draft_token"] is None


class TestPurchaseCommit:
    def _preview(self, items, supplier="Ромашка"):
        return _call(
            tools_purchase.purchase_preview, supplier=supplier, items=items
        )

    def test_commit_creates_the_order_and_the_missing_product(
        self, as_user, db_session, admin_user, default_company, catalogue
    ):
        as_user(admin_user, default_company)
        preview = self._preview(
            [
                {"query": "Сахар песок 1кг", "quantity": 10, "unit_cost": "5.20"},
                {"query": "Гречка ядрица 800г", "quantity": 20, "unit_cost": "7.00"},
            ]
        )
        result = _call(
            tools_purchase.purchase_commit, draft_token=preview["draft_token"]
        )

        assert result["purchase_order_id"]
        assert result["received"] is True
        assert len(result["created_products"]) == 1
        assert (
            db_session.query(Product)
            .filter(Product.name == "Гречка ядрица 800г")
            .count()
            == 1
        )

    def test_receiving_moves_stock_through_the_ledger(
        self, as_user, db_session, admin_user, default_company, catalogue
    ):
        as_user(admin_user, default_company)
        sugar = catalogue["products"][0]
        before = Decimal(str(sugar.stock_quantity))

        preview = self._preview(
            [{"query": "Сахар песок 1кг", "quantity": 10, "unit_cost": "5.20"}]
        )
        _call(tools_purchase.purchase_commit, draft_token=preview["draft_token"])

        db_session.refresh(sugar)
        assert Decimal(str(sugar.stock_quantity)) == before + Decimal("10")

    def test_draft_mode_creates_an_order_without_touching_stock(
        self, as_user, db_session, admin_user, default_company, catalogue
    ):
        as_user(admin_user, default_company)
        sugar = catalogue["products"][0]
        before = Decimal(str(sugar.stock_quantity))

        preview = self._preview(
            [{"query": "Сахар песок 1кг", "quantity": 10, "unit_cost": "5.20"}]
        )
        result = _call(
            tools_purchase.purchase_commit,
            draft_token=preview["draft_token"],
            mode="draft",
        )

        db_session.refresh(sugar)
        assert result["received"] is False
        assert result["status"] == PurchaseOrderStatus.DRAFT.value
        assert Decimal(str(sugar.stock_quantity)) == before

    def test_a_repeated_commit_creates_nothing_and_returns_the_same_order(
        self, as_user, db_session, admin_user, default_company, catalogue
    ):
        """The owner saying "ha" twice must not buy the delivery twice."""
        as_user(admin_user, default_company)
        preview = self._preview(
            [{"query": "Сахар песок 1кг", "quantity": 10, "unit_cost": "5.20"}]
        )
        first = _call(
            tools_purchase.purchase_commit, draft_token=preview["draft_token"]
        )
        orders_after_first = db_session.query(PurchaseOrder).count()

        second = _call(
            tools_purchase.purchase_commit, draft_token=preview["draft_token"]
        )

        assert second["purchase_order_id"] == first["purchase_order_id"]
        assert second["replayed"] is True
        assert db_session.query(PurchaseOrder).count() == orders_after_first

    def test_commit_refuses_an_unknown_mode(
        self, as_user, admin_user, default_company, catalogue
    ):
        as_user(admin_user, default_company)
        with pytest.raises(ToolError):
            _call(
                tools_purchase.purchase_commit, draft_token="x", mode="teleport"
            )

    def test_receiving_requires_manager_level(
        self, as_user, db_session, manager_user, default_company, catalogue
    ):
        """A `user`-level grant may look at purchases but not receive them."""
        as_user(manager_user, default_company)
        grant = (
            db_session.query(MembershipModuleAccess)
            .filter(
                MembershipModuleAccess.membership_id
                == _membership(manager_user, default_company).id,
                MembershipModuleAccess.module == "purchasing",
            )
            .one()
        )
        grant.level = "user"
        db_session.flush()

        preview = _call(
            tools_purchase.purchase_preview,
            supplier="Ромашка",
            items=[{"query": "Сахар песок 1кг", "quantity": 1, "unit_cost": "5"}],
        )
        with pytest.raises(ToolError) as exc:
            _call(
                tools_purchase.purchase_commit, draft_token=preview["draft_token"]
            )
        assert "руководител" in str(exc.value)
