from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
from core.config import settings
from core.database import SessionLocal
from bootstrap_utils import ensure_super_admin
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
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        return response


@asynccontextmanager
async def lifespan(app: FastAPI):
    db = SessionLocal()
    try:
        ensure_super_admin(db)
        db.commit()
    finally:
        db.close()
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.PROJECT_NAME,
        version=settings.VERSION,
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.BACKEND_CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.add_middleware(SecurityHeadersMiddleware)

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
