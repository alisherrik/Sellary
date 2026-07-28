from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, Field, model_validator

from models.stock_write_off import DISPOSITIONS, REASON_CODES, RETURNED_TO_SUPPLIER


class WriteOffItemCreate(BaseModel):
    product_id: int
    # NULL = the product's base unit. Any other value must belong to the product.
    product_unit_id: Optional[int] = None
    # In the chosen unit; the service converts it to base units.
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
        # A return has to name who took the goods; a disposal has nobody to name,
        # and a stale supplier left on one would make the report lie.
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
