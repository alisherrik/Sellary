# Module Permissions (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-employee module access (pos / inventory / purchasing / shop / reports, each at `user` or `manager` level) enforced in the backend and reflected in the frontend nav + admin UI.

**Architecture:** New tenant-scoped table `membership_module_access` keyed by `company_memberships.id`. A `require_module(module, level)` FastAPI dependency checks it per request (admin role bypasses). Auth session responses gain a `modules` map that the frontend uses to filter the sidebar and guard routes. Admin manages grants via `/api/admin/memberships/{id}/modules`.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, Pydantic (backend); Next.js 14 App Router, Zustand, vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-07-24-erp-modularization-design.md`

**Conventions that apply to every task:**
- Backend commands run from `sellary-backend/` with venv binaries (`.venv\Scripts\pytest.exe`, `.venv\Scripts\python.exe` on Windows).
- Backend tests use transaction rollback — inside tests/fixtures use `session.flush()`, never `session.commit()`.
- Frontend commands run from `sellary-frontend/`; one-shot tests via `npx vitest run`.
- UI strings in Russian.
- Alembic currently has **two heads**; our migration chains onto `a8b9c0d1e2f3` (the domain head). Never merge heads in this plan.

---

### Task 1: Model + migration + backfill

**Files:**
- Create: `sellary-backend/models/membership_module_access.py`
- Modify: `sellary-backend/models/__init__.py` (add import/export)
- Create: `sellary-backend/alembic/versions/20260724_1000-b9c0d1e2f3a4_add_membership_module_access.py`
- Test: `sellary-backend/tests/unit/test_membership_module_access_model.py`

- [ ] **Step 1: Write the failing model test**

```python
"""Unit tests for the MembershipModuleAccess model."""
import pytest
from sqlalchemy.exc import IntegrityError

from models.company_membership import CompanyMembership
from models.membership_module_access import MembershipModuleAccess, MODULES, LEVELS


class TestMembershipModuleAccessModel:
    def _make_membership(self, db_session, user, company):
        return (
            db_session.query(CompanyMembership)
            .filter_by(user_id=user.id, company_id=company.id)
            .one()
        )

    def test_module_and_level_constants(self):
        assert MODULES == ("pos", "inventory", "purchasing", "shop", "reports")
        assert LEVELS == ("user", "manager")

    def test_create_grant(self, db_session, cashier_user, default_company):
        membership = self._make_membership(db_session, cashier_user, default_company)
        grant = MembershipModuleAccess(
            membership_id=membership.id, module="inventory", level="user"
        )
        db_session.add(grant)
        db_session.flush()
        assert grant.id is not None

    def test_duplicate_module_rejected(self, db_session, cashier_user, default_company):
        membership = self._make_membership(db_session, cashier_user, default_company)
        db_session.add(
            MembershipModuleAccess(membership_id=membership.id, module="shop", level="user")
        )
        db_session.flush()
        db_session.add(
            MembershipModuleAccess(membership_id=membership.id, module="shop", level="manager")
        )
        with pytest.raises(IntegrityError):
            db_session.flush()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest.exe tests/unit/test_membership_module_access_model.py -v`
Expected: FAIL / ERROR with `ModuleNotFoundError: No module named 'models.membership_module_access'`

- [ ] **Step 3: Write the model**

`models/membership_module_access.py`:

```python
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from core.database import Base

MODULES = ("pos", "inventory", "purchasing", "shop", "reports")
LEVELS = ("user", "manager")


