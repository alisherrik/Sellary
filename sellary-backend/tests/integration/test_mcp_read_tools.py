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
from mcp_server import tools_sales
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
