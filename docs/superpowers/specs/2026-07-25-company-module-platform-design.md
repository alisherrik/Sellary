# Company module platform — design

**Date:** 2026-07-25
**Status:** approved, ready for implementation planning
**Scope:** the module platform only. The vertical feature sets (warehouse, kitchen, made-to-order production) are separate projects that build on this one.

## Problem

Sellary is sold to one kind of business today: a small retail shop. The owner wants to sell it to several — an online-only store, a warehouse, a kitchen, a made-to-order workshop — and provision each from the owner panel with only the parts that business needs.

Two things block that.

**There is no company-level module concept.** `membership_module_access` grants a module to a *user*. Nothing says "this company does not have a register at all." An online-only store's admin sees Касса in the nav, and its API is reachable.

**The current module boundaries are screen groups, not business domains.** `pos` holds Касса, История продаж, Смена and Клиенты. An online store needs sales history and customers but has no till and no shift. There is no way to express that with the five modules that exist.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Module granularity | Split `pos` into `register`, `sales`, `customers` | A module is a business domain, not a screen group. The online-only case is unrepresentable otherwise. |
| Company-level storage | New `company_modules` table | Mirrors the existing `membership_module_access` pattern; leaves room for per-module settings; the owner panel lists and edits it. |
| Enforcement | Backend 403, not UI-only | A hidden nav item is still a reachable URL. |
| Who toggles company modules | Owner only | It is a commercial decision — what the customer paid for. A company admin distributes what exists; they do not grant themselves more. |
| Business types | A label plus a preset source, never a lock | The owner said the packages are a starting point that must stay editable. |
| Module registry drift | Canonical list in `core/modules.py`; CI script compares it to `lib/modules.ts` | Keeps the TS union type; catches drift at build time without a runtime fetch. |
| Existing `pos` grants | Become `register` + `sales` + `customers` at the same level | Nobody loses access on upgrade. |

## Architecture

Access becomes two layers:

```
effective(user, module) = company_has(module) AND membership_grant(user, module)
```

The company layer is the commercial decision (owner-controlled). The membership layer is the organisational decision (company-admin-controlled).

**The `admin` role bypasses the membership layer only.** Today `require_module` returns early for `auth.role == "admin"`, skipping every check. Under the new rule the company check runs *before* that early return, so the admin of a company without `shop` gets a 403 from `/api/shop/*` like everyone else.

### Modules

| Module | Pages | Typical buyer |
|---|---|---|
| `register` | Касса `/pos`, Смена `/shifts` | shop, kitchen |
| `sales` | История продаж `/sales` (returns, annulment) | anyone who sells |
| `customers` | Клиенты `/customers` (debts, ledger) | shop, online |
| `inventory` | Товары `/products` | everyone |
| `purchasing` | Поставщики `/suppliers`, Заказы поставщикам `/purchase-orders` | shop, warehouse |
| `shop` | Заказы `/orders` (Telegram storefront) | online |
| `reports` | Дашборд `/dashboard`, Аналитика `/reports` | optional everywhere |

### Business type presets

```python
BUSINESS_TYPE_PRESETS = {
    "retail":     ("register", "sales", "customers", "inventory", "purchasing", "reports"),
    "online":     ("sales", "customers", "inventory", "shop", "reports"),
    "warehouse":  ("inventory", "purchasing", "reports"),
    "kitchen":    ("register", "sales", "inventory", "purchasing", "reports"),
    "production": ("sales", "customers", "inventory", "purchasing", "reports"),
}
```

`kitchen` and `production` are composed from modules that exist today. They do not yet carry recipes, stations, BOMs or work orders — those arrive with their own specs and extend the preset then. A `kitchen` company provisioned today gets a register and stock, and nothing more; the preset is honest about that because it names only modules that exist.

## Data model

```sql
CREATE TABLE company_modules (
    id         SERIAL PRIMARY KEY,
    company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    module     VARCHAR(20) NOT NULL,
    enabled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_company_modules_company_module UNIQUE (company_id, module)
);
CREATE INDEX ix_company_modules_company_id ON company_modules(company_id);

ALTER TABLE companies ADD COLUMN business_type VARCHAR(30);  -- nullable
```

A row present means the module is enabled. No row means the company does not have it.

`business_type` is nullable and enforces nothing. It exists so the owner panel can offer a preset button and so the owner can later answer "which kind of customer do we have most of?".

## Backend

### `core/modules.py` (new)

