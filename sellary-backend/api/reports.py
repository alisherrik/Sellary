from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from api.dependencies import AuthContext, require_module
from core.database import get_db
from schemas.purchase_report import (
    OutstandingOrderRow,
    PurchaseByProductRow,
    PurchaseBySupplierRow,
    PurchaseSummary,
)
from schemas.report import DashboardWidgets, DailySalesReport, ProfitReport, TopProductReport
from services.purchase_report_service import PurchaseReportService
from services.report_service import ReportService

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/dashboard", response_model=DashboardWidgets)
def get_dashboard_widgets(
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("reports")),
):
    service = ReportService(db, auth.company_id)
    return service.get_dashboard_widgets()


@router.get("/daily-sales", response_model=DailySalesReport)
def get_daily_sales(
    start_date: datetime = Query(None),
    end_date: datetime = Query(None),
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("reports")),
):
    service = ReportService(db, auth.company_id)
    start_date, end_date = service.default_range(start_date, end_date, days)
    return service.get_daily_sales(start_date, end_date)


@router.get("/profit", response_model=ProfitReport)
def get_profit_report(
    start_date: datetime = Query(None),
    end_date: datetime = Query(None),
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("reports")),
):
    service = ReportService(db, auth.company_id)
    start_date, end_date = service.default_range(start_date, end_date, days)
    return service.get_profit_report(start_date, end_date)


@router.get("/top-products", response_model=TopProductReport)
def get_top_products(
    start_date: datetime = Query(None),
    end_date: datetime = Query(None),
    limit: int = Query(10, ge=1, le=50),
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("reports")),
):
    service = ReportService(db, auth.company_id)
    start_date, end_date = service.default_range(start_date, end_date, days)
    return service.get_top_products(start_date, end_date, limit=limit)


# --------------------------------------------------------------- purchasing
#
# Gated on `purchasing`, not `reports`: someone who buys goods needs to see
# what they have been paying without also being given the sales analytics.


@router.get("/purchases", response_model=PurchaseSummary)
def get_purchase_summary(
    start_date: datetime = Query(None),
    end_date: datetime = Query(None),
    days: int = Query(30, ge=1, le=365),
    supplier_id: int = Query(None),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("purchasing")),
):
    """How much was spent on goods in the period, and on how many deliveries.

    Counts received goods, not placed orders: an order is an intention, a
    receipt is stock that arrived and money that is owed.
    """
    service = PurchaseReportService(db, auth.company_id)
    start_date, end_date = service.default_range(start_date, end_date, days)
    return service.summary(start_date, end_date, supplier_id)


@router.get("/purchases/by-product", response_model=list[PurchaseByProductRow])
def get_purchases_by_product(
    start_date: datetime = Query(None),
    end_date: datetime = Query(None),
    days: int = Query(30, ge=1, le=365),
    supplier_id: int = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("purchasing")),
):
    """What was bought and for how much, per product, dearest first."""
    service = PurchaseReportService(db, auth.company_id)
    start_date, end_date = service.default_range(start_date, end_date, days)
    return service.by_product(start_date, end_date, supplier_id, limit)


@router.get("/purchases/by-supplier", response_model=list[PurchaseBySupplierRow])
def get_purchases_by_supplier(
    start_date: datetime = Query(None),
    end_date: datetime = Query(None),
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("purchasing")),
):
    service = PurchaseReportService(db, auth.company_id)
    start_date, end_date = service.default_range(start_date, end_date, days)
    return service.by_supplier(start_date, end_date)


@router.get("/purchases/outstanding", response_model=list[OutstandingOrderRow])
def get_outstanding_orders(
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("purchasing")),
):
    """Orders sent but not fully received — committed, not yet bought."""
    return PurchaseReportService(db, auth.company_id).outstanding()
