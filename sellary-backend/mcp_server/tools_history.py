"""Read business documents and histories through company-scoped services."""

from datetime import timedelta
from typing import Literal
from fastmcp.exceptions import ToolError

from mcp_server import SCOPE_RECORDS, SCOPE_REPORTS
from mcp_server.context import mcp_session, require_module, require_scope
from mcp_server.periods import Period
from mcp_server.read_support import READ_ONLY, DateArg, Id, Limit, Offset, page_info, period_query
from mcp_server.serialization import json_safe
from mcp_server.server import mcp
from schemas.consistency import ConsistencyReport, FindingOut
from schemas.mcp_read import (ConsistencyPage, CustomerPage, LedgerPage, MoneyPage, PurchaseOrdersPage,
    ReconciliationsPage, SaleDetail, SalesPage, StockPage, WriteOffPage, WriteOffSummaryResult)
from schemas.purchase_order import PurchaseOrderResponse, PurchaseOrderStatus
from schemas.reconciliation import ReconciliationRead
from schemas.sale import PaymentMethod, SaleStatus
from schemas.stock_write_off import WriteOffRead
from services.company_time import utc_now
from services.customer_ledger_service import CustomerLedgerService
from services.customer_service import CustomerService
from services.inventory_service import InventoryService
from services.money_service import MoneyService
from services.purchase_order_service import PurchaseOrderService
from services.reconciliation_service import ReconciliationService
from services.report_service import ReportService
from services.sale_return_service import SaleReturnService
from services.sale_service import SaleService
from services.stock_write_off_service import StockWriteOffService


def _access(auth, db, module):
    require_scope(auth, SCOPE_RECORDS)
    require_module(auth, db, module)


@mcp.tool(annotations=READ_ONLY)
def list_sales(period: Period | None = None, start_date: DateArg | None = None,
               end_date: DateArg | None = None, sale_id: Id | None = None,
               cashier_id: Id | None = None, status: SaleStatus | None = None,
               payment_method: PaymentMethod | None = None, query: str | None = None,
               limit: Limit = 50, offset: Offset = 0,
               search: str | None = None) -> SalesPage:
    """Чеки постранично: даты, кассир, статус, способ оплаты и поиск.
    Без периода — открытый период после сверки; явный период читает историю.
    sale_id находит конкретный чек в том числе до сверки. Оплаты берутся из tenders.
    """
    with mcp_session() as (db, auth):
        _access(auth, db, "sales")
        start, end, echo = period_query(ReportService(db, auth.company_id), period, start_date, end_date)
        rows, total = SaleService(db, auth.company_id).get_all(skip=offset, limit=limit,
            start_date=start, end_date=end, sale_id=sale_id, cashier_id=cashier_id,
            status=status, payment_method=payment_method,
            search=query if query is not None else search)
        return {**echo, **page_info(len(rows), total, limit, offset), "sales": json_safe(rows)}


@mcp.tool(annotations=READ_ONLY)
def get_sale(sale_id: Id) -> SaleDetail:
    """Чек по ID: товары, отдельные способы оплаты, долг, возвраты и отмена.
    Для движений остатка этого чека используйте list_stock_movements(sale_id=...).
    """
    with mcp_session() as (db, auth):
        _access(auth, db, "sales")
        row = SaleService(db, auth.company_id).get_by_id(sale_id)
        if row is None:
            raise ToolError("Чек не найден.")
        return {**json_safe(row), "returns": json_safe(
            SaleReturnService(db, auth.company_id).get_returns_for_sale(sale_id))}


@mcp.tool(annotations=READ_ONLY)
def list_stock_movements(product_id: Id | None = None, sale_id: Id | None = None,
                         reference_type: str | None = None, period: Period | None = None,
                         start_date: DateArg | None = None, end_date: DateArg | None = None,
                         limit: Limit = 50, offset: Offset = 0) -> StockPage:
    """История остатков: приход, продажа, возврат, списание, корректировка.
    Фильтр по товару, чеку, типу операции и локальным датам. sale_id исключает
    закупки с совпавшим номером. Без периода возвращает всю историю постранично.
    """
    with mcp_session() as (db, auth):
        _access(auth, db, "inventory")
        start, end, echo = period_query(ReportService(db, auth.company_id), period, start_date, end_date)
        rows, total = InventoryService(db, auth.company_id).get_logs(skip=offset, limit=limit,
            product_id=product_id, sale_id=sale_id, reference_type=reference_type,
            start_date=start, end_date=end)
        return {**echo, **page_info(len(rows), total, limit, offset), "movements": json_safe(rows)}


