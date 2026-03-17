from .auth import router as auth_router
from .products import router as products_router
from .sales import router as sales_router
from .inventory import router as inventory_router
from .reports import router as reports_router
from .categories import router as categories_router
from .customers import router as customers_router
from .suppliers import router as suppliers_router
from .purchase_orders import router as purchase_orders_router
from .meta import router as meta_router

__all__ = [
    "auth_router",
    "products_router",
    "sales_router",
    "inventory_router",
    "reports_router",
    "categories_router",
    "customers_router",
    "suppliers_router",
    "purchase_orders_router",
    "meta_router",
]
