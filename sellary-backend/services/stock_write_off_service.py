"""Taking goods off the shelf as a document.

A write-off is a FIFO consumption with a different consumer, so this service
calls the same ``InventoryLedgerService`` a sale does and never touches
``stock_quantity`` itself — that second channel is how stock once drifted from
its layers.

``allow_oversell`` is deliberately not passed: writing off stock that is not
there is a data error, not a historical fact the way an offline sale is.
"""

from datetime import datetime
from decimal import Decimal
from typing import Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from models.product_unit import ProductUnit
from models.stock_write_off import (
    RETURNED_TO_SUPPLIER,
    StockWriteOff,
    StockWriteOffItem,
)
from models.supplier import Supplier
from repositories.product_repository import ProductRepository
from repositories.stock_write_off_repository import StockWriteOffRepository
from schemas.stock_write_off import WriteOffCreate
from services.inventory_ledger_service import InventoryLedgerService
from services.tenant import resolve_company_id

MONEY_QUANT = Decimal("0.0001")
QTY_QUANT = Decimal("0.001")


class StockWriteOffService:
    def __init__(self, db: Session, company_id: int | None = None):
        self.db = db
        self.company_id = resolve_company_id(db, company_id)
        self.repo = StockWriteOffRepository(db)
        self.product_repo = ProductRepository(db)
        self.ledger = InventoryLedgerService(db, self.company_id)

    def create(self, payload: WriteOffCreate, user_id: int) -> StockWriteOff:
        supplier = self._resolve_supplier(payload)
        lines = self._merge_lines(payload)

        write_off = StockWriteOff(
            company_id=self.company_id,
            disposition=payload.disposition,
            reason_code=payload.reason_code,
            supplier_id=supplier.id if supplier else None,
            notes=payload.notes,
            total_cost=Decimal("0.0000"),
            created_by_user_id=user_id,
        )
        self.repo.add(write_off)

        total = Decimal("0.0000")
        for (product_id, unit_id), unit_quantity in lines.items():
            product = self.product_repo.get_by_id_for_update(
                self.company_id, product_id
            )
            if not product:
                raise ValueError(f"Product with id {product_id} not found")

            factor = self._unit_factor(product_id, unit_id)
            quantity = (unit_quantity * factor).quantize(QTY_QUANT)
            if quantity <= 0:
                raise ValueError("Quantity must be greater than zero")

            consumption = self.ledger.consume_fifo(
                product=product,
                quantity=quantity,
                consumer_type="write_off",
                consumer_id=write_off.id,
                sale_item_id=None,
                user_id=user_id,
                reason=payload.reason_code,
                reference_type="write_off",
                reference_id=write_off.id,
            )
            line_cost = Decimal(consumption.value).quantize(MONEY_QUANT)
            self.db.add(
                StockWriteOffItem(
                    write_off_id=write_off.id,
                    product_id=product_id,
                    product_unit_id=unit_id,
                    unit_quantity=unit_quantity,
                    quantity=quantity,
                    unit_cost=(line_cost / quantity).quantize(MONEY_QUANT),
                    line_cost=line_cost,
                )
            )
            total += line_cost

        write_off.total_cost = total.quantize(MONEY_QUANT)
        self.db.flush()
        self.db.refresh(write_off)
        return write_off

    def _resolve_supplier(self, payload: WriteOffCreate) -> Optional[Supplier]:
        if payload.disposition != RETURNED_TO_SUPPLIER:
            return None
        supplier = (
            self.db.query(Supplier)
            .filter(
                Supplier.company_id == self.company_id,
                Supplier.id == payload.supplier_id,
            )
            .first()
        )
        if not supplier:
            raise ValueError(f"Supplier with id {payload.supplier_id} not found")
        return supplier

    def _merge_lines(self, payload: WriteOffCreate) -> Dict[Tuple[int, Optional[int]], Decimal]:
        """Fold repeated (product, unit) pairs.

        Two lines of the same product would otherwise lock and walk the same
        FIFO layers twice, and the second pass would see stock the first had
        already taken.
        """
        merged: Dict[Tuple[int, Optional[int]], Decimal] = {}
        for item in payload.items:
            key = (item.product_id, item.product_unit_id)
            merged[key] = merged.get(key, Decimal("0")) + Decimal(item.quantity)
        return merged

    def _unit_factor(self, product_id: int, unit_id: Optional[int]) -> Decimal:
        if unit_id is None:
            return Decimal("1")
        unit = (
            self.db.query(ProductUnit)
            .filter(ProductUnit.id == unit_id, ProductUnit.product_id == product_id)
            .first()
        )
        if not unit:
            raise ValueError(f"Unit {unit_id} does not belong to product {product_id}")
        return Decimal(unit.factor)

    def get(self, write_off_id: int) -> Optional[StockWriteOff]:
        return self.repo.get_by_id(self.company_id, write_off_id)

    def list(self, **filters) -> Tuple[List[StockWriteOff], int]:
        return self.repo.list(self.company_id, **filters)

    def summary(self, start_date: datetime, end_date: datetime) -> dict:
        by_reason = self.repo.totals_by(
            self.company_id, StockWriteOff.reason_code, start_date, end_date
        )
        by_disposition = self.repo.totals_by(
            self.company_id, StockWriteOff.disposition, start_date, end_date
        )
        return {
            "total_cost": self.repo.total_cost(self.company_id, start_date, end_date),
            "document_count": sum(row[2] for row in by_disposition),
            "by_reason": [
                {"key": key, "total_cost": cost, "document_count": count}
                for key, cost, count in by_reason
            ],
            "by_disposition": [
                {"key": key, "total_cost": cost, "document_count": count}
                for key, cost, count in by_disposition
            ],
        }