def _reconciliation_access(auth):
    require_scope(auth, SCOPE_REPORTS)
    if auth.role not in ("admin", "manager"):
        raise ToolError("Сверки доступны руководителю и администратору.")


@mcp.tool(annotations=READ_ONLY)
def list_reconciliations(limit: Limit = 50, offset: Offset = 0) -> ReconciliationsPage:
    """История документов сверки и дат закрытия, от новых к старым.
    effective_from — первый открытый местный день. Только руководитель/администратор.
    """
    with mcp_session() as (db, auth):
        _reconciliation_access(auth)
        rows, total = ReconciliationService(db, auth.company_id).history_page(limit, offset)
        return {**page_info(len(rows), total, limit, offset), "reconciliations": [
            json_safe(ReconciliationRead.model_validate(row)) for row in rows]}


@mcp.tool(annotations=READ_ONLY)
def get_reconciliation(reconciliation_id: Id | None = None) -> ReconciliationRead:
    """Документ сверки по ID; без ID — последняя сверка компании.
    Читает дату и комментарий, не закрывает период и не меняет остатки.
    """
    with mcp_session() as (db, auth):
        _reconciliation_access(auth)
        service = ReconciliationService(db, auth.company_id)
        row = service.get_by_id(reconciliation_id) if reconciliation_id is not None else service.latest()
        if row is None:
            raise ToolError("Сверка не найдена.")
        return json_safe(ReconciliationRead.model_validate(row))


