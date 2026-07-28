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

### Split payment

One sale, several tenders (26 наличными + 10 DC + 10 Эсхата + 4 в долг). Each is a row in `sale_payments`, and that table is the truth about money — balances, shift totals, sales summary, payment filter and money accounts all read it. `sales.payment_method` is the *largest* tender plus a `sales.is_split` flag: display and compatibility only. `POST /api/sales` takes either `payments: [...]` or the older scalar shape, never both; `services/sale_tender_service.py` normalises both and holds the rules (exact sum to the cent, one credit line, customer required for credit). Every path that creates a `Sale` must write tenders — `SaleService.create` and `sync_service` do; tests use `add_sale_tenders` from `tests/conftest.py`. A credit sale's till payments are ledger rows of type `sale_tender`, not `payment`, so money reports do not count the same cash twice.

### Refunds and debt

A return settles the debt first. `sale_returns.credit_refund_amount` is how much the debt absorbed; money that actually moved is `total_refund_amount - credit_refund_amount`, and that is what `CashShiftService.compute_totals` and `MoneyRepository._sum_refunds` use. `total_refund_amount` still means the value of the goods returned, so turnover and `remaining_refundable_amount` are unchanged. Never gate debt logic on `sales.payment_method` — a split sale files itself under its largest tender.

### The drawer has one balance

The till `MoneyAccount` owns the cash figure. The shift's «Ожидается в кассе» is read from `MoneyRepository.till_balance`, and whatever the shift's own window cannot explain is surfaced as the `late_arrivals` line rather than left to split the two screens apart — in production they drifted 339.74 (offline sales syncing into already-frozen `closing_totals`, reversed debt payments, and hand-typed count corrections the money page never heard about).

A physical count is a document: `open_shift` and `close_shift` write the difference from the ledger as a `MoneyMovement` (`adjustment_in`/`adjustment_out`), stamped at `opened_at` (inside the new window) and at `closed_at` (outside the window it settles). `opening_cash` and `counted_cash` are what somebody counted, never a balance. `open_shift` stamps `opened_at` with `utc_now()`, not `func.now()`, so the previous close's correction cannot fall inside the new shift.

### Write-offs and supplier returns
Spoiled, broken or defective goods leave the shelf as a `stock_write_offs`
document with lines — not as a quantity nudge. Two independent axes:
`reason_code` (why the goods are unsellable) and `disposition` (`disposed` or
`returned_to_supplier`). Keeping them separate is what lets the report say
«порча 400, из них 250 вернули поставщику».

`StockWriteOffService` calls the same `consume_fifo` a sale does and never
touches `stock_quantity` itself. Cost is whatever the ledger actually consumed,
frozen into `line_cost` / `total_cost` — never `quantity * cost_price`, because
the layers that fed the document may be gone tomorrow. `allow_oversell` is not
passed: writing off stock that is not there is a data error, not a historical
fact the way an offline sale is.

**A supplier return moves no money.** `suppliers` has no balance and
`purchase_orders` has no `paid_amount`, so there is nothing to reduce; the
return records that the goods left and who took them. If the supplier actually
refunds cash, that is an ordinary movement on the Finance page. Do not invent a
supplier ledger to make a return "balance".

Write-offs never enter turnover. The profit report carries them as
`write_off_cost` and `profit_after_write_offs` beside an unchanged `profit`, so
existing callers (frontend, MCP `get_profit_report`) keep their meaning.

### MCP connector

Gated on the `ai` module — in no business-type preset, checked on every tool call (not just at connect time, since access tokens live a day), and the OAuth company step hides companies without it. Settings → «ИИ-коннектор» (`api/mcp.py`, `services/mcp_admin_service.py`) gives the URL to copy, lists connected agents and revokes one by striking its refresh token.


`sellary-backend/mcp_server/` is an MCP server mounted in-process at `/mcp` (FastMCP 3.x). Tools call `services/`, never repositories — a tool is the MCP equivalent of a router. Auth is OAuth 2.1 (PKCE + Dynamic Client Registration) with Sellary as both authorization and resource server; `/authorize` parks the request in a signed transaction and hands the browser to `login → company → consent`. The access token is the ordinary company-scoped JWT plus `mcp: true`, so a web-session token is refused at `/mcp`. Discovery documents are served from the **origin root**, not under the mount. Reports are read-only; the only write is `purchase_preview` → `purchase_commit`, where the commit executes only the signed draft the preview issued. Requires `MCP_PUBLIC_BASE_URL`; in production the connector disables itself if it is unset.

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
- `docs/MCP_CONNECTOR_GUIDE.md` — connecting Sellary to Claude, written for the shop owner (Russian)
- `ISSUE_TASKS.md` — P0/P1/P2 task backlog
- `Suggestion.md` — MVP scope recommendations (Uzbek)
