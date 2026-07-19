from .auth import router as auth_router
from .admin import router as admin_router
from .products import router as products_router
from .sales import router as sales_router
from .inventory import router as inventory_router
from .reports import router as reports_router
from .categories import router as categories_router
from .customers import router as customers_router
from .suppliers import router as suppliers_router
from .purchase_orders import router as purchase_orders_router
from .meta import router as meta_router
from .owner import router as owner_router
from .sync import router as sync_router
from .device_auth import router as device_auth_router
from .cash_shifts import router as cash_shifts_router
from .company import router as company_router
from .shop import router as shop_router

__all__ = [
    "auth_router",
    "admin_router",
    "products_router",
    "sales_router",
    "inventory_router",
    "reports_router",
    "categories_router",
    "customers_router",
    "suppliers_router",
    "purchase_orders_router",
    "meta_router",
    "owner_router",
    "sync_router",
    "device_auth_router",
    "cash_shifts_router",
    "company_router",
    "shop_router",
]
