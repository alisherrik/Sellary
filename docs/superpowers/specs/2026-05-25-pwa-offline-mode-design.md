# PWA Offline Mode — Design Spec

**Date:** 2026-05-25
**Status:** In Progress
**Author:** Sellary Team

---

## 1. Overview

Enable Sellary to function as an installable PWA with offline sales support across desktop, tablet, and phone. The app must work offline for critical POS operations (creating sales, browsing product catalog), sync queued sales to the server when connectivity returns, and handle stock discrepancies gracefully.

## 2. Scope

### In scope
- Service Worker with asset precaching (app shell loads offline)
- PWA manifest with install prompt (standalone display mode)
- Offline sales via IndexedDB sync queue (already built, needs hardening)
- React Query cache persistence for product/catalog browsing offline
- Lenient stock enforcement for synced offline sales with warnings
- Read-only fallback for pages that can't function fully offline
- Storage budget monitoring (warn at 40MB+)

### Out of scope
- Offline inventory adjustments, purchase orders, or catalog editing
- Native app wrappers (Tauri/Capacitor)
- Multi-company offline support (explicitly blocked)
- Offline login (requires existing valid token)
- Conflict resolution for concurrent edits (only sales are written offline)
- Offline payment processing (cash-only assumed offline)

## 3. Architecture

### 3.1 Data flow

```
Online:  User action → API call → Server → Update React Query cache → Update IndexedDB persist
Offline: User action → IndexedDB sync queue → React Query cache (optimistic)
Restore: Server reachable → processQueue() → replay queued items → POST /api/sales (with idempotency) → Server → sync_warnings → Update UI
```

### 3.2 Storage layers

| Layer | Storage | Scope | Eviction |
|-------|---------|-------|----------|
| SW Cache | Cache API | Static assets (JS/CSS/fonts/images) | Build-versioned, auto-cleanup |
| React Query persist | IndexedDB (`idb-keyval`) | API responses (products, customers, categories) | 24h maxAge, whitelist keys only |
| Sync queue | IndexedDB (`idb-keyval`) | Pending API calls (sales) | Manual clear or after successful sync |
| Auth/Cart | localStorage | Session state | Keyed by tenant, survives refresh |

### 3.3 Service Worker caching strategy

| Resource Type | Strategy | Details |
|---------------|----------|---------|
| JS/CSS/fonts (build output) | `PrecacheAndRoute` | Precached on install, hash-versioned |
| Next.js pages (HTML) | `NetworkFirst` | Serve cached if offline, update in background |
| `/api/*` | `NetworkOnly` | **NEVER cached** — stale financial data is dangerous |
| Product images | `StaleWhileRevalidate` | Serve cached image, update in background, max 50 entries |
| External resources | `NetworkOnly` | No caching of third-party scripts/fonts |

### 3.4 Connectivity detection

Zero-trust model (already built): `POST /api/health` with 3s timeout, 30s polling interval, `navigator.onLine` events trigger immediate recheck. Initial state: offline (fail-safe).

## 4. Key Components

### 4.1 SW registration & update flow (`src/lib/sw.ts` — new)

- Register SW via `@ducanh2912/next-pwa` generated file
- Listen for `SW` update: `skipWaiting()` → post message to all clients
- Show update toast: "Новая версия доступна. Обновите страницу."
- On user click: `window.location.reload()`

### 4.2 Install prompt (`src/components/InstallPrompt.tsx` — new)

- Listen for `beforeinstallprompt` event, store in state
- Show subtle button in sidebar: "Установить приложение"
- On click: `prompt.prompt()` → handle `userChoice` outcome
- On already-installed (standalone mode): hide button entirely

### 4.3 Sync queue hardening (`src/lib/syncQueue.ts` — modify)

- Add `maxItems: 500` cap, warn if approaching
- Client-side dedup: check `idempotencyKey` before enqueue
- Post-sync verification: `GET /api/sales/:id` after successful replay, compare response
- Parse `sync_warnings` from response, store with queue item for UI display
- Respect `_offline_sync: true` flag in replayed request body

### 4.4 SyncStatusPanel (`src/components/SyncStatusPanel.tsx` — modify)

- Show `sync_warnings` (oversold products) as expandable detail per queue item
- Color-code: pending=gray, syncing=blue, failed=red, warning=yellow

### 4.5 OfflineGuard softening (`src/components/OfflineGuard.tsx` — modify)

- Instead of full page block, allow read-only render of cached data
- Overlay a dismissible banner: "Офлайн — данные могут быть неактуальны"
- Only block write actions (create/edit/delete buttons disabled or hidden)

### 4.6 Storage monitor (`src/lib/storage.ts` — new)

