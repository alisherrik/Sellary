# Stock write-offs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take spoiled, broken or defective goods off the shelf as a multi-line
document that either disposes of them or hands them back to the supplier, with
the loss valued at real FIFO cost.

**Architecture:** Two new tables (`stock_write_offs` header + `stock_write_off_items`
lines) and one service that calls the existing `InventoryLedgerService.consume_fifo`
once per line. No new stock-mutation path: the ledger stays the only channel that
touches `stock_quantity` and `inventory_value`. Money accounts are untouched — a
supplier return moves goods, not money.

**Tech Stack:** FastAPI · SQLAlchemy · Alembic · Pydantic v2 · pytest · Next.js 14 App Router · TanStack Query · vitest

Spec: `docs/superpowers/specs/2026-07-28-stock-write-offs-design.md`

---

## File Structure

**Backend (`sellary-backend/`)**

| File | Responsibility |
|---|---|
| Create `models/stock_write_off.py` | Both ORM models + the allowed `REASON_CODES` / `DISPOSITIONS` constants |
| Modify `models/__init__.py` | Export the new models so Alembic and `Base.metadata` see them |
| Modify `models/supplier.py` | `write_offs` backref |
| Create `schemas/stock_write_off.py` | Request/response Pydantic models + validation rules |
| Create `repositories/stock_write_off_repository.py` | Queries: insert, get by id, filtered list, summary aggregate |
| Create `services/stock_write_off_service.py` | The rules; the only caller of `consume_fifo` for write-offs |
| Create `api/stock_write_offs.py` | Router, module guards, idempotency wrapper |
| Modify `main.py` | Register the router |
| Modify `services/report_service.py` | `write_off_cost` + `profit_after_write_offs` in the profit report |
| Modify `schemas/report.py` | Same two fields on `ProfitReport` |
| Create `alembic/versions/<rev>_stock_write_offs.py` | The two tables |

**Frontend (`sellary-frontend/`)**

| File | Responsibility |
|---|---|
| Modify `src/lib/types.ts` | `WriteOff`, `WriteOffItem`, `WriteOffSummary`, reason/disposition unions |
| Modify `src/lib/api.ts` | `writeOffsApi` |
| Modify `src/lib/moduleNav.ts` | «Списания» page under the `inventory` module |
| Create `src/lib/writeOffLabels.ts` | Russian labels for reason codes and dispositions (single source, used by list and form) |
| Create `src/app/(protected)/write-offs/page.tsx` | List + filters + «Новый акт» entry |
| Create `src/components/write-offs/WriteOffDialog.tsx` | The creation form |
| Create `src/components/write-offs/__tests__/WriteOffDialog.test.tsx` | Form validation + payload shape |

---

## Task 1: Models and migration

**Files:**
- Create: `sellary-backend/models/stock_write_off.py`
- Modify: `sellary-backend/models/__init__.py`
- Modify: `sellary-backend/models/supplier.py`
- Create: `sellary-backend/alembic/versions/<rev>_stock_write_offs.py`

- [ ] **Step 1: Write the models**

```python
# models/stock_write_off.py
from decimal import Decimal

from sqlalchemy import (
    Column, DateTime, ForeignKey, Index, Integer, Numeric, String, Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from core.database import Base

# What happened to the goods. Two axes, deliberately separate from the reason:
# a return and a disposal can share a reason ("порча") and still be different
# facts about where the goods went.
DISPOSED = "disposed"
RETURNED_TO_SUPPLIER = "returned_to_supplier"
DISPOSITIONS = (DISPOSED, RETURNED_TO_SUPPLIER)

# Why the goods left the shelf.
REASON_CODES = (
    "spoiled",        # порча
    "damaged",        # бой / повреждение при хранении
    "defective",      # заводской брак
    "expired",        # просрочка (picked by hand; no batch tracking)
    "lost",           # утеряно / кража
    "shortage",       # недостача по инвентаризации
    "internal_use",   # ушло на собственные нужды
)

# Stored as String, not a native Postgres enum: SQLite tolerates a bad enum
# value in tests and Postgres rejects it in production, which is how the money
# accounts work shipped a bug twice. Validation lives in the schema layer.


class StockWriteOff(Base):
    """One act of taking goods off the shelf.

    ``total_cost`` is a frozen fact, written once from what the FIFO ledger
    actually consumed. It is never recomputed from today's ``cost_price`` — the
    layers that fed this document may be gone tomorrow.
    """

    __tablename__ = "stock_write_offs"
    __table_args__ = (
        Index("ix_stock_write_offs_company_created", "company_id", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    disposition = Column(String(24), nullable=False)
    reason_code = Column(String(24), nullable=False)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)
    notes = Column(Text)
    total_cost = Column(Numeric(16, 4), nullable=False, default=Decimal("0.0000"))
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    company = relationship("Company")
    supplier = relationship("Supplier")
    created_by_user = relationship("User")
    items = relationship(
        "StockWriteOffItem",
        back_populates="write_off",
        cascade="all, delete-orphan",
    )


class StockWriteOffItem(Base):
    """One product line. Tenant scope is inherited through the parent, the same
    way ``sale_items`` and ``purchase_order_items`` do it."""

    __tablename__ = "stock_write_off_items"

    id = Column(Integer, primary_key=True, index=True)
    write_off_id = Column(
        Integer, ForeignKey("stock_write_offs.id"), nullable=False, index=True
    )
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    product_unit_id = Column(Integer, ForeignKey("product_units.id"), nullable=True)
    # What the user typed, in the unit they picked.
    unit_quantity = Column(Numeric(12, 3), nullable=False)
    # Base units — what actually left stock.
    quantity = Column(Numeric(10, 3), nullable=False)
    unit_cost = Column(Numeric(16, 4), nullable=False, default=Decimal("0.0000"))
    line_cost = Column(Numeric(16, 4), nullable=False, default=Decimal("0.0000"))

    write_off = relationship("StockWriteOff", back_populates="items")
    product = relationship("Product")
    product_unit = relationship("ProductUnit")
```

