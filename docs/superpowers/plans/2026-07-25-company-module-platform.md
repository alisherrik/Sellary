# Company Module Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every company its own set of enabled modules, owner-controlled, so Sellary can be provisioned for an online-only store, a warehouse or a kitchen instead of only a retail shop.

**Architecture:** Module access becomes two layers — a new `company_modules` table (what the company bought, owner-controlled) intersected with the existing `membership_module_access` grant (what the user may open, company-admin-controlled). The company check runs *before* the `admin` early-return in `require_module`, so a company without a module is closed to its own admin. `pos` splits into `register` / `sales` / `customers` so a store with no till is expressible.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, PostgreSQL, pytest (backend); Next.js 14 App Router, TypeScript, Zustand, vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-07-25-company-module-platform-design.md`

---

## File Structure

**Backend — create**
- `sellary-backend/core/modules.py` — canonical module registry, levels, level ranks, business-type presets. The single source of truth every other backend file imports.
- `sellary-backend/models/company_module.py` — `CompanyModule` ORM model.
- `sellary-backend/repositories/company_module_repository.py` — reads and writes `company_modules`.
- `sellary-backend/alembic/versions/20260725_1000-c0d1e2f3a4b5_add_company_modules.py` — table, column, backfill, `pos` split.
- `sellary-backend/tests/unit/test_modules_registry.py` — preset and registry invariants.
- `sellary-backend/tests/integration/test_company_modules.py` — enforcement, session shape, owner endpoints.
- `scripts/check_module_parity.py` — CI drift check between Python and TypeScript module lists.

**Backend — modify**
- `models/membership_module_access.py` — drop its own `MODULES`/`LEVELS`, re-export from `core.modules`.
- `api/dependencies.py:228-268` — two-layer `require_module`.
- `services/auth_service.py:176-194` — `_module_map` intersects with the company set.
- `schemas/user.py:8` — seven-key `ModuleKey`; `CompanySession`/`AuthSession` gain `company_modules`.
- `schemas/admin.py` — company module payload/response schemas.
- `services/admin_management.py` — company module read/write, `business_type` on create/update.
- `api/owner.py` — `GET`/`PUT /companies/{id}/modules`.
- `api/shop.py`, `api/shop_orders.py` — storefront 404 when `shop` is off.
- `models/company.py` — `business_type` column.
- `tests/conftest.py`, `tests/integration/conftest.py` — fixtures enable company modules and use the new keys.
- `railway.toml:9` — migration pin.

**Frontend — modify**
- `src/lib/modules.ts` — seven-key `ModuleKey`.
- `src/lib/moduleNav.ts` — `MODULE_NAV` restructured to seven modules.
- `src/lib/store.ts` — session carries `companyModules`.
- `src/app/(protected)/pos/page.tsx` — top-bar links conditional on module.
- `src/components/owner/OwnerDashboard.tsx` — business-type select and module checkboxes.
- `src/lib/api.ts` — owner module endpoints.

---

## Task 1: Canonical module registry

**Files:**
- Create: `sellary-backend/core/modules.py`
- Create: `sellary-backend/tests/unit/test_modules_registry.py`
- Modify: `sellary-backend/models/membership_module_access.py`

- [ ] **Step 1: Write the failing test**

Create `sellary-backend/tests/unit/test_modules_registry.py`:

```python
from core.modules import BUSINESS_TYPE_PRESETS, LEVEL_RANK, LEVELS, MODULES


class TestModuleRegistry:
    def test_modules_are_the_seven_business_domains(self):
        assert MODULES == (
            "register",
            "sales",
            "customers",
            "inventory",
            "purchasing",
            "shop",
            "reports",
        )

    def test_levels_rank_manager_above_user(self):
        assert LEVELS == ("user", "manager")
        assert LEVEL_RANK["manager"] > LEVEL_RANK["user"]

    def test_every_preset_names_only_real_modules(self):
        for business_type, modules in BUSINESS_TYPE_PRESETS.items():
            unknown = set(modules) - set(MODULES)
            assert not unknown, f"{business_type} names unknown modules: {unknown}"

    def test_online_preset_has_no_register(self):
        # The whole point of the split: an online store has no till.
        assert "register" not in BUSINESS_TYPE_PRESETS["online"]
        assert "shop" in BUSINESS_TYPE_PRESETS["online"]

    def test_every_preset_includes_inventory(self):
        # Every vertical sells or moves stock.
        for business_type, modules in BUSINESS_TYPE_PRESETS.items():
            assert "inventory" in modules, business_type
```

- [ ] **Step 2: Run test to verify it fails**

Run from `sellary-backend/`: `.venv\Scripts\pytest.exe tests/unit/test_modules_registry.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'core.modules'`

- [ ] **Step 3: Write the registry**

Create `sellary-backend/core/modules.py`:

```python
"""Canonical module registry.

A module is a business domain, not a screen group. Access is two-layered:
`company_modules` says what a company has (owner-controlled, a commercial
decision), `membership_module_access` says what a user may open within it.

This tuple is the single source of truth on the backend. `lib/modules.ts`
mirrors it on the frontend; `scripts/check_module_parity.py` fails CI if the
two drift.
"""

MODULES = (
    "register",     # Касса, Смена
    "sales",        # История продаж, возвраты, аннулирование
    "customers",    # Клиенты, долги
    "inventory",    # Товары, категории
    "purchasing",   # Поставщики, Заказы поставщикам
    "shop",         # Telegram-магазин, Заказы
    "reports",      # Дашборд, Аналитика
)

LEVELS = ("user", "manager")

LEVEL_RANK = {"user": 1, "manager": 2}

# A business type is a label and a starting point, never a lock. The owner
# edits the resulting module set freely afterwards.
#
# `kitchen` and `production` are composed from modules that exist today. They
# do not yet carry recipes, stations, BOMs or work orders — those arrive with
# their own specs and extend the preset then.
BUSINESS_TYPE_PRESETS: dict[str, tuple[str, ...]] = {
    "retail": ("register", "sales", "customers", "inventory", "purchasing", "reports"),
    "online": ("sales", "customers", "inventory", "shop", "reports"),
    "warehouse": ("inventory", "purchasing", "reports"),
    "kitchen": ("register", "sales", "inventory", "purchasing", "reports"),
    "production": ("sales", "customers", "inventory", "purchasing", "reports"),
}

BUSINESS_TYPES = tuple(BUSINESS_TYPE_PRESETS)
```

- [ ] **Step 4: Point the model at the registry**

Replace the tuple declarations in `sellary-backend/models/membership_module_access.py`. The file currently opens with:

```python
from core.database import Base

MODULES = ("pos", "inventory", "purchasing", "shop", "reports")
LEVELS = ("user", "manager")
```

Change to:

```python
from core.database import Base
from core.modules import LEVELS, MODULES  # noqa: F401  (re-exported for existing importers)
```

Leave the rest of the file unchanged.

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv\Scripts\pytest.exe tests/unit/test_modules_registry.py -v`
Expected: 5 passed

- [ ] **Step 6: Commit**

```bash
git add sellary-backend/core/modules.py sellary-backend/tests/unit/test_modules_registry.py sellary-backend/models/membership_module_access.py
git commit -m "feat(modules): canonical seven-module registry with business-type presets"
```

---

## Task 2: CompanyModule model and repository

**Files:**
- Create: `sellary-backend/models/company_module.py`
- Create: `sellary-backend/repositories/company_module_repository.py`
- Modify: `sellary-backend/models/company.py`
- Modify: `sellary-backend/models/__init__.py`
- Test: `sellary-backend/tests/integration/test_company_modules.py`

- [ ] **Step 1: Write the failing test**

Create `sellary-backend/tests/integration/test_company_modules.py`:

