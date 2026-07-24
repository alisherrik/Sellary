from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from api.dependencies import AuthContext, require_module
from core.database import get_db
from schemas.report import DashboardWidgets, DailySalesReport, ProfitReport, TopProductReport
from services.report_service import ReportService

router = APIRouter(prefix="/reports", tags=["reports"])


def _default_range(service: ReportService, start_date, end_date, days: int):
    """Fill in a missing range as the last `days` local business days.

    Anchored on the company's clock — `datetime.now()` here would anchor on the
    server's UTC day and cut the range at the wrong boundary.
    """
    tz = service.tz()
    if not end_date:
        _, end_date = service.local_day_bounds()
    if not start_date:
        start_date, _ = service.local_day_bounds(
            datetime.now(tz).date() - timedelta(days=days)
        )
    return start_date, end_date


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
    start_date, end_date = _default_range(service, start_date, end_date, days)
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
    start_date, end_date = _default_range(service, start_date, end_date, days)
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
    start_date, end_date = _default_range(service, start_date, end_date, days)
    return service.get_top_products(start_date, end_date, limit=limit)
