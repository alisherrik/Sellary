"""Pydantic contracts for the transaction reversal (annulment) workflow.

These models are shared by both the sale-void (Task 7) and purchase-void
(Task 8) endpoints, and mirror the frontend TypeScript contracts. ``VoidRequest``
is the request body; ``VoidPreview`` is the dry-run impact/blocker report;
``VoidResult`` is the execution result.
"""
from datetime import datetime
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, Field


class VoidRequest(BaseModel):
    reason: str = Field(..., min_length=3, max_length=500)


class InventoryImpact(BaseModel):
    """Projected per-product effect of an annulment on stock and value."""

    product_id: int
    product_name: str
    quantity_change: Decimal
    value_change: Decimal
    resulting_stock: Decimal

    class Config:
        from_attributes = True


class ReversalBlocker(BaseModel):
    """A concrete reason an annulment cannot proceed (purchases only)."""

    blocker_type: Literal["sale", "inventory_adjustment", "legacy_history"]
    reference_id: Optional[int]
    product_id: int
    product_name: str
    quantity: Decimal
    created_at: Optional[datetime]
    message: str

    class Config:
        from_attributes = True


class VoidPreview(BaseModel):
    can_void: bool
    is_legacy: bool
    impacts: list[InventoryImpact]
    blockers: list[ReversalBlocker]


class VoidResult(BaseModel):
    operation_id: int
    entity_type: Literal["sale", "purchase_order"]
    entity_id: int
    status: str
    voided_at: datetime