- [ ] **Step 2: Export the models**

In `models/__init__.py`, add alongside the existing imports and `__all__`
entries:

```python
from models.stock_write_off import StockWriteOff, StockWriteOffItem
```

- [ ] **Step 3: Verify the models import**

Run from `sellary-backend/`:
`.venv\Scripts\python.exe -m compileall models`
Expected: no errors.

- [ ] **Step 4: Find the current head, then autogenerate the migration**

Run: `.venv\Scripts\python.exe -m alembic heads`
Expected: **two** heads print. Pick the one the deployed app is pinned to
(check `railway.json` / the deploy config) and pass it explicitly:

`.venv\Scripts\python.exe -m alembic revision --autogenerate -m "stock write-offs" --head <that-head>`

Open the generated file and confirm it creates exactly `stock_write_offs` and
`stock_write_off_items` and nothing else — autogenerate picks up unrelated
drift. Delete any operation that is not one of those two tables.

- [ ] **Step 5: Apply and verify**

Run: `.venv\Scripts\python.exe -m alembic upgrade head`
Expected: no error; `\dt stock_write_off*` shows both tables.

- [ ] **Step 6: Commit**

```bash
git add sellary-backend/models/ sellary-backend/alembic/versions/
git commit -m "feat(inventory): tables for a write-off act and its lines"
```

---

## Task 2: Schemas

**Files:**
- Create: `sellary-backend/schemas/stock_write_off.py`

- [ ] **Step 1: Write the schemas**

```python
# schemas/stock_write_off.py
from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, Field, model_validator

from models.stock_write_off import DISPOSITIONS, REASON_CODES, RETURNED_TO_SUPPLIER


class WriteOffItemCreate(BaseModel):
    product_id: int
    product_unit_id: Optional[int] = None
    quantity: Decimal = Field(gt=0)


class WriteOffCreate(BaseModel):
    disposition: str
    reason_code: str
    supplier_id: Optional[int] = None
    notes: Optional[str] = None
    items: List[WriteOffItemCreate] = Field(min_length=1)

    @model_validator(mode="after")
    def check(self):
        if self.disposition not in DISPOSITIONS:
            raise ValueError(f"disposition must be one of {DISPOSITIONS}")
        if self.reason_code not in REASON_CODES:
            raise ValueError(f"reason_code must be one of {REASON_CODES}")
        # A return has to say who took the goods; a disposal has nobody to name.
        if self.disposition == RETURNED_TO_SUPPLIER and self.supplier_id is None:
            raise ValueError("supplier_id is required when returning to a supplier")
        if self.disposition != RETURNED_TO_SUPPLIER and self.supplier_id is not None:
            raise ValueError("supplier_id is only allowed on a supplier return")
        return self


class WriteOffItemRead(BaseModel):
    id: int
    product_id: int
    product_name: str
    product_unit_id: Optional[int]
    unit_name: Optional[str]
    unit_quantity: Decimal
    quantity: Decimal
    unit_cost: Decimal
    line_cost: Decimal


class WriteOffRead(BaseModel):
    id: int
    disposition: str
    reason_code: str
    supplier_id: Optional[int]
    supplier_name: Optional[str]
    notes: Optional[str]
    total_cost: Decimal
    created_by_user_id: int
    created_by_name: Optional[str]
    created_at: datetime
    items: List[WriteOffItemRead]


class WriteOffListResponse(BaseModel):
    items: List[WriteOffRead]
    total: int


class WriteOffSummaryBucket(BaseModel):
    key: str
    total_cost: Decimal
    document_count: int


class WriteOffSummary(BaseModel):
    period_start: str
    period_end: str
    total_cost: Decimal
    document_count: int
    by_reason: List[WriteOffSummaryBucket]
    by_disposition: List[WriteOffSummaryBucket]
```

