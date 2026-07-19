# Marketplace F1 — Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the backend data model and merchant endpoints that let a shop mark products for the online marketplace, attach a product image (Cloudinary), and configure its storefront settings.

**Architecture:** Extend the existing single FastAPI backend. New columns on `products` and `companies`; a Cloudinary upload service; a product-image upload endpoint; and a new `company` router for marketplace storefront settings. All merchant-facing, protected by the existing company-scoped token. No shopper-facing (`/api/shop`) API yet — that is phase F2.

**Tech Stack:** Python 3 / FastAPI / SQLAlchemy / Alembic / Pydantic v2 / pytest / Cloudinary Python SDK.

## Global Constraints

- Backend runs on port **8001**; all commands run from `sellary-backend/` with the venv active (`.venv\Scripts\python.exe`, `.venv\Scripts\pytest.exe`).
- Test isolation is transaction-rollback: in tests use `db_session.flush()` or `db_session.commit()` per existing fixtures; never rely on real persistence.
- **Every new Alembic migration MUST chain off the current live head `b8c9d0e1f2a3` and bump `railway.toml`'s `preDeployCommand = "alembic upgrade <rev>"` to the new revision.** A guard test (`tests/unit/test_migration_chain.py`) fails otherwise. The dead head `20260319_0001` must remain untouched (exactly two heads total).
- Layering is strict: `api/ → services/ → repositories/ → models/`. Pydantic models live in `schemas/`.
- Merchant mutations use `require_manager_or_admin`; reads use `get_auth_context`. Tenant scope is always `auth.company_id`.
- CI gate is `python -m compileall api core models repositories schemas services main.py`.

---

### Task 1: Data model + migration (product & company marketplace fields)

**Files:**
- Modify: `sellary-backend/models/product.py` (after line 37, near `stock_quantity`)
- Modify: `sellary-backend/models/company.py` (after line 22, near `timezone`)
- Create: `sellary-backend/alembic/versions/20260719_1200-c9d0e1f2a3b4_add_marketplace_fields.py`
- Modify: `railway.toml:9`
- Test: `sellary-backend/tests/unit/test_marketplace_model.py`

**Interfaces:**
- Produces: `Product.image_url: str | None`, `Product.is_published: bool` (default `False`); `Company.is_marketplace_enabled: bool` (default `False`), `Company.logo_url: str | None`, `Company.marketplace_description: str | None`, `Company.supports_delivery: bool` (default `True`), `Company.supports_pickup: bool` (default `True`). New live migration head `c9d0e1f2a3b4`.

- [ ] **Step 1: Write the failing test**

Create `sellary-backend/tests/unit/test_marketplace_model.py`:

```python
"""Marketplace columns exist on Product and Company with correct defaults."""
from decimal import Decimal

from models.company import Company
from models.product import Product


def test_product_marketplace_defaults(db_session):
    company = db_session.query(Company).first()
    if company is None:
        company = Company(name="MP Co", slug="mp-co")
        db_session.add(company)
        db_session.flush()
    product = Product(
        company_id=company.id,
        name="Online item",
        cost_price=Decimal("1.0000"),
        sell_price=Decimal("2.0000"),
    )
    db_session.add(product)
    db_session.flush()
    assert product.is_published is False
    assert product.image_url is None


def test_company_marketplace_defaults(db_session):
    company = Company(name="Shop A", slug="shop-a-mp")
    db_session.add(company)
    db_session.flush()
    assert company.is_marketplace_enabled is False
    assert company.supports_delivery is True
    assert company.supports_pickup is True
    assert company.logo_url is None
    assert company.marketplace_description is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest.exe tests/unit/test_marketplace_model.py -v`
