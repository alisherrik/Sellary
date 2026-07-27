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

**Module-level access:** non-admin members get per-module grants (`pos | inventory | purchasing | shop | reports` × `user | manager`) stored in `membership_module_access` and enforced by the `require_module()` dependency (`api/dependencies.py`). Membership role `admin` bypasses all module checks; the cashier sync/device-auth channel and shopper-facing shop endpoints are unaffected. Session responses (`select-company`, `/auth/me`) include a `modules` map that drives the frontend nav and `ModuleGuard`; admins edit grants via `GET/PUT /api/admin/memberships/{id}/modules`.

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

### Split payment
One sale can be settled with several tenders — 26 наличными + 10 DC + 10 Эсхата + 4 в долг.
Each is a row in **`sale_payments`**, and that table is the truth about money: till
balances, shift totals, the sales summary, the payment-method filter and the money
accounts all read it. `sales.payment_method` survives as the **largest** tender plus a
`sales.is_split` flag — display and backwards compatibility only, never a money figure.
Never add a second channel for this fact; that is how `stock_quantity` drifted from its
FIFO layers.

`POST /api/sales` accepts either `payments: [...]` or the older scalar
`payment_method`/`paid_amount` shape, never both — the offline cashier still speaks the
old one. `services/sale_tender_service.py` turns both into the same tender list and is
where the rules live (exact sum to the cent, one credit line, a customer for credit).
Anything that creates a `Sale` must write tenders: today that is `SaleService.create`
and `sync_service`, and tests use `add_sale_tenders` from `tests/conftest.py`.

A credit sale's ledger keeps its old shape — `credit_sale` for the total plus offsetting
rows for what was paid at the till — but those offsets are `entry_type='sale_tender'`,
not `payment`. Money reports filter on `payment`, so the same cash is not counted both
as a tender and as a debt repayment.

### MCP connector (`sellary-backend/mcp_server/`)
An MCP server mounted in-process at `/mcp` (FastMCP 3.x), so Claude can read every
report and record a batch purchase. Tools call the same `services/` layer the
routers call — a tool is the MCP equivalent of a router and holds no business logic.

Auth is OAuth 2.1 with PKCE and Dynamic Client Registration, with Sellary acting as
both authorization and resource server (`mcp_server/oauth/`). `/authorize` parks the
request in a signed transaction and hands the browser to `login → company → consent`
(server-rendered Russian pages), which mints the code. The access token is the
ordinary company-scoped JWT plus an `mcp: true` claim, so a web-session token is
rejected at `/mcp` and an MCP token carries no more authority than its owner's login.
Discovery documents are served from the **origin root**, not under the mount.

Reports are read-only. The only write is the two-phase purchase: `purchase_preview`
resolves a delivery against the catalogue and returns a signed `draft_token` without
writing; `purchase_commit` executes only what that token carries, guarded by the
existing `idempotency_keys` table. Required env var: `MCP_PUBLIC_BASE_URL` (the public
https origin) — in production the connector disables itself if it is unset.

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
- `docs/MCP_CONNECTOR_GUIDE.md` — connecting Sellary to Claude, for the shop owner (Russian)
- `docs/superpowers/specs/2026-07-27-sellary-mcp-server-design.md` — MCP design; the plan sits alongside it in `plans/`
- `ISSUE_TASKS.md` — P0/P1/P2 backlog; `Suggestion.md` — MVP scope notes (Uzbek)
