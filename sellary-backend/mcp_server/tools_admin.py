"""Cross-domain reads: the shop queue, one shift, and the books check.

`run_consistency_check` is not module-gated — it spans stock and cash, so it
mirrors its REST guard against the caller's role instead. Declaring a сверка is
deliberately absent: freezing a period needs a human signature.
"""

from fastmcp.exceptions import ToolError

from mcp_server import SCOPE_RECORDS
from mcp_server.context import mcp_session, require_module, require_scope
from mcp_server.serialization import json_safe
from mcp_server.server import mcp
from models.cash_shift import CashShift as CashShiftModel
from services.cash_shift_service import CashShiftService
from services.consistency_service import ConsistencyService
from services.order_service import OrderService


@mcp.tool
def list_shop_orders(status: str | None = None, limit: int = 50) -> dict:
    """Заказы из Telegram-магазина: кто заказал, что, на какую сумму и в каком
    состоянии заказ. Нужен, чтобы понять, что ждёт обработки.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_RECORDS)
        require_module(auth, db, "shop")
        limit = max(1, min(int(limit), 200))
        result = OrderService(db, auth.company_id).list_orders_for_company(
            status=status, limit=limit
        )
        return {"total": result.total, "orders": json_safe(result.items)}


@mcp.tool
def get_shift(shift_id: int | None = None) -> dict:
    """Одна смена: когда открыта и закрыта, кем, сколько наторговали, что
    насчитали в кассе и какое расхождение. Без shift_id возвращает открытую
    смену; если открытой нет, скажет об этом.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_RECORDS)
        require_module(auth, db, "register")
        service = CashShiftService(db, auth.company_id)
        if shift_id is None:
            shift = service.get_current()
            if shift is None:
                return {"shift": None, "message": "Открытой смены сейчас нет."}
        else:
            shift = (
                db.query(CashShiftModel)
                .filter(
                    CashShiftModel.id == shift_id,
                    CashShiftModel.company_id == auth.company_id,
                )
                .first()
            )
            if shift is None:
                raise ToolError(f"Смена №{shift_id} не найдена.")
        return {"shift": json_safe(shift), "totals": json_safe(service.totals_for(shift))}


@mcp.tool
def run_consistency_check() -> dict:
    """Проверка сходимости учёта: сверяет каждую производную цифру с независимым
    источником — остатки с партиями, долги с журналом, кассу с движениями.
    `drift` означает расхождение, которое нужно чинить; `known` — записанный
    факт, вроде чека, пришедшего с кассы задним числом.
    Ничего не изменяет.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_RECORDS)
        if auth.role != "admin":
            raise ToolError("Проверку учёта может запускать только администратор.")
        findings = ConsistencyService(db, auth.company_id).run()
        return {
            "clean": not any(item.bucket == "drift" for item in findings),
            "findings": json_safe([item.__dict__ for item in findings]),
        }