```python
"""Company-level module enablement: storage, enforcement, session shape."""

from repositories.company_module_repository import CompanyModuleRepository


class TestCompanyModuleRepository:
    def test_set_modules_replaces_the_whole_set(self, db_session, default_company):
        repo = CompanyModuleRepository(db_session)
        repo.set_modules(default_company.id, ["inventory", "shop"])
        db_session.flush()
        assert sorted(repo.enabled_modules(default_company.id)) == ["inventory", "shop"]

        repo.set_modules(default_company.id, ["reports"])
        db_session.flush()
        assert repo.enabled_modules(default_company.id) == ["reports"]

    def test_has_module_is_true_only_for_enabled(self, db_session, default_company):
        repo = CompanyModuleRepository(db_session)
        repo.set_modules(default_company.id, ["inventory"])
        db_session.flush()
        assert repo.has_module(default_company.id, "inventory") is True
        assert repo.has_module(default_company.id, "shop") is False

    def test_set_modules_rejects_an_unknown_module(self, db_session, default_company):
        repo = CompanyModuleRepository(db_session)
        try:
            repo.set_modules(default_company.id, ["inventory", "teleportation"])
        except ValueError as exc:
            assert "teleportation" in str(exc)
        else:
            raise AssertionError("expected ValueError for an unknown module")

    def test_enabled_modules_returns_registry_order(self, db_session, default_company):
        repo = CompanyModuleRepository(db_session)
        repo.set_modules(default_company.id, ["reports", "inventory", "register"])
        db_session.flush()
        # Registry order, not insertion order — the owner panel renders this list.
        assert repo.enabled_modules(default_company.id) == ["register", "inventory", "reports"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest.exe tests/integration/test_company_modules.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'repositories.company_module_repository'`

- [ ] **Step 3: Write the model**

Create `sellary-backend/models/company_module.py`:

```python
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from core.database import Base


class CompanyModule(Base):
    """Company-level module enablement. A row means the company has it.

    This is the commercial layer — what the customer bought. It is owner-
    controlled and intersected with the per-membership grant to decide what a
    given user may open.
    """

    __tablename__ = "company_modules"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(
        Integer,
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    module = Column(String(20), nullable=False)
    enabled_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("company_id", "module", name="uq_company_modules_company_module"),
    )

    company = relationship("Company", back_populates="modules")
```

- [ ] **Step 4: Add the column and relationship to Company**

In `sellary-backend/models/company.py`, add the column after `is_active`:

```python
    is_active = Column(Boolean, default=True, nullable=False)
    # Label only. Seeds the module preset in the owner panel; enforces nothing.
    business_type = Column(String(30), nullable=True)
```

And add the relationship alongside the existing ones (after `memberships`):

```python
    modules = relationship(
        "CompanyModule",
        back_populates="company",
        cascade="all, delete-orphan",
    )
```

- [ ] **Step 5: Register the model for metadata**

In `sellary-backend/models/__init__.py`, add an import next to the other model imports so `Base.metadata` sees the table:

```python
from models.company_module import CompanyModule  # noqa: F401
```

- [ ] **Step 6: Write the repository**

Create `sellary-backend/repositories/company_module_repository.py`:

