# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Sellary is a retail POS, inventory, and supplier-management system. It is a three-package monorepo:

- **sellary-backend** — Python / FastAPI / PostgreSQL / SQLAlchemy / Alembic. Serves on port **8001** (not 8000).
- **sellary-frontend** — Next.js 14 (App Router) / TypeScript / Tailwind / Zustand / TanStack Query. Port 3000.
- **sellary-cashier** — Tauri 2 / React / TypeScript / Vite. Offline-first desktop cashier app. Vite dev port 1420.

There is an extensive `AGENTS.md` at the repo root that overlaps with this file — keep the two consistent when updating either.

## Commands

All commands run **from the sub-project directory**, not the repo root. On Windows the backend venv binaries live at `.venv\Scripts\python.exe` / `.venv\Scripts\pytest.exe`.

### Backend (`sellary-backend/`)
```bash
python main.py                                    # start API on port 8001
pytest tests/integration tests/unit               # full suite
pytest tests/unit/test_security.py -v             # single file
pytest tests/unit/test_security.py::TestPasswordHashing::test_password_hashing_is_verifiable -v   # single test
python -m compileall api core models repositories schemas services main.py   # compile check, no DB needed (this is the CI gate)
alembic upgrade head                              # apply migrations
python reset_database.py --yes                    # destructive reset (dev only)
python bootstrap_company.py --company-name "..." --company-slug "..." --owner-username "..." --owner-email "..." --owner-password "..." --owner-role "admin"
```

### Frontend (`sellary-frontend/`)
```bash
npm run dev            # dev server (port 3000)
npm run build          # production build
npm run lint           # next lint
npm test               # vitest (watch); use `npx vitest run` for one-shot
npm run test:e2e       # playwright e2e
```

### Tauri Cashier (`sellary-cashier/`)
```bash
npm run dev            # Vite dev server (port 1420, browser-only)
npm test               # vitest run
npm run tauri:dev      # full desktop app (requires Rust toolchain)
npm run tauri:build    # desktop installer
```

### Run both backend + frontend together
From repo root: `run-client-server.bat` (Windows) or `scripts/start-dev.ps1`. CI (`.github/workflows/ci.yml`) runs all three packages on `windows-latest`.

## Architecture

### Multi-company (multi-tenant)
One database, shared schema, tenant isolation by `company_id`. A user can belong to several companies via `company_memberships`.

**Auth flow:** `POST /api/auth/login` returns a short-lived `login_token` → user picks a company via `POST /api/auth/select-company` → receives a **company-scoped `access_token`**. All business endpoints require that company-scoped token. The owner panel (`/owner/login`) uses a **separate owner token** for global admin operations.

Tenant-owned tables carry `company_id` directly: `categories`, `customers`, `products`, `suppliers`, `purchase_orders`, `sales`, `sale_returns`, `inventory_logs`, `idempotency_keys`. `sale_items` and `purchase_order_items` inherit tenant scope through their parent records.

### Backend layering
Strict layering — respect it when adding features:
```
api/ (FastAPI routers)  →  services/ (business logic)  →  repositories/ (DB queries)  →  models/ (SQLAlchemy)
```
Pydantic request/response models live in `schemas/`. Config is `core/config.py` reading `.env`. `core/database.py` opens the DB connection **at import time**, and `main.py` registers all routers + security-headers/CORS middleware. The lifespan hook calls `ensure_super_admin`.

### Idempotency
These mutating endpoints **require** an `Idempotency-Key` header (16–64 chars). Server stores keys in `idempotency_keys` (tenant-scoped) and replays the original response on retry:
- `POST /api/sales`, `POST /api/sales/{id}/cancel`, `POST /api/sales/{id}/return`
- `POST /api/inventory/adjust`
- `POST /api/purchase-orders/{id}/receive`

### Frontend
Next.js App Router with route groups: `(protected)/` (authenticated app pages), `login/`, and `owner/` (owner panel). Browser API calls go to `/api/*`, which a Next.js rewrite proxy forwards to the backend (`NEXT_PUBLIC_API_PROXY_TARGET`, default `http://127.0.0.1:8001`). State is split between Zustand stores (`src/lib/store.ts`, `src/lib/owner-store.ts`) and TanStack Query.

### Tauri cashier — offline-first sync
The cashier app is a local-first POS. It keeps a local SQLite catalog and an **outbox** of sales (`src/lib/db.ts`), and reconciles with the server via the backend's sync endpoints:
- `GET /api/sync/bootstrap` — pull products/categories into the offline catalog
- `POST /api/sync/sales` — push queued offline sales (carries `client_sale_id` + `idempotency_key` per sale)
- `GET /api/sync/status` — check server-side status of pending sales

`src/lib/sync-service.ts` drives this: it health-checks, recovers stuck `syncing` rows, sends `pending`/`failed` sales, and maps each server result back to outbox status (`synced`/`duplicate` → synced, else `failed`). Sync is single-flight (guarded by `isSyncing`).

## Key gotchas

- **Backend port is 8001**, not 8000. Older docs / `restart_app.ps1` mentioning 8000 are stale.
- **Backend tests must run from `sellary-backend/` with the venv active** — `core/database.py` connects at import. Test isolation uses **transaction rollback**, so in tests use `session.flush()`, not `session.commit()`.
- **Alembic migrations (`alembic/versions/*.py`) are tracked (committed); all `.env` files are gitignored.** Commit generated migrations; copy config from the `.env.example` files.
- **Online `POST /api/sales` rejects oversell** — the FIFO ledger in `services/inventory_ledger_service.py` cannot back negative stock (`consume_fifo` raises `Insufficient stock`). Only the offline **sync path** (`services/sync_service.py`, `allow_oversell=True`) tolerates oversell, recording it as a historical fact with a `SyncWarning`.
- **Duplicate frontend layers exist:** `src/api.ts` vs `src/lib/api.ts`, and `src/store/` vs `src/lib/store.ts`. Confirm which is canonical before editing. `src/App.tsx.bak` is dead.
- **Removed scope:** the restaurant module and the PWA/offline-web-sync path were deleted from the codebase. Offline is now handled exclusively by the Tauri cashier — don't reintroduce the old patterns.
- **Mixed languages by design:** code and docstrings in English, UI strings in Russian, some docs in Uzbek/English. Don't translate existing content without an explicit request.
- Backend root contains many one-off maintenance/debug scripts (`fix_enum*.py`, `check_enum.py`, `debug_return.py`, `attach_user_to_company.py`, etc.). These are operational tooling, not part of the request path.

## Reference docs

- `AGENTS.md` — companion agent guide (overlaps this file)
- `DOCUMENTATION.md` — full feature list, page-by-page UI behavior, DB schema, complete API endpoint table, and an explicit "NOT included" list
- `sellary-backend/README.md` — auth contract, bootstrap/seed scripts
- `sellary-backend/RUNBOOK.md` — tenant tables, multi-company operations
- `sellary-backend/TESTING_GUIDE.md` — test fixtures and conventions
- `BUSINESS_LOGIC_GUIDE.md` — business rules (Russian)
- `ISSUE_TASKS.md` — P0/P1/P2 backlog; `Suggestion.md` — MVP scope notes (Uzbek)
