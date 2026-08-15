"""Reading purchase orders back.

`purchase_commit` writes one and returns a summary; this is how the model checks
what it actually created, and how the owner asks about an older delivery.
"""

from fastmcp.exceptions import ToolError

from mcp_server import SCOPE_RECORDS
from mcp_server.context import mcp_session, require_module, require_scope
from mcp_server.periods import resolve_period
from mcp_server.serialization import json_safe
from mcp_server.server import mcp
from services.purchase_order_service import PurchaseOrderService
from services.purchase_report_service import PurchaseReportService


@mcp.tool
def get_purchase_order(purchase_order_id: int) -> dict:
    """Один заказ поставщику целиком: позиции, сколько заказано, сколько принято,
    сколько осталось, статус. Используйте, чтобы проверить, что именно было
    оформлено, в том числе после purchase_commit.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_RECORDS)
        require_module(auth, db, "purchasing")
        order = PurchaseOrderService(db, auth.company_id).get_by_id(purchase_order_id)
        if order is None:
            raise ToolError(f"Заказ №{purchase_order_id} не найден.")
        return json_safe(order)


@mcp.tool
def list_purchase_orders(
    period: str = "last_30_days",
    supplier_id: int | None = None,
    status: str | None = None,
    limit: int = 50,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    """Заказы поставщикам за период — с поставщиком, суммой и статусом.
    В отличие от get_outstanding_orders, показывает и принятые, и черновики.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_RECORDS)
        require_module(auth, db, "purchasing")
        limit = max(1, min(int(limit), 200))
        start, end, echo = resolve_period(
            PurchaseReportService(db, auth.company_id), period, start_date, end_date
        )
        orders, total = PurchaseOrderService(db, auth.company_id).get_all(
            limit=limit,
            supplier_id=supplier_id,
            status=status,
            start_date=start.isoformat() if start else None,
            end_date=end.isoformat() if end else None,
        )
        return {**echo, "total": total, "orders": json_safe(orders)}