```python
from sqlalchemy.orm import Session

from core.modules import MODULES
from models.company_module import CompanyModule


class CompanyModuleRepository:
    """Reads and writes the company-level module set."""

    def __init__(self, db: Session):
        self.db = db

    def enabled_modules(self, company_id: int) -> list[str]:
        """Enabled modules in registry order — the order the UI renders."""
        rows = (
            self.db.query(CompanyModule.module)
            .filter(CompanyModule.company_id == company_id)
            .all()
        )
        enabled = {row[0] for row in rows}
        return [module for module in MODULES if module in enabled]

    def has_module(self, company_id: int, module: str) -> bool:
        return (
            self.db.query(CompanyModule.id)
            .filter(
                CompanyModule.company_id == company_id,
                CompanyModule.module == module,
            )
            .first()
            is not None
        )

    def set_modules(self, company_id: int, modules: list[str]) -> list[str]:
        """Replace the company's module set. Does not commit."""
        unknown = [module for module in modules if module not in MODULES]
        if unknown:
            raise ValueError(f"Unknown modules: {', '.join(sorted(unknown))}")

        self.db.query(CompanyModule).filter(
            CompanyModule.company_id == company_id
        ).delete(synchronize_session=False)
        for module in dict.fromkeys(modules):
            self.db.add(CompanyModule(company_id=company_id, module=module))
        return [module for module in MODULES if module in set(modules)]
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `.venv\Scripts\pytest.exe tests/integration/test_company_modules.py -v`
Expected: 4 passed

- [ ] **Step 8: Commit**

```bash
git add sellary-backend/models/company_module.py sellary-backend/models/company.py sellary-backend/models/__init__.py sellary-backend/repositories/company_module_repository.py sellary-backend/tests/integration/test_company_modules.py
git commit -m "feat(modules): company_modules table, model and repository"
```

---

## Task 3: Migration — table, column, backfill, pos split

**Files:**
- Create: `sellary-backend/alembic/versions/20260725_1000-c0d1e2f3a4b5_add_company_modules.py`
- Modify: `railway.toml:9`

The repository has two Alembic heads (`20260319_0001` and `b9c0d1e2f3a4`). Chain onto `b9c0d1e2f3a4` — the one `railway.toml` pins — and update the pin in the same commit. Do not merge the heads here; that is unrelated work.

- [ ] **Step 1: Write the migration**

Create `sellary-backend/alembic/versions/20260725_1000-c0d1e2f3a4b5_add_company_modules.py`:

```python
"""add company_modules and split pos into register/sales/customers

Revision ID: c0d1e2f3a4b5
Revises: b9c0d1e2f3a4
Create Date: 2026-07-25 10:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c0d1e2f3a4b5"
down_revision: Union[str, None] = "b9c0d1e2f3a4"
branch_labels = None
depends_on = None

# Every existing company keeps everything it had. `shop` is conditional
# because it was already gated by is_marketplace_enabled.
BASE_MODULES = ("register", "sales", "customers", "inventory", "purchasing", "reports")

# The three domains that used to live behind the single `pos` key.
POS_SPLIT = ("register", "sales", "customers")

LEVEL_RANK = {"user": 1, "manager": 2}


def upgrade() -> None:
    op.add_column("companies", sa.Column("business_type", sa.String(length=30), nullable=True))

    op.create_table(
        "company_modules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "company_id",
            sa.Integer(),
            sa.ForeignKey("companies.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("module", sa.String(length=20), nullable=False),
        sa.Column(
            "enabled_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "company_id", "module", name="uq_company_modules_company_module"
        ),
    )

    conn = op.get_bind()

    # 1. Company-level backfill: nobody loses a screen they had yesterday.
    companies = conn.execute(
        sa.text("SELECT id, is_marketplace_enabled FROM companies")
    ).fetchall()
    company_rows = []
    for company_id, marketplace_enabled in companies:
        for module in BASE_MODULES:
            company_rows.append({"company_id": company_id, "module": module})
        if marketplace_enabled:
            company_rows.append({"company_id": company_id, "module": "shop"})
    if company_rows:
        conn.execute(
            sa.text(
                "INSERT INTO company_modules (company_id, module) "
                "VALUES (:company_id, :module)"
            ),
            company_rows,
        )

    # 2. Membership-level split: pos -> register + sales + customers, same level.
    pos_grants = conn.execute(
        sa.text(
            "SELECT membership_id, level FROM membership_module_access "
            "WHERE module = 'pos'"
        )
    ).fetchall()
    split_rows = [
        {"membership_id": membership_id, "module": module, "level": level}
        for membership_id, level in pos_grants
        for module in POS_SPLIT
    ]
    if split_rows:
        conn.execute(
            sa.text(
                "INSERT INTO membership_module_access (membership_id, module, level) "
                "VALUES (:membership_id, :module, :level) "
                "ON CONFLICT (membership_id, module) DO NOTHING"
            ),
            split_rows,
        )
    conn.execute(sa.text("DELETE FROM membership_module_access WHERE module = 'pos'"))


def downgrade() -> None:
    conn = op.get_bind()

    # Collapse the three back into one `pos` grant at the highest level held.
    grants = conn.execute(
        sa.text(
            "SELECT membership_id, module, level FROM membership_module_access "
            "WHERE module IN ('register', 'sales', 'customers')"
        )
    ).fetchall()
    best: dict[int, str] = {}
    for membership_id, _module, level in grants:
        current = best.get(membership_id)
        if current is None or LEVEL_RANK[level] > LEVEL_RANK[current]:
            best[membership_id] = level
    conn.execute(
        sa.text(
            "DELETE FROM membership_module_access "
            "WHERE module IN ('register', 'sales', 'customers')"
        )
    )
    if best:
        conn.execute(
            sa.text(
                "INSERT INTO membership_module_access (membership_id, module, level) "
                "VALUES (:membership_id, 'pos', :level) "
                "ON CONFLICT (membership_id, module) DO NOTHING"
            ),
            [
                {"membership_id": membership_id, "level": level}
                for membership_id, level in best.items()
            ],
        )

    op.drop_table("company_modules")
    op.drop_column("companies", "business_type")
```

- [ ] **Step 2: Verify the revision chains onto the pinned head**

Run from `sellary-backend/`: `.venv\Scripts\alembic.exe heads`
Expected: two heads listed, one of which is `c0d1e2f3a4b5 (head)`. `b9c0d1e2f3a4` must no longer be a head.

- [ ] **Step 3: Apply the migration locally**

Run: `.venv\Scripts\alembic.exe upgrade c0d1e2f3a4b5`
Expected: `Running upgrade b9c0d1e2f3a4 -> c0d1e2f3a4b5, add company_modules and split pos into register/sales/customers`

- [ ] **Step 4: Verify the downgrade path**

Run: `.venv\Scripts\alembic.exe downgrade b9c0d1e2f3a4` then `.venv\Scripts\alembic.exe upgrade c0d1e2f3a4b5`
Expected: both complete without error.

- [ ] **Step 5: Guard the migration's module constants**

The suite runs against an already-migrated schema, so the backfill SQL itself is verified by the upgrade/downgrade round-trip in Steps 3–4. What a test *can* catch cheaply is the realistic failure: someone renames a module later and the migration keeps backfilling a dead key. Append to `sellary-backend/tests/unit/test_modules_registry.py`:

```python
import importlib.util
from pathlib import Path


def _load_migration():
    path = (
        Path(__file__).resolve().parents[2]
        / "alembic"
        / "versions"
        / "20260725_1000-c0d1e2f3a4b5_add_company_modules.py"
    )
    spec = importlib.util.spec_from_file_location("migration_c0d1e2f3a4b5", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestCompanyModulesMigrationConstants:
    def test_backfill_names_only_real_modules(self):
        migration = _load_migration()
        assert set(migration.BASE_MODULES) <= set(MODULES)
        assert set(migration.POS_SPLIT) <= set(MODULES)

    def test_backfill_covers_every_module_except_shop(self):
        # shop stays conditional on is_marketplace_enabled; everything else is
        # granted to every existing company so nobody loses a screen.
        migration = _load_migration()
        assert set(migration.BASE_MODULES) == set(MODULES) - {"shop"}

    def test_pos_split_is_the_three_domains_that_replaced_it(self):
        migration = _load_migration()
        assert migration.POS_SPLIT == ("register", "sales", "customers")
```

Run: `.venv\Scripts\pytest.exe tests/unit/test_modules_registry.py -v`
Expected: 8 passed

- [ ] **Step 6: Update the deploy pin**

In `railway.toml` line 9, change:

```toml
preDeployCommand = "alembic upgrade b9c0d1e2f3a4"
```

to:

```toml
preDeployCommand = "alembic upgrade c0d1e2f3a4b5"
```

- [ ] **Step 7: Commit**

```bash
git add sellary-backend/alembic/versions/20260725_1000-c0d1e2f3a4b5_add_company_modules.py railway.toml sellary-backend/tests/unit/test_modules_registry.py
git commit -m "feat(modules): migration for company_modules and the pos split"
```

---

## Task 4: Test fixtures enable company modules

Without this, every existing module-access test fails: the fixtures create companies directly through the ORM, so no company has any module and the new company check returns 403 everywhere.

**Files:**
- Modify: `sellary-backend/tests/conftest.py:136-150` (`_grant_modules_for_role`)
- Modify: `sellary-backend/tests/conftest.py:128-133` (`secondary_company`)

- [ ] **Step 1: Enable all modules on every test company**

In `sellary-backend/tests/conftest.py`, add this helper directly above `_grant_modules_for_role`:

```python
def _enable_all_company_modules(db_session: Session, company: Company) -> None:
    """Mirror the c0d1e2f3a4b5 backfill: a test company has every module.

    Tests that care about a company *lacking* a module remove rows explicitly.
    """
    from models.company_module import CompanyModule
    from core.modules import MODULES

    existing = {
        row[0]
        for row in db_session.query(CompanyModule.module)
        .filter(CompanyModule.company_id == company.id)
        .all()
    }
    for module in MODULES:
        if module not in existing:
            db_session.add(CompanyModule(company_id=company.id, module=module))
    db_session.flush()
```

- [ ] **Step 2: Call it from the company fixtures**

Change the `default_company` fixture (currently at `tests/conftest.py:123-125`) to:

```python
@pytest.fixture
def default_company(db_session: Session) -> Company:
    company_id = db_session.info["default_company_id"]
    company = db_session.get(Company, company_id)
    _enable_all_company_modules(db_session, company)
    return company
```

And `secondary_company` to:

```python
@pytest.fixture
def secondary_company(db_session: Session) -> Company:
    company = Company(name="Second Company", slug="second-company", is_active=True)
    db_session.add(company)
    db_session.flush()
    _enable_all_company_modules(db_session, company)
    return company
```

- [ ] **Step 3: Update the membership grant helper to the new keys**

Replace the body of `_grant_modules_for_role` (currently `tests/conftest.py:136-150`) so a non-manager gets the three domains that used to be `pos`:

```python
def _grant_modules_for_role(db_session: Session, membership: CompanyMembership) -> None:
    """Mirror the c0d1e2f3a4b5 state: manager -> all modules at manager,
    other non-admin roles -> register/sales/customers at user (the old `pos`),
    admin -> nothing (bypasses the membership layer)."""
    from core.modules import MODULES

    if membership.role == "admin":
        return
    if membership.role == "manager":
        modules = [(module, "manager") for module in MODULES]
    else:
        modules = [(module, "user") for module in ("register", "sales", "customers")]
    for module, level in modules:
        db_session.add(
            MembershipModuleAccess(membership_id=membership.id, module=module, level=level)
        )
    db_session.flush()
```

Also make sure the company owning this membership has its modules enabled — add this as the first line of the function body, before the `admin` check:

```python
    _enable_all_company_modules(db_session, membership.company)
```

- [ ] **Step 4: Run the existing module-access suites**

Run: `.venv\Scripts\pytest.exe tests/integration/test_module_access_pos.py tests/integration/test_module_access_inventory.py tests/integration/test_module_access_misc.py -v`
Expected: all pass. They will still pass because `register`/`sales`/`customers` cover what `pos` covered, and every test company has every module.

- [ ] **Step 5: Commit**

```bash
git add sellary-backend/tests/conftest.py
git commit -m "test(modules): fixtures enable company modules and use the split keys"
```

---

## Task 5: Two-layer require_module

**Files:**
- Modify: `sellary-backend/api/dependencies.py:228-268`
- Modify: `sellary-backend/schemas/user.py:8`
- Test: `sellary-backend/tests/integration/test_company_modules.py`

- [ ] **Step 1: Write the failing test**

Append to `sellary-backend/tests/integration/test_company_modules.py`:

```python
from models.company_module import CompanyModule


class TestCompanyModuleEnforcement:
    def test_company_without_module_blocks_a_granted_user(
        self, client, db_session, default_company, manager_headers
    ):
        db_session.query(CompanyModule).filter(
            CompanyModule.company_id == default_company.id,
            CompanyModule.module == "inventory",
        ).delete(synchronize_session=False)
        db_session.flush()

        resp = client.get("/api/products", headers=manager_headers)
        assert resp.status_code == 403
        assert resp.json()["detail"]["code"] == "module_not_enabled"
        assert resp.json()["detail"]["module"] == "inventory"

    def test_company_without_module_blocks_the_admin_too(
        self, client, db_session, default_company, admin_headers
    ):
        # The admin bypass covers the membership layer only. A company that did
        # not buy a module must be closed to its own admin.
        db_session.query(CompanyModule).filter(
            CompanyModule.company_id == default_company.id,
            CompanyModule.module == "inventory",
        ).delete(synchronize_session=False)
        db_session.flush()

        resp = client.get("/api/products", headers=admin_headers)
        assert resp.status_code == 403
        assert resp.json()["detail"]["code"] == "module_not_enabled"

    def test_company_with_module_still_needs_the_membership_grant(
        self, client, no_module_headers
    ):
        # Regression: the company layer must not open anything on its own.
        resp = client.get("/api/products", headers=no_module_headers)
        assert resp.status_code == 403
        assert resp.json()["detail"]["code"] == "module_access_denied"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest.exe tests/integration/test_company_modules.py::TestCompanyModuleEnforcement -v`
Expected: the first two FAIL — the company check does not exist yet, so `/api/products` returns 200.

- [ ] **Step 3: Widen the ModuleKey literal**

In `sellary-backend/schemas/user.py` line 8, change:

```python
ModuleKey = Literal["pos", "inventory", "purchasing", "shop", "reports"]
```

to:

```python
ModuleKey = Literal[
    "register", "sales", "customers", "inventory", "purchasing", "shop", "reports"
]
```

- [ ] **Step 4: Add the company layer to require_module**

In `sellary-backend/api/dependencies.py`, add the import next to the other model imports:

```python
from repositories.company_module_repository import CompanyModuleRepository
```

Then replace the `checker` body inside `require_module` (currently `api/dependencies.py:238-254`) with:

```python
    def checker(
        auth: AuthContext = Depends(get_auth_context),
        db: Session = Depends(get_db),
    ) -> AuthContext:
        # Company layer first: `admin` bypasses the membership grant, never the
        # company's own module set. A company that did not buy `shop` must be
        # closed to its admin too.
        if not CompanyModuleRepository(db).has_module(auth.company_id, module):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"code": "module_not_enabled", "module": module},
            )
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
```

Leave the existing `if grant is None or ...` block that follows exactly as it is.

- [ ] **Step 5: Update the routers that guard on `pos`**

Find every call site: `grep -rn "require_module(\"pos\"" sellary-backend/api/`

Map each to its new module:
- `api/sales.py` → `require_module("sales", ...)`
- `api/cash_shifts.py` → `require_module("register", ...)`
- `api/customers.py` → `require_module("customers", ...)`

Leave the `level` argument of every call untouched.

- [ ] **Step 6: Run the tests**

Run: `.venv\Scripts\pytest.exe tests/integration/test_company_modules.py tests/integration/test_module_access_pos.py -v`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add sellary-backend/api/dependencies.py sellary-backend/schemas/user.py sellary-backend/api/sales.py sellary-backend/api/cash_shifts.py sellary-backend/api/customers.py sellary-backend/tests/integration/test_company_modules.py
git commit -m "feat(modules): enforce company-level module enablement ahead of the admin bypass"
```

---

## Task 6: Sessions carry the company set and the intersection

**Files:**
- Modify: `sellary-backend/services/auth_service.py:176-194`
- Modify: `sellary-backend/schemas/user.py` (`CompanySession`, `AuthSession`)
- Test: `sellary-backend/tests/integration/test_company_modules.py`

- [ ] **Step 1: Write the failing test**

Append to `sellary-backend/tests/integration/test_company_modules.py`:

```python
class TestSessionModuleShape:
    def test_session_reports_company_modules_and_the_intersection(
        self, client, db_session, default_company, manager_credentials
    ):
        db_session.query(CompanyModule).filter(
            CompanyModule.company_id == default_company.id,
            CompanyModule.module == "shop",
        ).delete(synchronize_session=False)
        db_session.flush()

        login = client.post("/api/auth/login", json=manager_credentials)
        assert login.status_code == 200
        resp = client.post(
            "/api/auth/select-company",
            json={"company_id": default_company.id},
            headers={"Authorization": f"Bearer {login.json()['login_token']}"},
        )
        assert resp.status_code == 200
        body = resp.json()

        assert "shop" not in body["company_modules"]
        # The manager fixture is granted every module, but the company no
        # longer has shop — the intersection must drop it.
        assert "shop" not in body["modules"]
        assert body["modules"]["inventory"] == "manager"

    def test_admin_gets_manager_on_exactly_the_company_modules(
        self, client, db_session, default_company, admin_credentials
    ):
        db_session.query(CompanyModule).filter(
            CompanyModule.company_id == default_company.id,
            CompanyModule.module == "purchasing",
        ).delete(synchronize_session=False)
        db_session.flush()

        login = client.post("/api/auth/login", json=admin_credentials)
        resp = client.post(
            "/api/auth/select-company",
            json={"company_id": default_company.id},
            headers={"Authorization": f"Bearer {login.json()['login_token']}"},
        )
        body = resp.json()
        assert "purchasing" not in body["modules"]
        assert body["modules"]["inventory"] == "manager"
```

If `manager_credentials` / `admin_credentials` fixtures do not exist, add them to `sellary-backend/tests/integration/conftest.py`:

```python
@pytest.fixture
def manager_credentials(test_password):
    return {"username": "manager", "password": test_password}


@pytest.fixture
def admin_credentials(test_password):
    return {"username": "admin", "password": test_password}
```

Check the usernames the existing `manager_headers` / `admin_headers` fixtures create and use those exact values.

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest.exe tests/integration/test_company_modules.py::TestSessionModuleShape -v`
Expected: FAIL with `KeyError: 'company_modules'`

- [ ] **Step 3: Add the field to the session schemas**

In `sellary-backend/schemas/user.py`, add one field to each of `CompanySession` and `AuthSession`:

```python
class CompanySession(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: User
    current_company: CompanySummary
    companies: list[CompanySummary]
    modules: dict[ModuleKey, ModuleLevel] = {}
    # What the company has, regardless of this user's grants. Drives the
    # "not part of your plan" copy; `modules` drives the nav.
    company_modules: list[ModuleKey] = []


class AuthSession(BaseModel):
    user: User
    current_company: CompanySummary
    companies: list[CompanySummary]
    modules: dict[ModuleKey, ModuleLevel] = {}
    company_modules: list[ModuleKey] = []
```

- [ ] **Step 4: Intersect in `_module_map` and populate the new field**

In `sellary-backend/services/auth_service.py`, add the import:

```python
from repositories.company_module_repository import CompanyModuleRepository
```

Replace `_module_map` (currently `services/auth_service.py:176-194`) with:

```python
    def _company_modules(self, company_id: int) -> list[str]:
        return CompanyModuleRepository(self.db).enabled_modules(company_id)

    def _module_map(
        self, membership: CompanyMembership | None, role: str, company_id: int
    ) -> dict[str, str]:
        """Resolve the effective module->level map.

        Effective access is the company's module set intersected with this
        membership's grants. Admins bypass the membership layer — they are
        manager on every module the company has — but never the company layer.
        """
        enabled = set(self._company_modules(company_id))
        if role == "admin":
            return {module: "manager" for module in MODULES if module in enabled}
        if membership is None:
            return {}
        rows = (
            self.db.query(MembershipModuleAccess)
            .filter(MembershipModuleAccess.membership_id == membership.id)
            .all()
        )
        return {row.module: row.level for row in rows if row.module in enabled}
```

- [ ] **Step 5: Update the three call sites**

`services/auth_service.py` calls `_module_map` at three places. Update each to pass the company id and to set the new field:

At line ~242 (`create_company_session`):

```python
            modules=self._module_map(membership, membership.role, company_id),
            company_modules=self._company_modules(company_id),
```

At line ~272 (`create_super_admin_company_session`):

```python
            modules=self._module_map(None, "admin", company.id),
            company_modules=self._company_modules(company.id),
```

At line ~320 (the `/auth/me` session builder):

```python
            modules=self._module_map(membership, current_company.role, current_company.id),
            company_modules=self._company_modules(current_company.id),
```

- [ ] **Step 6: Run the tests**

Run: `.venv\Scripts\pytest.exe tests/integration/test_company_modules.py tests/integration/test_auth_endpoints.py -v`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add sellary-backend/services/auth_service.py sellary-backend/schemas/user.py sellary-backend/tests/integration/test_company_modules.py sellary-backend/tests/integration/conftest.py
git commit -m "feat(modules): sessions carry company_modules and the effective intersection"
```

---

## Task 7: Storefront closes when shop is off

The shopper-facing endpoints are public — no `AuthContext`, so `require_module` cannot apply. They get their own check.

**Files:**
- Modify: `sellary-backend/api/shop_dependencies.py`
- Test: `sellary-backend/tests/integration/test_company_modules.py`

- [ ] **Step 1: Write the failing test**

Append to `sellary-backend/tests/integration/test_company_modules.py`:

```python
class TestStorefrontModuleGate:
    def test_storefront_404s_when_shop_module_is_off(
        self, client, db_session, default_company
    ):
        default_company.is_marketplace_enabled = True
        db_session.query(CompanyModule).filter(
            CompanyModule.company_id == default_company.id,
            CompanyModule.module == "shop",
        ).delete(synchronize_session=False)
        db_session.flush()

        resp = client.get(f"/api/shop/{default_company.slug}")
        assert resp.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest.exe tests/integration/test_company_modules.py::TestStorefrontModuleGate -v`
Expected: FAIL — a 200 is returned.

- [ ] **Step 3: Add the check to the storefront company resolver**

Open `sellary-backend/api/shop_dependencies.py` and find the dependency that resolves a company from the slug (it raises 404 for an unknown or disabled storefront). Add the module check to the same guard, so an off module is indistinguishable from a missing store:

```python
from repositories.company_module_repository import CompanyModuleRepository
```

and inside the resolver, immediately after the company is found and before it is returned:

```python
    # `shop` off means the storefront does not exist, not that it is forbidden —
    # a 403 would tell a stranger the company is here.
    if not CompanyModuleRepository(db).has_module(company.id, "shop"):
        raise HTTPException(status_code=404, detail="Store not found")
```

Match the exact wording of the existing 404 detail in that file so the two responses are identical.

- [ ] **Step 4: Run the tests**

Run: `.venv\Scripts\pytest.exe tests/integration/test_company_modules.py tests/integration/test_shop_endpoints.py -v`
Expected: all pass. (If `test_shop_endpoints.py` does not exist, run the shop-related file that does — find it with `ls tests/integration | grep -i shop`.)

- [ ] **Step 5: Commit**

```bash
git add sellary-backend/api/shop_dependencies.py sellary-backend/tests/integration/test_company_modules.py
git commit -m "feat(modules): storefront 404s when the shop module is off"
```

---

## Task 8: Owner endpoints for company modules

**Files:**
- Modify: `sellary-backend/schemas/admin.py`
- Modify: `sellary-backend/services/admin_management.py`
- Modify: `sellary-backend/api/owner.py`
- Test: `sellary-backend/tests/integration/test_company_modules.py`

- [ ] **Step 1: Write the failing test**

Append to `sellary-backend/tests/integration/test_company_modules.py`:

```python
class TestOwnerCompanyModuleEndpoints:
    def test_owner_reads_and_replaces_the_module_set(
        self, client, owner_headers, default_company
    ):
        resp = client.put(
            f"/api/owner/companies/{default_company.id}/modules",
            headers=owner_headers,
            json={"business_type": "online", "modules": ["inventory", "shop", "sales"]},
        )
        assert resp.status_code == 200
        assert resp.json()["modules"] == ["sales", "inventory", "shop"]  # registry order
        assert resp.json()["business_type"] == "online"

        read = client.get(
            f"/api/owner/companies/{default_company.id}/modules", headers=owner_headers
        )
        assert read.json()["modules"] == ["sales", "inventory", "shop"]

    def test_company_admin_cannot_touch_company_modules(
        self, client, admin_headers, default_company
    ):
        resp = client.get(
            f"/api/owner/companies/{default_company.id}/modules", headers=admin_headers
        )
        assert resp.status_code in (401, 403)

    def test_unknown_module_is_rejected(self, client, owner_headers, default_company):
        resp = client.put(
            f"/api/owner/companies/{default_company.id}/modules",
            headers=owner_headers,
            json={"modules": ["inventory", "teleportation"]},
        )
        assert resp.status_code == 422

    def test_creating_a_company_applies_the_business_type_preset(
        self, client, owner_headers
    ):
        resp = client.post(
            "/api/owner/companies",
            headers=owner_headers,
            json={"name": "Онлайн Магазин", "business_type": "online"},
        )
        assert resp.status_code == 201
        company_id = resp.json()["id"]

        read = client.get(
            f"/api/owner/companies/{company_id}/modules", headers=owner_headers
        )
        assert read.json()["modules"] == ["sales", "customers", "inventory", "shop", "reports"]
        assert "register" not in read.json()["modules"]

    def test_creating_a_company_without_a_type_enables_nothing(
        self, client, owner_headers
    ):
        resp = client.post(
            "/api/owner/companies", headers=owner_headers, json={"name": "Пустая"}
        )
        company_id = resp.json()["id"]
        read = client.get(
            f"/api/owner/companies/{company_id}/modules", headers=owner_headers
        )
        assert read.json()["modules"] == []
```

Use whatever owner-token fixture the existing owner tests use — find it with `grep -rn "owner_headers\|def owner" sellary-backend/tests/integration/conftest.py sellary-backend/tests/conftest.py`.

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\pytest.exe tests/integration/test_company_modules.py::TestOwnerCompanyModuleEndpoints -v`
Expected: FAIL with 404 — the route does not exist.

- [ ] **Step 3: Add the schemas**

In `sellary-backend/schemas/admin.py`, add the `BusinessType` alias and the two schemas after `ManagedCompanyUpdate`. `Literal` needs its members spelled out, so the tuple in `core/modules.py` cannot be unpacked here — `test_business_type_literal_matches_registry` in Task 8 Step 7 guards the duplication:

```python
BusinessType = Literal["retail", "online", "warehouse", "kitchen", "production"]


class CompanyModulesPayload(BaseModel):
    modules: list[ModuleKey]
    business_type: Optional[BusinessType] = None


class CompanyModulesResponse(BaseModel):
    company_id: int
    business_type: Optional[BusinessType] = None
    modules: list[ModuleKey]
```

Add `business_type` to the company create/update/response schemas:

```python
class ManagedCompanyResponse(BaseModel):
    id: int
    name: str
    slug: str
    is_active: bool
    business_type: Optional[BusinessType] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ManagedCompanyCreate(BaseModel):
    name: str
    slug: Optional[str] = None
    is_active: bool = True
    business_type: Optional[BusinessType] = None


class ManagedCompanyUpdate(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    is_active: Optional[bool] = None
    business_type: Optional[BusinessType] = None
```

The `Literal` import must be present at the top of the file: `from typing import Literal, Optional`.

- [ ] **Step 4: Add the service methods**

In `sellary-backend/services/admin_management.py`, add the imports:

```python
from core.modules import BUSINESS_TYPE_PRESETS
from repositories.company_module_repository import CompanyModuleRepository
```

Add these two methods next to `get_membership_modules` / `set_membership_modules`:

```python
    def get_company_modules(self, company_id: int) -> dict:
        company = self._get_company(company_id)
        return {
            "company_id": company.id,
            "business_type": company.business_type,
            "modules": CompanyModuleRepository(self.db).enabled_modules(company.id),
        }

    def set_company_modules(
        self, company_id: int, modules: list[str], business_type: str | None = None
    ) -> dict:
        company = self._get_company(company_id)
        if business_type is not None:
            company.business_type = business_type
        ordered = CompanyModuleRepository(self.db).set_modules(company.id, modules)
        self.db.commit()
        return {
            "company_id": company.id,
            "business_type": company.business_type,
            "modules": ordered,
        }
```

Extend `create_company` (currently `services/admin_management.py:142-153`) so a business type seeds the preset:

```python
    def create_company(self, payload: ManagedCompanyCreate) -> ManagedCompanyResponse:
        slug = slugify_company_name(payload.slug or payload.name)
        self._ensure_company_slug_available(slug)
        company = Company(
            name=payload.name,
            slug=slug,
            is_active=payload.is_active,
            business_type=payload.business_type,
        )
        self.db.add(company)
        self.db.flush()
        # The preset is a starting point — the owner edits the set afterwards.
        if payload.business_type:
            CompanyModuleRepository(self.db).set_modules(
                company.id, list(BUSINESS_TYPE_PRESETS[payload.business_type])
            )
        self.db.commit()
        self.db.refresh(company)
        return ManagedCompanyResponse.model_validate(company)
```

And handle the field in `update_company`, next to the existing `is_active` branch:

```python
        if "business_type" in updates:
            company.business_type = updates["business_type"]
```

- [ ] **Step 5: Add the routes**

In `sellary-backend/api/owner.py`, add the imports to the existing schema import block:

```python
from schemas.admin import CompanyModulesPayload, CompanyModulesResponse
```

Add the two routes after `update_company`:

```python
@router.get("/companies/{company_id}/modules", response_model=CompanyModulesResponse)
def get_company_modules(
    company_id: int,
    db: Session = Depends(get_db),
    owner: OwnerContext = Depends(require_super_admin),
):
    del owner
    try:
        return AdminManagementService(db).get_company_modules(company_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.put("/companies/{company_id}/modules", response_model=CompanyModulesResponse)
def set_company_modules(
    company_id: int,
    payload: CompanyModulesPayload,
    db: Session = Depends(get_db),
    owner: OwnerContext = Depends(require_super_admin),
):
    del owner
    try:
        return AdminManagementService(db).set_company_modules(
            company_id, modules=payload.modules, business_type=payload.business_type
        )
    except ValueError as exc:
        status_code = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(exc))
```

- [ ] **Step 6: Reject membership grants for modules the company lacks**

In `set_membership_modules` (`services/admin_management.py:303-320`), add this immediately after the `admin` guard, so a company admin cannot grant what the company does not have:

```python
        enabled = set(CompanyModuleRepository(self.db).enabled_modules(membership.company_id))
        missing = [module for module in modules if module not in enabled]
        if missing:
            raise ValueError(
                f"Company does not have these modules: {', '.join(sorted(missing))}"
            )
```

- [ ] **Step 7: Guard the duplicated BusinessType literal**

`schemas/admin.py` spells the business types out because `Literal` cannot take a tuple. Append to `sellary-backend/tests/unit/test_modules_registry.py`:

```python
class TestBusinessTypeLiteral:
    def test_business_type_literal_matches_registry(self):
        from typing import get_args

        from schemas.admin import BusinessType

        assert set(get_args(BusinessType)) == set(BUSINESS_TYPE_PRESETS)
```

Run: `.venv\Scripts\pytest.exe tests/unit/test_modules_registry.py -v`
Expected: 9 passed

- [ ] **Step 8: Run the tests**

Run: `.venv\Scripts\pytest.exe tests/integration/test_company_modules.py tests/integration/test_admin_endpoints.py -v`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add sellary-backend/schemas/admin.py sellary-backend/services/admin_management.py sellary-backend/api/owner.py sellary-backend/tests/integration/test_company_modules.py sellary-backend/tests/unit/test_modules_registry.py
git commit -m "feat(modules): owner endpoints for company modules and business-type presets"
```

---

## Task 9: Frontend module registry and nav

**Files:**
- Modify: `sellary-frontend/src/lib/modules.ts`
- Modify: `sellary-frontend/src/lib/moduleNav.ts`
- Test: `sellary-frontend/src/lib/__tests__/moduleNav.test.ts`

- [ ] **Step 1: Write the failing test**

Create or extend `sellary-frontend/src/lib/__tests__/moduleNav.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { MODULE_NAV, grantedModuleDefs, pageForPath } from '../moduleNav';
import type { ModuleMap } from '../modules';

describe('MODULE_NAV after the pos split', () => {
  it('exposes the seven business domains in registry order', () => {
    expect(MODULE_NAV.map((def) => def.key)).toEqual([
      'register',
      'sales',
      'customers',
      'inventory',
      'purchasing',
      'shop',
      'reports',
      'settings',
    ]);
  });

  it('keeps Касса and Смена together under register', () => {
    const register = MODULE_NAV.find((def) => def.key === 'register');
    expect(register?.pages.map((page) => page.href)).toEqual(['/pos', '/shifts']);
  });

  it('gives an online-only company sales, customers, inventory and shop — no register', () => {
    const modules: ModuleMap = {
      sales: 'user',
      customers: 'user',
      inventory: 'user',
      shop: 'user',
    };
    const keys = grantedModuleDefs(modules, false).map((def) => def.key);
    expect(keys).toEqual(['sales', 'customers', 'inventory', 'shop']);
    expect(keys).not.toContain('register');
  });

  it('resolves /shifts to the register module', () => {
    expect(pageForPath('/shifts')?.label).toBe('Смена');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run from `sellary-frontend/`: `npx vitest run src/lib/__tests__/moduleNav.test.ts`
Expected: FAIL — `MODULE_NAV` still starts with `pos`.

- [ ] **Step 3: Widen ModuleKey**

In `sellary-frontend/src/lib/modules.ts` line 1:

```typescript
export type ModuleKey =
  | 'register'
  | 'sales'
  | 'customers'
  | 'inventory'
  | 'purchasing'
  | 'shop'
  | 'reports';
```

Leave the rest of the file unchanged.

- [ ] **Step 4: Restructure MODULE_NAV**

Replace the `MODULE_NAV` array in `sellary-frontend/src/lib/moduleNav.ts` with:

```typescript
export const MODULE_NAV: ModuleDef[] = [
  {
    key: 'register',
    label: 'Касса',
    tagline: 'Продажи и смены',
    pages: [
      { label: 'Касса', href: '/pos' },
      { label: 'Смена', href: '/shifts' },
    ],
  },
  {
    key: 'sales',
    label: 'Продажи',
    tagline: 'История продаж, возвраты',
    pages: [{ label: 'История продаж', href: '/sales' }],
  },
  {
    key: 'customers',
    label: 'Клиенты',
    tagline: 'Долги и история клиентов',
    pages: [{ label: 'Клиенты', href: '/customers' }],
  },
  {
    key: 'inventory',
    label: 'Склад',
    tagline: 'Товары, категории, инвентаризация',
    pages: [{ label: 'Товары', href: '/products' }],
  },
  {
    key: 'purchasing',
    label: 'Закупки',
    tagline: 'Поставщики и заказы поставщикам',
    pages: [
      { label: 'Поставщики', href: '/suppliers' },
      { label: 'Заказы поставщикам', href: '/purchase-orders' },
    ],
  },
  {
    key: 'shop',
    label: 'Магазин',
    tagline: 'Заказы из Telegram-магазина',
    pages: [{ label: 'Заказы', href: '/orders' }],
  },
  {
    key: 'reports',
    label: 'Отчеты',
    tagline: 'Дашборд и аналитика продаж',
    pages: [
      { label: 'Дашборд', href: '/dashboard' },
      { label: 'Аналитика', href: '/reports' },
    ],
  },
  {
    key: 'settings',
    label: 'Настройки',
    tagline: 'Компания, маркетплейс, сотрудники',
    pages: [{ label: 'Настройки', href: '/settings' }],
  },
];
```

Also update the doc comment above `grantedModuleDefs`, which names the old order, to: `(register, sales, customers, inventory, purchasing, shop, reports, settings)`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib src/components/mobile`
Expected: the new file passes. The existing `BottomTabBar`/`MoreSheet`/`MobileShell` tests will fail because they set `modules: { pos: 'manager', ... }`.

- [ ] **Step 6: Update the existing mobile tests to the new keys**

In `src/components/mobile/__tests__/BottomTabBar.test.tsx`, `MoreSheet.test.tsx` and `MobileShell.test.tsx`, replace every `pos:` key in a `state.modules` / `useModules` mock with the three that replaced it. For example, in `BottomTabBar.test.tsx`:

```typescript
    state.modules = {
      register: 'manager',
      sales: 'manager',
      customers: 'manager',
      inventory: 'manager',
      purchasing: 'manager',
      shop: 'manager',
      reports: 'manager',
    };
```

Assertions that expect exactly four tabs plus «Ещё» still hold — `MOBILE_MAX_TABS` is unchanged and there are now more modules, so the overflow case is if anything more certain. Re-read each assertion and adjust the expected labels: the first four granted modules are now Касса, Продажи, Клиенты, Склад.

- [ ] **Step 7: Run the full frontend suite**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add sellary-frontend/src/lib/modules.ts sellary-frontend/src/lib/moduleNav.ts sellary-frontend/src/lib/__tests__/moduleNav.test.ts sellary-frontend/src/components/mobile/__tests__
git commit -m "feat(modules): frontend nav follows the seven business domains"
```

---

## Task 10: Store carries companyModules; POS links become conditional

**Files:**
- Modify: `sellary-frontend/src/lib/store.ts`
- Modify: `sellary-frontend/src/app/(protected)/pos/page.tsx`
- Test: `sellary-frontend/src/app/(protected)/pos/__tests__/page.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `sellary-frontend/src/app/(protected)/pos/__tests__/page.test.tsx`, inside the existing top-level `describe` or a new one:

```typescript
describe('POS top bar module gating', () => {
  it('hides История продаж and Клиенты when those modules are absent', async () => {
    // The register-only company: a till, no sales history, no customer base.
    setModules({ register: 'manager' });
    renderPos();

    expect(await screen.findByText('Касса')).toBeInTheDocument();
    expect(screen.queryByText('История продаж')).not.toBeInTheDocument();
    expect(screen.queryByText('Клиенты')).not.toBeInTheDocument();
    expect(screen.getByText('Смена')).toBeInTheDocument();
  });
});
```

The file mocks `@/lib/store` at the top and renders the page through its own helper. Read lines 1–120 first, then express the test in that file's existing idiom: set the mocked `useModules` return value to `{ register: 'manager' }` and render with the same call the other tests use. Do not introduce new helpers — if the file seeds modules through a hoisted `state` object (as the mobile tests do), assign to that object instead.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "src/app/(protected)/pos"`
Expected: FAIL — the links render unconditionally.

- [ ] **Step 3: Add companyModules to the store**

In `sellary-frontend/src/lib/store.ts`, add the field to the auth state interface next to `modules`:

```typescript
  modules: ModuleMap;
  /** What the company has, regardless of this user's grants. */
  companyModules: ModuleKey[];
```

Add `ModuleKey` to the type import on line 17:

```typescript
import type { ModuleKey, ModuleMap } from './modules';
```

Set the default next to `modules: {} as ModuleMap` (line ~47):

```typescript
  companyModules: [] as ModuleKey[],
```

And carry it through each place that reads `session.modules` (lines ~66, ~149) and the persist partialize (line ~163):

```typescript
        modules: session.modules ?? {},
        companyModules: session.company_modules ?? [],
```

```typescript
        modules: state.modules,
        companyModules: state.companyModules,
```

At line ~90 where the state is cleared on logout, add `companyModules: []` next to `modules: {}`.

Add the selector next to `useModules` (line ~189):

```typescript
export const useCompanyModules = () => useAuthStore((state) => state.companyModules);
```

- [ ] **Step 4: Gate the POS top-bar links**

In `sellary-frontend/src/app/(protected)/pos/page.tsx`, the `posNavLinks` array is built unconditionally. Replace it with a module-filtered version. Add the import:

```typescript
import { canAccessModule } from '@/lib/modules';
```

(`useModules` is already imported from `@/lib/store` in this file — confirm before adding it.)

Then replace the array:

```typescript
  // A register-only company has no sales history and no customer base; the bar
  // must not offer links that 403.
  const posNavLinks = [
    { href: '/sales', label: 'История продаж', module: 'sales' as const },
    { href: '/shifts', label: 'Смена', module: 'register' as const },
    { href: '/customers', label: 'Клиенты', module: 'customers' as const },
  ].filter((link) => canAccessModule(modules, link.module));
```

`modules` comes from the existing `useModules()` call in this component. If the component does not already call it, add near the other hooks:

```typescript
  const modules = useModules();
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run "src/app/(protected)/pos"`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add sellary-frontend/src/lib/store.ts "sellary-frontend/src/app/(protected)/pos/page.tsx" "sellary-frontend/src/app/(protected)/pos/__tests__/page.test.tsx"
git commit -m "feat(modules): session carries companyModules; POS links follow the module set"
```

---

## Task 11: Owner panel business type and module checkboxes

**Files:**
- Modify: `sellary-frontend/src/lib/api.ts`
- Modify: `sellary-frontend/src/components/owner/OwnerDashboard.tsx`
- Create: `sellary-frontend/src/components/owner/CompanyModulesEditor.tsx`
- Test: `sellary-frontend/src/components/owner/__tests__/CompanyModulesEditor.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `sellary-frontend/src/components/owner/__tests__/CompanyModulesEditor.test.tsx`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CompanyModulesEditor from '../CompanyModulesEditor';

describe('CompanyModulesEditor', () => {
  const noop = vi.fn();

  it('fills the checkboxes from the business-type preset', async () => {
    render(
      <CompanyModulesEditor
        companyId={1}
        initialBusinessType={null}
        initialModules={[]}
        onSave={noop}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText('Тип бизнеса'), 'online');

    expect(screen.getByRole('checkbox', { name: 'Магазин' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Касса' })).not.toBeChecked();
  });

  it('lets the owner edit the set after choosing a type', async () => {
    render(
      <CompanyModulesEditor
        companyId={1}
        initialBusinessType={null}
        initialModules={[]}
        onSave={noop}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText('Тип бизнеса'), 'online');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Касса' }));

    expect(screen.getByRole('checkbox', { name: 'Касса' })).toBeChecked();
  });

  it('saves the selected set', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <CompanyModulesEditor
        companyId={1}
        initialBusinessType="warehouse"
        initialModules={['inventory', 'purchasing']}
        onSave={onSave}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Сохранить модули' }));

    expect(onSave).toHaveBeenCalledWith({
      business_type: 'warehouse',
      modules: ['inventory', 'purchasing'],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/owner/__tests__/CompanyModulesEditor.test.tsx`
Expected: FAIL — the component does not exist.

- [ ] **Step 3: Write the component**

Create `sellary-frontend/src/components/owner/CompanyModulesEditor.tsx`:

```typescript
'use client';

import { useState } from 'react';
import type { ModuleKey } from '@/lib/modules';

export type BusinessType = 'retail' | 'online' | 'warehouse' | 'kitchen' | 'production';

// Mirrors core/modules.py BUSINESS_TYPE_PRESETS. scripts/check_module_parity.py
// fails CI if the module list drifts; the presets are checked by eye.
const PRESETS: Record<BusinessType, ModuleKey[]> = {
  retail: ['register', 'sales', 'customers', 'inventory', 'purchasing', 'reports'],
  online: ['sales', 'customers', 'inventory', 'shop', 'reports'],
  warehouse: ['inventory', 'purchasing', 'reports'],
  kitchen: ['register', 'sales', 'inventory', 'purchasing', 'reports'],
  production: ['sales', 'customers', 'inventory', 'purchasing', 'reports'],
};

const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  retail: 'Магазин',
  online: 'Онлайн-магазин',
  warehouse: 'Склад',
  kitchen: 'Кухня',
  production: 'Производство',
};

const MODULE_LABELS: { key: ModuleKey; label: string }[] = [
  { key: 'register', label: 'Касса' },
  { key: 'sales', label: 'Продажи' },
  { key: 'customers', label: 'Клиенты' },
  { key: 'inventory', label: 'Склад' },
  { key: 'purchasing', label: 'Закупки' },
  { key: 'shop', label: 'Магазин' },
  { key: 'reports', label: 'Отчеты' },
];

interface CompanyModulesEditorProps {
  companyId: number;
  initialBusinessType: BusinessType | null;
  initialModules: ModuleKey[];
  onSave: (payload: { business_type: BusinessType | null; modules: ModuleKey[] }) => Promise<void>;
}

export default function CompanyModulesEditor({
  companyId,
  initialBusinessType,
  initialModules,
  onSave,
}: CompanyModulesEditorProps) {
  const [businessType, setBusinessType] = useState<BusinessType | null>(initialBusinessType);
  const [selected, setSelected] = useState<Set<ModuleKey>>(new Set(initialModules));
  const [saving, setSaving] = useState(false);

  // A type seeds the set; it never locks it.
  const applyPreset = (type: BusinessType | null) => {
    setBusinessType(type);
    if (type) setSelected(new Set(PRESETS[type]));
  };

  const toggle = (module: ModuleKey) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(module)) next.delete(module);
      else next.add(module);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        business_type: businessType,
        modules: MODULE_LABELS.map((m) => m.key).filter((key) => selected.has(key)),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 border border-[var(--erp-divider)] p-4">
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-[var(--erp-muted)]">
          Тип бизнеса
        </span>
        <select
          value={businessType ?? ''}
          onChange={(event) =>
            applyPreset((event.target.value || null) as BusinessType | null)
          }
          className="h-11 w-full border border-[var(--erp-divider)] bg-white px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)]"
        >
          <option value="">Не указан</option>
          {(Object.keys(PRESETS) as BusinessType[]).map((type) => (
            <option key={type} value={type}>
              {BUSINESS_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend className="mb-2 text-xs font-semibold text-[var(--erp-muted)]">Модули</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {MODULE_LABELS.map(({ key, label }) => (
            <label key={key} className="flex min-h-[44px] items-center gap-2">
              <input
                type="checkbox"
                checked={selected.has(key)}
                onChange={() => toggle(key)}
                className="h-5 w-5 accent-[var(--erp-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-accent)]"
              />
              <span className="text-sm text-[var(--erp-text)]">{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        data-company-id={companyId}
        className="inline-flex min-h-[44px] items-center bg-[var(--erp-accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--erp-accent-strong)] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-accent)]"
      >
        {saving ? 'Сохранение...' : 'Сохранить модули'}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/owner/__tests__/CompanyModulesEditor.test.tsx`
Expected: 3 passed

- [ ] **Step 5: Add the API client methods**

In `sellary-frontend/src/lib/api.ts`, find the owner API object (the one calling `/owner/companies`) and add:

```typescript
  getCompanyModules: (companyId: number) =>
    api.get<{ company_id: number; business_type: string | null; modules: string[] }>(
      `/owner/companies/${companyId}/modules`,
    ),
  setCompanyModules: (
    companyId: number,
    payload: { business_type: string | null; modules: string[] },
  ) => api.put(`/owner/companies/${companyId}/modules`, payload),
```

Match the surrounding style — if the owner calls go through a separate axios instance with the owner token, use that instance rather than `api`.

- [ ] **Step 6: Mount the editor in the owner panel**

`OwnerDashboard.tsx` already renders a per-company row with expandable detail. Find the company row component, add module state next to the other per-company state, and render the editor in the expanded body:

```typescript
import CompanyModulesEditor, { type BusinessType } from './CompanyModulesEditor';
import type { ModuleKey } from '@/lib/modules';
```

Inside the component that owns the expanded company row:

```typescript
  const [moduleState, setModuleState] = useState<{
    businessType: BusinessType | null;
    modules: ModuleKey[];
  } | null>(null);

  // Loaded lazily so the company list request stays one round trip.
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    ownerApi
      .getCompanyModules(company.id)
      .then((response) => {
        if (cancelled) return;
        setModuleState({
          businessType: (response.data.business_type as BusinessType | null) ?? null,
          modules: response.data.modules as ModuleKey[],
        });
      })
      .catch(() => toast.error('Не удалось загрузить модули компании.'));
    return () => {
      cancelled = true;
    };
  }, [expanded, company.id]);
```

And in the expanded body, next to the existing sections:

```typescript
      {expanded && moduleState && (
        <CompanyModulesEditor
          companyId={company.id}
          initialBusinessType={moduleState.businessType}
          initialModules={moduleState.modules}
          onSave={async (payload) => {
            await ownerApi.setCompanyModules(company.id, payload);
            toast.success('Модули компании обновлены.');
            await reloadCompanies();
          }}
        />
      )}
```

Rename `ownerApi`, `expanded`, `company` and `reloadCompanies` to the identifiers the file actually uses — read the surrounding component first.

- [ ] **Step 7: Run the full frontend suite and build**

Run: `npx vitest run && npm run build`
Expected: all tests pass, build succeeds.

- [ ] **Step 8: Commit**

```bash
git add sellary-frontend/src/components/owner sellary-frontend/src/lib/api.ts
git commit -m "feat(modules): owner panel edits company modules and business type"
```

---

## Task 12: CI parity check

**Files:**
- Create: `scripts/check_module_parity.py`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the script**

Create `scripts/check_module_parity.py`:

```python
"""Fail the build when the backend and frontend module lists drift.