- [ ] **Step 2: Verify it compiles**

Run: `.venv\Scripts\python.exe -m compileall schemas`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add sellary-backend/schemas/stock_write_off.py
git commit -m "feat(inventory): write-off request and response shapes"
```

---

## Task 3: Repository

**Files:**
- Create: `sellary-backend/repositories/stock_write_off_repository.py`

- [ ] **Step 1: Write the repository**

Follow the existing repository style (a `db: Session` in `__init__`, every
query filtered by `company_id`).

```python
# repositories/stock_write_off_repository.py
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
            .options(joinedload(StockWriteOff.items).joinedload(StockWriteOffItem.product))
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
                joinedload(StockWriteOff.items).joinedload(StockWriteOffItem.product)
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
```

- [ ] **Step 2: Commit**

```bash
git add sellary-backend/repositories/stock_write_off_repository.py
git commit -m "feat(inventory): queries for write-off documents"
```

---

## Task 4: Service — the rules

**Files:**
- Create: `sellary-backend/services/stock_write_off_service.py`
- Test: `sellary-backend/tests/integration/test_write_off_endpoints.py` (written in Task 6)

- [ ] **Step 1: Write the service**

```python
# services/stock_write_off_service.py
"""Taking goods off the shelf as a document.

A write-off is a FIFO consumption with a different consumer, so this service
calls the same ``InventoryLedgerService`` a sale does and never touches
``stock_quantity`` itself. ``allow_oversell`` is deliberately not passed: a
write-off of stock that is not there is a data error, not a historical fact.
"""

from datetime import datetime
from decimal import Decimal
from typing import List, Optional, Tuple

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
            product = self.product_repo.get_by_id_for_update(self.company_id, product_id)
            if not product:
                raise ValueError(f"Product with id {product_id} not found")

            factor = self._unit_factor(product_id, unit_id)
            quantity = (Decimal(unit_quantity) * factor).quantize(Decimal("0.001"))
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
                    unit_quantity=Decimal(unit_quantity),
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

    def _merge_lines(self, payload: WriteOffCreate) -> dict:
        """Fold repeated (product, unit) pairs so each product is locked and
        consumed once — two lines of the same product would otherwise take two
        passes over the same FIFO layers."""
        merged: dict = {}
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
        total = self.repo.total_cost(self.company_id, start_date, end_date)
        return {
            "total_cost": total,
            "document_count": sum(row[2] for row in by_disposition),
            "by_reason": [
                {"key": k, "total_cost": c, "document_count": n} for k, c, n in by_reason
            ],
            "by_disposition": [
                {"key": k, "total_cost": c, "document_count": n}
                for k, c, n in by_disposition
            ],
        }
```

- [ ] **Step 2: Verify it compiles**

Run: `.venv\Scripts\python.exe -m compileall services`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add sellary-backend/services/stock_write_off_service.py
git commit -m "feat(inventory): the rules for writing goods off"
```

---

## Task 5: API router

**Files:**
- Create: `sellary-backend/api/stock_write_offs.py`
- Modify: `sellary-backend/main.py`

- [ ] **Step 1: Write the router**

Copy the idempotency wrapper from `api/inventory.py:19-63` exactly — cached
response first, `IdempotencyConflictError` → 409, `ValueError` → 400,
`db.commit()` last.

