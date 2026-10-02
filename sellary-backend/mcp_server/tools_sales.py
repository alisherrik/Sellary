"""Stable receipt tool names backed by the paginated document reads."""

from mcp_server.read_support import READ_ONLY, Id, Limit, Offset, page_info
from mcp_server.server import mcp
from mcp_server.tools_history import get_sale, list_sales
from schemas.mcp_read import SaleReturnsPage


@mcp.tool(annotations=READ_ONLY)
def list_sale_returns(sale_id: Id, limit: Limit = 50, offset: Offset = 0) -> SaleReturnsPage:
    """Возвраты по одному чеку, постранично. Долг погашается раньше выдачи денег."""
    detail = get_sale(sale_id)
    rows = detail["returns"]
    page = rows[offset:offset + limit]
    return {"sale_id": sale_id, **page_info(len(page), len(rows), limit, offset), "returns": page}