Canonical `MODULES` tuple, `LEVELS`, `BUSINESS_TYPE_PRESETS`, and `LEVEL_RANK`. `models/membership_module_access.py` imports from it instead of declaring its own tuple.

### `require_module`

```python
def checker(auth, db):
    if not company_has_module(db, auth.company_id, module):
        raise HTTPException(403, {"code": "module_not_enabled", "module": module})
    if auth.role == "admin":
        return auth
    grant = ...  # unchanged membership lookup
```

`company_has_module` is a repository function over `company_modules`. It is called on every guarded request, so it reads a single indexed row.

The cashier sync and device-auth channel stays outside module checks, exactly as it is today.

The shopper-facing storefront endpoints (`api/shop.py`, `api/shop_orders.py`) are public — they have no `AuthContext` and cannot use `require_module`. They gain their own check instead: a request for a company whose `shop` module is off returns 404, the same response an unknown company already gets. Turning `shop` off closes the storefront.

### Session responses

`POST /api/auth/select-company` and `GET /api/auth/me` gain one field and change the meaning of another:

- `company_modules: ["register", "sales", ...]` — what the company has
- `modules: {register: "manager", ...}` — the intersection: what this user can actually open

The frontend nav reads `modules`. A "this module is not part of your plan" message, if one is ever shown, reads `company_modules`.

### Owner endpoints

```
GET  /api/owner/companies/{id}/modules   → {business_type, modules: [...]}
PUT  /api/owner/companies/{id}/modules   → {business_type?, modules: [...]}
POST /api/owner/companies                → accepts business_type; applies the preset
```

Owner token required. A company admin calling these gets 403.

`PUT` replaces the set. Removing a module does not delete the data it produced — a company that loses `shop` keeps its orders in the database, and gets them back if the module is re-enabled.

## Frontend

`ModuleKey` becomes a seven-key union. `MODULE_NAV` is restructured to the table above; `moduleNav.ts` stays the single source of nav truth, so the tab bar, the More sheet, the launcher, the desktop rail and `ModuleGuard` all follow without further change.

The POS top bar links to `/sales`, `/shifts` and `/customers` unconditionally today. Each becomes conditional on its module, or a register-only company shows a bar with no way out except Приложения.

The owner panel company card gains a business-type select and seven module checkboxes. Choosing a type fills the checkboxes from the preset; the checkboxes remain editable afterwards.

## Migration

Alembic revision creates `company_modules`, adds `companies.business_type`, and backfills so that no existing user loses access:

1. Every existing company gets `register`, `sales`, `customers`, `inventory`, `purchasing`, `reports`.
2. `shop` is added only where `companies.is_marketplace_enabled` is true.
3. `business_type` stays `NULL`.
4. Every `membership_module_access` row with `module = 'pos'` becomes three rows — `register`, `sales`, `customers` — at the same `level`. The `pos` row is deleted.

The downgrade collapses `register`/`sales`/`customers` back to a single `pos` row at the highest of the three levels, drops the column and the table.

Note for deployment: the repository has two Alembic heads, and Railway pins a specific revision rather than `head`. The new revision must be chained onto the correct head and the pin updated in the same change.

## Testing

**Backend**
- Effective-module resolution: company set ∩ membership grant, including the empty cases.
- `require_module` returns 403 when the company lacks the module — including for `role == "admin"`.
- `require_module` still returns 403 when the company has the module but the membership grant is missing or too low (regression).
- Owner endpoints: a company admin token is rejected; an owner token succeeds.
- The storefront returns 404 for a company whose `shop` module is off.
- Creating a company with `business_type="online"` enables exactly the preset's modules.
- `PUT` with a module name outside `MODULES` is rejected.
- Migration: a membership holding `pos` at `manager` ends with three rows at `manager`; a company with `is_marketplace_enabled = false` has no `shop` row.

**Frontend**
- Nav, More sheet and launcher filter to the seven modules.
- The POS top bar hides links whose module is absent.
- Owner panel: selecting a business type fills the checkboxes; editing them afterwards sticks.

**CI**
- A script compares `MODULES` in `core/modules.py` with the `ModuleKey` union in `lib/modules.ts` and fails the build on drift.

## Out of scope

- Warehouse, kitchen and production domain features. Each gets its own spec.
- Locations and stock-movement documents. This is the deeper foundation those three verticals share, and it is a larger project that touches the FIFO ledger. It should be the next one after this.
- Billing or plans. `business_type` is a label, not a subscription.
- Per-module configuration (for example a register that allows offline sale). The table has room for it; nothing uses it yet.
