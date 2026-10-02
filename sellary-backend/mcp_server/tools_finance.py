"""Stable finance tool name backed by bounded, company-local history reads."""

from mcp_server.periods import Period
from mcp_server.read_support import READ_ONLY, DateArg, Id, Limit, Offset
from mcp_server.server import mcp
from mcp_server.tools_history import list_money_movements
from schemas.mcp_read import MoneyPage


@mcp.tool(annotations=READ_ONLY)
def get_money_movements(period: Period = "this_month", account_id: Id | None = None,
                        limit: Limit = 100, start_date: DateArg | None = None,
                        end_date: DateArg | None = None, offset: Offset = 0) -> MoneyPage:
    """Ручные расходы, поступления, переводы и пересчёты. next_offset продолжает историю."""
    return list_money_movements(account_id, period, start_date, end_date, limit, offset)
