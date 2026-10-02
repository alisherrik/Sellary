"""Discoverable MCP response schemas, reusing business response contracts."""

from decimal import Decimal
from datetime import datetime
from pydantic import BaseModel
from schemas.customer import Customer
from schemas.customer_ledger import CustomerLedgerResponse
from schemas.inventory_log import InventoryLog
from schemas.money import MovementOut
from schemas.purchase_order import PurchaseOrderResponse
from schemas.purchase_report import PurchaseByProductRow, PurchaseBySupplierRow, PurchaseSummary, OutstandingOrderRow
from schemas.reconciliation import ReconciliationRead
from schemas.report import DashboardWidgets, DailySalesReport, ProfitReport, TopProductReport
from schemas.sale import SaleResponse, SalesSummary
from schemas.sale_return import SaleReturnResponse
from schemas.stock_write_off import WriteOffRead, WriteOffSummaryBucket
from schemas.cash_shift import ShiftTotals
from schemas.consistency import ConsistencyReport


class Page(BaseModel):
    count: int
    total: int | None
    limit: int
    offset: int
    has_more: bool
    next_offset: int | None


class PeriodEcho(BaseModel):
    period: str | None = None
    period_label: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    timezone: str
    reconciled_from: str | None = None


class ProductRow(BaseModel):
    id: int
    name: str
    barcode: str | None
    uom: str | None
    stock_quantity: str
    min_stock_level: str
    cost_price: str
    sell_price: str
    category: str | None
    is_active: bool
    purchased_quantity: str | None = None
    sold_quantity: str | None = None
    ledger_stock_quantity: str | None = None


class ProductPage(Page):
    query: str | None = None
    products: list[ProductRow]


class SupplierRow(BaseModel):
    id: int
    name: str
    phone: str | None
    contact_person: str | None


class SupplierPage(Page):
    suppliers: list[SupplierRow]


class SaleDetail(SaleResponse):
    returns: list[SaleReturnResponse]


class SalesPage(Page, PeriodEcho):
    sales: list[SaleResponse]


class StockPage(Page, PeriodEcho):
    movements: list[InventoryLog]


class ReconciliationsPage(Page):
    reconciliations: list[ReconciliationRead]


class CustomerPage(Page):
    customers: list[Customer]


class LedgerPage(Page, PeriodEcho, CustomerLedgerResponse):
    pass


class MoneyPage(Page, PeriodEcho):
    movements: list[MovementOut]


class PurchaseOrdersPage(Page, PeriodEcho):
    orders: list[PurchaseOrderResponse]


class WriteOffPage(Page, PeriodEcho):
    write_offs: list[WriteOffRead]


class WriteOffSummaryResult(PeriodEcho):
    total_cost: Decimal
    document_count: int
    by_reason: list[WriteOffSummaryBucket]
    by_disposition: list[WriteOffSummaryBucket]


class DashboardResult(DashboardWidgets):
    company: str
    timezone: str


class SalesSummaryResult(SalesSummary, PeriodEcho):
    pass


class DailySalesResult(DailySalesReport, PeriodEcho):
    pass


class ProfitResult(ProfitReport, PeriodEcho):
    pass


class TopProductsResult(TopProductReport, PeriodEcho, Page):
    pass


class PurchaseSummaryResult(PurchaseSummary, PeriodEcho):
    pass


class PurchaseProductsPage(Page, PeriodEcho):
    rows: list[PurchaseByProductRow]


class PurchaseSuppliersPage(Page, PeriodEcho):
    rows: list[PurchaseBySupplierRow]


class OutstandingPage(Page):
    orders: list[OutstandingOrderRow]


class ShiftRow(BaseModel):
    shift_number: int
    status: str
    opened_at: datetime
    closed_at: datetime | None
    opening_cash: str
    expected_cash: str | None
    counted_cash: str | None
    discrepancy: str | None
    notes: str | None
    totals: ShiftTotals


class ShiftsPage(Page, PeriodEcho):
    total_discrepancy: str
    shifts: list[ShiftRow]


class CurrentShiftResult(BaseModel):
    is_open: bool
    message: str | None = None
    shift_number: int | None = None
    opened_at: datetime | None = None
    opening_cash: str | None = None
    totals: ShiftTotals | None = None


class ConsistencyPage(ConsistencyReport, Page):
    pass