class MembershipModuleAccess(Base):
    """Per-membership module grant. No row = no access. Admin role bypasses."""

    __tablename__ = "membership_module_access"

    id = Column(Integer, primary_key=True, index=True)
    membership_id = Column(
        Integer,
        ForeignKey("company_memberships.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    module = Column(String(20), nullable=False)
    level = Column(String(10), nullable=False, default="user")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("membership_id", "module", name="uq_module_access_membership_module"),
    )

    membership = relationship("CompanyMembership", backref="module_access")
```

In `models/__init__.py` add the import and `__all__` entry following the existing pattern (open the file and mirror how e.g. `CashShift` is registered).

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv\Scripts\pytest.exe tests/unit/test_membership_module_access_model.py -v`
Expected: 3 passed

- [ ] **Step 5: Write the migration**

Create `alembic/versions/20260724_1000-b9c0d1e2f3a4_add_membership_module_access.py`. **First open the previous migration** (`20260719_1600-a8b9c0d1e2f3_add_platform_settings.py`) and copy its file header style exactly. Content:

```python
"""add membership_module_access

Revision ID: b9c0d1e2f3a4
Revises: a8b9c0d1e2f3
Create Date: 2026-07-24
"""
import sqlalchemy as sa
from alembic import op

revision = "b9c0d1e2f3a4"
down_revision = "a8b9c0d1e2f3"
branch_labels = None
depends_on = None

MODULES = ("pos", "inventory", "purchasing", "shop", "reports")


def upgrade() -> None:
    op.create_table(
        "membership_module_access",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "membership_id",
            sa.Integer(),
            sa.ForeignKey("company_memberships.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("module", sa.String(length=20), nullable=False),
        sa.Column("level", sa.String(length=10), nullable=False, server_default="user"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint(
            "membership_id", "module", name="uq_module_access_membership_module"
        ),
    )

    # Backfill so existing companies keep working:
    #   manager  -> all 5 modules at manager
    #   cashier / any other non-admin role -> pos at user
    #   admin    -> nothing (bypasses checks)
    conn = op.get_bind()
    memberships = conn.execute(
        sa.text("SELECT id, role FROM company_memberships WHERE is_active = true")
    ).fetchall()
    rows = []
    for m_id, role in memberships:
        if role == "admin":
            continue
        if role == "manager":
            rows.extend(
                {"membership_id": m_id, "module": mod, "level": "manager"}
                for mod in MODULES
            )
        else:
            rows.append({"membership_id": m_id, "module": "pos", "level": "user"})
    if rows:
        conn.execute(
            sa.text(
                "INSERT INTO membership_module_access (membership_id, module, level) "
                "VALUES (:membership_id, :module, :level)"
            ),
            rows,
        )


def downgrade() -> None:
    op.drop_table("membership_module_access")
```

- [ ] **Step 6: Verify migration chain test still passes**

Run: `.venv\Scripts\pytest.exe tests/unit/test_migration_chain.py -v`
Expected: PASS. If it fails because the new revision must be registered in the test, open the test, follow its pattern, add `b9c0d1e2f3a4`.

- [ ] **Step 7: Apply migration to dev DB**

Run: `.venv\Scripts\python.exe -m alembic upgrade b9c0d1e2f3a4`
Expected: `Running upgrade a8b9c0d1e2f3 -> b9c0d1e2f3a4`

- [ ] **Step 8: Commit**

```bash
git add sellary-backend/models sellary-backend/alembic/versions sellary-backend/tests/unit/test_membership_module_access_model.py
git commit -m "feat(auth): membership_module_access table with role backfill"
```

---

### Task 2: Test fixtures for module grants

Existing integration tests authenticate as `manager_headers` / `cashier_headers`. Once enforcement lands (Task 4+), those tests only keep passing if fixtures mirror the backfill. Do this **before** enforcement.

**Files:**
- Modify: `sellary-backend/tests/conftest.py` (function `_create_user_with_membership`, around line 135)

- [ ] **Step 1: Add grant helper and wire into membership creation**

In `tests/conftest.py`, add near `_create_user_with_membership`:

```python
from models.membership_module_access import MembershipModuleAccess, MODULES


def _grant_modules_for_role(db_session, membership) -> None:
    """Mirror the b9c0d1e2f3a4 backfill: manager -> all modules manager,
    other non-admin roles -> pos:user, admin -> nothing (bypass)."""
    if membership.role == "admin":
        return
    if membership.role == "manager":
        rows = [
            MembershipModuleAccess(membership_id=membership.id, module=m, level="manager")
            for m in MODULES
        ]
    else:
        rows = [MembershipModuleAccess(membership_id=membership.id, module="pos", level="user")]
    db_session.add_all(rows)
    db_session.flush()
```

Inside `_create_user_with_membership`, after the membership is flushed (it must have an `id`), call `_grant_modules_for_role(db_session, membership)`.

Also add a reusable fixture at the bottom of the fixtures section:

```python
@pytest.fixture
def grant_module(db_session):
    """grant_module(user, company, module, level) — replace a user's grants for one module."""
    def _grant(user, company, module, level="user"):
        membership = (
            db_session.query(CompanyMembership)
            .filter_by(user_id=user.id, company_id=company.id)
            .one()
        )
        db_session.query(MembershipModuleAccess).filter_by(
            membership_id=membership.id, module=module
        ).delete()
        db_session.add(
            MembershipModuleAccess(membership_id=membership.id, module=module, level=level)
        )
        db_session.flush()
    return _grant
```

(`CompanyMembership` is already imported in conftest; verify, add if missing.)

- [ ] **Step 2: Run full backend suite — must stay green (no enforcement yet)**

Run: `.venv\Scripts\pytest.exe tests/integration tests/unit -q`
Expected: same pass count as before this task (fixtures are additive).

- [ ] **Step 3: Commit**

```bash
git add sellary-backend/tests/conftest.py
git commit -m "test: module-grant fixtures mirroring migration backfill"
```

---

### Task 3: `require_module` dependency

**Files:**
- Modify: `sellary-backend/api/dependencies.py`
- Test: `sellary-backend/tests/unit/test_require_module.py`

- [ ] **Step 1: Write the failing tests**

The dependency is a factory returning a checker; call the checker directly with an `AuthContext` and a db session — no HTTP needed.

```python
"""Unit tests for the require_module dependency factory."""
import pytest
from fastapi import HTTPException

from api.dependencies import AuthContext, require_module
from models.company_membership import CompanyMembership
from models.membership_module_access import MembershipModuleAccess


def _ctx(db_session, user, company):
    membership = (
        db_session.query(CompanyMembership)
        .filter_by(user_id=user.id, company_id=company.id)
        .one()
    )
    return AuthContext(
        user=user,
        company=company,
        membership=membership,
        token_payload={},
        effective_role=membership.role,
    )


class TestRequireModule:
    def test_admin_bypasses(self, db_session, admin_user, default_company):
        checker = require_module("inventory", level="manager")
        auth = _ctx(db_session, admin_user, default_company)
        assert checker(auth=auth, db=db_session) is auth

    def test_no_grant_403(self, db_session, cashier_user, default_company):
        checker = require_module("inventory")
        auth = _ctx(db_session, cashier_user, default_company)
        with pytest.raises(HTTPException) as exc:
            checker(auth=auth, db=db_session)
        assert exc.value.status_code == 403
        assert exc.value.detail["code"] == "module_access_denied"
        assert exc.value.detail["module"] == "inventory"

    def test_user_grant_passes_user_level(self, db_session, cashier_user, default_company):
        # backfill fixture already granted pos:user to cashier
        checker = require_module("pos")
        auth = _ctx(db_session, cashier_user, default_company)
        assert checker(auth=auth, db=db_session) is auth

    def test_user_grant_fails_manager_level(self, db_session, cashier_user, default_company):
        checker = require_module("pos", level="manager")
        auth = _ctx(db_session, cashier_user, default_company)
        with pytest.raises(HTTPException) as exc:
            checker(auth=auth, db=db_session)
        assert exc.value.status_code == 403

    def test_manager_grant_passes_both_levels(self, db_session, manager_user, default_company):
        auth = _ctx(db_session, manager_user, default_company)
        assert require_module("reports")(auth=auth, db=db_session) is auth
        assert require_module("reports", level="manager")(auth=auth, db=db_session) is auth

    def test_unknown_module_is_programming_error(self):
        with pytest.raises(ValueError):
            require_module("banking")
        with pytest.raises(ValueError):
            require_module("pos", level="root")

    def test_membership_none_403(self, db_session, super_admin_user, default_company):
        # super-admin company entry has membership=None but role admin -> bypass
        auth = AuthContext(
            user=super_admin_user,
            company=default_company,
            membership=None,
            token_payload={"super_admin_entry": True},
            effective_role="admin",
        )
        assert require_module("pos")(auth=auth, db=db_session) is auth
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv\Scripts\pytest.exe tests/unit/test_require_module.py -v`
Expected: FAIL with `ImportError: cannot import name 'require_module'`

- [ ] **Step 3: Implement `require_module`**

In `api/dependencies.py`, add after `require_manager_or_admin` (imports at top of file):

```python
from models.membership_module_access import LEVELS, MODULES, MembershipModuleAccess

_LEVEL_RANK = {"user": 1, "manager": 2}


def require_module(module: str, level: str = "user"):
    """Dependency factory: 403 unless the member has `module` at >= `level`.

    Membership role `admin` (including super-admin company entry) bypasses.
    """
    if module not in MODULES:
        raise ValueError(f"Unknown module: {module}")
    if level not in LEVELS:
        raise ValueError(f"Unknown level: {level}")

    def checker(
        auth: AuthContext = Depends(get_auth_context),
        db: Session = Depends(get_db),
    ) -> AuthContext:
        if auth.role == "admin":
            return auth
        grant = None
        if auth.membership is not None:
            grant = (
                db.query(MembershipModuleAccess)
                .filter(
                    MembershipModuleAccess.membership_id == auth.membership.id,
                    MembershipModuleAccess.module == module,
                )
                .first()
            )
        if grant is None or _LEVEL_RANK[grant.level] < _LEVEL_RANK[level]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "module_access_denied",
                    "module": module,
                    "required_level": level,
                },
            )
        return auth

    return checker
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv\Scripts\pytest.exe tests/unit/test_require_module.py -v`
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add sellary-backend/api/dependencies.py sellary-backend/tests/unit/test_require_module.py
git commit -m "feat(auth): require_module dependency (module x level, admin bypass)"
```

---

### Task 4: Enforce on POS routers (sales, shifts, customers)

**Files:**
- Modify: `sellary-backend/api/sales.py`, `sellary-backend/api/cash_shifts.py`, `sellary-backend/api/customers.py`
- Test: `sellary-backend/tests/integration/test_module_access_pos.py`

**Level map for this task** (rule: daily flow = `user`, destructive/corrective = `manager`):

| Endpoint | Dependency |
|---|---|
| `POST /api/sales`, `GET /api/sales*`, sale detail/search/summary | `require_module("pos")` |
| `POST /api/sales/{id}/cancel`, `POST /api/sales/{id}/return`, line annulment / reversal endpoints in sales router | `require_module("pos", "manager")` |
| `POST /api/shifts/open`, `POST /api/shifts/close`, `GET /api/shifts*` | `require_module("pos")` |
| force-close / close-other-user's-shift endpoint (if present in `cash_shifts.py`) | `require_module("pos", "manager")` |
| customers + customer-ledger CRUD (all of `customers.py`) | `require_module("pos")`; customer **delete** endpoint (if present) → `require_module("pos", "manager")` |

- [ ] **Step 1: Write failing integration tests**

```python
"""Module-access enforcement on POS routers.

cashier fixture has pos:user (backfill); manager has all modules at manager.
"""


def _no_grant_headers(client, db_session, default_company, test_password):
    """Create a member with zero module grants and return auth headers."""
    from tests.conftest import _create_user_with_membership, _create_company_scoped_token
    from models.membership_module_access import MembershipModuleAccess
    from models.company_membership import CompanyMembership

    user = _create_user_with_membership(
        db_session,
        username="nomods",
        email="nomods@example.com",
        password=test_password,
        company=default_company,
        role="cashier",
    )
    membership = (
        db_session.query(CompanyMembership)
        .filter_by(user_id=user.id, company_id=default_company.id)
        .one()
    )
    db_session.query(MembershipModuleAccess).filter_by(membership_id=membership.id).delete()
    db_session.flush()
    token = _create_company_scoped_token(user, default_company.id, "cashier")
    return {"Authorization": f"Bearer {token}"}


class TestPosModuleAccess:
    def test_no_grant_cannot_list_sales(
        self, client, db_session, default_company, test_password
    ):
        headers = _no_grant_headers(client, db_session, default_company, test_password)
        resp = client.get("/api/sales", headers=headers)
        assert resp.status_code == 403
        assert resp.json()["detail"]["code"] == "module_access_denied"

    def test_pos_user_can_list_sales(self, client, cashier_headers):
        assert client.get("/api/sales", headers=cashier_headers).status_code == 200

    def test_pos_user_cannot_cancel_sale(self, client, cashier_headers):
        resp = client.post(
            "/api/sales/999999/cancel",
            headers={**cashier_headers, "Idempotency-Key": "modtest-cancel-0001"},
            json={},
        )
        # 403 module check must fire BEFORE 404 lookup
        assert resp.status_code == 403

    def test_manager_cancel_reaches_lookup(self, client, manager_headers):
        resp = client.post(
            "/api/sales/999999/cancel",
            headers={**manager_headers, "Idempotency-Key": "modtest-cancel-0002"},
            json={},
        )
        assert resp.status_code == 404

    def test_no_grant_cannot_list_customers(
        self, client, db_session, default_company, test_password
    ):
        headers = _no_grant_headers(client, db_session, default_company, test_password)
        assert client.get("/api/customers", headers=headers).status_code == 403

    def test_no_grant_cannot_open_shift(
        self, client, db_session, default_company, test_password
    ):
        headers = _no_grant_headers(client, db_session, default_company, test_password)
        resp = client.post("/api/shifts/open", headers=headers, json={"opening_cash": 0})
        assert resp.status_code == 403
```

Adjust `_create_user_with_membership` call signature to what conftest actually defines (open conftest first; it may take different kwargs). If the shift-open payload differs, copy a valid payload from `test_cash_shift_endpoints.py`.

- [ ] **Step 2: Run to verify failures**

Run: `.venv\Scripts\pytest.exe tests/integration/test_module_access_pos.py -v`
Expected: the `no_grant` / `pos_user_cannot_cancel` tests FAIL (endpoints currently return 200/404, not 403).

- [ ] **Step 3: Apply dependencies to the three routers**

Pattern — replace/augment the auth dependency per route. Example for a read route in `sales.py`:

```python
# before
auth: AuthContext = Depends(get_auth_context),
# after
auth: AuthContext = Depends(require_module("pos")),
```

and for destructive routes:

```python
auth: AuthContext = Depends(require_module("pos", "manager")),
```

Import `require_module` from `api.dependencies` in each file. Where a route currently uses `require_manager_or_admin`, replace it with the `manager`-level module check. Go route by route through `sales.py`, `cash_shifts.py`, `customers.py` using the table above. `require_module(...)` returns the same `AuthContext`, so handler bodies don't change.

- [ ] **Step 4: Run new tests + affected suites**

Run: `.venv\Scripts\pytest.exe tests/integration/test_module_access_pos.py tests/integration/test_sales_endpoints.py tests/integration/test_cash_shift_endpoints.py tests/integration/test_customers_endpoints.py tests/integration/test_customer_credit_endpoints.py tests/integration/test_return_endpoints.py tests/integration/test_transaction_reversal_endpoints.py -q`
Expected: all pass. If an existing test fails with 403, check the table: if the test used `cashier_headers` for a manager-level action (cancel/return/reversal), that's the intended behavior change — switch that test to `manager_headers`.

- [ ] **Step 5: Commit**

```bash
git add sellary-backend/api/sales.py sellary-backend/api/cash_shifts.py sellary-backend/api/customers.py sellary-backend/tests/integration
git commit -m "feat(auth): enforce pos module access on sales/shifts/customers"
```

---

### Task 5: Enforce on inventory routers (products, categories, inventory)

**Files:**
- Modify: `sellary-backend/api/products.py`, `sellary-backend/api/categories.py`, `sellary-backend/api/inventory.py`
- Test: `sellary-backend/tests/integration/test_module_access_inventory.py`

**Level map:**

| Endpoint | Dependency |
|---|---|
| products CRUD, product units, image upload, `GET` stock/list | `require_module("inventory")` |
| product delete | `require_module("inventory", "manager")` |
| categories CRUD | `require_module("inventory")`; category delete → `manager` |
| `POST /api/inventory/adjust` | `require_module("inventory", "manager")` |
| inventory logs/list (`GET`) | `require_module("inventory")` |

- [ ] **Step 1: Write failing integration tests**

Same shape as Task 4 (reuse `_no_grant_headers` — move it to `tests/integration/conftest.py` as a fixture `no_module_headers` now that two files need it):

```python
# in tests/integration/conftest.py
import pytest


@pytest.fixture
def no_module_headers(db_session, default_company, test_password):
    """Company member with zero module grants."""
    from tests.conftest import _create_user_with_membership, _create_company_scoped_token
    from models.membership_module_access import MembershipModuleAccess
    from models.company_membership import CompanyMembership

    user = _create_user_with_membership(
        db_session,
        username="nomods",
        email="nomods@example.com",
        password=test_password,
        company=default_company,
        role="cashier",
    )
    membership = (
        db_session.query(CompanyMembership)
        .filter_by(user_id=user.id, company_id=default_company.id)
        .one()
    )
    db_session.query(MembershipModuleAccess).filter_by(membership_id=membership.id).delete()
    db_session.flush()
    token = _create_company_scoped_token(user, default_company.id, "cashier")
    return {"Authorization": f"Bearer {token}"}
```

(Update Task 4's test file to use this fixture too.)

```python
"""Module-access enforcement on inventory routers."""


class TestInventoryModuleAccess:
    def test_no_grant_cannot_list_products(self, client, no_module_headers):
        assert client.get("/api/products", headers=no_module_headers).status_code == 403

    def test_cashier_pos_only_cannot_list_products(self, client, cashier_headers):
        # cashier backfill = pos:user only -> inventory closed
        assert client.get("/api/products", headers=cashier_headers).status_code == 403

    def test_inventory_user_can_list_products(
        self, client, cashier_user, default_company, grant_module, cashier_headers
    ):
        grant_module(cashier_user, default_company, "inventory", "user")
        assert client.get("/api/products", headers=cashier_headers).status_code == 200

    def test_inventory_user_cannot_adjust(
        self, client, cashier_user, default_company, grant_module, cashier_headers, test_product
    ):
        grant_module(cashier_user, default_company, "inventory", "user")
        resp = client.post(
            "/api/inventory/adjust",
            headers={**cashier_headers, "Idempotency-Key": "modtest-adjust-0001"},
            json={"product_id": test_product.id, "quantity_change": 1, "reason": "test"},
        )
        assert resp.status_code == 403

    def test_manager_can_adjust(self, client, manager_headers, test_product):
        resp = client.post(
            "/api/inventory/adjust",
            headers={**manager_headers, "Idempotency-Key": "modtest-adjust-0002"},
            json={"product_id": test_product.id, "quantity_change": 1, "reason": "test"},
        )
        assert resp.status_code in (200, 201)
```

Copy the exact adjust payload shape from `test_inventory_endpoints.py` before writing.

**Heads-up:** `test_cashier_pos_only_cannot_list_products` encodes an intentional behavior change — if existing tests exercise products/categories with `cashier_headers`, re-point them to `manager_headers` (or grant inventory via `grant_module`).

- [ ] **Step 2: Run to verify failures**

Run: `.venv\Scripts\pytest.exe tests/integration/test_module_access_inventory.py -v`
Expected: FAIL (currently 200s).

- [ ] **Step 3: Apply dependencies per the table** (same mechanical pattern as Task 4).

- [ ] **Step 4: Run new + affected suites**

Run: `.venv\Scripts\pytest.exe tests/integration/test_module_access_inventory.py tests/integration/test_product_endpoints.py tests/integration/test_category_endpoints.py tests/integration/test_inventory_endpoints.py tests/integration/test_product_image_upload.py tests/integration/test_product_marketplace_fields.py -q`
Expected: all pass (after re-pointing any cashier-based tests as above).

- [ ] **Step 5: Commit**

```bash
git add sellary-backend/api/products.py sellary-backend/api/categories.py sellary-backend/api/inventory.py sellary-backend/tests/integration
git commit -m "feat(auth): enforce inventory module access on products/categories/inventory"
```

---

### Task 6: Enforce on purchasing, shop-orders, reports routers

**Files:**
- Modify: `sellary-backend/api/suppliers.py`, `sellary-backend/api/purchase_orders.py`, `sellary-backend/api/orders.py`, `sellary-backend/api/reports.py`
- Test: `sellary-backend/tests/integration/test_module_access_misc.py`

**Level map:**

| Endpoint | Dependency |
|---|---|
| suppliers list/get/create/update | `require_module("purchasing")`; supplier delete → `manager` |
| purchase orders list/get/create/update | `require_module("purchasing")` |
| `POST /api/purchase-orders/{id}/receive`, PO delete/void/writeoff | `require_module("purchasing", "manager")` |
| `GET /api/orders*`, `POST /api/orders/{id}/confirm`, `POST /api/orders/{id}/status` | `require_module("shop")` |
| `POST /api/orders/{id}/cancel` | `require_module("shop", "manager")` |
| everything in `reports.py` | `require_module("reports")` |

**Do NOT touch:** `shop.py`, `shop_orders.py`, `telegram_webhook.py` (public shopper channel), `sync.py`, `device_auth.py` (cashier channel), `meta.py`, `company.py`, `admin.py`, `owner.py`, `auth.py` (platform).

Note: `orders.py` currently uses `require_manager_or_admin` for mutations — confirm/status move DOWN to `shop:user` per spec; cancel stays manager-level via `require_module("shop", "manager")`.

- [ ] **Step 1: Write failing integration tests**

```python
"""Module-access enforcement on purchasing / shop-orders / reports routers."""


class TestPurchasingModuleAccess:
    def test_no_grant_cannot_list_suppliers(self, client, no_module_headers):
        assert client.get("/api/suppliers", headers=no_module_headers).status_code == 403

    def test_purchasing_user_can_list_pos(
        self, client, cashier_user, default_company, grant_module, cashier_headers
    ):
        grant_module(cashier_user, default_company, "purchasing", "user")
        assert client.get("/api/purchase-orders", headers=cashier_headers).status_code == 200

    def test_purchasing_user_cannot_receive(
        self, client, cashier_user, default_company, grant_module, cashier_headers
    ):
        grant_module(cashier_user, default_company, "purchasing", "user")
        resp = client.post(
            "/api/purchase-orders/999999/receive",
            headers={**cashier_headers, "Idempotency-Key": "modtest-receive-0001"},
            json={},
        )
        assert resp.status_code == 403


class TestShopOrdersModuleAccess:
    def test_no_grant_cannot_list_orders(self, client, no_module_headers):
        assert client.get("/api/orders", headers=no_module_headers).status_code == 403

    def test_shop_user_can_list_orders(
        self, client, cashier_user, default_company, grant_module, cashier_headers
    ):
        grant_module(cashier_user, default_company, "shop", "user")
        assert client.get("/api/orders", headers=cashier_headers).status_code == 200

    def test_shop_user_cannot_cancel(
        self, client, cashier_user, default_company, grant_module, cashier_headers
    ):
        grant_module(cashier_user, default_company, "shop", "user")
        resp = client.post(
            "/api/orders/999999/cancel",
            headers=cashier_headers,
            json={"reason": "test"},
        )
        assert resp.status_code == 403


class TestReportsModuleAccess:
    def test_no_grant_cannot_read_reports(self, client, no_module_headers):
        assert client.get("/api/reports/dashboard", headers=no_module_headers).status_code == 403

    def test_reports_user_can_read(
        self, client, cashier_user, default_company, grant_module, cashier_headers
    ):
        grant_module(cashier_user, default_company, "reports", "user")
        assert client.get("/api/reports/dashboard", headers=cashier_headers).status_code == 200
```

Before writing, open `reports.py` and use a real route path (replace `/api/reports/dashboard` if different); same for cancel payload shape from `test_order_endpoints.py`.

- [ ] **Step 2: Run to verify failures**

Run: `.venv\Scripts\pytest.exe tests/integration/test_module_access_misc.py -v`
Expected: FAIL.

- [ ] **Step 3: Apply dependencies per the table.**

- [ ] **Step 4: Run new + affected suites**

Run: `.venv\Scripts\pytest.exe tests/integration/test_module_access_misc.py tests/integration/test_purchase_order_endpoints.py tests/integration/test_order_endpoints.py -q`
Then the full suite: `.venv\Scripts\pytest.exe tests/integration tests/unit -q`
Expected: all pass (re-point cashier-based tests where the behavior change is intended).

- [ ] **Step 5: Commit**

```bash
git add sellary-backend/api sellary-backend/tests/integration
git commit -m "feat(auth): enforce purchasing/shop/reports module access"
```

---

### Task 7: `modules` map in auth session responses

**Files:**
- Modify: `sellary-backend/schemas/user.py`, `sellary-backend/services/auth_service.py`
- Test: `sellary-backend/tests/integration/test_auth_endpoints.py` (extend)

- [ ] **Step 1: Write failing tests** (append to `test_auth_endpoints.py`)

```python
class TestSessionModules:
    def test_me_returns_modules_for_cashier(self, client, cashier_headers):
        resp = client.get("/api/auth/me", headers=cashier_headers)
        assert resp.status_code == 200
        assert resp.json()["modules"] == {"pos": "user"}

    def test_me_returns_all_manager_for_admin(self, client, admin_headers):
        resp = client.get("/api/auth/me", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["modules"] == {
            "pos": "manager",
            "inventory": "manager",
            "purchasing": "manager",
            "shop": "manager",
            "reports": "manager",
        }

    def test_select_company_returns_modules(
        self, client, manager_user, default_company, test_password
    ):
        login = client.post(
            "/api/auth/login",
            json={"username": manager_user.username, "password": test_password},
        )
        assert login.status_code == 200
        resp = client.post(
            "/api/auth/select-company",
            json={"company_id": default_company.id},
            headers={"Authorization": f"Bearer {login.json()['login_token']}"},
        )
        assert resp.status_code == 200
        assert resp.json()["modules"]["inventory"] == "manager"
```

- [ ] **Step 2: Run to verify failures**

Run: `.venv\Scripts\pytest.exe tests/integration/test_auth_endpoints.py -v -k Modules`
Expected: FAIL (`KeyError: 'modules'`).

- [ ] **Step 3: Implement**

In `schemas/user.py`:

```python
ModuleKey = Literal["pos", "inventory", "purchasing", "shop", "reports"]
ModuleLevel = Literal["user", "manager"]
```

Add `modules: dict[ModuleKey, ModuleLevel] = {}` to **both** `CompanySession` and `AuthSession`.

In `services/auth_service.py`, add a helper and call it from both `create_company_session` and `get_auth_session` (open the file first; both already load the membership — reuse it):

```python
from models.membership_module_access import MODULES, MembershipModuleAccess


def _module_map(db, membership, role: str) -> dict[str, str]:
    if role == "admin":
        return {m: "manager" for m in MODULES}
    if membership is None:
        return {}
    rows = (
        db.query(MembershipModuleAccess)
        .filter(MembershipModuleAccess.membership_id == membership.id)
        .all()
    )
    return {r.module: r.level for r in rows}
```

Populate `modules=` when constructing the response objects.

- [ ] **Step 4: Run tests**

Run: `.venv\Scripts\pytest.exe tests/integration/test_auth_endpoints.py -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add sellary-backend/schemas/user.py sellary-backend/services/auth_service.py sellary-backend/tests/integration/test_auth_endpoints.py
git commit -m "feat(auth): expose module grants in session responses"
```

---

### Task 8: Admin endpoints for managing grants

**Files:**
- Modify: `sellary-backend/api/admin.py`, `sellary-backend/schemas/admin.py`, `sellary-backend/services/admin_management.py`
- Test: `sellary-backend/tests/integration/test_admin_endpoints.py` (extend)

API (admin-only, deviation from spec's tentative `/api/company/...` path — memberships already live under `/api/admin`):
- `GET /api/admin/memberships/{membership_id}/modules` → `{"modules": {"pos": "user", ...}}`
- `PUT /api/admin/memberships/{membership_id}/modules` body `{"modules": {...}}` → replaces the full grant set, returns the same shape.

Rules: membership must belong to `auth.company_id` (404 otherwise); target role `admin` → 400 `"Admin memberships have full access"`.

- [ ] **Step 1: Write failing tests** (append to `test_admin_endpoints.py`)

```python
class TestMembershipModules:
    def _membership_id(self, db_session, user, company):
        from models.company_membership import CompanyMembership
        return (
            db_session.query(CompanyMembership)
            .filter_by(user_id=user.id, company_id=company.id)
            .one()
            .id
        )

    def test_get_modules(self, client, admin_headers, db_session, cashier_user, default_company):
        m_id = self._membership_id(db_session, cashier_user, default_company)
        resp = client.get(f"/api/admin/memberships/{m_id}/modules", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["modules"] == {"pos": "user"}

    def test_put_replaces_grants(
        self, client, admin_headers, db_session, cashier_user, default_company
    ):
        m_id = self._membership_id(db_session, cashier_user, default_company)
        resp = client.put(
            f"/api/admin/memberships/{m_id}/modules",
            headers=admin_headers,
            json={"modules": {"inventory": "manager", "reports": "user"}},
        )
        assert resp.status_code == 200
        assert resp.json()["modules"] == {"inventory": "manager", "reports": "user"}
        # pos grant replaced away
        get_resp = client.get(f"/api/admin/memberships/{m_id}/modules", headers=admin_headers)
        assert get_resp.json()["modules"] == {"inventory": "manager", "reports": "user"}

    def test_put_invalid_module_422(
        self, client, admin_headers, db_session, cashier_user, default_company
    ):
        m_id = self._membership_id(db_session, cashier_user, default_company)
        resp = client.put(
            f"/api/admin/memberships/{m_id}/modules",
            headers=admin_headers,
            json={"modules": {"banking": "user"}},
        )
        assert resp.status_code == 422

    def test_put_admin_target_400(
        self, client, admin_headers, db_session, admin_user, default_company
    ):
        m_id = self._membership_id(db_session, admin_user, default_company)
        resp = client.put(
            f"/api/admin/memberships/{m_id}/modules",
            headers=admin_headers,
            json={"modules": {"pos": "user"}},
        )
        assert resp.status_code == 400

    def test_foreign_company_membership_404(
        self, client, admin_headers, db_session, secondary_company, test_password
    ):
        from tests.conftest import _create_user_with_membership
        user = _create_user_with_membership(
            db_session,
            username="foreigner",
            email="foreigner@example.com",
            password=test_password,
            company=secondary_company,
            role="cashier",
        )
        m_id = self._membership_id(db_session, user, secondary_company)
        resp = client.get(f"/api/admin/memberships/{m_id}/modules", headers=admin_headers)
        assert resp.status_code == 404

    def test_non_admin_403(self, client, manager_headers, db_session, cashier_user, default_company):
        m_id = self._membership_id(db_session, cashier_user, default_company)
        resp = client.get(f"/api/admin/memberships/{m_id}/modules", headers=manager_headers)
        assert resp.status_code == 403
```

(Adjust `_create_user_with_membership` kwargs to conftest's real signature.)

- [ ] **Step 2: Run to verify failures**

Run: `.venv\Scripts\pytest.exe tests/integration/test_admin_endpoints.py -v -k Modules`
Expected: 404s / failures.

- [ ] **Step 3: Implement**

`schemas/admin.py` — add:

```python
from schemas.user import ModuleKey, ModuleLevel


class MembershipModulesPayload(BaseModel):
    modules: dict[ModuleKey, ModuleLevel]


class MembershipModulesResponse(BaseModel):
    membership_id: int
    modules: dict[ModuleKey, ModuleLevel]
```

`services/admin_management.py` — add two methods (follow the class's existing error convention: `ValueError` with "not found" → 404 in the router):

```python
def get_membership_modules(self, membership_id: int, allowed_company_id: int):
    membership = self._get_scoped_membership(membership_id, allowed_company_id)
    rows = (
        self.db.query(MembershipModuleAccess)
        .filter(MembershipModuleAccess.membership_id == membership.id)
        .all()
    )
    return {"membership_id": membership.id, "modules": {r.module: r.level for r in rows}}


def set_membership_modules(self, membership_id: int, allowed_company_id: int, modules: dict):
    membership = self._get_scoped_membership(membership_id, allowed_company_id)
    if membership.role == "admin":
        raise ValueError("Admin memberships have full access")
    self.db.query(MembershipModuleAccess).filter(
        MembershipModuleAccess.membership_id == membership.id
    ).delete()
    for module, level in modules.items():
        self.db.add(
            MembershipModuleAccess(
                membership_id=membership.id, module=module, level=level
            )
        )
    self.db.flush()
    return {"membership_id": membership.id, "modules": dict(modules)}
```

`_get_scoped_membership` = fetch by id filtered to `allowed_company_id`, raise `ValueError("Membership not found")` if missing — reuse an existing helper in the service if one exists (open the file first).

`api/admin.py` — two routes following the file's existing try/except pattern:

```python
@router.get("/memberships/{membership_id}/modules", response_model=MembershipModulesResponse)
def get_membership_modules(
    membership_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_admin),
):
    try:
        return AdminManagementService(db).get_membership_modules(
            membership_id, allowed_company_id=auth.company_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.put("/memberships/{membership_id}/modules", response_model=MembershipModulesResponse)
def set_membership_modules(
    membership_id: int,
    payload: MembershipModulesPayload,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_admin),
):
    try:
        return AdminManagementService(db).set_membership_modules(
            membership_id, allowed_company_id=auth.company_id, modules=payload.modules
        )
    except ValueError as exc:
        status_code = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(exc))
```

- [ ] **Step 4: Run tests**

Run: `.venv\Scripts\pytest.exe tests/integration/test_admin_endpoints.py -q`
Then full backend suite: `.venv\Scripts\pytest.exe tests/integration tests/unit -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add sellary-backend/api/admin.py sellary-backend/schemas/admin.py sellary-backend/services/admin_management.py sellary-backend/tests/integration/test_admin_endpoints.py
git commit -m "feat(admin): GET/PUT membership module grants"
```

---

### Task 9: Frontend — modules in store + nav filtering

**Files:**
- Modify: `sellary-frontend/src/lib/types.ts` (session types)
- Modify: `sellary-frontend/src/lib/store.ts`
- Create: `sellary-frontend/src/lib/modules.ts`
- Modify: `sellary-frontend/src/components/Layout.tsx` (nav array ~line 34)
- Modify: `sellary-frontend/src/components/mobile/BottomTabBar.tsx`, `sellary-frontend/src/components/mobile/MoreSheet.tsx` (same filtering)
- Test: `sellary-frontend/src/lib/__tests__/modules.test.ts`

- [ ] **Step 1: Write failing test for the filter helper**

```typescript
import { describe, expect, it } from 'vitest';
import { canAccessModule, filterNavByModules, type ModuleMap } from '../modules';

const navItems = [
  { name: 'Касса', href: '/pos', module: 'pos' as const },
  { name: 'Товары', href: '/products', module: 'inventory' as const },
  { name: 'Отчеты', href: '/reports', module: 'reports' as const },
  { name: 'Настройки', href: '/settings', module: null },
];

describe('canAccessModule', () => {
  const modules: ModuleMap = { pos: 'user', inventory: 'manager' };

  it('grants at same or lower level', () => {
    expect(canAccessModule(modules, 'pos')).toBe(true);
    expect(canAccessModule(modules, 'inventory', 'manager')).toBe(true);
  });

  it('denies missing module or insufficient level', () => {
    expect(canAccessModule(modules, 'reports')).toBe(false);
    expect(canAccessModule(modules, 'pos', 'manager')).toBe(false);
  });

  it('denies everything on empty map', () => {
    expect(canAccessModule({}, 'pos')).toBe(false);
  });
});

describe('filterNavByModules', () => {
  it('keeps module-less items and granted modules only', () => {
    const result = filterNavByModules(navItems, { pos: 'user' });
    expect(result.map((i) => i.href)).toEqual(['/pos', '/settings']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/__tests__/modules.test.ts`
Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement `src/lib/modules.ts`**

```typescript
export type ModuleKey = 'pos' | 'inventory' | 'purchasing' | 'shop' | 'reports';
export type ModuleLevel = 'user' | 'manager';
export type ModuleMap = Partial<Record<ModuleKey, ModuleLevel>>;

const LEVEL_RANK: Record<ModuleLevel, number> = { user: 1, manager: 2 };

export function canAccessModule(
  modules: ModuleMap,
  module: ModuleKey,
  level: ModuleLevel = 'user',
): boolean {
  const granted = modules[module];
  if (!granted) return false;
  return LEVEL_RANK[granted] >= LEVEL_RANK[level];
}

export function filterNavByModules<T extends { module: ModuleKey | null }>(
  items: T[],
  modules: ModuleMap,
): T[] {
  return items.filter((item) => item.module === null || canAccessModule(modules, item.module));
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run src/lib/__tests__/modules.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into types, store, and nav**

- `src/lib/types.ts`: find the session response types (`CompanySession` / `AuthSession` equivalents — grep for `current_company`) and add `modules: ModuleMap;` (import from `./modules`).
- `src/lib/store.ts`: add `modules: ModuleMap` state (default `{}`), set it wherever `currentCompany` is set from a session response (login/selectCompany/switch/me — grep `current_company: session.current_company`, ~lines 62, 143), clear on logout, and include it in the persist partialize (~line 156). Export a selector hook `useModules`.
- `src/components/Layout.tsx`: extend the `navigation` array items with `module`: `/pos` `/sales` `/shifts` `/customers` → `'pos'`; `/orders` → `'shop'`; `/products` → `'inventory'`; `/suppliers` `/purchase-orders` → `'purchasing'`; `/reports` and `/dashboard` → `'reports'`; `/settings` → `null`. Render from `filterNavByModules(navigation, modules)`.
- Apply the same `module` tagging + filtering to the mobile nav (`BottomTabBar.tsx`, `MoreSheet.tsx` — they have their own item arrays; existing tests in `__tests__` show how items render, update those tests' fixtures if they break).

- [ ] **Step 6: Run frontend checks**

Run: `npx vitest run` then `npm run build`
Expected: tests pass, build clean.

- [ ] **Step 7: Commit**

```bash
git add sellary-frontend/src
git commit -m "feat(frontend): module map in auth store, nav filtered by grants"
```

---

### Task 10: Frontend — route guard

**Files:**
- Create: `sellary-frontend/src/components/ModuleGuard.tsx`
- Modify: each `(protected)` section page to wrap content
- Test: `sellary-frontend/src/components/__tests__/ModuleGuard.test.tsx`

- [ ] **Step 1: Write failing component test**

Look at an existing component test (e.g. `src/components/mobile/__tests__/MobileShell.test.tsx`) for the render/mock setup convention, then:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModuleGuard } from '../ModuleGuard';

const mockModules = vi.hoisted(() => ({ current: {} as Record<string, string> }));

vi.mock('@/lib/store', () => ({
  useModules: () => mockModules.current,
}));

describe('ModuleGuard', () => {
  it('renders children when module granted', () => {
    mockModules.current = { pos: 'user' };
    render(
      <ModuleGuard module="pos">
        <div>secret</div>
      </ModuleGuard>,
    );
    expect(screen.getByText('secret')).toBeInTheDocument();
  });

  it('renders no-access message when missing', () => {
    mockModules.current = {};
    render(
      <ModuleGuard module="inventory">
        <div>secret</div>
      </ModuleGuard>,
    );
    expect(screen.queryByText('secret')).toBeNull();
    expect(screen.getByText('Нет доступа к этому разделу')).toBeInTheDocument();
  });
});
```

(Adapt the store mock path/name to what Task 9 actually exported.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/__tests__/ModuleGuard.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `ModuleGuard`**

```tsx
'use client';

import { useModules } from '@/lib/store';
import { canAccessModule, type ModuleKey, type ModuleLevel } from '@/lib/modules';

interface ModuleGuardProps {
  module: ModuleKey;
  level?: ModuleLevel;
  children: React.ReactNode;
}

export function ModuleGuard({ module, level = 'user', children }: ModuleGuardProps) {
  const modules = useModules();
  if (!canAccessModule(modules, module, level)) {
    return (
      <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-2 text-center">
        <p className="text-lg font-semibold">Нет доступа к этому разделу</p>
        <p className="text-sm text-gray-500">
          Обратитесь к администратору, чтобы получить доступ.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run src/components/__tests__/ModuleGuard.test.tsx`
Expected: PASS

- [ ] **Step 5: Wrap section pages**

In each `(protected)` section's `page.tsx`, wrap the page content: `pos`, `sales`, `shifts`, `customers` → `module="pos"`; `orders` → `"shop"`; `products` → `"inventory"`; `suppliers`, `purchase-orders` → `"purchasing"`; `reports`, `dashboard` → `"reports"`. `settings` — no guard. If a section has nested pages (e.g. `sales/[id]`), wrap in the section's shared layout instead of each page — check whether the section has its own `layout.tsx` first.

- [ ] **Step 6: Run checks + manual smoke**

Run: `npx vitest run` then `npm run build`
Expected: pass, clean build.

- [ ] **Step 7: Commit**

```bash
git add sellary-frontend/src
git commit -m "feat(frontend): ModuleGuard route protection per section"
```

---

### Task 11: Frontend — admin grants UI

**Files:**
- Modify: `sellary-frontend/src/lib/api.ts` (add two calls)
- Modify: `sellary-frontend/src/components/settings/CompanyAdminSection.tsx`

No new automated test here (section is an integration-heavy admin screen; existing pattern in this component has no tests) — verified by manual smoke in Task 12.

- [ ] **Step 1: API functions**

In `src/lib/api.ts`, next to the existing admin/membership calls (grep `memberships`), add:

```typescript
export async function getMembershipModules(membershipId: number): Promise<{ membership_id: number; modules: ModuleMap }> {
  return apiFetch(`/api/admin/memberships/${membershipId}/modules`);
}

export async function putMembershipModules(
  membershipId: number,
  modules: ModuleMap,
): Promise<{ membership_id: number; modules: ModuleMap }> {
  return apiFetch(`/api/admin/memberships/${membershipId}/modules`, {
    method: 'PUT',
    body: JSON.stringify({ modules }),
  });
}
```

(Match the file's actual fetch helper name and error handling — open it first.)

- [ ] **Step 2: Grants editor in `CompanyAdminSection.tsx`**

Open the component; it lists memberships with role editing. Add per non-admin membership a "Доступ к модулям" expander containing a 5-row grid:

| Модуль | Нет | Сотрудник | Менеджер |
|---|---|---|---|
| Касса (pos) | radio | radio | radio |
| Склад (inventory) | ... | | |
| Закупки (purchasing) | | | |
| Магазин (shop) | | | |
| Отчеты (reports) | | | |

Behavior:
- On expand: `getMembershipModules(membershipId)` (TanStack Query, key `['membership-modules', membershipId]`).
- Radio change updates local state; a "Сохранить" button calls `putMembershipModules` with only the non-"Нет" entries, then invalidates the query.
- For `role === 'admin'` memberships render the static text "Полный доступ (администратор)" instead of the grid.
- Module display names: Касса, Склад, Закупки, Магазин, Отчеты. Levels: Нет / Сотрудник / Менеджер.
- Follow the component's existing styling/state patterns (it already does mutations for role changes — mirror that code).

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add sellary-frontend/src/lib/api.ts sellary-frontend/src/components/settings/CompanyAdminSection.tsx
git commit -m "feat(frontend): admin UI for editing membership module grants"
```

---

### Task 12: End-to-end smoke + docs

**Files:**
- Modify: `DOCUMENTATION.md` (API table + feature note), `CLAUDE.md` + `AGENTS.md` (keep consistent — one short bullet each)

- [ ] **Step 1: Full backend suite + compile gate**

Run from `sellary-backend/`:
`.venv\Scripts\pytest.exe tests/integration tests/unit -q`
`.venv\Scripts\python.exe -m compileall api core models repositories schemas services main.py`
Expected: all pass, compile clean.

- [ ] **Step 2: Manual smoke (backend + frontend running)**

Start both (`run-client-server.bat` from repo root). Then:
1. Log in as an admin → all sidebar items visible; settings → employees → pick a non-admin member → set grants: only Склад (Сотрудник) → save.
2. Log in as that member (fresh browser/incognito) → sidebar shows only Товары + Настройки; navigating to `/pos` by URL shows "Нет доступа к этому разделу"; `GET /api/sales` from its session returns 403.
3. Change the member's grant to add Касса → member refreshes → Касса appears without re-login (modules come from `/api/auth/me` on load; permission checks are DB-backed per request).

Fix anything broken before proceeding.

- [ ] **Step 3: Docs**

- `DOCUMENTATION.md`: add `membership_module_access` to the schema section; add the two admin endpoints + the module×level access column note to the API table.
- `CLAUDE.md` and `AGENTS.md`: one bullet under multi-tenancy: module-level access (`pos|inventory|purchasing|shop|reports` × `user|manager`) via `require_module`; admin bypasses; cashier sync channel unaffected.

- [ ] **Step 4: Final commit**

```bash
git add DOCUMENTATION.md CLAUDE.md AGENTS.md
git commit -m "docs: module permissions (membership_module_access, require_module)"
```

---

## Out of scope (per spec)

- No changes to `sellary-cashier/`, `sync.py`, `device_auth.py`, shopper-facing `shop.py`/`shop_orders.py`/`telegram_webhook.py`.
- No per-record permissions, no per-company module packaging.
- Backend/frontend folder restructuring is Phase 2/3 — separate plans.
