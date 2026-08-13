# Multi-Company Runbook

## Scope

This runbook covers Sellary multi-company v1:

- one shared database
- company-scoped business data via `company_id`
- multi-company users via `company_memberships`
- company-scoped JWT sessions

Non-goals in this wave:

- branch/store tenancy
- offline multi-company sync
- company branding/settings
- public self-signup onboarding

## Fresh Start

Use this only for local/dev or explicitly approved destructive resets.

```bash
python reset_database.py --yes
```

Then bootstrap the first company:

```bash
python bootstrap_company.py ^
  --company-name "Sellary Demo" ^
  --company-slug "sellary-demo" ^
  --owner-username "admin" ^
  --owner-email "admin@example.com" ^
  --owner-password "admin123" ^
  --owner-role "admin"
```

Optional demo accounts and data:

```bash
python seed_admin.py
python seed_demo_data.py
```

## Add Another Company

Attach an existing or new user without editing the database manually:

```bash
python attach_user_to_company.py ^
  --company-name "North Branch" ^
  --company-slug "north-branch" ^
  --username "manager1" ^
  --email "manager1@example.com" ^
  --password "secret123" ^
  --role "manager" ^
  --default-company
```

If the user already exists, `--email` can be omitted.

## Login Flow

1. `POST /api/auth/login`
   Returns:
   - `login_token`
   - `user`
   - `companies[]`
2. `POST /api/auth/select-company`
   Requires `Authorization: Bearer <login_token>`
3. `POST /api/auth/switch-company`
   Requires current company-scoped access token
4. `GET /api/auth/me`
   Returns current session state

Important:

- business endpoints must not accept login tokens
- business reads/writes must always apply company filters
- idempotent business operations require `Idempotency-Key`

## Tenant-Owned Tables

These tables are company-scoped in v1:

- `categories`
- `customers`
- `products`
- `suppliers`
- `purchase_orders`
- `sales`
- `sale_returns`
- `inventory_logs`
- `idempotency_keys`

`sale_items` and `purchase_order_items` inherit tenant scope through parent records.

## Verification Commands

Backend tests:

```bash
pytest tests/integration tests/unit
```

Backend compile smoke:

```bash
python -m compileall api core models repositories schemas services main.py
```

Frontend tests:

```bash
npx vitest run
```

Frontend build:

```bash
npm run build
```

## Сверка (closing a period)

The order matters — every step exists because skipping it has cost somebody a day.

1. **Close the shift.** A cut-off inside an open shift splits that shift's own
   arithmetic across the boundary, and the API refuses it.
2. **Count the goods and the cash.** Enter the counted quantities through
   «Инвентаризация» on the products page and «Сверить» on each money account.
3. **Run the checker** and read the output:
   ```
   railway run --service Postgres python check_consistency.py --company <id>
   ```
   It writes nothing and exits 1 when anything is in the `drift` bucket.
4. **Declare the reconciliation** — Settings → «Сверка», or
   `POST /api/reconciliation {"effective_from": "<first open day>"}`. It runs the
   checker again and refuses on drift; `acknowledge_violations: true` proceeds
   and records the findings on the row.

Two things to know before anyone relies on it:

- **The freeze binds the application, not the database.** The maintenance
  scripts in this directory (`reconcile_ledger_drift.py`, `repair_purchase_15.py`,
  `reconcile_inventory_value.py`, `reset_database.py`, `clear_test_data.py`,
  `debug_return.py`, `fix_enum*.py`) open their own engines and commit their own
  transactions, outside all company scoping. No service guard stops them. That
  escape hatch is deliberate — it is how the June ledger drift was repaired — and
  making it a real invariant would need a Postgres trigger and its own migration.
- **Nothing schedules the checker.** There is no cron, no APScheduler and no
  Railway worker anywhere in the stack; `railway.toml` has only a
  `preDeployCommand` and a healthcheck. Production runs are manual until someone
  decides otherwise.

## Known Guardrails

- `Idempotency-Key` must be 16-64 characters.
- `POST /api/sales/{sale_id}/cancel` and `POST /api/sales/{sale_id}/return` now return `404` when the sale is not found in the active company.
- Multi-company is not supported when frontend offline mode is enabled.
