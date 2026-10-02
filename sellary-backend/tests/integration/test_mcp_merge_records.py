"""A pre-existing reports consent must not silently gain individual records."""

import pytest
from fastmcp.exceptions import ToolError

from mcp_server import SCOPE_REPORTS, tools_history
from tests.integration.test_mcp_tools import as_user


@pytest.mark.parametrize("name,arguments", [
    ("list_sales", {}),
    ("get_sale", {"sale_id": 1}),
    ("list_stock_movements", {}),
    ("list_customers", {}),
    ("get_customer_ledger", {"customer_id": 1}),
    ("list_money_movements", {}),
    ("list_purchase_orders", {}),
    ("get_purchase_order", {"purchase_order_id": 1}),
    ("list_write_offs", {}),
    ("get_write_off", {"write_off_id": 1}),
    ("check_consistency", {}),
])
def test_reports_only_consent_refuses_document_reads(
    name, arguments, as_user, admin_user, default_company,
):
    as_user(admin_user, default_company, scopes=(SCOPE_REPORTS,))
    with pytest.raises(ToolError, match="разрешение"):
        getattr(tools_history, name)(**arguments)
