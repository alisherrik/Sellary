from decimal import Decimal
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class DailySalesData(BaseModel):
    date: str
    sales_count: int
    total_sales: Decimal
    total_profit: Decimal


class DailySalesReport(BaseModel):
    period_start: str
    period_end: str
    data: List[DailySalesData]
    total_sales: Decimal
    total_profit: Decimal
    sales_count: int


class ProfitReport(BaseModel):
    period_start: str
    period_end: str
    revenue: Decimal
    cost: Decimal
    profit: Decimal
    profit_margin_percent: Decimal
    sales_count: int


class TopProductItem(BaseModel):
    product_id: int
    product_name: str
    barcode: str
    quantity_sold: int
    revenue: Decimal
    profit: Decimal


class TopProductReport(BaseModel):
    period_start: str
    period_end: str
    top_products: List[TopProductItem]


class InventoryValuationItem(BaseModel):
    product_id: int
    product_name: str
    barcode: str
    stock_quantity: int
    cost_price: Decimal
    total_value: Decimal


class InventoryValuationReport(BaseModel):
    total_value: Decimal
    total_products: int
    total_items: int
    items: List[InventoryValuationItem]


class LowStockItem(BaseModel):
    product_id: int
    product_name: str
    barcode: str
    current_stock: Decimal
    min_stock_level: Decimal


class DashboardWidgets(BaseModel):
    today_sales: Decimal
    today_profit: Decimal
    today_sales_count: int
    low_stock_count: int
    low_stock_items: List[LowStockItem]
    top_products: List[TopProductItem]
    recent_sales: List[dict]
