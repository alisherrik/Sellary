"""Stable inventory names; bounded lists retain explicit continuation."""

from mcp_server import SCOPE_REPORTS
from mcp_server.context import mcp_session, require_module, require_scope
from mcp_server.read_support import READ_ONLY, Id, Limit, Offset, page_info
from mcp_server.serialization import json_safe
from mcp_server.server import mcp
from mcp_server.tools_catalog import list_products
from mcp_server.tools_history import get_write_off_summary, list_stock_movements, list_write_offs
from schemas.mcp_read import CategoryPage, InventoryValuation, StockPage
from services.category_service import CategoryService
from services.inventory_service import InventoryService


@mcp.tool(annotations=READ_ONLY)
def list_categories(limit: Limit = 50, offset: Offset = 0) -> CategoryPage:
    """Категории компании постранично; next_offset продолжает весь список."""
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "inventory")
        rows, total = CategoryService(db, auth.company_id).get_page(offset, limit)
        return {**page_info(len(rows), total, limit, offset), "categories": [
            {"id": row.id, "name": row.name} for row in rows]}


@mcp.tool(annotations=READ_ONLY)
def get_stock_movements(product_id: Id | None = None, limit: Limit = 100,
                        offset: Offset = 0) -> StockPage:
    """История остатков компании или товара; next_offset продолжает полный список."""
    return list_stock_movements(product_id=product_id, limit=limit, offset=offset)


@mcp.tool(annotations=READ_ONLY)
def get_inventory_valuation() -> InventoryValuation:
    """Стоимость остатков, количество активных товаров и единиц по всему складу."""
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "inventory")
        return json_safe(InventoryService(db, auth.company_id).get_inventory_value())
