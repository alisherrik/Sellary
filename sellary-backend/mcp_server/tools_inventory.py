"""What is on the shelf, what moved it, and what left as spoilage.

Read-only. Counting stock is a document with a human author, and a delta applied
to whatever the server currently holds is the failure this codebase already
suffered — neither belongs on this channel.
"""

from mcp_server import SCOPE_RECORDS, SCOPE_REPORTS
from mcp_server.context import mcp_session, require_module, require_scope
from mcp_server.periods import resolve_period
from mcp_server.serialization import json_safe, quantity, unit_price
from mcp_server.server import mcp
from repositories.category_repository import CategoryRepository
from services.inventory_service import InventoryService
from services.product_service import ProductService
from services.report_service import ReportService
from services.stock_write_off_service import StockWriteOffService


@mcp.tool
def list_products(query: str | None = None, limit: int = 50, offset: int = 0) -> dict:
    """Каталог товаров с остатками и ценами, страницами. В отличие от
    search_products, работает и без поискового запроса — чтобы просто посмотреть,
    что вообще есть в магазине.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "inventory")
        limit = max(1, min(int(limit), 200))
        products, total = ProductService(db, auth.company_id).get_all(
            skip=max(0, int(offset)), limit=limit, search=query
        )
        return {
            "total": total,
            "products": [
                {
                    "id": row.id,
                    "name": row.name,
                    "barcode": row.barcode,
                    "uom": row.uom,
                    "stock_quantity": quantity(row.stock_quantity),
                    "cost_price": unit_price(row.cost_price),
                    "sell_price": unit_price(row.sell_price),
                }
                for row in products
            ],
        }


@mcp.tool
def list_categories() -> dict:
    """Категории товаров магазина."""
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "inventory")
        categories = CategoryRepository(db).get_all(auth.company_id)
        return {
            "categories": [{"id": row.id, "name": row.name} for row in categories]
        }


@mcp.tool
def get_stock_movements(
    product_id: int | None = None,
    limit: int = 100,
    offset: int = 0,
) -> dict:
    """История движения остатков: приход, продажа, возврат, списание, пересчёт —
    с причиной и количеством, от новых к старым. Отвечает на «почему остаток
    стал таким». Без product_id показывает движения по всему складу.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_RECORDS)
        require_module(auth, db, "inventory")
        limit = max(1, min(int(limit), 500))
        logs, total = InventoryService(db, auth.company_id).get_logs(
            skip=max(0, int(offset)), limit=limit, product_id=product_id
        )
        return {"total": total, "movements": json_safe(logs)}


@mcp.tool
def list_write_offs(
    period: str = "this_month",
    limit: int = 50,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    """Акты списания за период: что списали, по какой причине и куда оно делось —
    выброшено или возвращено поставщику. Списания не входят в оборот.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_RECORDS)
        require_module(auth, db, "inventory")
        limit = max(1, min(int(limit), 200))
        start, end, echo = resolve_period(
            ReportService(db, auth.company_id), period, start_date, end_date
        )
        write_offs, total = StockWriteOffService(db, auth.company_id).list(
            start_date=start, end_date=end, limit=limit
        )
        return {**echo, "total": total, "write_offs": json_safe(write_offs)}


@mcp.tool
def get_write_off_summary(
    period: str = "this_month",
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    """Сводка списаний за период — по причинам и по тому, вернули ли товар
    поставщику. Отвечает на «сколько мы потеряли на порче».
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "inventory")
        start, end, echo = resolve_period(
            ReportService(db, auth.company_id), period, start_date, end_date
        )
        summary = StockWriteOffService(db, auth.company_id).summary(start, end)
        return {**echo, **json_safe(summary)}


@mcp.tool
def get_inventory_valuation() -> dict:
    """Во сколько магазину обходится товар, который сейчас лежит на складе —
    по закупочной цене. Это не выручка и не прибыль, а связанные деньги.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "inventory")
        return json_safe(InventoryService(db, auth.company_id).get_inventory_value())
