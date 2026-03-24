# Sellary Backend

FastAPI backend for Sellary with multi-company v1 support.

## Multi-Company Defaults

- One database
- Shared schema
- Tenant isolation through `company_id`
- Users can belong to multiple companies through `company_memberships`
- Auth flow is `login -> select company -> company-scoped access token`
- Offline multi-company remains out of scope for this wave

## Setup

1. Install dependencies
```bash
pip install -r requirements.txt
```

2. Configure `.env`
```bash
cp .env.example .env
```

3. Apply migrations
```bash
alembic upgrade head
```

4. Bootstrap the first company and owner
```bash
python bootstrap_company.py ^
  --company-name "Sellary Demo" ^
  --company-slug "sellary-demo" ^
  --owner-username "admin" ^
  --owner-email "admin@example.com" ^
  --owner-password "admin123" ^
  --owner-role "admin"
```

5. Optionally seed demo cashier and demo data
```bash
python seed_admin.py
python seed_demo_data.py
```

6. Run the API
```bash
uvicorn main:app --reload
```

API base URL: `http://localhost:8000`

Docs: `http://localhost:8000/docs`

## Auth Contract

- `POST /api/auth/login`
  - Returns `login_token`, `user`, and `companies[]`
- `POST /api/auth/select-company`
  - Exchanges `login_token` for a company-scoped `access_token`
- `POST /api/auth/switch-company`
  - Re-issues a company-scoped `access_token` for another membership
- `GET /api/auth/me`
  - Returns `user`, `current_company`, and `companies[]`
- `POST /api/owner/auth/login`
  - Returns an owner-only `access_token` for the global control panel
- `GET /api/owner/session`
  - Returns the current super admin owner session
- `POST /api/owner/companies/{company_id}/enter`
  - Opens a temporary admin company session without a stored membership

All business endpoints require a company-scoped access token.

## Bootstrap Scripts

- `python reset_database.py --yes`
  - Fresh-start destructive reset for local/dev environments
- `python bootstrap_company.py ...`
  - Creates the first company and owner account
- Schema creation/reset and migration upgrade flow also auto-create or update the owner-panel super admin when
  `SUPER_ADMIN_USERNAME`, `SUPER_ADMIN_EMAIL`, and `SUPER_ADMIN_PASSWORD` are present in `.env`
- `python attach_user_to_company.py ...`
  - Attaches an existing or new user to a company
- `python bootstrap_super_admin.py`
  - Manual fallback to create or update the env-driven owner panel account
- `python seed_admin.py`
  - Ensures default demo company plus `admin` and `cashier`
- `python seed_demo_data.py`
  - Re-seeds deterministic demo tenant data for one company

## Idempotent Endpoints

These endpoints require `Idempotency-Key` headers with 16-64 characters:

- `POST /api/sales`
- `POST /api/sales/{sale_id}/cancel`
- `POST /api/sales/{sale_id}/return`
- `POST /api/inventory/adjust`
- `POST /api/purchase-orders/{po_id}/receive`

## Verification

Backend test suite:
```bash
pytest tests/integration tests/unit
```

Compile smoke check:
```bash
python -m compileall api core models repositories schemas services main.py
```

## Runbook

Operator steps and recovery notes live in `RUNBOOK.md`.
