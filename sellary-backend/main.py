from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from core.config import settings
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

def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.PROJECT_NAME,
        version=settings.VERSION,
        docs_url="/docs",
        redoc_url="/redoc",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.BACKEND_CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

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


@app.api_route("/health", methods=["GET", "POST"])
def health_check():
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