```python
# api/stock_write_offs.py
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from api.dependencies import AuthContext, require_module
from core.database import get_db
from core.idempotency import (
    IdempotencyConflictError,
    IdempotencyService,
    require_idempotency_key,
)
from schemas.stock_write_off import (
    WriteOffCreate,
    WriteOffListResponse,
    WriteOffRead,
    WriteOffSummary,
)
from services.stock_write_off_service import StockWriteOffService

router = APIRouter(prefix="/write-offs", tags=["write-offs"])


def _to_read(write_off) -> dict:
    return {
        "id": write_off.id,
        "disposition": write_off.disposition,
        "reason_code": write_off.reason_code,
        "supplier_id": write_off.supplier_id,
        "supplier_name": write_off.supplier.name if write_off.supplier else None,
        "notes": write_off.notes,
        "total_cost": write_off.total_cost,
        "created_by_user_id": write_off.created_by_user_id,
        "created_by_name": (
            write_off.created_by_user.full_name if write_off.created_by_user else None
        ),
        "created_at": write_off.created_at,
        "items": [
            {
                "id": item.id,
                "product_id": item.product_id,
                "product_name": item.product.name if item.product else "",
                "product_unit_id": item.product_unit_id,
                "unit_name": item.product_unit.name if item.product_unit else None,
                "unit_quantity": item.unit_quantity,
                "quantity": item.quantity,
                "unit_cost": item.unit_cost,
                "line_cost": item.line_cost,
            }
            for item in write_off.items
        ],
    }


@router.post("", response_model=WriteOffRead)
def create_write_off(
    payload: WriteOffCreate,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("inventory", "manager")),
    idempotency_key: str = Depends(require_idempotency_key),
):
    endpoint = "/api/write-offs"
    request_body = payload.model_dump(mode="json")

    idempotency_service = IdempotencyService(db)
    try:
        cached = idempotency_service.get_cached_response(
            key=idempotency_key,
            company_id=auth.company_id,
            user_id=auth.user.id,
            endpoint=endpoint,
            request_body=request_body,
        )
        if cached:
            response_body, _ = cached
            return response_body
    except IdempotencyConflictError as exc:
        raise HTTPException(status_code=409, detail=exc.message)

    service = StockWriteOffService(db, auth.company_id)
    try:
        write_off = service.create(payload, auth.user.id)
        result = _to_read(write_off)
        idempotency_service.store_response(
            key=idempotency_key,
            company_id=auth.company_id,
            user_id=auth.user.id,
            endpoint=endpoint,
            request_body=request_body,
            response_body=WriteOffRead(**result).model_dump(mode="json"),
            status_code=200,
        )
        db.commit()
        return result
    except IdempotencyConflictError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=exc.message)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("", response_model=WriteOffListResponse)
def list_write_offs(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    disposition: Optional[str] = Query(None),
    reason_code: Optional[str] = Query(None),
    supplier_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("inventory")),
):
    service = StockWriteOffService(db, auth.company_id)
    rows, total = service.list(
        skip=skip,
        limit=limit,
        start_date=start_date,
        end_date=end_date,
        disposition=disposition,
        reason_code=reason_code,
        supplier_id=supplier_id,
    )
    return {"items": [_to_read(row) for row in rows], "total": total}


@router.get("/summary", response_model=WriteOffSummary)
def get_write_off_summary(
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("inventory")),
):
    from services.report_service import ReportService

    report = ReportService(db, auth.company_id)
    start, end = report.default_range(start_date, end_date, days)
    service = StockWriteOffService(db, auth.company_id)
    data = service.summary(start, end)
    return {
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        **data,
    }


@router.get("/{write_off_id}", response_model=WriteOffRead)
def get_write_off(
    write_off_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("inventory")),
):
    service = StockWriteOffService(db, auth.company_id)
    write_off = service.get(write_off_id)
    if not write_off:
        raise HTTPException(status_code=404, detail="Write-off not found")
    return _to_read(write_off)
```

**Route order matters:** `/summary` is declared before `/{write_off_id}`, or
FastAPI matches "summary" as an id and returns a 422.

- [ ] **Step 2: Reuse the reports date helper**

`api/reports.py` has a module-level `_default_range(service, start, end, days)`.
Move it onto `ReportService` as a public `default_range(start, end, days)`
method and have `api/reports.py` call `service.default_range(...)`, so
`/write-offs/summary` and the reports share one company-timezone range rule
instead of hand-rolling a second one. Update every call site in
`api/reports.py`.

- [ ] **Step 3: Register the router**

In `main.py`, next to `inventory_router`:

```python
from api.stock_write_offs import router as write_offs_router
...
    app.include_router(write_offs_router, prefix=settings.API_V1_STR)
```

- [ ] **Step 4: Verify the app imports**

Run: `.venv\Scripts\python.exe -m compileall api services main.py`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add sellary-backend/api/ sellary-backend/main.py sellary-backend/services/report_service.py
git commit -m "feat(inventory): endpoints for write-off acts"
```

---

## Task 6: Backend tests

**Files:**
- Create: `sellary-backend/tests/integration/test_write_off_endpoints.py`

The `layered_product` fixture has 5 units across two FIFO layers — 2 @ 10 then
3 @ 20 — which is what makes the cost assertion meaningful: writing off 3 units
must cost `2*10 + 1*20 = 40`, not `3 * cost_price`.

- [ ] **Step 1: Write the failing tests**

```python
from decimal import Decimal

import pytest

from models.stock_write_off import StockWriteOff


