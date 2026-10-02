"""Read-only reporting tools.

Each tool is the MCP equivalent of a router: resolve the caller, check the
module, call a service, serialise. No business logic lives here.

Docstrings are the description the model reads when choosing between tools, so
they are written for the shopkeeper who will hear the answer — they say what the
number means, not which service produced it.
"""

from datetime import timedelta

from mcp_server import SCOPE_REPORTS
from mcp_server.context import mcp_session, require_module, require_scope
from mcp_server.periods import Period
from mcp_server.read_support import READ_ONLY, DateArg, Id, Limit, ShiftLimit, Offset, page_info, period_query
from mcp_server.serialization import json_safe, money
from mcp_server.server import mcp
from schemas.mcp_read import (DashboardResult, SalesSummaryResult, DailySalesResult,
    ProfitResult, TopProductsResult, PurchaseSummaryResult, PurchaseProductsPage,
    PurchaseSuppliersPage, OutstandingPage, ShiftsPage, CurrentShiftResult)
from schemas.money import MoneyOverview
from services.cash_shift_service import CashShiftService
from services.money_service import MoneyService
from services.purchase_report_service import PurchaseReportService
from services.report_service import ReportService
from services.sale_service import SaleService

PERIOD_ARG_DOC = (
    "Период: today, yesterday, this_week, last_week, this_month, last_month, "
    "last_7_days, last_30_days, last_90_days, this_year, custom. "
    "Для custom укажите start_date и end_date в формате ГГГГ-ММ-ДД."
)


# ----------------------------------------------------------------- продажи


@mcp.tool(annotations=READ_ONLY)
def get_dashboard() -> DashboardResult:
    """Краткая сводка за сегодня: выручка, число продаж, средний чек,
    сколько товаров заканчивается. Отвечает на вопрос «как дела сейчас».
    День закрывается по часовому поясу компании, а не по серверному времени.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "reports")
        service = ReportService(db, auth.company_id)
        widgets = service.get_dashboard_widgets()
        return {
            "company": auth.company.name,
            "timezone": str(service.tz()),
            **json_safe(widgets),
        }


@mcp.tool(annotations=READ_ONLY)
def get_sales_summary(
    period: Period = "today",
    start_date: DateArg | None = None,
    end_date: DateArg | None = None,
) -> SalesSummaryResult:
    """Итоги продаж за период: оборот, количество чеков, средний чек и разбивка
    по способам оплаты. Это главный ответ на вопрос «сколько наторговали».
    turnover — сумма чеков, refunds — возвраты по этим чекам,
    net_turnover = turnover - refunds. Возвраты привязаны к дате исходного чека.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "reports")
        report = ReportService(db, auth.company_id)
        start, end, echo = period_query(report, period, start_date, end_date)
        summary = SaleService(db, auth.company_id).get_summary(
            start_date=start, end_date=end
        )
        return {**echo, **json_safe(summary)}


@mcp.tool(annotations=READ_ONLY)
def get_daily_sales(
    period: Period = "last_30_days",
    start_date: DateArg | None = None,
    end_date: DateArg | None = None,
) -> DailySalesResult:
    """Выручка по дням за период — ряд «дата → сумма и число чеков».
    Используйте, когда нужно увидеть динамику или сравнить дни недели.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "reports")
        service = ReportService(db, auth.company_id)
        start, end, echo = period_query(service, period, start_date, end_date)
        return {**echo, **json_safe(service.get_daily_sales(start, end))}


@mcp.tool(annotations=READ_ONLY)
def get_profit_report(
    period: Period = "this_month",
    start_date: DateArg | None = None,
    end_date: DateArg | None = None,
) -> ProfitResult:
    """Прибыль за период: выручка, себестоимость проданного, валовая прибыль
    и маржа в процентах. Себестоимость берётся из FIFO-партий, то есть по той
    цене, по которой товар реально закупался, а не по текущей.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "reports")
        service = ReportService(db, auth.company_id)
        start, end, echo = period_query(service, period, start_date, end_date)
        return {**echo, **json_safe(service.get_profit_report(start, end))}


@mcp.tool(annotations=READ_ONLY)
def get_top_products(
    period: Period = "this_month",
    limit: Limit = 10,
    start_date: DateArg | None = None,
    end_date: DateArg | None = None,
    offset: Offset = 0,
) -> TopProductsResult:
    """Самые продаваемые товары за период — по количеству, с выручкой и
    прибылью. Отвечает на «что лучше всего продаётся» и «на чём мы зарабатываем».
    Прибыль считается по себестоимости на момент продажи, как в отчёте о прибыли.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "reports")
        limit = max(1, min(int(limit), 200))
        service = ReportService(db, auth.company_id)
        start, end, echo = period_query(service, period, start_date, end_date)
        result = service.get_top_products(start, end, limit=limit, offset=offset)
        return {**echo, **page_info(len(result.top_products), result.product_count, limit, offset),
                **json_safe(result)}


# ----------------------------------------------------------------- закупки


@mcp.tool(annotations=READ_ONLY)
def get_purchase_summary(
    period: Period = "this_month",
    supplier_id: Id | None = None,
    start_date: DateArg | None = None,
    end_date: DateArg | None = None,
) -> PurchaseSummaryResult:
    """Стоимость принятого товара и число поставок за период по дате прихода.
    Заказы и отменённые приходы исключены. Это стоимость закупки, а не
    фактические выплаты поставщикам: возврат поставщику не двигает деньги.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "purchasing")
        service = PurchaseReportService(db, auth.company_id)
        start, end, echo = period_query(service, period, start_date, end_date)
        end += timedelta(microseconds=1)  # Receipts use half-open calendar windows.
        return {**echo, **json_safe(service.summary(start, end, supplier_id))}


