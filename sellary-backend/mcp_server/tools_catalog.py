"""Catalogue lookups.

These exist for their own sake — "do we still have sugar?" — and because the
purchase flow needs them: the model has to be able to check a name before
proposing that a product be created.
"""

from mcp_server import SCOPE_REPORTS
from mcp_server.context import mcp_session, require_module, require_scope
from mcp_server.serialization import json_safe, money, quantity, unit_price
from mcp_server.server import mcp
from services.product_service import ProductService
from services.supplier_service import SupplierService


def _product_row(product) -> dict:
    return {
        "id": product.id,
        "name": product.name,
        "barcode": product.barcode,
        "uom": product.uom,
        "stock_quantity": quantity(product.stock_quantity),
        "min_stock_level": quantity(product.min_stock_level),
        "cost_price": unit_price(product.cost_price),
        "sell_price": unit_price(product.sell_price),
        "category": (product.category or {}).get("name") if product.category else None,
    }


@mcp.tool
def search_products(query: str, limit: int = 15) -> dict:
    """Найти товары по названию или штрихкоду. Показывает остаток, закупочную
    и продажную цену. Используйте перед закупкой, чтобы проверить, есть ли
    товар в базе, и не создать дубликат.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "inventory")
        limit = max(1, min(int(limit), 50))
        products = ProductService(db, auth.company_id).search(query, limit=limit)
        return {
            "query": query,
            "count": len(products),
            "products": [_product_row(product) for product in products],
        }


@mcp.tool
def get_low_stock() -> dict:
    """Товары, остаток которых опустился до минимального уровня или ниже —
    то, что пора закупать.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "inventory")
        products = ProductService(db, auth.company_id).get_low_stock()
        return {
            "count": len(products),
            "products": [_product_row(product) for product in products],
        }


@mcp.tool
def list_suppliers(query: str | None = None, limit: int = 50) -> dict:
    """Список поставщиков, при необходимости с поиском по названию.
    Нужен, чтобы указать поставщика при оформлении закупки.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "purchasing")
        limit = max(1, min(int(limit), 200))
        suppliers, total = SupplierService(db, auth.company_id).get_all(
            limit=limit, search=query
        )
        return {
            "total": total,
            "suppliers": [
                {
                    "id": supplier.id,
                    "name": supplier.name,
                    "phone": supplier.phone,
                    "contact_person": getattr(supplier, "contact_person", None),
                }
                for supplier in suppliers
            ],
        }
