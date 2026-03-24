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

## Known Guardrails

- `Idempotency-Key` must be 16-64 characters.
- `POST /api/sales/{sale_id}/cancel` and `POST /api/sales/{sale_id}/return` now return `404` when the sale is not found in the active company.
- Multi-company is not supported when frontend offline mode is enabled.
