# Tauri Cashier Runbook

## Purpose

`sellary-cashier` is the offline-first POS app for cashier terminals. It uses local SQLite for product catalog and sale outbox, then syncs to the backend through `/api/sync/*`.

## Commands

```
cd sellary-cashier
npm run dev
npm run tauri:dev
npm run build
npm run tauri:build
```

## Backend URL

Production: `https://sellary-production-30ec.up.railway.app`
Local: `http://127.0.0.1:8001`

## Auth Flow

1. `POST /api/auth/login` returns `login_token`.
2. User selects company.
3. `POST /api/auth/select-company` returns company-scoped `access_token`.
4. `GET /api/sync/bootstrap` downloads products/categories.
5. Cashier stores catalog locally.

## Offline Sales Flow

1. Sale is written to `outbox_sales`.
2. Local stock is decremented.
3. If server is reachable, sale syncs immediately.
4. If server is unreachable, sale remains pending/failed.
5. Manual sync retries pending/failed rows.

## Common Errors

### `sql.execute not allowed`

Tauri capability is missing SQL execute permission. Confirm `sellary-cashier/src-tauri/capabilities/default.json` includes:
```json
"sql:allow-load",
"sql:allow-select",
"sql:allow-execute"
```

### `Unauthorized` after selecting company

The app is likely using a login token where an access token is required, or the access token expired. Re-login and confirm `/api/auth/select-company` returns `access_token`.

### Sales stuck in `syncing`

Run manual sync. The sync service should recover interrupted syncing rows automatically.
