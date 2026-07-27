import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
from core.config import settings
from core.database import SessionLocal
from bootstrap_utils import ensure_super_admin
from services.customer_credit_schema import ensure_customer_credit_schema
from api import (
    admin_router,
    auth_router,
    products_router,
    sales_router,
    inventory_router,
    reports_router,
    categories_router,
    customers_router,
    suppliers_router,
    purchase_orders_router,
    meta_router,
    owner_router,
    sync_router,
    device_auth_router,
    cash_shifts_router,
    money_router,
    company_router,
    shop_router,
    shop_orders_router,
    orders_router,
    telegram_webhook_router,
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        return response


def _startup() -> None:
    ensure_customer_credit_schema()
    db = SessionLocal()
    try:
        ensure_super_admin(db)
        db.commit()
    finally:
        db.close()


def _make_lifespan(mcp_app):
    """Our own startup, plus the MCP session manager when it is mounted.

    The MCP ASGI app carries a lifespan of its own that must run for streamable
    HTTP sessions to work. Replacing ours with theirs would drop
    `ensure_super_admin` and break bootstrap, so both run.
    """

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        _startup()
        if mcp_app is None:
            yield
            return
        async with mcp_app.lifespan(app):
            yield

    return lifespan


def _build_mcp():
    """The MCP connector, or nothing if it is disabled or fails to load.

    A broken connector must not take the register down with it: the POS is the
    business, the connector is a convenience.
    """
    if not settings.MCP_ENABLED:
        return None, []
    try:
        from mcp_server.server import build_mcp_app, well_known_routes

        return build_mcp_app(), well_known_routes()
    except Exception:  # pragma: no cover - defensive
        logging.getLogger(__name__).exception(
            "MCP connector failed to initialise; continuing without it"
        )
        return None, []


def create_app() -> FastAPI:
    mcp_app, mcp_well_known = _build_mcp()

    app = FastAPI(
        title=settings.PROJECT_NAME,
        version=settings.VERSION,
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=_make_lifespan(mcp_app),
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.BACKEND_CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Total-Count"],
    )

    app.add_middleware(SecurityHeadersMiddleware)

    # NOTE (F2/F3): add the Telegram Mini App host to BACKEND_CORS_ORIGINS_RAW in
    # production once sellary-shop is deployed, so /api/shop/* is reachable from
    # the WebView origin. initData auth (header X-Telegram-Init-Data) is the real
    # security boundary; CORS only governs browser fetch eligibility.

    app.include_router(auth_router, prefix=settings.API_V1_STR)
    app.include_router(admin_router, prefix=settings.API_V1_STR)
    app.include_router(products_router, prefix=settings.API_V1_STR)
    app.include_router(sales_router, prefix=settings.API_V1_STR)
    app.include_router(inventory_router, prefix=settings.API_V1_STR)
    app.include_router(reports_router, prefix=settings.API_V1_STR)
    app.include_router(categories_router, prefix=settings.API_V1_STR)
    app.include_router(customers_router, prefix=settings.API_V1_STR)
    app.include_router(suppliers_router, prefix=settings.API_V1_STR)
    app.include_router(purchase_orders_router, prefix=settings.API_V1_STR)
    app.include_router(meta_router, prefix=settings.API_V1_STR)
    app.include_router(owner_router, prefix=settings.API_V1_STR)
    app.include_router(sync_router, prefix=settings.API_V1_STR)
    app.include_router(device_auth_router, prefix=settings.API_V1_STR)
    app.include_router(cash_shifts_router, prefix=settings.API_V1_STR)
    app.include_router(money_router, prefix=settings.API_V1_STR)
    app.include_router(company_router, prefix=settings.API_V1_STR)
    app.include_router(shop_router, prefix=settings.API_V1_STR)
    app.include_router(shop_orders_router, prefix=settings.API_V1_STR)
    app.include_router(orders_router, prefix=settings.API_V1_STR)
    app.include_router(telegram_webhook_router, prefix=settings.API_V1_STR)

    if mcp_app is not None:
        # Discovery documents belong at the origin root — that is where OAuth
        # clients look for them — while the operational endpoints live under
        # the mount. Serving the metadata from under /mcp is the quiet failure
        # where a connector never manages to authenticate.
        for route in mcp_well_known:
            app.router.routes.append(route)

        # Exact `/mcp` first, then the mount for everything beneath it — the
        # mount alone cannot serve the bare path (see ExactPathRoute).
        from mcp_server.server import ExactPathRoute

        app.router.routes.append(ExactPathRoute("/mcp", mcp_app))
        app.mount("/mcp", mcp_app)

    return app


app = create_app()


@app.get("/")
def root():
    return {
        "name": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "status": "online",
    }


@app.api_route("/health", methods=["GET", "POST", "OPTIONS"])
def health_check():
    return {
        "status": "healthy",
        "name": settings.PROJECT_NAME,
        "version": settings.VERSION,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