@mcp.tool(annotations=READ_ONLY)
def check_consistency(limit: Limit = 50, offset: Offset = 0, check: str | None = None,
                      bucket: Literal["drift", "known"] | None = None) -> ConsistencyPage:
    """Проверить остатки, FIFO, долги и деньги по независимым источникам.
    Только администратор. drift означает расхождение; known — известный факт.
    Ничего не исправляет и не выбирает, какой из двух остатков считать верным.
    clean относится ко всей проверке; findings — выбранная страница/фильтр.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_RECORDS)
        if auth.role != "admin":
            raise ToolError("Проверка согласованности доступна только администратору.")
        findings = ReconciliationService(db, auth.company_id).check()
        clean = not any(f.bucket == "drift" for f in findings)
        selected = [f for f in findings if (check is None or f.check == check)
                    and (bucket is None or f.bucket == bucket)]
        page = selected[offset:offset + limit]
        return json_safe(ConsistencyPage(checked_at=utc_now(), clean=clean,
            **page_info(len(page), len(selected), limit, offset),
            findings=[FindingOut(**f.__dict__) for f in page]))


@mcp.tool(annotations=READ_ONLY)
def list_customers(query: str | None = None, limit: Limit = 50,
                   offset: Offset = 0) -> CustomerPage:
    """Активные клиенты с поиском по имени, телефону, почте; balance — текущий долг
    по всей истории клиента. Для операций используйте get_customer_ledger.
    """
    with mcp_session() as (db, auth):
        _access(auth, db, "customers")
        rows, total = CustomerService(db, auth.company_id).get_all(offset, limit, query)
        return {**page_info(len(rows), total, limit, offset), "customers": json_safe(rows)}


@mcp.tool(annotations=READ_ONLY)
def get_customer_ledger(customer_id: Id, period: Period | None = None,
                        start_date: DateArg | None = None, end_date: DateArg | None = None,
                        limit: Limit = 50, offset: Offset = 0) -> LedgerPage:
    """История долга клиента: покупки в долг, погашения и корректировки.
    balance — текущий долг по всей истории, entries — операции выбранного периода.
    sale_tender означает деньги при покупке; payment — последующее погашение.
    """
    with mcp_session() as (db, auth):
        _access(auth, db, "customers")
        start, end, echo = period_query(ReportService(db, auth.company_id), period, start_date, end_date)
        try:
            row, total = CustomerLedgerService(db, auth.company_id).get_customer_ledger_page(
                customer_id, limit, offset, start, end)
        except ValueError as exc:
            raise ToolError("Клиент не найден.") from exc
        return {**echo, **page_info(len(row.entries), total, limit, offset), **json_safe(row)}


@mcp.tool(annotations=READ_ONLY)
def list_money_movements(account_id: Id | None = None, period: Period | None = None,
                         start_date: DateArg | None = None, end_date: DateArg | None = None,
                         limit: Limit = 50, offset: Offset = 0) -> MoneyPage:
    """Ручные операции финансовых счетов: расходы, поступления, переводы,
    пересчёты. Продажи и погашения долга читаются через get_sale и get_customer_ledger.
    total=null: для продолжения используйте has_more и next_offset.
    """
    with mcp_session() as (db, auth):
        _access(auth, db, "finance")
        start, end, echo = period_query(ReportService(db, auth.company_id), period, start_date, end_date)
        # Money history uses a half-open window; company calendar tools expose
        # inclusive local days, including their last representable instant.
        exclusive_end = end + timedelta(microseconds=1) if end else None
        rows = MoneyService(db, auth.company_id).history(account_id, start, exclusive_end, limit + 1, offset)
        more = len(rows) > limit
        rows = rows[:limit]
        return {**echo, **page_info(len(rows), None, limit, offset, has_more=more),
                "movements": json_safe(rows)}


@mcp.tool(annotations=READ_ONLY)
def list_purchase_orders(supplier_id: Id | None = None, status: PurchaseOrderStatus | None = None,
                          period: Period | None = None, start_date: DateArg | None = None,
                          end_date: DateArg | None = None, limit: Limit = 50,
                          offset: Offset = 0) -> PurchaseOrdersPage:
    """Документы закупок постранично, по поставщику, статусу и дате заказа.
    Для фактических приходов и стоимости используйте get_purchase_summary.
    """
    with mcp_session() as (db, auth):
        _access(auth, db, "purchasing")
        start, end, echo = period_query(ReportService(db, auth.company_id), period, start_date, end_date)
        rows, total = PurchaseOrderService(db, auth.company_id).get_all(skip=offset, limit=limit,
            supplier_id=supplier_id, status=status, start_date=start.isoformat() if start else None,
            end_date=end.isoformat() if end else None)
        return {**echo, **page_info(len(rows), total, limit, offset), "orders": json_safe(rows)}


@mcp.tool(annotations=READ_ONLY)
def get_purchase_order(order_id: Id | None = None,
                       purchase_order_id: Id | None = None) -> PurchaseOrderResponse:
    """Заказ поставщику по ID: товары, цены, заказанное и полученное количество,
    статус и отменённые строки. Читает документ, не принимает товар.
    """
    with mcp_session() as (db, auth):
        _access(auth, db, "purchasing")
        if order_id is None and purchase_order_id is None:
            raise ToolError("Укажите purchase_order_id.")
        if order_id is not None and purchase_order_id is not None and order_id != purchase_order_id:
            raise ToolError("order_id и purchase_order_id должны совпадать.")
        row = PurchaseOrderService(db, auth.company_id).get_by_id(
            order_id if order_id is not None else purchase_order_id)
        if row is None:
            raise ToolError("Заказ не найден.")
        return json_safe(row)


@mcp.tool(annotations=READ_ONLY)
def list_write_offs(period: Period | None = None, start_date: DateArg | None = None,
                    end_date: DateArg | None = None, disposition: str | None = None,
                    reason_code: str | None = None, supplier_id: Id | None = None,
                    limit: Limit = 50, offset: Offset = 0) -> WriteOffPage:
    """Списания и возвраты поставщику: документы, причина, направление и FIFO-стоимость.
    Возврат поставщику не означает движение денег. Список продолжается через next_offset.
    """
    with mcp_session() as (db, auth):
        _access(auth, db, "inventory")
        start, end, echo = period_query(ReportService(db, auth.company_id), period, start_date, end_date)
        service = StockWriteOffService(db, auth.company_id)
        rows, total = service.list(start_date=start, end_date=end, disposition=disposition,
            reason_code=reason_code, supplier_id=supplier_id, skip=offset, limit=limit)
        return {**echo, **page_info(len(rows), total, limit, offset), "write_offs": [
            json_safe(service.to_read(row)) for row in rows]}


@mcp.tool(annotations=READ_ONLY)
def get_write_off(write_off_id: Id) -> WriteOffRead:
    """Документ списания/возврата поставщику по ID, со строками и замороженной FIFO-стоимостью.
    """
    with mcp_session() as (db, auth):
        _access(auth, db, "inventory")
        service = StockWriteOffService(db, auth.company_id)
        row = service.get(write_off_id)
        if row is None:
            raise ToolError("Списание не найдено.")
        return json_safe(service.to_read(row))


@mcp.tool(annotations=READ_ONLY)
def get_write_off_summary(period: Period = "this_month", start_date: DateArg | None = None,
                          end_date: DateArg | None = None) -> WriteOffSummaryResult:
    """FIFO-стоимость списаний за период, по причинам и направлениям.
    Эти расходы не входят в оборот; прибыль после них — profit_after_write_offs.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "inventory")
        start, end, echo = period_query(ReportService(db, auth.company_id), period, start_date, end_date)
        return {**echo, **json_safe(StockWriteOffService(db, auth.company_id).summary(start, end))}