def _headers(manager_headers, key="wo-key-1"):
    return {**manager_headers, "Idempotency-Key": key}


def _payload(product_id, quantity="3", **over):
    body = {
        "disposition": "disposed",
        "reason_code": "spoiled",
        "items": [{"product_id": product_id, "quantity": quantity}],
    }
    body.update(over)
    return body


class TestWriteOffCreation:
    def test_cost_comes_from_the_fifo_layers_not_the_average(
        self, client, manager_headers, layered_product
    ):
        response = client.post(
            "/api/write-offs",
            json=_payload(layered_product.id, "3"),
            headers=_headers(manager_headers),
        )
        assert response.status_code == 200, response.text
        body = response.json()
        # 2 units from the 10-layer, 1 from the 20-layer.
        assert Decimal(body["total_cost"]) == Decimal("40.0000")
        assert Decimal(body["items"][0]["quantity"]) == Decimal("3.000")

    def test_stock_falls_by_the_written_off_quantity(
        self, client, db_session, manager_headers, layered_product
    ):
        client.post(
            "/api/write-offs",
            json=_payload(layered_product.id, "3"),
            headers=_headers(manager_headers),
        )
        db_session.refresh(layered_product)
        assert Decimal(layered_product.stock_quantity) == Decimal("2")

    def test_writing_off_more_than_is_there_is_refused(
        self, client, manager_headers, layered_product
    ):
        response = client.post(
            "/api/write-offs",
            json=_payload(layered_product.id, "99"),
            headers=_headers(manager_headers),
        )
        assert response.status_code == 400
        assert "Insufficient stock" in response.json()["detail"]

    def test_repeated_product_lines_are_merged(
        self, client, manager_headers, layered_product
    ):
        response = client.post(
            "/api/write-offs",
            json={
                "disposition": "disposed",
                "reason_code": "spoiled",
                "items": [
                    {"product_id": layered_product.id, "quantity": "1"},
                    {"product_id": layered_product.id, "quantity": "2"},
                ],
            },
            headers=_headers(manager_headers),
        )
        assert response.status_code == 200
        body = response.json()
        assert len(body["items"]) == 1
        assert Decimal(body["total_cost"]) == Decimal("40.0000")


class TestSupplierReturn:
    def test_return_records_the_supplier(
        self, client, manager_headers, layered_product, test_supplier
    ):
        response = client.post(
            "/api/write-offs",
            json=_payload(
                layered_product.id,
                "1",
                disposition="returned_to_supplier",
                reason_code="defective",
                supplier_id=test_supplier.id,
            ),
            headers=_headers(manager_headers),
        )
        assert response.status_code == 200
        assert response.json()["supplier_name"] == test_supplier.name

    def test_return_without_a_supplier_is_refused(
        self, client, manager_headers, layered_product
    ):
        response = client.post(
            "/api/write-offs",
            json=_payload(
                layered_product.id, "1", disposition="returned_to_supplier"
            ),
            headers=_headers(manager_headers),
        )
        assert response.status_code == 422

    def test_disposal_with_a_supplier_is_refused(
        self, client, manager_headers, layered_product, test_supplier
    ):
        response = client.post(
            "/api/write-offs",
            json=_payload(layered_product.id, "1", supplier_id=test_supplier.id),
            headers=_headers(manager_headers),
        )
        assert response.status_code == 422

    def test_another_companys_supplier_is_refused(
        self, client, db_session, manager_headers, layered_product, secondary_company
    ):
        from models.supplier import Supplier

        foreign = Supplier(
            company_id=secondary_company.id, name="Foreign", phone="+000"
        )
        db_session.add(foreign)
        db_session.flush()

        response = client.post(
            "/api/write-offs",
            json=_payload(
                layered_product.id,
                "1",
                disposition="returned_to_supplier",
                supplier_id=foreign.id,
            ),
            headers=_headers(manager_headers),
        )
        assert response.status_code == 400


class TestIdempotency:
    def test_replay_returns_the_same_document_and_consumes_once(
        self, client, db_session, manager_headers, layered_product
    ):
        headers = _headers(manager_headers, "wo-replay")
        first = client.post(
            "/api/write-offs", json=_payload(layered_product.id, "2"), headers=headers
        )
        second = client.post(
            "/api/write-offs", json=_payload(layered_product.id, "2"), headers=headers
        )
        assert first.status_code == 200 and second.status_code == 200
        assert first.json()["id"] == second.json()["id"]
        assert db_session.query(StockWriteOff).count() == 1
        db_session.refresh(layered_product)
        assert Decimal(layered_product.stock_quantity) == Decimal("3")