The registry lives in core/modules.py. lib/modules.ts mirrors it so the
frontend keeps a real union type instead of fetching the list at runtime.
Nothing enforces that mirror but this script.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "sellary-backend" / "core" / "modules.py"
FRONTEND = ROOT / "sellary-frontend" / "src" / "lib" / "modules.ts"


def backend_modules() -> list[str]:
    source = BACKEND.read_text(encoding="utf-8")
    block = re.search(r"^MODULES\s*=\s*\((.*?)\)", source, re.S | re.M)
    if not block:
        raise SystemExit(f"MODULES tuple not found in {BACKEND}")
    return re.findall(r'"([a-z_]+)"', block.group(1))


def frontend_modules() -> list[str]:
    source = FRONTEND.read_text(encoding="utf-8")
    block = re.search(r"export type ModuleKey\s*=(.*?);", source, re.S)
    if not block:
        raise SystemExit(f"ModuleKey union not found in {FRONTEND}")
    return re.findall(r"'([a-z_]+)'", block.group(1))


def main() -> int:
    backend = backend_modules()
    frontend = frontend_modules()
    if backend == frontend:
        print(f"OK: {len(backend)} modules match — {', '.join(backend)}")
        return 0
    print("Module lists have drifted.")
    print(f"  core/modules.py : {backend}")
    print(f"  lib/modules.ts  : {frontend}")
    only_backend = [m for m in backend if m not in frontend]
    only_frontend = [m for m in frontend if m not in backend]
    if only_backend:
        print(f"  missing from the frontend: {only_backend}")
    if only_frontend:
        print(f"  missing from the backend : {only_frontend}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Run it to verify it passes**

Run from the repo root: `python scripts/check_module_parity.py`
Expected: `OK: 7 modules match — register, sales, customers, inventory, purchasing, shop, reports`

- [ ] **Step 3: Verify it catches drift**

Temporarily add `| 'teleportation'` to the `ModuleKey` union in `sellary-frontend/src/lib/modules.ts`, run the script again.
Expected: exit code 1 and `missing from the backend : ['teleportation']`. Remove the temporary line afterwards and re-run to confirm it is green again.

- [ ] **Step 4: Wire it into CI**

In `.github/workflows/ci.yml`, add a step to the Backend job after the compile check (find the step running `python -m compileall`):

```yaml
      - name: Check module registry parity
        working-directory: .
        run: python scripts/check_module_parity.py
```

If the Backend job sets a `working-directory` of `sellary-backend` at the job level, use `run: python ../scripts/check_module_parity.py` instead.

- [ ] **Step 5: Commit**

```bash
git add scripts/check_module_parity.py .github/workflows/ci.yml
git commit -m "ci: fail the build when backend and frontend module lists drift"
```

---

## Task 13: Full verification

- [ ] **Step 1: Backend suite**

Run from `sellary-backend/`: `.venv\Scripts\pytest.exe tests/integration tests/unit -q`
Expected: all pass, no errors.

- [ ] **Step 2: Backend compile gate**

Run from `sellary-backend/`: `.venv\Scripts\python.exe -m compileall api core models repositories schemas services main.py`
Expected: no output, exit 0.

- [ ] **Step 3: Frontend suite, lint, build**

Run from `sellary-frontend/`: `npx vitest run && npm run lint && npm run build`
Expected: all tests pass, no ESLint warnings, build succeeds.

- [ ] **Step 4: Parity check**

Run from the repo root: `python scripts/check_module_parity.py`
Expected: `OK: 7 modules match`

- [ ] **Step 5: Manual smoke against a running stack**

Start the backend (`python main.py`) and frontend (`npm run dev`), then:
1. Log in as an existing company admin. Every module is present — the backfill gave the company all six base modules.
2. In the owner panel, set that company's business type to `online` and save.
3. Reload the app. Касса and Смена are gone from the nav; `/pos` returns 403 from the API.
4. Set the type back to `retail` and save. Касса returns.

- [ ] **Step 6: Commit any fixes, then merge**

```bash
git add -A
git commit -m "fix: verification fixes for the company module platform"
```
