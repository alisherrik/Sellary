# Sellary AGENTS.md

## Overview

Sellary is a retail POS, inventory, and supplier management system. Three-package monorepo:
- **sellary-backend** — Python 3+ / FastAPI / PostgreSQL / SQLAlchemy / Alembic
- **sellary-frontend** — Next.js 14 (App Router) / TypeScript / Tailwind / Zustand / TanStack Query
- **sellary-cashier** — Tauri 2 / React / TypeScript / Vite (desktop cashier app for offline POS)

Backend port is **8001**, not 8000. Frontend proxies `NEXT_PUBLIC_API_PROXY_TARGET` (defaults to `http://127.0.0.1:8001`).

## Commands

All commands run from the sub-project directory (not repo root).

### Backend (sellary-backend)

```bash
# Start (port 8001)
python main.py

# All tests
pytest tests/integration tests/unit

# Single test file/class/function
pytest tests/unit/test_security.py -v
pytest tests/unit/test_security.py::TestPasswordHashing -v
pytest tests/unit/test_security.py::TestPasswordHashing::test_password_hashing_is_verifiable -v

# Compile check (no DB needed)
python -m compileall api core models repositories schemas services main.py

# DB: apply migrations
alembic upgrade head

# DB: destructive reset (dev only)
python reset_database.py --yes

# DB: bootstrap company + admin
python bootstrap_company.py --company-name "Sellary Demo" --company-slug "sellary-demo" --owner-username "admin" --owner-email "admin@example.com" --owner-password "admin123" --owner-role "admin"
```

On Windows use `.venv\Scripts\python.exe` and `.venv\Scripts\pytest.exe`.

### Frontend (sellary-frontend)

```bash
npm run dev            # dev server (port 3000)
npm run build          # production build
npm run lint           # next lint
npx vitest run         # unit/component tests
npx vitest --ui        # vitest UI
npx vitest --coverage  # coverage
npx playwright test    # e2e tests
```

### Tauri Cashier (sellary-cashier)

```bash
npm run dev             # Vite dev server (port 1420)
npm run build           # TypeScript + Vite build
npm run tauri dev       # Tauri dev mode (desktop)
npm run tauri build     # Tauri production build (desktop installer)
```

## Architecture

### Auth flow (multi-company v1)

Login returns a `login_token` (short-lived). User picks a company, exchanges for a company-scoped `access_token`. All business endpoints require a company-scoped token. The owner panel (`/owner/login`) uses a separate owner token for global admin operations.

### Backend layers

`api/` → `services/` → `repositories/` → `models/`. Schemas (Pydantic) in `schemas/`. Config via `core/config.py` reading `.env`.

### Multi-company

One DB, shared schema, tenant isolation via `company_id`. Tenant-owned tables: `categories`, `customers`, `products`, `suppliers`, `purchase_orders`, `sales`, `sale_returns`, `inventory_logs`, `idempotency_keys`. `sale_items` and `purchase_order_items` inherit scope through parent records.

Module-level access: non-admin members get per-module grants (`pos | inventory | purchasing | shop | reports` × `user | manager`) in `membership_module_access`, enforced by `require_module()`; admin role bypasses; sync/device-auth and shopper-facing shop endpoints unaffected. Admin manages grants via `GET/PUT /api/admin/memberships/{id}/modules`; sessions expose a `modules` map used by the frontend nav/ModuleGuard.

### Idempotency

Required header `Idempotency-Key` (16-64 chars) on:
- `POST /api/sales`
- `POST /api/sales/{id}/cancel`
- `POST /api/sales/{id}/return`
- `POST /api/inventory/adjust`
- `POST /api/purchase-orders/{id}/receive`

### Frontend routing

Next.js App Router with route groups: `(protected)/` for authenticated pages, `login/` and `owner/login/` for auth. API requests go through Next.js rewrite proxy (`/api/*` → backend).

## Key gotchas

- Backend port is **8001** (not 8000 as some older docs reference). `restart_app.ps1` mentions port 8000 — it's stale.
- Backend tests MUST run from within `sellary-backend/` with the virtual environment activated. DB connection is opened at import time via `core/database.py`.
- Test DB isolation uses **transaction rollback** — use `session.flush()` not `session.commit()` in tests.
- The codebase has **mixed languages**: code/docstrings in English, UI in Russian, some docs in Uzbek and English. Do not change the language of existing content without explicit instruction.
- **Online `POST /api/sales` rejects oversell** — the FIFO ledger (`services/inventory_ledger_service.py`, `consume_fifo`) raises `Insufficient stock`. Only the offline **sync path** (`services/sync_service.py`, `allow_oversell=True`) tolerates oversell, recording it as a historical fact with a `SyncWarning`.
- `.env` files are gitignored. Copy from `.env.example` files.
- Alembic migration files (`alembic/versions/*.py`) are **tracked (committed)** — commit generated migrations.
- Frontend duplicate layers exist: `src/api.ts` vs `src/lib/api.ts`, `src/store/` vs `src/lib/store.ts`. Be careful about which is canonical when editing.

## Key reference files

- `sellary-backend/README.md` — auth contract, bootstrap scripts, verification commands
- `sellary-backend/RUNBOOK.md` — tenant tables, multi-company operations
- `sellary-backend/TESTING_GUIDE.md` — test fixtures, conventions
- `DOCUMENTATION.md` — full system docs, API endpoints, schema
- `BUSINESS_LOGIC_GUIDE.md` — business logic in Russian
- `ISSUE_TASKS.md` — P0/P1/P2 task backlog
- `Suggestion.md` — MVP scope recommendations (Uzbek)
