"""Individual receipts.

`get_sales_summary` says how much was taken; these say what was actually sold and
to whom. Read-only: a sale is rung at the till, never here.
"""

from fastmcp.exceptions import ToolError

from mcp_server import SCOPE_RECORDS
from mcp_server.context import mcp_session, require_module, require_scope
from mcp_server.periods import resolve_period
from mcp_server.serialization import json_safe
from mcp_server.server import mcp
from services.report_service import ReportService
from services.sale_return_service import SaleReturnService
from services.sale_service import SaleService


@mcp.tool
def get_sale(sale_id: int) -> dict:
    """Один чек целиком: позиции, цены, способы оплаты, что из него возвращали.
    Используйте, когда владелец спрашивает про конкретную продажу — «что было
    в чеке №1043».
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_RECORDS)
        require_module(auth, db, "sales")
        sale = SaleService(db, auth.company_id).get_by_id(sale_id)
        if sale is None:
            raise ToolError(f"Чек №{sale_id} не найден.")
        return json_safe(sale)


@mcp.tool
def list_sales(
    period: str = "today",
    search: str | None = None,
    payment_method: str | None = None,
    limit: int = 50,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    """Список чеков за период — с суммой, кассиром, способом оплаты и статусом.
    `search` ищет по номеру чека, товару или клиенту. Нужен, чтобы найти
    продажу, о которой спрашивают, и потом открыть её через get_sale.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_RECORDS)
        require_module(auth, db, "sales")
        limit = max(1, min(int(limit), 200))
        start, end, echo = resolve_period(
            ReportService(db, auth.company_id), period, start_date, end_date
        )
        sales, total = SaleService(db, auth.company_id).get_all(
            limit=limit,
            start_date=start,
            end_date=end,
            search=search,
            payment_method=payment_method,
        )
        return {**echo, "total": total, "sales": json_safe(sales)}


@mcp.tool
def list_sale_returns(sale_id: int) -> dict:
    """Возвраты, оформленные по одному чеку: что вернули, на какую сумму и когда.
    Возврат сначала гасит долг клиента, поэтому выданные деньги могут быть меньше
    стоимости возвращённого товара.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_RECORDS)
        require_module(auth, db, "sales")
        if SaleService(db, auth.company_id).get_by_id(sale_id) is None:
            raise ToolError(f"Чек №{sale_id} не найден.")
        returns = SaleReturnService(db, auth.company_id).get_returns_for_sale(sale_id)
        return {"sale_id": sale_id, "count": len(returns), "returns": json_safe(returns)}