class TestAccess:
    def test_a_plain_inventory_member_cannot_create(
        self, client, cashier_headers, grant_module, cashier_user, layered_product
    ):
        grant_module(cashier_user, "inventory", "user")
        response = client.post(
            "/api/write-offs",
            json=_payload(layered_product.id, "1"),
            headers=_headers(cashier_headers),
        )
        assert response.status_code == 403

    def test_a_plain_inventory_member_can_read(
        self, client, cashier_headers, grant_module, cashier_user
    ):
        grant_module(cashier_user, "inventory", "user")
        assert client.get("/api/write-offs", headers=cashier_headers).status_code == 200
```

- [ ] **Step 2: Run them and watch them fail**

Run from `sellary-backend/`:
`.venv\Scripts\pytest.exe tests/integration/test_write_off_endpoints.py -v`
Expected before the code lands: collection errors / 404s. After Tasks 1-5: all pass.

- [ ] **Step 3: Check the `grant_module` fixture signature**

Read `tests/conftest.py:364-381` and adjust the two access tests to whatever
arguments it actually takes. Do not guess.

- [ ] **Step 4: Run the whole suite**

Run: `.venv\Scripts\pytest.exe tests/integration tests/unit -q`
Expected: no new failures against the pre-change baseline.

- [ ] **Step 5: Commit**

```bash
git add sellary-backend/tests/integration/test_write_off_endpoints.py
git commit -m "test(inventory): a write-off costs what the layers cost"
```

---

## Task 7: Profit report fields

**Files:**
- Modify: `sellary-backend/schemas/report.py:29-36`
- Modify: `sellary-backend/services/report_service.py:189-239`
- Test: `sellary-backend/tests/integration/test_write_off_endpoints.py`

- [ ] **Step 1: Write the failing test**

Append to the test file:

```python
class TestProfitReport:
    def test_write_off_cost_is_reported_beside_profit_not_inside_it(
        self, client, manager_headers, layered_product
    ):
        before = client.get("/api/reports/profit", headers=manager_headers).json()
        client.post(
            "/api/write-offs",
            json=_payload(layered_product.id, "3"),
            headers=_headers(manager_headers, "wo-profit"),
        )
        after = client.get("/api/reports/profit", headers=manager_headers).json()

        assert Decimal(after["profit"]) == Decimal(before["profit"])
        assert Decimal(after["write_off_cost"]) == Decimal("40.0000")
        assert Decimal(after["profit_after_write_offs"]) == Decimal(
            after["profit"]
        ) - Decimal("40.0000")
```

- [ ] **Step 2: Run it and watch it fail**

Run: `.venv\Scripts\pytest.exe tests/integration/test_write_off_endpoints.py::TestProfitReport -v`
Expected: `KeyError: 'write_off_cost'`.

- [ ] **Step 3: Add the two fields to the schema**

In `schemas/report.py`, on `ProfitReport`, after `sales_count`:

```python
    write_off_cost: Decimal = Decimal("0.00")
    profit_after_write_offs: Decimal = Decimal("0.00")
```

- [ ] **Step 4: Fill them in the service**

In `services/report_service.py`, inside `get_profit_report`, before the return:

```python
        from repositories.stock_write_off_repository import StockWriteOffRepository

        write_off_cost = StockWriteOffRepository(self.db).total_cost(
            self.company_id, start_date, end_date
        )
```

and in the `ProfitReport(...)` call add:

```python
            write_off_cost=write_off_cost,
            profit_after_write_offs=profit - write_off_cost,
```

`revenue`, `cost`, `profit` and `profit_margin_percent` are not touched — the
frontend and the MCP `get_profit_report` tool keep reading what they read now.

- [ ] **Step 5: Run the test**

Run: `.venv\Scripts\pytest.exe tests/integration/test_write_off_endpoints.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add sellary-backend/schemas/report.py sellary-backend/services/report_service.py sellary-backend/tests/
git commit -m "feat(reports): show what spoilage cost beside the profit"
```

---

## Task 8: Frontend types, API client, nav, labels

**Files:**
- Modify: `sellary-frontend/src/lib/types.ts`
- Modify: `sellary-frontend/src/lib/api.ts:346-353`
- Modify: `sellary-frontend/src/lib/moduleNav.ts:42-47`
- Create: `sellary-frontend/src/lib/writeOffLabels.ts`

- [ ] **Step 1: Types**

Append to `src/lib/types.ts`:

```ts
export type WriteOffDisposition = 'disposed' | 'returned_to_supplier';

export type WriteOffReason =
  | 'spoiled'
  | 'damaged'
  | 'defective'
  | 'expired'
  | 'lost'
  | 'shortage'
  | 'internal_use';

