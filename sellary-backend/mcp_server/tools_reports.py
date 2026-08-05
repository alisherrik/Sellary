"""Read-only reporting tools.

Each tool is the MCP equivalent of a router: resolve the caller, check the
module, call a service, serialise. No business logic lives here.

Docstrings are the description the model reads when choosing between tools, so
they are written for the shopkeeper who will hear the answer — they say what the
number means, not which service produced it.
"""

from decimal import Decimal

from mcp_server import SCOPE_REPORTS
from mcp_server.context import mcp_session, require_module, require_scope
from mcp_server.periods import resolve_period
from mcp_server.serialization import json_safe, money
from mcp_server.server import mcp
from models.cash_shift import CashShift as CashShiftModel
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


@mcp.tool
def get_dashboard() -> dict:
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


@mcp.tool
def get_sales_summary(
    period: str = "today",
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    """Итоги продаж за период: оборот, количество чеков, средний чек и разбивка
    по способам оплаты. Это главный ответ на вопрос «сколько наторговали».
    Возвраты уже вычтены — это чистая выручка, а не сумма пробитых чеков.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "reports")
        report = ReportService(db, auth.company_id)
        start, end, echo = resolve_period(report, period, start_date, end_date)
        summary = SaleService(db, auth.company_id).get_summary(
            start_date=start, end_date=end
        )
        return {**echo, **json_safe(summary)}


@mcp.tool
def get_daily_sales(
    period: str = "last_30_days",
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    """Выручка по дням за период — ряд «дата → сумма и число чеков».
    Используйте, когда нужно увидеть динамику или сравнить дни недели.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "reports")
        service = ReportService(db, auth.company_id)
        start, end, echo = resolve_period(service, period, start_date, end_date)
        return {**echo, **json_safe(service.get_daily_sales(start, end))}


@mcp.tool
def get_profit_report(
    period: str = "this_month",
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    """Прибыль за период: выручка, себестоимость проданного, валовая прибыль
    и маржа в процентах. Себестоимость берётся из FIFO-партий, то есть по той
    цене, по которой товар реально закупался, а не по текущей.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "reports")
        service = ReportService(db, auth.company_id)
        start, end, echo = resolve_period(service, period, start_date, end_date)
        return {**echo, **json_safe(service.get_profit_report(start, end))}


@mcp.tool
def get_top_products(
    period: str = "this_month",
    limit: int = 10,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    """Самые продаваемые товары за период — по количеству, с выручкой и
    прибылью. Отвечает на «что лучше всего продаётся» и «на чём мы зарабатываем».
    Прибыль считается по себестоимости на момент продажи, как в отчёте о прибыли.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "reports")
        limit = max(1, min(int(limit), 50))
        service = ReportService(db, auth.company_id)
        start, end, echo = resolve_period(service, period, start_date, end_date)
        return {
            **echo,
            **json_safe(service.get_top_products(start, end, limit=limit)),
        }


# ----------------------------------------------------------------- закупки


@mcp.tool
def get_purchase_summary(
    period: str = "this_month",
    supplier_id: int | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    """Сколько потрачено на товар за период и сколько было поставок.
    Считается по принятому товару, а не по оформленным заказам: заказ — это
    намерение, а приход — это товар на складе и деньги, которые вы должны.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "purchasing")
        service = PurchaseReportService(db, auth.company_id)
        start, end, echo = resolve_period(service, period, start_date, end_date)
        return {**echo, **json_safe(service.summary(start, end, supplier_id))}


@mcp.tool
def get_purchases_by_supplier(
    period: str = "this_month",
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    """Расходы на закупку в разрезе поставщиков за период — кому сколько
    заплачено и сколько было поставок.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "purchasing")
        service = PurchaseReportService(db, auth.company_id)
        start, end, echo = resolve_period(service, period, start_date, end_date)
        return {**echo, "rows": json_safe(service.by_supplier(start, end))}


@mcp.tool
def get_purchases_by_product(
    period: str = "this_month",
    supplier_id: int | None = None,
    limit: int = 50,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    """Что закупали и почём, по товарам, начиная с самых дорогих позиций.
    Показывает, куда уходят деньги на закупку.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "purchasing")
        limit = max(1, min(int(limit), 500))
        service = PurchaseReportService(db, auth.company_id)
        start, end, echo = resolve_period(service, period, start_date, end_date)
        return {
            **echo,
            "rows": json_safe(service.by_product(start, end, supplier_id, limit)),
        }


@mcp.tool
def get_outstanding_orders() -> dict:
    """Заказы поставщикам, которые отправлены, но ещё не получены полностью —
    товар в пути и деньги, которые уже обещаны.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "purchasing")
        rows = PurchaseReportService(db, auth.company_id).outstanding()
        return {"count": len(rows), "orders": json_safe(rows)}


# -------------------------------------------------------------------- касса


@mcp.tool
def get_current_shift() -> dict:
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


@mcp.tool
def list_shifts(
    period: str = "last_7_days",
    limit: int = 20,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    """Смены за период с итогами: выручка, ожидаемая и посчитанная наличность,
    расхождение. Отрицательное расхождение означает недостачу в кассе.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "register")
        limit = max(1, min(int(limit), 100))
        service = CashShiftService(db, auth.company_id)
        report = ReportService(db, auth.company_id)
        start, end, echo = resolve_period(report, period, start_date, end_date)

        shifts = (
            db.query(CashShiftModel)
            .filter(
                CashShiftModel.company_id == auth.company_id,
                CashShiftModel.opened_at >= start,
                CashShiftModel.opened_at <= end,
            )
            .order_by(CashShiftModel.opened_at.desc())
            .limit(limit)
            .all()
        )

        rows = []
        total_discrepancy = Decimal("0.00")
        for shift in shifts:
            if shift.discrepancy is not None:
                total_discrepancy += Decimal(str(shift.discrepancy))
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
            "count": len(rows),
            "total_discrepancy": money(total_discrepancy),
            "shifts": rows,
        }


# ------------------------------------------------------------------ деньги


@mcp.tool
def get_money_accounts() -> dict:
    """Остатки по счетам: касса, карты, банк. Показывает, где сейчас лежат
    деньги. Остатки считаются из движений, а не хранятся отдельно, поэтому
    всегда сходятся с историей операций.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "finance")
        return json_safe(MoneyService(db, auth.company_id).overview())
