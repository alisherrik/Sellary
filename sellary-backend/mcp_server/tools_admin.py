"""Retained upstream MCP reads, sharing company-scoped service contracts."""

from typing import Annotated, Literal

from fastmcp.exceptions import ToolError
from pydantic import Field

from mcp_server import SCOPE_RECORDS, SCOPE_REPORTS
from mcp_server.context import mcp_session, require_module, require_scope
from mcp_server.read_support import READ_ONLY, Id, Limit, Offset, page_info
from mcp_server.serialization import json_safe, money
from mcp_server.server import mcp
from mcp_server.tools_history import check_consistency
from models.order import OrderStatus
from schemas.mcp_compat import (
    CompatConsistencyPage,
    CompatPeriodPage,
    CompatPeriodReport,
    CompatShiftResult,
    CompatShopPage,
)
from services.cash_shift_service import CashShiftService
from services.order_service import OrderService
from services.period_report_service import PeriodReportService

PeriodLimit = Annotated[int, Field(ge=1, le=60)]


@mcp.tool(annotations=READ_ONLY)
def list_shop_orders(
    status: OrderStatus | None = None, limit: Limit = 50, offset: Offset = 0
) -> CompatShopPage:
    """Заказы из Telegram-магазина: кто заказал, что, на какую сумму и в каком
    состоянии заказ. Нужен, чтобы понять, что ждёт обработки.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_RECORDS)
        require_module(auth, db, "shop")
        limit = max(1, min(int(limit), 200))
        offset = max(0, int(offset))
        result = OrderService(db, auth.company_id).list_orders_for_company(
            status=status, limit=limit, skip=offset
        )
        return {
            **page_info(len(result.items), result.total, limit, offset),
            "orders": json_safe(result.items),
        }


@mcp.tool(annotations=READ_ONLY)
def get_shift(shift_id: Id | None = None) -> CompatShiftResult:
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
            shift = service.get_by_id(shift_id)
            if shift is None:
                raise ToolError(f"Смена №{shift_id} не найдена.")
        return {
            "shift": {
                "id": shift.id,
                "shift_number": shift.shift_number,
                "status": json_safe(shift.status),
                "opened_at": json_safe(shift.opened_at),
                "closed_at": json_safe(shift.closed_at),
                "opening_cash": money(shift.opening_cash),
                "opening_notes": shift.opening_notes,
                "expected_cash": money(shift.expected_cash),
                "counted_cash": money(shift.counted_cash),
                "discrepancy": money(shift.discrepancy),
                "notes": shift.notes,
            },
            "totals": json_safe(service.totals_for(shift)),
        }


@mcp.tool(annotations=READ_ONLY)
def run_consistency_check(
    limit: Limit = 50,
    offset: Offset = 0,
    check: str | None = None,
    bucket: Literal["drift", "known"] | None = None,
) -> CompatConsistencyPage:
    """Проверка сходимости учёта: сверяет каждую производную цифру с независимым
    источником — остатки с партиями, долги с журналом, кассу с движениями.
    `drift` означает расхождение, которое нужно чинить; `known` — записанный
    факт, вроде чека, пришедшего с кассы задним числом.
    Ничего не изменяет.
    """
    # The canonical reader enforces records scope and the admin role, and
    # keeps whole-company clean independent of filtering/pagination.
    return check_consistency(limit=limit, offset=offset, check=check, bucket=bucket)


@mcp.tool(annotations=READ_ONLY)
def list_periods(limit: PeriodLimit = 12, offset: Offset = 0) -> CompatPeriodPage:
    """Закрытые периоды — каждый закрыт своей сверкой — с тем, сколько за период
    закупили и сколько продали. Отвечает на «покажи по месяцам, что я купил и
    что продал».
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "reports", "manager")
        limit = max(1, min(int(limit), 60))
        offset = max(0, int(offset))
        result = PeriodReportService(db, auth.company_id).list(limit=limit, offset=offset)
        return {
            **page_info(len(result.periods), result.total, limit, offset),
            "periods": json_safe(result.periods),
        }


@mcp.tool(annotations=READ_ONLY)
def get_period_report(reconciliation_id: Id) -> CompatPeriodReport:
    """Отчёт по одному закрытому периоду: закуплено, продано, себестоимость,
    прибыль, списания, возвраты, кто и когда провёл сверку. Цифры считаются
    заново при каждом запросе, поэтому всегда совпадают с остальными отчётами.
    `late_arrivals` — чеки, пробитые внутри периода, но дошедшие до сервера
    после его закрытия; из-за них итог может отличаться от того, что видели
    в день сверки.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "reports", "manager")
        detail = PeriodReportService(db, auth.company_id).detail(reconciliation_id)
        if detail is None:
            raise ToolError(f"Период №{reconciliation_id} не найден.")
        if auth.role not in ("admin", "manager"):
            # A reports-manager grant alone cannot reveal the recorded checker
            # findings. Preserve the reconciliation role guard independently.
            detail.checker_report = None
        return json_safe(detail)