export interface WriteOffItem {
  id: number;
  product_id: number;
  product_name: string;
  product_unit_id: number | null;
  unit_name: string | null;
  unit_quantity: string;
  quantity: string;
  unit_cost: string;
  line_cost: string;
}

export interface WriteOff {
  id: number;
  disposition: WriteOffDisposition;
  reason_code: WriteOffReason;
  supplier_id: number | null;
  supplier_name: string | null;
  notes: string | null;
  total_cost: string;
  created_by_user_id: number;
  created_by_name: string | null;
  created_at: string;
  items: WriteOffItem[];
}

export interface WriteOffListResponse {
  items: WriteOff[];
  total: number;
}

export interface WriteOffSummaryBucket {
  key: string;
  total_cost: string;
  document_count: number;
}

export interface WriteOffSummary {
  period_start: string;
  period_end: string;
  total_cost: string;
  document_count: number;
  by_reason: WriteOffSummaryBucket[];
  by_disposition: WriteOffSummaryBucket[];
}
```

- [ ] **Step 2: API client**

In `src/lib/api.ts`, after `inventoryApi`:

```ts
export const writeOffsApi = {
  list: (params?: Record<string, unknown>) =>
    api.get<WriteOffListResponse>('/write-offs', { params }),
  getById: (id: number) => api.get<WriteOff>(`/write-offs/${id}`),
  getSummary: (params?: Record<string, unknown>) =>
    api.get<WriteOffSummary>('/write-offs/summary', { params }),
  create: (data: unknown, idempotencyKey?: string) => {
    const key = idempotencyKey || generateIdempotencyKey();
    return api.post<WriteOff>('/write-offs', data, {
      headers: { 'Idempotency-Key': key },
    });
  },
};
```

Add `WriteOff`, `WriteOffListResponse`, `WriteOffSummary` to the type import at
the top of the file.

- [ ] **Step 3: Nav entry**

In `src/lib/moduleNav.ts`, the `inventory` module's `pages`:

```ts
    pages: [
      { label: 'Товары', href: '/products' },
      { label: 'Списания', href: '/write-offs' },
    ],
```

- [ ] **Step 4: Labels**

```ts
// src/lib/writeOffLabels.ts
import type { WriteOffDisposition, WriteOffReason } from './types';

export const REASON_LABELS: Record<WriteOffReason, string> = {
  spoiled: 'Порча',
  damaged: 'Бой / повреждение',
  defective: 'Заводской брак',
  expired: 'Просрочка',
  lost: 'Утеряно',
  shortage: 'Недостача',
  internal_use: 'Внутреннее использование',
};

export const DISPOSITION_LABELS: Record<WriteOffDisposition, string> = {
  disposed: 'Утилизировано',
  returned_to_supplier: 'Возврат поставщику',
};

export const REASON_ORDER = Object.keys(REASON_LABELS) as WriteOffReason[];
```

- [ ] **Step 5: Typecheck**

Run from `sellary-frontend/`: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add sellary-frontend/src/lib/
git commit -m "feat(inventory): frontend contract for write-offs"
```

---

## Task 9: The creation dialog

**Files:**
- Create: `sellary-frontend/src/components/write-offs/WriteOffDialog.tsx`
- Create: `sellary-frontend/src/components/write-offs/__tests__/WriteOffDialog.test.tsx`

Model it on `src/components/finance/MoneyDialog.tsx` for the shell and on
`src/components/purchase-orders/ProductCombobox.tsx` for product search — read
both before writing.

**Component contract:**

```ts
interface WriteOffDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;   // parent invalidates the list query
}
```

Internal state: `disposition`, `reasonCode`, `supplierId`, `notes`, and
`rows: { product: Product; unitId: number | null; quantity: string }[]`.

Rules the component enforces before submitting:
- at least one row with a quantity greater than zero;
- `returned_to_supplier` requires a supplier, and the supplier select is only
  rendered for that disposition;
- switching to `disposed` clears `supplierId`, so a stale supplier cannot be
  submitted.

Submitted payload:

```ts
{
  disposition,
  reason_code: reasonCode,
  supplier_id: disposition === 'returned_to_supplier' ? supplierId : null,
  notes: notes.trim() || null,
  items: rows.map((r) => ({
    product_id: r.product.id,
    product_unit_id: r.unitId,
    quantity: r.quantity,
  })),
}
```

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/write-offs/__tests__/WriteOffDialog.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { buildWriteOffPayload, validateWriteOff } from '../WriteOffDialog';

const row = { product: { id: 7, name: 'Молоко' }, unitId: null, quantity: '2' } as never;

