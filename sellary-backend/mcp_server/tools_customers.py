"""Stable customer tool names; individual records require their own consent scope."""

from mcp_server.periods import Period
from mcp_server.read_support import READ_ONLY, DateArg, Id, Limit, Offset
from mcp_server.server import mcp
from mcp_server.tools_history import get_customer_ledger, list_customers
from schemas.mcp_read import LedgerPage


@mcp.tool(annotations=READ_ONLY)
def get_customer_debt(customer_id: Id, limit: Limit = 50, offset: Offset = 0,
                      period: Period | None = None, start_date: DateArg | None = None,
                      end_date: DateArg | None = None) -> LedgerPage:
    """Текущий долг клиента и страницы его истории: покупки, погашения, корректировки."""
    return get_customer_ledger(customer_id, period, start_date, end_date, limit, offset)
