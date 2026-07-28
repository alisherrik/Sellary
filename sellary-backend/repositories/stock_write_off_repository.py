from datetime import datetime
from decimal import Decimal
from typing import List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from models.stock_write_off import StockWriteOff, StockWriteOffItem


class StockWriteOffRepository:
    def __init__(self, db: Session):
        self.db = db

    def add(self, write_off: StockWriteOff) -> StockWriteOff:
        self.db.add(write_off)
        self.db.flush()
        return write_off

    def get_by_id(self, company_id: int, write_off_id: int) -> Optional[StockWriteOff]:
        return (
            self.db.query(StockWriteOff)
            .options(
                joinedload(StockWriteOff.items).joinedload(StockWriteOffItem.product),
                joinedload(StockWriteOff.items).joinedload(
                    StockWriteOffItem.product_unit
                ),
                joinedload(StockWriteOff.supplier),
                joinedload(StockWriteOff.created_by_user),
            )
            .filter(
                StockWriteOff.company_id == company_id,
                StockWriteOff.id == write_off_id,
            )
            .first()
        )

    def list(
        self,
        company_id: int,
        skip: int = 0,
        limit: int = 50,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        disposition: Optional[str] = None,
        reason_code: Optional[str] = None,
        supplier_id: Optional[int] = None,
    ) -> Tuple[List[StockWriteOff], int]:
        query = self.db.query(StockWriteOff).filter(
            StockWriteOff.company_id == company_id
        )
        if start_date is not None:
            query = query.filter(StockWriteOff.created_at >= start_date)
        if end_date is not None:
            query = query.filter(StockWriteOff.created_at <= end_date)
        if disposition:
            query = query.filter(StockWriteOff.disposition == disposition)
        if reason_code:
            query = query.filter(StockWriteOff.reason_code == reason_code)
        if supplier_id:
            query = query.filter(StockWriteOff.supplier_id == supplier_id)

        total = query.count()
        rows = (
            query.options(
                joinedload(StockWriteOff.items).joinedload(StockWriteOffItem.product),
                joinedload(StockWriteOff.items).joinedload(
                    StockWriteOffItem.product_unit
                ),
                joinedload(StockWriteOff.supplier),
                joinedload(StockWriteOff.created_by_user),
            )
            .order_by(StockWriteOff.created_at.desc(), StockWriteOff.id.desc())
            .offset(skip)
            .limit(limit)
            .all()
        )
        return rows, total

    def totals_by(
        self,
        company_id: int,
        column,
        start_date: datetime,
        end_date: datetime,
    ) -> List[tuple]:
        """Cost and document count grouped by one header column."""
        return (
            self.db.query(
                column,
                func.coalesce(func.sum(StockWriteOff.total_cost), Decimal("0.0000")),
                func.count(StockWriteOff.id),
            )
            .filter(
                StockWriteOff.company_id == company_id,
                StockWriteOff.created_at >= start_date,
                StockWriteOff.created_at <= end_date,
            )
            .group_by(column)
            .all()
        )

    def total_cost(
        self, company_id: int, start_date: datetime, end_date: datetime
    ) -> Decimal:
        return (
            self.db.query(
                func.coalesce(func.sum(StockWriteOff.total_cost), Decimal("0.0000"))
            )
            .filter(
                StockWriteOff.company_id == company_id,
                StockWriteOff.created_at >= start_date,
                StockWriteOff.created_at <= end_date,
            )
            .scalar()
        ) or Decimal("0.0000")
