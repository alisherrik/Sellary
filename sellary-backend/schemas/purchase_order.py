from decimal import Decimal
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from enum import Enum


class PurchaseOrderStatus(str, Enum):
    DRAFT = "draft"
    SENT = "sent"
    PARTIALLY_RECEIVED = "partially_received"
    RECEIVED = "received"
    CANCELLED = "cancelled"


class PurchaseOrderItemBase(BaseModel):
    product_id: int = Field(..., gt=0)
    quantity_ordered: Decimal = Field(..., gt=0, decimal_places=3)
    unit_cost: Decimal = Field(..., ge=0, decimal_places=2)


class PurchaseOrderItemCreate(PurchaseOrderItemBase):
    pass


class PurchaseOrderItemResponse(PurchaseOrderItemBase):
    id: int
    quantity_received: Decimal
    subtotal: Decimal
    product: Optional[dict] = None

    class Config:
        from_attributes = True


class PurchaseOrderBase(BaseModel):
    supplier_id: int = Field(..., gt=0)
    expected_delivery_date: Optional[datetime] = None
    notes: Optional[str] = None


class PurchaseOrderCreate(PurchaseOrderBase):
    items: List[PurchaseOrderItemCreate] = Field(..., min_length=1)


class PurchaseOrderUpdate(BaseModel):
    supplier_id: Optional[int] = Field(None, gt=0)
    expected_delivery_date: Optional[datetime] = None
    notes: Optional[str] = None
    items: Optional[List[PurchaseOrderItemCreate]] = None


class ReceiveItemsRequest(BaseModel):
    items: List[dict] = Field(..., min_length=1)
    # Each item should have: {"item_id": int, "quantity_to_receive": int}


class PurchaseOrder(PurchaseOrderBase):
    id: int
    order_date: datetime
    expected_delivery_date: Optional[datetime] = None
    status: PurchaseOrderStatus
    total_amount: Decimal
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None
    voided_at: Optional[datetime] = None
    voided_by_user_id: Optional[int] = None
    void_reason: Optional[str] = None
    reversal_operation_id: Optional[int] = None

    class Config:
        from_attributes = True


class PurchaseOrderResponse(PurchaseOrder):
    supplier: Optional[dict] = None
    items: List[PurchaseOrderItemResponse] = []
