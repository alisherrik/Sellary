from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from api.dependencies import AuthContext, get_auth_context
from core.database import get_db
from schemas.report import DashboardWidgets, DailySalesReport, ProfitReport, TopProductReport
from services.report_service import ReportService

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/dashboard", response_model=DashboardWidgets)
def get_dashboard_widgets(
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    service = ReportService(db, auth.company_id)
    return service.get_dashboard_widgets()


@router.get("/daily-sales", response_model=DailySalesReport)
def get_daily_sales(
    start_date: datetime = Query(None),
    end_date: datetime = Query(None),
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    if not start_date:
        start_date = datetime.now() - timedelta(days=days)
    if not end_date:
        end_date = datetime.now()

    service = ReportService(db, auth.company_id)
    return service.get_daily_sales(start_date, end_date)


@router.get("/profit", response_model=ProfitReport)
def get_profit_report(
    start_date: datetime = Query(None),
    end_date: datetime = Query(None),
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    if not start_date:
        start_date = datetime.now() - timedelta(days=days)
    if not end_date:
        end_date = datetime.now()

    service = ReportService(db, auth.company_id)
    return service.get_profit_report(start_date, end_date)


@router.get("/top-products", response_model=TopProductReport)
def get_top_products(
    start_date: datetime = Query(None),
    end_date: datetime = Query(None),
    limit: int = Query(10, ge=1, le=50),
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    if not start_date:
        start_date = datetime.now() - timedelta(days=days)
    if not end_date:
        end_date = datetime.now()

    service = ReportService(db, auth.company_id)
    return service.get_top_products(start_date, end_date, limit=limit)