@mcp.tool(annotations=READ_ONLY)
def get_purchases_by_supplier(
    period: Period = "this_month",
    start_date: DateArg | None = None,
    end_date: DateArg | None = None,
    limit: Limit = 50,
    offset: Offset = 0,
) -> PurchaseSuppliersPage:
    """Стоимость принятых товаров по поставщикам за период, постранично.
    spend — стоимость прихода, не сумма фактических выплат поставщику.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "purchasing")
        service = PurchaseReportService(db, auth.company_id)
        start, end, echo = period_query(service, period, start_date, end_date)
        end += timedelta(microseconds=1)  # Receipts use half-open calendar windows.
        rows = service.by_supplier(start, end, limit=limit, offset=offset)
        return {**echo, **page_info(len(rows), service.supplier_count(start, end), limit, offset),
                "rows": json_safe(rows)}


@mcp.tool(annotations=READ_ONLY)
def get_purchases_by_product(
    period: Period = "this_month",
    supplier_id: Id | None = None,
    limit: Limit = 50,
    start_date: DateArg | None = None,
    end_date: DateArg | None = None,
    offset: Offset = 0,
) -> PurchaseProductsPage:
    """Что закупали и почём, по товарам, начиная с самых дорогих позиций.
    Показывает, куда уходят деньги на закупку.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "purchasing")
        limit = max(1, min(int(limit), 200))
        service = PurchaseReportService(db, auth.company_id)
        start, end, echo = period_query(service, period, start_date, end_date)
        end += timedelta(microseconds=1)  # Receipts use half-open calendar windows.
        rows = service.by_product(start, end, supplier_id, limit, offset)
        return {**echo, **page_info(len(rows), service.product_count(start, end, supplier_id), limit, offset),
                "rows": json_safe(rows)}


@mcp.tool(annotations=READ_ONLY)
def get_outstanding_orders(limit: Limit = 50, offset: Offset = 0) -> OutstandingPage:
    """Заказы поставщикам, которые отправлены, но ещё не получены полностью —
    товар в пути и деньги, которые уже обещаны.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "purchasing")
        service = PurchaseReportService(db, auth.company_id)
        rows = service.outstanding(limit, offset)
        return {**page_info(len(rows), service.outstanding_count(), limit, offset), "orders": json_safe(rows)}


# -------------------------------------------------------------------- касса


@mcp.tool(annotations=READ_ONLY)
def get_current_shift() -> CurrentShiftResult:
    """Открытая смена с текущими итогами: наличные в кассе, выручка, число
    чеков. Если открытой смены нет, возвращает is_open = false.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "register")
        service = CashShiftService(db, auth.company_id)
        shift = service.get_current()
        if shift is None:
            return {"is_open": False, "message": "Открытой смены нет."}
        return {
            "is_open": True,
            "shift_number": shift.shift_number,
            "opened_at": json_safe(shift.opened_at),
            "opening_cash": money(shift.opening_cash),
            "totals": json_safe(service.totals_for(shift)),
        }


@mcp.tool(annotations=READ_ONLY)
def list_shifts(
    period: Period = "last_7_days",
    limit: ShiftLimit = 20,
    start_date: DateArg | None = None,
    end_date: DateArg | None = None,
    offset: Offset = 0,
) -> ShiftsPage:
    """Смены за период с итогами: выручка, ожидаемая и посчитанная наличность,
    расхождение. Отрицательное расхождение означает недостачу в кассе.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "register")
        limit = max(1, min(int(limit), 100))
        service = CashShiftService(db, auth.company_id)
        report = ReportService(db, auth.company_id)
        start, end, echo = period_query(report, period, start_date, end_date)

        shifts, total, total_discrepancy = service.history(start, end, limit, offset)
        rows = []
        for shift in shifts:
            rows.append(
                {
                    "shift_number": shift.shift_number,
                    "status": json_safe(shift.status),
                    "opened_at": json_safe(shift.opened_at),
                    "closed_at": json_safe(shift.closed_at),
                    "opening_cash": money(shift.opening_cash),
                    "expected_cash": money(shift.expected_cash),
                    "counted_cash": money(shift.counted_cash),
                    "discrepancy": money(shift.discrepancy),
                    "notes": shift.notes,
                    "totals": json_safe(service.totals_for(shift)),
                }
            )

        return {
            **echo,
            **page_info(len(rows), total, limit, offset),
            "total_discrepancy": money(total_discrepancy),
            "shifts": rows,
        }


# ------------------------------------------------------------------ деньги


@mcp.tool(annotations=READ_ONLY)
def get_money_accounts() -> MoneyOverview:
    """Остатки по счетам: касса, карты, банк. Показывает, где сейчас лежат
    деньги. Остатки считаются из движений, а не хранятся отдельно, поэтому
    всегда сходятся с историей операций.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "finance")
        return json_safe(MoneyService(db, auth.company_id).overview())
