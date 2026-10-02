"""Discoverable purchase plans and commit results; amounts remain exact strings."""

from typing import Literal

from pydantic import BaseModel, Field

from schemas.purchase_order import PurchaseOrderStatus


class ProductCandidate(BaseModel):
    product_id: int
    name: str
    barcode: str | None = None
    stock: str
    score: int


class SupplierCandidate(BaseModel):
    supplier_id: int
    name: str
    phone: str | None = None


class PurchasePreviewLine(BaseModel):
    status: Literal["matched", "ambiguous", "new"]
    query: str
    product_id: int | None = None
    product_name: str = ""
    barcode: str | None = None
    quantity: str
    uom: str
    unit_cost: str
    line_total: str
    sell_price: str | None = None
    sell_price_guessed: bool = False
    current_cost: str | None = None
    current_stock: str | None = None
    candidates: list[ProductCandidate] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class PurchasePreviewResult(BaseModel):
    supplier: str
    can_commit: bool
    draft_token: str | None = None
    next_step: str
    lines: list[PurchasePreviewLine] = Field(default_factory=list)
    supplier_candidates: list[SupplierCandidate] = Field(default_factory=list)
    line_count: int | None = None
    new_product_count: int | None = None
    ambiguous_count: int | None = None
    total_amount: str | None = None
    summary: str | None = None
    notes: list[str] = Field(default_factory=list)


class CreatedProduct(BaseModel):
    id: int
    name: str


class PurchaseCommitResult(BaseModel):
    purchase_order_id: int
    status: PurchaseOrderStatus
    supplier: str
    line_count: int
    total_amount: str
    received: bool
    created_products: list[CreatedProduct] = Field(default_factory=list)
    message: str
    replayed: bool = False
