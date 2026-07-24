# ERP Modularization — Module Permissions + Modular Monolith

**Date:** 2026-07-24
**Status:** Approved design (brainstorm complete)

## Problem

Sellary has grown to small-ERP size. Two pains:

1. **No module-level access control.** A company owner cannot give one employee
   only the Warehouse module and another only POS. Today the only lever is the
   coarse membership role (`admin` / `manager` / `cashier`).
2. **Layer-first code layout.** Backend groups code by layer (`api/`,
   `services/`, `repositories/`, `models/`) with all domains mixed in each
   folder; frontend similarly mixes domains under `src/`. Navigation and
   onboarding get harder as the system grows.

Industry reference (validated 2026-07-24): Odoo grants access per app via
access groups with levels ("Inventory / User", "Inventory / Administrator");
menus and models are hidden without the group. ERPNext hides a module
automatically when the user has no permissions on its documents. We adopt the
same shape: **module = unit of permission, with two levels inside each
module.**

## Decisions (agreed with user)

- Modular **monolith** — one backend, one DB, one deploy. No microservices.
- Two access levels per module: `user` (daily work) and `manager`
  (reports, settings, deletions, destructive ops).
- Membership role `admin` **bypasses** module checks entirely — implicit
  manager on every module. Module grants apply to non-admin members only.
- Module list (5 grantable modules):
  | Module key | Covers (routers) |
  |---|---|
  | `pos` | sales, cash shifts (`/shifts`), sale returns/cancels, customers + customer ledger |
  | `inventory` | products, categories, product units (multi-UOM), inventory adjust + ledger |
  | `purchasing` | suppliers, purchase orders (incl. receive) |
  | `shop` | merchant-side Telegram shop: `/orders` (confirm/status/cancel), shop settings |
  | `reports` | `/reports/*` (kept as a separate module for now — single page today) |
- **Not modules:** platform (auth, company, memberships, meta, owner/admin
  panels — admin-only already), sync + device auth (technical channel for the
  cashier app).
- **Cashier Tauri app: out of scope.** No changes to `sellary-cashier`, sync
  endpoints, or device-token auth in any phase.
- Customers live in `pos` (they are used by sales/credit flows).
- Reports stay one module for now; may split per-domain later.

## Phase 1 — Module permissions (build first)

### Data model

New table `membership_module_access`:

| column | type | notes |
|---|---|---|
| `id` | PK | |
| `membership_id` | FK → `company_memberships.id`, CASCADE | tenant scope inherited via membership |
| `module` | varchar/enum: `pos`, `inventory`, `purchasing`, `shop`, `reports` | |
| `level` | enum: `user`, `manager` | |

Unique constraint on `(membership_id, module)`. No row = no access.

**Backfill migration** (so existing companies keep working):
- role `admin` → no rows needed (bypass).
- role `manager` → all 5 modules at `manager`.
- any other role (`cashier`, etc.) → `pos` at `user`.
Admins then trim/extend per employee in the UI.

### Backend enforcement

New dependency in `api/dependencies.py`:

```python
def require_module(module: str, level: str = "user"):
    # returns a Depends-compatible checker:
    # - admin role → pass
    # - else look up membership_module_access; missing or insufficient → 403
```

- Lookup hits the DB per request (no token change → permission edits take
  effect immediately, no re-login). Single indexed query; acceptable.
- Applied per-route (not router-wide) because one router mixes levels.
- `403` body distinguishes `module_access_denied` so the frontend can render
  its "no access" page.
- Existing `require_admin` stays for platform endpoints. Existing
  `require_manager_or_admin` call sites inside module routers are **replaced**
  by `require_module(<module>, "manager")`.

**Level mapping (initial):**

| Action | Level |
|---|---|
| Create sale, list/view sales, open/close own shift, customers CRUD | `pos:user` |
| Cancel/return sale, line annulment, reversal ops, force-close shift | `pos:manager` |
| Products/categories/units CRUD, view stock | `inventory:user` |
| Inventory adjust, delete product/category | `inventory:manager` |
| View suppliers/POs, create PO | `purchasing:user` |
| Receive PO, delete supplier/PO | `purchasing:manager` |
| View/confirm/advance shop orders | `shop:user` |
| Cancel shop order, shop settings | `shop:manager` |
| All `/reports/*` | `reports:user` (whole module is read-only analytics) |

Exact endpoint-by-endpoint table is produced during planning; the rule of
thumb is: destructive/corrective/config → `manager`, daily flow → `user`.

### Auth payload for frontend

`POST /api/auth/select-company` response (and `/api/auth/me`) gains:

```json
"modules": { "pos": "manager", "inventory": "user" }
```

Admin receives all five at `"manager"`.

### Frontend

- Auth store keeps `modules`; sidebar renders only granted modules.
- Route guard per module section: no grant → "Ruxsat yo'q" (no access) page,
  not a redirect loop.
- Employees page (admin-only): checkbox grid — rows = employees, per employee
  5 modules × level selector (none / xodim / menejer). Saves via new
  endpoints `GET/PUT /api/company/memberships/{id}/modules` (admin-only).
- UI strings in Russian (project convention).

### Testing

- Unit: `require_module` matrix — admin bypass, missing row, `user` vs
  `manager`, wrong company.
- Integration: per module router, one `user`-level and one `manager`-level
  endpoint × (no grant → 403, user grant, manager grant, admin).
- Backfill migration test: manager/cashier memberships get expected rows.

## Phase 2 — Backend modular monolith (after Phase 1)

Regroup by domain, keeping the layer discipline **inside** each module:

```
sellary-backend/
  platform/   (auth, company, memberships, users, owner, admin, meta, module access)
  pos/        (sales, shifts, returns, customers, ledger)
  inventory/  (products, categories, units, inventory ledger)
  purchasing/ (suppliers, purchase orders, receipts)
  shop/       (telegram webhook, shop API, orders)
  reports/
  sync/       (cashier sync + device auth — moved, not modified)
  core/       (config, database, security — unchanged)
```

Each module contains its own `api/`, `services/`, `repositories/`,
`models/`, `schemas/`.

Compatibility rules:
- Top-level `models/__init__.py` remains and re-exports every model — Alembic
  autogenerate and any stale imports keep working.
- API URL prefixes do not change; `main.py` still registers all routers.
- Import direction: a module may import from itself, `platform`, and `core`
  only. Cross-domain calls (e.g. POS consuming inventory FIFO ledger) go
  through the other module's **service** layer, never its repositories.
- CI `compileall` path list updated in the same commit.
- Pure file moves + import rewrites; no behavior change. Full pytest suite is
  the gate.

## Phase 3 — Frontend modular structure (after Phase 2)

- `src/modules/<module>/` per module: pages (re-exported from App Router
  routes), components, query hooks.
- Sidebar grouped by module, Odoo-style.
- Cleanup folded in: resolve the duplicate layers (`src/api.ts` vs
  `src/lib/api.ts`, `src/store/` vs `src/lib/store.ts`) — one canonical copy
  each; delete `src/App.tsx.bak`.
- No visual redesign beyond the sidebar grouping; behavior unchanged.

## Phasing rationale

Phase 1 ships user-visible value without moving files. Phases 2–3 are
mechanical refactors done afterwards on a calm codebase. Each phase gets its
own implementation plan and lands independently.

## Non-goals

- No microservices, no repo split, no separate deploys.
- No cashier (Tauri) or sync-protocol changes.
- No per-record or per-field permissions (Odoo record rules) — module × level
  only.
- No billing/packaging of modules per company (possible later on top of the
  same table).