describe('write-off form rules', () => {
  it('refuses a supplier return with no supplier', () => {
    expect(
      validateWriteOff({
        disposition: 'returned_to_supplier',
        supplierId: null,
        rows: [row],
      }),
    ).toBe('Выберите поставщика');
  });

  it('accepts a disposal with one row', () => {
    expect(
      validateWriteOff({ disposition: 'disposed', supplierId: null, rows: [row] }),
    ).toBeNull();
  });

  it('refuses an empty document', () => {
    expect(
      validateWriteOff({ disposition: 'disposed', supplierId: null, rows: [] }),
    ).toBe('Добавьте хотя бы один товар');
  });

  it('drops the supplier from a disposal payload', () => {
    const payload = buildWriteOffPayload({
      disposition: 'disposed',
      reasonCode: 'spoiled',
      supplierId: 3,
      notes: '  ',
      rows: [row],
    });
    expect(payload.supplier_id).toBeNull();
    expect(payload.notes).toBeNull();
    expect(payload.items).toEqual([
      { product_id: 7, product_unit_id: null, quantity: '2' },
    ]);
  });
});
```

`validateWriteOff` and `buildWriteOffPayload` are exported pure functions in
`WriteOffDialog.tsx` — the rules are testable without rendering.

- [ ] **Step 2: Run it and watch it fail**

Run from `sellary-frontend/`:
`npx vitest run src/components/write-offs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Export the two pure functions plus the default dialog component. The dialog
uses `useMutation` from TanStack Query calling `writeOffsApi.create`, and
`useQuery` on `suppliersApi.getAll()` for the supplier select.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/write-offs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sellary-frontend/src/components/write-offs/
git commit -m "feat(inventory): the form for writing goods off"
```

---

## Task 10: The list page

**Files:**
- Create: `sellary-frontend/src/app/(protected)/write-offs/page.tsx`

- [ ] **Step 1: Write the page**

Read `src/app/(protected)/finance/page.tsx` first and follow its shape.

Structure:

```tsx
'use client';
// ...
export default function WriteOffsPage() {
  return (
    <ModuleGuard module="inventory">
      {/* header with «Новый акт» button (manager level only) */}
      {/* summary strip: total cost, disposed vs returned */}
      {/* filter row: disposition, reason */}
      {/* table: date · disposition badge · reason · supplier · items · cost */}
    </ModuleGuard>
  );
}
```

Data: `useQuery` on `writeOffsApi.list({ ...filters })` and
`writeOffsApi.getSummary()`. The create button opens `WriteOffDialog`; its
`onCreated` invalidates both query keys.

Gate the create button on `canAccessModule(modules, 'inventory', 'manager')` —
the API refuses a plain member, and a button that always 403s is worse than no
button.

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: the new route appears in the route list.

- [ ] **Step 4: Commit**

```bash
git add sellary-frontend/src/app/
git commit -m "feat(inventory): the write-offs page"
```

---

## Task 11: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`
- Modify: `DOCUMENTATION.md`

- [ ] **Step 1: Add an architecture note**

Add a short section to `CLAUDE.md` and the matching one in `AGENTS.md`, near
the refunds/debt note:

> ### Write-offs and supplier returns
> Spoiled or broken goods leave the shelf as a `stock_write_offs` document with
> lines. Two independent axes: `reason_code` (why it is unsellable) and
> `disposition` (`disposed` or `returned_to_supplier`). Cost is whatever
> `consume_fifo` actually consumed, frozen into `total_cost` — never
> `quantity * cost_price`. A supplier return moves **no money**: there is no
> supplier balance to reduce, so it records that the goods left and who took
> them. Write-offs never enter turnover; the profit report carries them as
> `write_off_cost` / `profit_after_write_offs` beside an unchanged `profit`.

- [ ] **Step 2: Add the endpoints to the API table in `DOCUMENTATION.md`**

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md AGENTS.md DOCUMENTATION.md
git commit -m "docs: write-offs and supplier returns"
```

---

## Task 12: Verify and ship

- [ ] **Step 1: Full backend suite**

Run from `sellary-backend/`: `.venv\Scripts\pytest.exe tests/integration tests/unit -q`
Expected: same pass/fail counts as the pre-change baseline, plus the new tests passing.

- [ ] **Step 2: Compile gate (this is what CI runs)**

Run: `.venv\Scripts\python.exe -m compileall api core models repositories schemas services main.py`

- [ ] **Step 3: Frontend suite and build**

Run from `sellary-frontend/`: `npx vitest run && npm run lint && npm run build`

- [ ] **Step 4: Merge and push**

```bash
git checkout main
git merge --no-ff feat/stock-write-offs
git push origin main
```

Pushing `main` deploys the backend on Railway, which runs the migration. Watch
the deploy, then confirm `GET /api/write-offs` answers on the deployed origin.