- Check `navigator.storage.estimate()` on app load and periodically
- Warn in console and show toast at >40MB
- Block new queue additions at >50MB (with error toast)

## 5. Backend Changes

### 5.1 `POST /api/sales` — lenient offline sync

File: `sellary-backend/services/sale_service.py`

When request body contains `_offline_sync: true`:
- Skip stock availability validation
- Allow sale to create negative stock balances
- After sale creation, detect oversold products
- Return `sync_warnings` array in response:

```json
{
  "sale": { ... },
  "sync_warnings": [
    {
      "type": "oversold",
      "product_id": "uuid",
      "product_name": "Товар X",
      "requested": 5,
      "available": 2,
      "new_balance": -3
    }
  ]
}
```

### 5.2 Response schema

File: `sellary-backend/schemas/sale.py`

Add `SaleSyncWarning` and update `SaleResponse` to include optional `sync_warnings: list[SaleSyncWarning] | None`.

### 5.3 No other backend changes

- No new endpoints
- No new DB tables
- No migration
- Inventory, purchase orders, catalog endpoints unchanged

## 6. Configuration

### 6.1 Environment

`NEXT_PUBLIC_ENABLE_OFFLINE_MODE=true` — enables all offline behavior.

### 6.2 next.config.js

```js
const withPWA = require("@ducanh2912/next-pwa").default({
  dest: "public",
  register: true,
  skipWaiting: true,
  clientsClaim: true,
  runtimeCaching: [
    { urlPattern: /^\/api\/.*/, handler: "NetworkOnly" },
    { urlPattern: /^\/_next\/static\/.*/, handler: "CacheFirst" },
    { urlPattern: /\.(png|jpg|jpeg|svg|gif|webp)$/, handler: "StaleWhileRevalidate", options: { maxEntries: 50 } },
  ],
  buildExcludes: [/middleware-manifest\.json$/],
});

module.exports = withPWA(nextConfig);
```

### 6.3 Package additions

Add to `package.json`:
- `@ducanh2912/next-pwa` — SW generation for Next.js 14 App Router

No other new dependencies needed. Existing `idb-keyval`, `@tanstack/react-query-persist-client`, `zustand` are sufficient.

## 7. Error Handling

| Scenario | Handling |
|----------|----------|
| IndexedDB full (>50MB) | Toast error, block new queue additions, suggest clearing old data |
| SW registration fails | Log error, continue without offline support (graceful degradation) |
| Sync replay gets 4xx | Mark queue item as `failed`, show error message, suggest manual review |
| Sync replay gets 5xx | Retry with exponential backoff (1s→2s→4s→8s→60s), max 5 retries |
| Network drops mid-sync | Abort remaining items, wait for next online event to resume |
| Idempotency collision on server | Server returns original sale, frontend matches and marks resolved |
| Token expired during offline | Sync fails with 401, redirect to login (queue preserved in IndexedDB) |

## 8. Testing Strategy

### 8.1 Unit tests (Vitest)

| File | What to test |
|------|-------------|
| `src/lib/sw.ts` | SW registration, update prompt flow |
| `src/components/InstallPrompt.tsx` | `beforeinstallprompt` event, render states |
| `src/lib/syncQueue.ts` | Dedup, maxItems cap, post-sync verification |
| `src/lib/storage.ts` | Storage estimate, warning thresholds |
| `src/components/SyncStatusPanel.tsx` | sync_warnings display |
| `src/components/OfflineGuard.tsx` | Read-only fallback, write action blocking |

### 8.2 E2E tests (Playwright)

| File | What to test |
|------|-------------|
| `tests/offline-mode-e2e.spec.ts` | Extend existing: add install prompt, SW update |
| `tests/offline-sync.spec.ts` | Extend: oversold warning display, queue dedup |

### 8.3 Backend tests

| File | What to test |
|------|-------------|
| `tests/unit/test_sale_service.py` | `_offline_sync` flag, oversold warnings, response schema |

## 9. Implementation Phases

All components implemented in a single phase via 5 parallel agents.

| Agent | Scope | Files |
|-------|-------|-------|
| 1 | PWA foundation — next-pwa, SW config, install prompt | `next.config.js`, `package.json`, `public/`, 2 new files |
| 2 | Backend — lenient stock + sync_warnings | `sale_service.py`, `sale.py` schema |
| 3 | Sync queue hardening + storage monitor | `syncQueue.ts`, 1 new file |
| 4 | UI — SyncStatusPanel, OfflineGuard, ConnectionStatus | 3 components |
| 5 | Integration, tests, enable offline mode flag | tests, providers, `.env` |
