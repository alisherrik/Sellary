"""Scoped catalogue reads with explicit continuation for every list."""

from fastmcp.exceptions import ToolError
from mcp_server import SCOPE_REPORTS
from mcp_server.context import mcp_session, require_module, require_scope
from mcp_server.read_support import READ_ONLY, Id, Limit, SearchLimit, Offset, page_info
from mcp_server.serialization import quantity, unit_price
from mcp_server.server import mcp
from schemas.mcp_read import ProductPage, ProductRow, SupplierPage
from services.product_service import ProductService
from services.supplier_service import SupplierService


def _product_row(product) -> dict:
    return {
        "id": product.id, "name": product.name, "barcode": product.barcode,
        "uom": product.uom, "stock_quantity": quantity(product.stock_quantity),
        "min_stock_level": quantity(product.min_stock_level),
        "cost_price": unit_price(product.cost_price), "sell_price": unit_price(product.sell_price),
        "category": (product.category or {}).get("name"), "is_active": product.is_active,
        "purchased_quantity": quantity(product.purchased_quantity),
        "sold_quantity": quantity(product.sold_quantity),
        "ledger_stock_quantity": quantity(product.ledger_stock_quantity),
    }


def _products(*, query=None, category_id=None, limit=50, offset=0,
              with_totals=False, low_stock_only=False):
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "inventory")
        products, total = ProductService(db, auth.company_id).get_all(
            search=query, category_id=category_id, skip=offset, limit=limit,
            with_totals=with_totals, low_stock_only=low_stock_only)
        return {"query": query, **page_info(len(products), total, limit, offset),
                "products": [_product_row(product) for product in products]}


@mcp.tool(annotations=READ_ONLY)
def search_products(query: str, limit: SearchLimit = 15, offset: Offset = 0) -> ProductPage:
    """Найти товары по названию или штрихкоду. Остатки и цены; next_offset
    продолжает поиск. Перед закупкой проверьте название, чтобы не создать дубликат.
    """
    return _products(query=query, limit=max(1, min(int(limit), 50)), offset=offset)


@mcp.tool(annotations=READ_ONLY)
def list_products(query: str | None = None, category_id: Id | None = None,
                  limit: Limit = 50, offset: Offset = 0, with_totals: bool = False,
                  low_stock_only: bool = False) -> ProductPage:
    """Полный каталог активных товаров постранично, с поиском и фильтром категории.
    with_totals добавляет приходы, продажи и остаток FIFO; next_offset продолжает список.
    """
    return _products(query=query, category_id=category_id, limit=limit, offset=offset,
                     with_totals=with_totals, low_stock_only=low_stock_only)


@mcp.tool(annotations=READ_ONLY)
def get_product(product_id: Id, with_totals: bool = True) -> ProductRow:
    """Карточка товара по ID, включая закупленное, проданное и остаток FIFO.
    stock_quantity и ledger_stock_quantity показаны отдельно для сверки.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "inventory")
        product = ProductService(db, auth.company_id).get_by_id(product_id, with_totals=with_totals)
        if product is None:
            raise ToolError("Товар не найден.")
        return _product_row(product)


@mcp.tool(annotations=READ_ONLY)
def get_low_stock(limit: Limit = 50, offset: Offset = 0,
                  category_id: Id | None = None) -> ProductPage:
    """Товары с остатком на минимальном уровне или ниже, постранично.
    total считает все совпадения; next_offset продолжает список закупки.
    """
    return _products(limit=limit, offset=offset, category_id=category_id, low_stock_only=True)


@mcp.tool(annotations=READ_ONLY)
def list_suppliers(query: str | None = None, limit: Limit = 50,
                   offset: Offset = 0) -> SupplierPage:
    """Активные поставщики с поиском по названию; next_offset продолжает полный список.
    ID позволяет однозначно выбрать поставщика в purchase_preview.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "purchasing")
        limit = max(1, min(int(limit), 200))
        suppliers, total = SupplierService(db, auth.company_id).get_all(
            skip=offset, limit=limit, search=query)
        return {**page_info(len(suppliers), total, limit, offset), "suppliers": [
            {"id": supplier.id, "name": supplier.name, "phone": supplier.phone,
             "contact_person": getattr(supplier, "contact_person", None)}
            for supplier in suppliers]}