Expected: FAIL — `AttributeError`/`TypeError` (columns don't exist yet).

- [ ] **Step 3: Add columns to the models**

In `sellary-backend/models/product.py`, immediately after the `stock_quantity` column (line 37):

```python
    # Marketplace: opt-in visibility and primary image (Cloudinary secure_url).
    is_published = Column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    image_url = Column(String(500), nullable=True)
```

In `sellary-backend/models/company.py`, immediately after the `timezone` column block (line 22):

```python
    # Marketplace storefront settings.
    is_marketplace_enabled = Column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    logo_url = Column(String(500), nullable=True)
    marketplace_description = Column(String(500), nullable=True)
    supports_delivery = Column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    supports_pickup = Column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
```

`text` is already imported in both files; `Boolean`/`String` are already imported in `company.py`. Confirm `Boolean` and `String` are imported in `product.py` (they are, lines 4-7).

- [ ] **Step 4: Create the migration**

Create `sellary-backend/alembic/versions/20260719_1200-c9d0e1f2a3b4_add_marketplace_fields.py`:

```python
"""add marketplace fields to products and companies

Adds opt-in online-store visibility. products.is_published gates whether a
product appears in the marketplace catalog; products.image_url holds its
Cloudinary image. companies.* configure the shop storefront (branding and the
fulfilment methods it offers). All default to a safe closed state: products
hidden, marketplace disabled, both fulfilment methods available once enabled.

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-07-19 12:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c9d0e1f2a3b4"
down_revision: Union[str, None] = "b8c9d0e1f2a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column(
            "is_published", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
    )
    op.add_column("products", sa.Column("image_url", sa.String(500), nullable=True))
    op.add_column(
        "companies",
        sa.Column(
            "is_marketplace_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column("companies", sa.Column("logo_url", sa.String(500), nullable=True))
    op.add_column(
        "companies", sa.Column("marketplace_description", sa.String(500), nullable=True)
    )
    op.add_column(
        "companies",
        sa.Column(
            "supports_delivery",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )
    op.add_column(
        "companies",
        sa.Column(
            "supports_pickup",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )


def downgrade() -> None:
    op.drop_column("companies", "supports_pickup")
    op.drop_column("companies", "supports_delivery")
    op.drop_column("companies", "marketplace_description")
    op.drop_column("companies", "logo_url")
    op.drop_column("companies", "is_marketplace_enabled")
    op.drop_column("products", "image_url")
    op.drop_column("products", "is_published")
```

- [ ] **Step 5: Bump the Railway migration pin**

In `railway.toml`, change line 9 from:

```toml
preDeployCommand = "alembic upgrade b8c9d0e1f2a3"
```

to:

```toml
preDeployCommand = "alembic upgrade c9d0e1f2a3b4"
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `.venv\Scripts\pytest.exe tests/unit/test_marketplace_model.py tests/unit/test_migration_chain.py -v`
Expected: PASS — model defaults hold, and the chain guard confirms one live head (`c9d0e1f2a3b4`) matching the Railway pin, exactly two heads total.

- [ ] **Step 7: Commit**

```bash
git add sellary-backend/models/product.py sellary-backend/models/company.py sellary-backend/alembic/versions/20260719_1200-c9d0e1f2a3b4_add_marketplace_fields.py railway.toml sellary-backend/tests/unit/test_marketplace_model.py
git commit -m "feat(marketplace): add product & company marketplace fields + migration"
```

---

### Task 2: Expose is_published / image_url through the product schema

**Files:**
- Modify: `sellary-backend/schemas/product.py` (`ProductUpdate` ~line 51, `Product` response ~line 75)
- Modify: `sellary-backend/services/product_service.py` (`_to_response` ~line 255)
- Test: `sellary-backend/tests/integration/test_product_marketplace_fields.py`

**Interfaces:**
- Consumes: `Product.is_published`, `Product.image_url` from Task 1.
- Produces: `PATCH`/`PUT /api/products/{id}` accepts `is_published: bool` and `image_url: str | None`; `ProductResponse` returns both. The existing `ProductService.update` already applies arbitrary `ProductUpdate` fields via `model_dump(exclude_unset=True)`, so no service `update` change is needed — only `_to_response` must surface the new fields.

- [ ] **Step 1: Write the failing test**

Create `sellary-backend/tests/integration/test_product_marketplace_fields.py`:

```python
"""Merchant can toggle is_published and set image_url via the product update API."""
from fastapi.testclient import TestClient


def test_update_sets_is_published_and_image_url(
    client: TestClient, manager_headers, test_product
):
    resp = client.put(
        f"/api/products/{test_product.id}",
        headers=manager_headers,
        json={"is_published": True, "image_url": "https://cdn.example/x.jpg"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["is_published"] is True
    assert body["image_url"] == "https://cdn.example/x.jpg"


def test_product_response_defaults_when_not_published(
    client: TestClient, manager_headers, test_product
):
    resp = client.get(f"/api/products/{test_product.id}", headers=manager_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["is_published"] is False
    assert body["image_url"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest.exe tests/integration/test_product_marketplace_fields.py -v`
Expected: FAIL — response has no `is_published`/`image_url` key (KeyError) and update ignores the fields.

- [ ] **Step 3: Add the fields to the schemas**

In `sellary-backend/schemas/product.py`, add to `ProductUpdate` (after `is_active` around line 62):

```python
    is_published: Optional[bool] = None
    image_url: Optional[str] = Field(None, max_length=500)
```

Add to the `Product` response model (after `is_active` around line 77):

```python
    is_published: bool = False
    image_url: Optional[str] = None
```

- [ ] **Step 4: Surface the fields in the service response**

In `sellary-backend/services/product_service.py`, inside `_to_response` (the `return ProductResponse(...)` block ~line 260), add these two keyword arguments (e.g. right after `is_active=product.is_active,`):

```python
            is_published=product.is_published,
            image_url=product.image_url,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv\Scripts\pytest.exe tests/integration/test_product_marketplace_fields.py -v`
Expected: PASS — both fields round-trip through update and appear in GET responses.

- [ ] **Step 6: Commit**

```bash
git add sellary-backend/schemas/product.py sellary-backend/services/product_service.py sellary-backend/tests/integration/test_product_marketplace_fields.py
git commit -m "feat(marketplace): expose is_published and image_url on product API"
```

---

### Task 3: Cloudinary config + upload service

**Files:**
- Modify: `sellary-backend/requirements.txt` (add dependency)
- Modify: `sellary-backend/core/config.py` (add settings ~after line 27)
- Modify: `sellary-backend/.env.example` (document keys)
- Create: `sellary-backend/services/image_upload_service.py`
- Test: `sellary-backend/tests/unit/test_image_upload_service.py`

**Interfaces:**
- Produces: `ImageUploadService(settings).upload_product_image(data: bytes, *, filename: str) -> str` returning a Cloudinary `secure_url`. Raises `ValueError("Image upload not configured")` when `CLOUDINARY_URL` is unset, and `ValueError("Image upload failed")` on SDK error.

- [ ] **Step 1: Write the failing test**

Create `sellary-backend/tests/unit/test_image_upload_service.py`:

```python
"""ImageUploadService wraps Cloudinary; behaviour is tested with the SDK mocked."""
import pytest

from services.image_upload_service import ImageUploadService


class _Settings:
    def __init__(self, url):
        self.CLOUDINARY_URL = url


def test_upload_returns_secure_url(monkeypatch):
    captured = {}

    def fake_upload(data, **kwargs):
        captured["data"] = data
        captured["kwargs"] = kwargs
        return {"secure_url": "https://res.cloudinary.com/demo/image/upload/x.jpg"}

    monkeypatch.setattr(
        "services.image_upload_service.cloudinary_uploader.upload", fake_upload
    )
    service = ImageUploadService(_Settings("cloudinary://k:s@demo"))
    url = service.upload_product_image(b"bytes", filename="photo.jpg")
    assert url == "https://res.cloudinary.com/demo/image/upload/x.jpg"
    assert captured["data"] == b"bytes"
    assert captured["kwargs"]["folder"] == "sellary/products"


def test_upload_unconfigured_raises():
    service = ImageUploadService(_Settings(""))
    with pytest.raises(ValueError, match="not configured"):
        service.upload_product_image(b"bytes", filename="photo.jpg")


def test_upload_sdk_error_raises(monkeypatch):
    def boom(data, **kwargs):
        raise RuntimeError("network")

    monkeypatch.setattr(
        "services.image_upload_service.cloudinary_uploader.upload", boom
    )
    service = ImageUploadService(_Settings("cloudinary://k:s@demo"))
    with pytest.raises(ValueError, match="failed"):
        service.upload_product_image(b"bytes", filename="photo.jpg")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest.exe tests/unit/test_image_upload_service.py -v`
Expected: FAIL — `ModuleNotFoundError: services.image_upload_service`.

- [ ] **Step 3: Add the dependency and config**

Append to `sellary-backend/requirements.txt`:

```
cloudinary>=1.40,<2
```

Then install it: `.venv\Scripts\python.exe -m pip install "cloudinary>=1.40,<2"`

In `sellary-backend/core/config.py`, add to the `Settings` class after `DEFAULT_TIMEZONE` (line 27):

```python
    # Cloudinary image hosting. Format: cloudinary://<api_key>:<api_secret>@<cloud_name>
    # Empty disables uploads (endpoints return 503). Read from env in production.
    CLOUDINARY_URL: str = ""
```

In `sellary-backend/.env.example`, add a documenting line:

```
# Marketplace product images (Cloudinary). Leave blank to disable image upload.
CLOUDINARY_URL=
```

- [ ] **Step 4: Write the service**

Create `sellary-backend/services/image_upload_service.py`:

```python
"""Upload product images to Cloudinary and return their CDN URL.

Cloudinary is configured from a single CLOUDINARY_URL DSN. When it is unset
(local dev without an account), uploads raise a configuration error the API
layer turns into a 503, so the rest of the app runs without image hosting.
"""
from __future__ import annotations

import cloudinary
from cloudinary import uploader as cloudinary_uploader

PRODUCT_IMAGE_FOLDER = "sellary/products"


class ImageUploadService:
    def __init__(self, settings) -> None:
        self._url = getattr(settings, "CLOUDINARY_URL", "") or ""
        if self._url:
            # cloudinary.config() reads CLOUDINARY_URL from the environment, but we
            # pass it explicitly so the service is not coupled to process env state.
            cloudinary.config(cloudinary_url=self._url)

    def upload_product_image(self, data: bytes, *, filename: str) -> str:
        if not self._url:
            raise ValueError("Image upload not configured")
        try:
            result = cloudinary_uploader.upload(
                data,
                folder=PRODUCT_IMAGE_FOLDER,
                resource_type="image",
                # Cap stored size; Cloudinary re-encodes/optimises on delivery.
                transformation=[{"width": 1600, "height": 1600, "crop": "limit"}],
            )
        except Exception as exc:  # SDK raises various error types
            raise ValueError("Image upload failed") from exc
        secure_url = result.get("secure_url")
        if not secure_url:
            raise ValueError("Image upload failed")
        return secure_url
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv\Scripts\pytest.exe tests/unit/test_image_upload_service.py -v`
Expected: PASS — all three cases (success, unconfigured, SDK error).

- [ ] **Step 6: Commit**

```bash
git add sellary-backend/requirements.txt sellary-backend/core/config.py sellary-backend/.env.example sellary-backend/services/image_upload_service.py sellary-backend/tests/unit/test_image_upload_service.py
git commit -m "feat(marketplace): add Cloudinary image upload service"
```

---

### Task 4: Product image upload endpoint

**Files:**
- Modify: `sellary-backend/api/products.py` (add route + imports)
- Test: `sellary-backend/tests/integration/test_product_image_upload.py`

**Interfaces:**
- Consumes: `ImageUploadService.upload_product_image` (Task 3); `ProductService.get_by_id`/`update` (existing).
- Produces: `POST /api/products/{product_id}/image` (multipart `file`) → uploads to Cloudinary, persists `image_url`, returns the updated `ProductResponse`. 404 if the product doesn't exist, 400 for a non-image/oversized file, 503 when Cloudinary is unconfigured.

- [ ] **Step 1: Write the failing test**

Create `sellary-backend/tests/integration/test_product_image_upload.py`:

```python
"""POST /api/products/{id}/image uploads via Cloudinary (mocked) and persists the URL."""
import io

from fastapi.testclient import TestClient


def _patch_upload(monkeypatch, url="https://cdn.example/uploaded.jpg"):
    monkeypatch.setattr(
        "services.image_upload_service.ImageUploadService.upload_product_image",
        lambda self, data, *, filename: url,
    )


def test_upload_persists_image_url(
    client: TestClient, manager_headers, test_product, monkeypatch
):
    _patch_upload(monkeypatch)
    resp = client.post(
        f"/api/products/{test_product.id}/image",
        headers=manager_headers,
        files={"file": ("photo.jpg", io.BytesIO(b"\xff\xd8\xff jpeg"), "image/jpeg")},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["image_url"] == "https://cdn.example/uploaded.jpg"


def test_upload_rejects_non_image(
    client: TestClient, manager_headers, test_product, monkeypatch
):
    _patch_upload(monkeypatch)
    resp = client.post(
        f"/api/products/{test_product.id}/image",
        headers=manager_headers,
        files={"file": ("doc.txt", io.BytesIO(b"hello"), "text/plain")},
    )
    assert resp.status_code == 400, resp.text


def test_upload_missing_product_404(
    client: TestClient, manager_headers, monkeypatch
):
    _patch_upload(monkeypatch)
    resp = client.post(
        "/api/products/999999/image",
        headers=manager_headers,
        files={"file": ("photo.jpg", io.BytesIO(b"\xff\xd8\xff"), "image/jpeg")},
    )
    assert resp.status_code == 404, resp.text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest.exe tests/integration/test_product_image_upload.py -v`
Expected: FAIL — route does not exist (404 for the success case too, wrong reason).

- [ ] **Step 3: Add the endpoint**

In `sellary-backend/api/products.py`, extend the imports at the top:

```python
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from core.config import settings
from schemas.product import ProductCreate, ProductResponse, ProductUpdate
from services.image_upload_service import ImageUploadService
from services.product_service import ProductService
```

(Keep the existing `AuthContext`/`get_auth_context`/`require_manager_or_admin`/`get_db` imports.)

Add this route at the end of the file, after `delete_product`:

```python
MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB


@router.post("/{product_id}/image", response_model=ProductResponse)
async def upload_product_image(
    product_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_manager_or_admin),
):
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    data = await file.read()
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="Image exceeds 5 MB limit")

    service = ProductService(db, auth.company_id)
    product = service.get_by_id(product_id)
    if not product or not product.is_active:
        raise HTTPException(status_code=404, detail="Product not found")

    try:
        url = ImageUploadService(settings).upload_product_image(
            data, filename=file.filename or "image"
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = 503 if "not configured" in detail else 400
        raise HTTPException(status_code=status_code, detail=detail)

    try:
        response = service.update(product_id, ProductUpdate(image_url=url))
        db.commit()
        return response
    except Exception:
        db.rollback()
        raise
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv\Scripts\pytest.exe tests/integration/test_product_image_upload.py -v`
Expected: PASS — persist, non-image rejection (400), missing product (404).

- [ ] **Step 5: Commit**

```bash
git add sellary-backend/api/products.py sellary-backend/tests/integration/test_product_image_upload.py
git commit -m "feat(marketplace): add product image upload endpoint"
```

---

### Task 5: Company marketplace settings endpoint

**Files:**
- Create: `sellary-backend/schemas/company.py`
- Create: `sellary-backend/services/company_service.py`
- Create: `sellary-backend/api/company.py`
- Modify: `sellary-backend/api/__init__.py` (register router)
- Modify: `sellary-backend/main.py` (import + include router)
- Test: `sellary-backend/tests/integration/test_company_marketplace_endpoints.py`

**Interfaces:**
- Consumes: `Company` marketplace columns (Task 1); `AuthContext.company_id`.
- Produces: `GET /api/company/marketplace` → `MarketplaceSettingsResponse`; `PATCH /api/company/marketplace` (partial) → updated `MarketplaceSettingsResponse`. `CompanyService(db, company_id).get_marketplace_settings()` / `.update_marketplace_settings(payload: MarketplaceSettingsUpdate)`.

- [ ] **Step 1: Write the failing test**

Create `sellary-backend/tests/integration/test_company_marketplace_endpoints.py`:

```python
"""GET/PATCH /api/company/marketplace reads and updates storefront settings."""
from fastapi.testclient import TestClient


def test_get_marketplace_defaults(client: TestClient, manager_headers):
    resp = client.get("/api/company/marketplace", headers=manager_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["is_marketplace_enabled"] is False
    assert body["supports_delivery"] is True
    assert body["supports_pickup"] is True
    assert body["logo_url"] is None


def test_patch_updates_subset(client: TestClient, manager_headers):
    resp = client.patch(
        "/api/company/marketplace",
        headers=manager_headers,
        json={
            "is_marketplace_enabled": True,
            "marketplace_description": "Best shop",
            "supports_delivery": False,
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["is_marketplace_enabled"] is True
    assert body["marketplace_description"] == "Best shop"
    assert body["supports_delivery"] is False
    # Untouched field keeps its default.
    assert body["supports_pickup"] is True


def test_patch_requires_auth(client: TestClient):
    resp = client.patch("/api/company/marketplace", json={"is_marketplace_enabled": True})
    assert resp.status_code == 401
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest.exe tests/integration/test_company_marketplace_endpoints.py -v`
Expected: FAIL — route not registered (404).

- [ ] **Step 3: Write the schema**

Create `sellary-backend/schemas/company.py`:

```python
from typing import Optional

from pydantic import BaseModel, Field


class MarketplaceSettingsUpdate(BaseModel):
    is_marketplace_enabled: Optional[bool] = None
    logo_url: Optional[str] = Field(None, max_length=500)
    marketplace_description: Optional[str] = Field(None, max_length=500)
    supports_delivery: Optional[bool] = None
    supports_pickup: Optional[bool] = None


class MarketplaceSettingsResponse(BaseModel):
    is_marketplace_enabled: bool
    logo_url: Optional[str] = None
    marketplace_description: Optional[str] = None
    supports_delivery: bool
    supports_pickup: bool

    class Config:
        from_attributes = True
```

- [ ] **Step 4: Write the service**

Create `sellary-backend/services/company_service.py`:

```python
"""Read and update a company's marketplace storefront settings."""
from sqlalchemy.orm import Session

from models.company import Company
from schemas.company import MarketplaceSettingsResponse, MarketplaceSettingsUpdate
from services.tenant import resolve_company_id


class CompanyService:
    def __init__(self, db: Session, company_id: int | None = None):
        self.db = db
        self.company_id = resolve_company_id(db, company_id)

    def _get_company(self) -> Company:
        company = self.db.query(Company).filter(Company.id == self.company_id).first()
        if company is None:
            raise ValueError("Company not found")
        return company

    def get_marketplace_settings(self) -> MarketplaceSettingsResponse:
        return MarketplaceSettingsResponse.model_validate(self._get_company())

    def update_marketplace_settings(
        self, payload: MarketplaceSettingsUpdate
    ) -> MarketplaceSettingsResponse:
        company = self._get_company()
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(company, field, value)
        self.db.flush()
        return MarketplaceSettingsResponse.model_validate(company)
```

Note: `services/tenant.py` already provides `resolve_company_id` (used by `ProductService`).

- [ ] **Step 5: Write the router**

Create `sellary-backend/api/company.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api.dependencies import AuthContext, get_auth_context, require_manager_or_admin
from core.database import get_db
from schemas.company import MarketplaceSettingsResponse, MarketplaceSettingsUpdate
from services.company_service import CompanyService

router = APIRouter(prefix="/company", tags=["company"])


@router.get("/marketplace", response_model=MarketplaceSettingsResponse)
def get_marketplace_settings(
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    return CompanyService(db, auth.company_id).get_marketplace_settings()


@router.patch("/marketplace", response_model=MarketplaceSettingsResponse)
def update_marketplace_settings(
    payload: MarketplaceSettingsUpdate,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_manager_or_admin),
):
    service = CompanyService(db, auth.company_id)
    try:
        response = service.update_marketplace_settings(payload)
        db.commit()
        return response
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception:
        db.rollback()
        raise
```

- [ ] **Step 6: Register the router**

In `sellary-backend/api/__init__.py`, add the import after the `cash_shifts` import (line 15):

```python
from .company import router as company_router
```

and add `"company_router",` to the `__all__` list.

In `sellary-backend/main.py`, add `company_router,` to the import block (after `cash_shifts_router,` line 26) and add after line 86:

```python
    app.include_router(company_router, prefix=settings.API_V1_STR)
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `.venv\Scripts\pytest.exe tests/integration/test_company_marketplace_endpoints.py -v`
Expected: PASS — defaults read, partial update, auth required.

- [ ] **Step 8: Run the full compile gate + new tests**

Run: `.venv\Scripts\python.exe -m compileall api core models repositories schemas services main.py`
Then: `.venv\Scripts\pytest.exe tests/unit/test_marketplace_model.py tests/unit/test_image_upload_service.py tests/unit/test_migration_chain.py tests/integration/test_product_marketplace_fields.py tests/integration/test_product_image_upload.py tests/integration/test_company_marketplace_endpoints.py -v`
Expected: compile OK; all marketplace F1 tests PASS.

- [ ] **Step 9: Commit**

```bash
git add sellary-backend/schemas/company.py sellary-backend/services/company_service.py sellary-backend/api/company.py sellary-backend/api/__init__.py sellary-backend/main.py sellary-backend/tests/integration/test_company_marketplace_endpoints.py
git commit -m "feat(marketplace): add company marketplace settings endpoint"
```

---

## Self-Review Notes

- **Spec coverage (F1 rows):** product `image_url` + `is_published` (Tasks 1–2), Cloudinary storage (Task 3), image upload (Task 4), company storefront settings incl. delivery/pickup + logo + description (Tasks 1, 5). `is_marketplace_enabled` default off (Task 1). Merchant-only auth on all mutations (Tasks 2, 4, 5).
- **Deferred to later plans (not in F1):** `telegram_users` table and `customers.telegram_id` (needed first in F2 auth / F4 orders — created there under YAGNI, not here). Merchant **frontend** UI (Next.js `/products` toggle + image picker + storefront settings form) is a separate F1-frontend plan with its own vitest cycle.
- **Migration safety:** Task 1 chains off `b8c9d0e1f2a3`, bumps `railway.toml`, and is guarded by `test_migration_chain.py` in Step 6.
- **Type consistency:** `ImageUploadService.upload_product_image(data, *, filename)` signature matches its call site in Task 4; `MarketplaceSettings*` schema names match service and router usage in Task 5; `ProductUpdate(image_url=...)` used in Task 4 is defined in Task 2.
```
