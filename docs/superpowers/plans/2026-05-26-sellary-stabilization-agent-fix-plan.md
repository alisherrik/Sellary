# Sellary Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize Sellary after the Restaurant/PWA removal and Tauri cashier introduction so backend, web frontend, desktop cashier, sync, deployment, and CI are consistent and production-pilot ready.

**Architecture:** Keep the web app as the online admin/POS interface, keep the backend as the single source of truth, and make the Tauri cashier an offline-first local SQLite client that syncs sales through `/api/sync/*`. Do not reintroduce PWA/service-worker/offline web queue code or Restaurant/table-ordering code.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, PostgreSQL, Pytest, Next.js 15, React 18, Vitest, Netlify, Tauri 2, React 19, Vite, TypeScript, SQLite via `@tauri-apps/plugin-sql`, Store/Stronghold plugins, Railway.

---

## Agent Rules

- Work from repo root: `D:\Learning\Sellary`.
- Do not use `git reset --hard`, `git checkout --`, or any destructive cleanup.
- The worktree is already dirty. Do not revert unrelated changes.
- Backend commands must run inside `sellary-backend`.
- Frontend commands must run inside `sellary-frontend`.
- Cashier commands must run inside `sellary-cashier`.
- Backend port is `8001`, not `8000`.
- Do not restore deleted PWA files: `public/sw.js`, `public/manifest.json`, `src/lib/syncQueue.ts`, `src/lib/sw.ts`, `src/hooks/useOfflineSync.ts`, `src/components/SyncManager.tsx`, etc.
- Do not restore deleted Restaurant routes under `sellary-frontend/src/app/(protected)/restaurant`.
- Prefer small commits after each completed task.

## Current Audit Evidence

Commands already passed before this plan:

```powershell
cd D:\Learning\Sellary\sellary-backend
.\.venv\Scripts\python.exe -m compileall api core models repositories schemas services main.py
.\.venv\Scripts\pytest.exe tests/integration tests/unit -q
```

Expected current backend result: `281 passed`, coverage around `84%`.

```powershell
cd D:\Learning\Sellary\sellary-frontend
npm run build
npx vitest run
npm run lint
```

Expected current frontend result: build passes, `53 passed`, one lint warning in `src/providers/ServerHealthProvider.tsx`.

```powershell
cd D:\Learning\Sellary\sellary-cashier
npm run tauri:build
```

Expected current cashier result: Windows app and installers build successfully.

Production evidence:

- Railway backend URL: `https://sellary-production-30ec.up.railway.app`
- Netlify frontend URL: `https://sellary-client.netlify.app`
- Production backend health is healthy.
- Production DB Alembic version is `d6220dc5b3cb`.
- Restaurant/offline DB columns are removed from production: `sales.context_type`, `sales.table_name`, `sales.offline_sync`, `products.product_type`.

## Severity Summary

| Priority | Area | Problem | Impact |
| --- | --- | --- | --- |
| P0 | Git/release | `sellary-cashier/` is untracked and repo has a huge dirty diff | Easy to lose or accidentally omit the new app |
| P1 | Tauri auth | `restoreSession()` always returns false and token only lives in memory | Cashier loses session after restart/refresh |
| P1 | Tauri sync | Sales can get stuck in `syncing` forever after a crash/network error | Offline sales may never reach backend |
| P1 | Tauri sync | Sync errors are swallowed as `{ synced: 0, failed: 0 }` | Cashier UI may report wrong status |
| P1 | Tauri offline stock | Local stock is not decremented after local sale | Offline cashier can repeatedly oversell without local warning |
| P1 | Mobile | Android scripts exist but mobile app is not initialized/verified | "Mobile ready" is not true yet |
| P1 | Deploy | Railway auto-deploy root config is fragile | GitHub deploys can fail while manual CLI deploy works |
| P2 | Frontend | `ServerHealthProvider` hook dependency warning | Build is green but lint is not clean |
| P2 | CI | No `.github/workflows` | Regressions depend on manual checks |
| P2 | Backend sync | Offline sync allows oversell by design | Business rule needs explicit setting and tests |
| P2 | Cashier QA | No cashier unit tests | Tauri regressions are easy to miss |
| P3 | UX | Cashier settings lacks catalog refresh and clearer sync details | Operators have fewer recovery tools |

## Recommended 8-Agent Split

Use this if running multiple agents. If only one agent is available, execute tasks in the same order.

1. **Agent 1 - Git Hygiene + Release Baseline:** Task 1.
2. **Agent 2 - Tauri Session Restore:** Task 2.
3. **Agent 3 - Tauri Sync Reliability:** Task 3.
4. **Agent 4 - Tauri Offline Stock + Catalog Refresh:** Task 4.
5. **Agent 5 - Cashier Test Harness:** Task 5.
6. **Agent 6 - Backend Sync Hardening:** Task 6.
7. **Agent 7 - Frontend Cleanup + CI:** Tasks 7 and 8.
8. **Agent 8 - Deployment + Final QA Docs:** Tasks 9 and 10.

---

## File Map

### Backend

- Modify: `sellary-backend/core/config.py`
  - Add explicit sync oversell setting.
- Modify: `sellary-backend/services/sync_service.py`
  - Respect oversell setting and keep per-sale error behavior.
- Modify/Test: `sellary-backend/tests/unit/test_sync_service.py`
  - Add oversell strict-mode tests.
- Modify/Test: `sellary-backend/tests/integration/test_sync_endpoints.py`
  - Add endpoint contract checks if missing.

### Web Frontend

- Modify: `sellary-frontend/src/providers/ServerHealthProvider.tsx`
  - Fix lint warning with `useCallback`.
- Modify/Test: `sellary-frontend/src/providers/__tests__/ServerHealthProvider.test.tsx`
  - Keep provider behavior covered.
- Modify: `sellary-frontend/package.json`
  - Optionally migrate `lint` away from deprecated `next lint`.
- Create: `.github/workflows/ci.yml`
  - Backend, frontend, and cashier verification.

### Tauri Cashier

- Create: `sellary-cashier/src/lib/error.ts`
  - Shared unknown-error normalization.
- Create: `sellary-cashier/src/lib/session.ts`
  - Session metadata and secure token persistence boundary.
- Modify: `sellary-cashier/src/lib/api.ts`
  - Add token restore hooks and clearer 401 behavior.
- Modify: `sellary-cashier/src/lib/auth-store.ts`
  - Implement restore, logout cleanup, and session save.
- Modify: `sellary-cashier/src/lib/db.ts`
  - Add local stock decrement and stuck sync recovery helpers.
- Modify: `sellary-cashier/src/lib/sync-service.ts`
  - Fix stuck `syncing` sales and error accounting.
- Modify: `sellary-cashier/src/pages/LoginPage.tsx`
  - Reuse shared error helper.
- Modify: `sellary-cashier/src/pages/CashierShell.tsx`
  - Restore session on first load.
- Modify: `sellary-cashier/src/pages/POSPage.tsx`
  - Update local stock after local sale and improve sync messages.
- Modify: `sellary-cashier/src/pages/SettingsPage.tsx`
  - Add catalog refresh button.
- Modify: `sellary-cashier/package.json`
  - Add test scripts and dev dependencies.
- Create: `sellary-cashier/src/test/setup.ts`
  - Mock Tauri plugins for unit tests.
- Create: `sellary-cashier/src/lib/__tests__/sync-service.test.ts`
  - Cover sync stuck-state recovery.
- Create: `sellary-cashier/src/lib/__tests__/auth-store.test.ts`
  - Cover restore/logout behavior.

### Deploy/Docs

- Modify: `railway.toml` or Railway service settings documentation.
- Modify: `DOCUMENTATION.md`
- Modify: `ISSUE_TASKS.md`
- Create: `docs/TAURI_CASHIER_RUNBOOK.md`
- Create: `docs/RELEASE_CHECKLIST.md`

---

## Task 1: Git Hygiene And Baseline

**Problem:** `sellary-cashier/` is currently untracked as one directory, while frontend/backend cleanup is a large dirty diff. This can cause the new cashier app to be omitted from commits or deploy review.

**Files:**
- Check: `.gitignore`
- Check: `sellary-cashier/.gitignore`
- Check: `sellary-cashier/src-tauri/.gitignore`

- [ ] **Step 1: Confirm ignored generated files**

Run:

```powershell
cd D:\Learning\Sellary
git check-ignore -v sellary-cashier/node_modules sellary-cashier/dist sellary-cashier/src-tauri/target
```

Expected:

```text
sellary-cashier/.gitignore:10:node_modules sellary-cashier/node_modules
sellary-cashier/.gitignore:11:dist sellary-cashier/dist
sellary-cashier/src-tauri/.gitignore:3:/target/ sellary-cashier/src-tauri/target
```

- [ ] **Step 2: List trackable cashier files**

Run:

```powershell
cd D:\Learning\Sellary
rg --files sellary-cashier -g '!node_modules/**' -g '!dist/**' -g '!src-tauri/target/**' | Sort-Object
```

Expected: source files, package files, Tauri config, icons, migrations, and Rust files only.

- [ ] **Step 3: Do not stage yet unless explicitly asked**

This plan is for implementation. Do not stage or commit unless the user asks or the executing workflow requires commits.

---

## Task 2: Tauri Session Restore And Logout Cleanup

**Problem:** Cashier login works, but after refresh or app restart the user is forced back to login. `accessToken` is memory-only in `sellary-cashier/src/lib/api.ts`, and `restoreSession()` returns `false` in `sellary-cashier/src/lib/auth-store.ts`.

**Root Cause:**

```ts
let accessToken: string | null = null;
```

and:

```ts
restoreSession: async () => {
  return false;
},
```

**Target behavior:**

- After successful company selection, persist:
  - `access_token`
  - token expiry timestamp
  - company/user metadata needed for UI
- On app start, restore session if token exists and is not expired.
- If `/api/sync/bootstrap` returns 401, clear session and go to login.
- On logout, clear token and session metadata.
- Do not store username/password.

**Security decision for this project stage:**

- Use `@tauri-apps/plugin-stronghold` for token storage because it is already installed and registered.
- Use `@tauri-apps/plugin-store` only for non-sensitive settings such as API base URL and last company id.
- If Stronghold password UX is too heavy for this sprint, use a clearly named MVP fallback file with a warning comment, but prefer Stronghold.

**Files:**
- Create: `sellary-cashier/src/lib/error.ts`
- Create: `sellary-cashier/src/lib/session.ts`
- Modify: `sellary-cashier/src/lib/api.ts`
- Modify: `sellary-cashier/src/lib/auth-store.ts`
- Modify: `sellary-cashier/src/pages/CashierShell.tsx`
- Modify: `sellary-cashier/src/pages/LoginPage.tsx`

- [ ] **Step 1: Create shared error helper**

Create `sellary-cashier/src/lib/error.ts`:

```ts
export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown; error?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
    const nestedError = (error as { error?: unknown }).error;
    if (typeof nestedError === 'string' && nestedError.trim()) {
      return nestedError;
    }
  }
  return fallback;
}
```

- [ ] **Step 2: Create session module**

Create `sellary-cashier/src/lib/session.ts`.

Use this shape:

```ts
export interface PersistedCashierSession {
  accessToken: string;
  expiresAt: string;
  companyId: number;
  companyName: string;
  userId: number;
  username: string;
  userRole: string;
}

const ACCESS_TOKEN_KEY = 'cashier_access_token';
const SESSION_META_KEY = 'cashier_session_meta';
```

Implement these functions:

```ts
export async function saveCashierSession(session: PersistedCashierSession): Promise<void>;
export async function loadCashierSession(): Promise<PersistedCashierSession | null>;
export async function clearCashierSession(): Promise<void>;
export function isSessionExpired(session: PersistedCashierSession, now?: Date): boolean;
```

Implementation requirements:

- Store `accessToken` in Stronghold if possible.
- Store metadata excluding token in Store.
- If Stronghold fails, log `console.warn('Stronghold unavailable; falling back to app store token persistence', error)` and use Store as fallback for MVP only.
- `isSessionExpired` must return true if `Date.parse(expiresAt)` is invalid or <= current time.

Use these helpers inside the file:

```ts
function decodeJwtExp(token: string): string {
  const [, payload] = token.split('.');
  if (!payload) {
    return new Date(0).toISOString();
  }
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  const json = JSON.parse(atob(normalized));
  if (typeof json.exp !== 'number') {
    return new Date(0).toISOString();
  }
  return new Date(json.exp * 1000).toISOString();
}
```

If using this helper, export it only for tests:

```ts
export const sessionTestInternals = { decodeJwtExp };
```

- [ ] **Step 3: Add token expiry helper to API**

Modify `sellary-cashier/src/lib/api.ts`:

```ts
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}
```

Keep these functions, and ensure `apiFetch` clears the token only after parsing the response body so backend details are not lost.

- [ ] **Step 4: Persist session after select company**

Modify `sellary-cashier/src/lib/auth-store.ts`:

Import:

```ts
import { clearCashierSession, loadCashierSession, saveCashierSession, isSessionExpired } from './session';
import { getErrorMessage } from './error';
```

After successful bootstrap, call:

```ts
await saveCashierSession({
  accessToken: tokenRes.access_token,
  expiresAt: tokenRes.access_token ? sessionTestSafeExpiresAt(tokenRes.access_token) : new Date(0).toISOString(),
  companyId: bootstrap.company_id,
  companyName: bootstrap.company_name,
  userId: bootstrap.user_id,
  username: bootstrap.user_username,
  userRole: bootstrap.user_role,
});
```

Do not literally call `sessionTestSafeExpiresAt` unless you implement it. The real implementation should use the exported session helper, for example:

```ts
const expiresAt = getTokenExpiresAt(tokenRes.access_token);
```

Add `getTokenExpiresAt(token: string): string` to `session.ts` if needed.

- [ ] **Step 5: Implement restoreSession**

Replace:

```ts
restoreSession: async () => {
  return false;
},
```

with:

```ts
restoreSession: async () => {
  const session = await loadCashierSession();
  if (!session || isSessionExpired(session)) {
    await clearCashierSession();
    setApiToken(null);
    return false;
  }

  setApiToken(session.accessToken);
  set({
    isAuthenticated: true,
    companyId: session.companyId,
    companyName: session.companyName,
    userId: session.userId,
    username: session.username,
    userRole: session.userRole,
  });
  return true;
},
```

- [ ] **Step 6: Clear session on logout**

Modify logout in `auth-store.ts`:

```ts
logout: async () => {
  setApiToken(null);
  await clearCashierSession();
  set({
    isAuthenticated: false,
    companyId: null,
    companyName: null,
    userId: null,
    username: null,
    userRole: null,
  });
},
```

- [ ] **Step 7: Restore session in CashierShell**

Modify `sellary-cashier/src/pages/CashierShell.tsx` so it attempts restore once before redirecting.

Expected shape:

```tsx
export function CashierShell() {
  const { isAuthenticated, restoreSession } = useAuthStore();
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    restoreSession()
      .then((restored) => {
        if (cancelled) return;
        if (!restored && !isAuthenticated) {
          navigate('/login', { replace: true });
        }
      })
      .finally(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [restoreSession, isAuthenticated, navigate]);

  if (!checked && !isAuthenticated) {
    return null;
  }
  if (!isAuthenticated) {
    return null;
  }
  return <POSPage />;
}
```

Add missing imports:

```ts
import { useEffect, useState } from 'react';
```

- [ ] **Step 8: Run cashier build**

Run:

```powershell
cd D:\Learning\Sellary\sellary-cashier
npm run build
```

Expected: TypeScript and Vite build pass.

---

## Task 3: Tauri Sync Reliability

**Problem:** If sync marks local sales as `syncing` and then the network/server fails, those sales can stay in `syncing`. The next sync filters only `pending` and `failed`, so stuck records are not sent.

**Current risky pattern:**

```ts
const salesToSync = pending
  .filter((s) => s.status === 'pending' || s.status === 'failed')
```

then:

```ts
for (const sale of pending) {
  if (sale.status !== 'synced') {
    await updateOutboxStatus(sale.id, 'syncing');
  }
}
```

**Target behavior:**

- Before each sync, recover stale/incomplete `syncing` rows to `failed`.
- Only rows being sent should be marked `syncing`.
- If `pushSales` throws, all rows that were just marked `syncing` must be changed to `failed` with the error message.
- `syncPendingSales()` must return accurate `{ synced, failed }`.
- If no rows are actually sendable, do not call backend with an empty sales list.

**Files:**
- Modify: `sellary-cashier/src/lib/db.ts`
- Modify: `sellary-cashier/src/lib/sync-service.ts`
- Test: `sellary-cashier/src/lib/__tests__/sync-service.test.ts`

- [ ] **Step 1: Add DB helper to recover syncing rows**

Modify `sellary-cashier/src/lib/db.ts`.

Add:

```ts
export async function recoverSyncingSales(error = 'Recovered from interrupted sync'): Promise<number> {
  const database = await getDb();
  const result = await database.execute(
    `UPDATE outbox_sales
     SET status = 'failed',
         last_error = $1,
         retry_count = retry_count + 1
     WHERE status = 'syncing'`,
    [error]
  );
  return result.rowsAffected ?? 0;
}
```

If `rowsAffected` is not available in plugin result type, use:

```ts
return Number((result as { rowsAffected?: number }).rowsAffected ?? 0);
```

- [ ] **Step 2: Add DB helper to fail a batch**

Add:

```ts
export async function markOutboxSalesFailed(ids: number[], error: string): Promise<void> {
  if (ids.length === 0) return;
  for (const id of ids) {
    await updateOutboxStatus(id, 'failed', undefined, error);
  }
}
```

- [ ] **Step 3: Fix sync service**

Modify imports in `sellary-cashier/src/lib/sync-service.ts`:

```ts
import {
  getPendingSales,
  updateOutboxStatus,
  addSyncEvent,
  recoverSyncingSales,
  markOutboxSalesFailed,
} from './db';
import { getErrorMessage } from './error';
```

At the beginning of `syncPendingSales`, after online check and before `getPendingSales`, call:

```ts
await recoverSyncingSales();
```

Replace sales selection with:

```ts
const sendable = pending.filter((s) => s.status === 'pending' || s.status === 'failed');
if (sendable.length === 0) {
  await addSyncEvent('sync', 'skipped', 'no sendable pending sales');
  return { synced: 0, failed: 0 };
}
```

Build `salesToSync` from `sendable`, not `pending`.

Mark only `sendable` as `syncing`:

```ts
for (const sale of sendable) {
  await updateOutboxStatus(sale.id, 'syncing');
}
```

When matching backend results, search in `sendable`, not `pending`.

In catch:

```ts
} catch (e: unknown) {
  const msg = getErrorMessage(e, 'Sync error');
  const failedIds = sendableIds;
  await markOutboxSalesFailed(failedIds, msg).catch((error) => {
    console.warn('Failed to mark outbox sales as failed after sync error', error);
  });
  failed = failedIds.length;
  await addSyncEvent('sync', 'error', msg).catch((error) => {
    console.warn('Failed to write sync error event', error);
  });
}
```

Define `sendableIds` outside the try block:

```ts
let sendableIds: number[] = [];
```

- [ ] **Step 4: Ensure sync service does not swallow important failures**

Return accurate counts:

```ts
return { synced, failed };
```

Manual sync UI depends on this.

- [ ] **Step 5: Run build**

Run:

```powershell
cd D:\Learning\Sellary\sellary-cashier
npm run build
```

Expected: pass.

---

## Task 4: Local Stock Updates And Catalog Refresh

**Problem:** The cashier stores a sale locally but does not decrement the local product stock immediately. Offline users can sell the same stock repeatedly without local feedback.

**Target behavior:**

- After local sale is saved to outbox, decrement local SQLite product stock for the sold items.
- If local DB update fails, do not lose the sale; show a warning and keep the outbox row.
- Settings page should allow manual catalog refresh by calling bootstrap again.

**Files:**
- Modify: `sellary-cashier/src/lib/db.ts`
- Modify: `sellary-cashier/src/pages/POSPage.tsx`
- Modify: `sellary-cashier/src/lib/auth-store.ts`
- Modify: `sellary-cashier/src/pages/SettingsPage.tsx`

- [ ] **Step 1: Add local stock decrement helper**

Add to `sellary-cashier/src/lib/db.ts`:

```ts
export interface LocalStockChange {
  product_id: number;
  quantity: number;
}

export async function decrementLocalStock(items: LocalStockChange[]): Promise<void> {
  const database = await getDb();
  for (const item of items) {
    await database.execute(
      `UPDATE products
       SET stock_quantity = stock_quantity - $1
       WHERE id = $2`,
      [item.quantity, item.product_id]
    );
  }
}
```

- [ ] **Step 2: Use local stock decrement after outbox insert**

Modify `sellary-cashier/src/pages/POSPage.tsx`.

Import:

```ts
import { decrementLocalStock } from '../lib/db';
```

After the existing `await addToOutbox` block in `handleCompleteSale`, call:

```ts
await decrementLocalStock(
  cart.map((item) => ({
    product_id: item.product.id,
    quantity: item.quantity,
  }))
);
```

If this fails, keep sale in outbox:

```ts
try {
  await decrementLocalStock(
    cart.map((item) => ({
      product_id: item.product.id,
      quantity: item.quantity,
    }))
  );
} catch (error) {
  console.warn('Sale saved but local stock update failed', error);
  setSyncMessage('Продажа сохранена, но локальный остаток не обновился');
}
```

- [ ] **Step 3: Add catalog refresh action to auth store**

Extend `AuthState` in `auth-store.ts`:

```ts
refreshCatalog: () => Promise<void>;
```

Implement:

```ts
refreshCatalog: async () => {
  const bootstrap = await fetchBootstrap();
  await upsertCategories(bootstrap.categories);
  await upsertProducts(bootstrap.products);
  await setMeta('last_bootstrap_time', bootstrap.server_time);
  await addSyncEvent('bootstrap', 'success', 'manual refresh').catch(console.warn);
},
```

- [ ] **Step 4: Add button in SettingsPage**

Modify `sellary-cashier/src/pages/SettingsPage.tsx`.

Pull `refreshCatalog` from store:

```ts
const { username, companyName, userRole, logout, isAuthenticated, refreshCatalog } = useAuthStore();
```

Add state:

```ts
const [refreshingCatalog, setRefreshingCatalog] = useState(false);
```

Add handler:

```ts
const handleRefreshCatalog = async () => {
  setRefreshingCatalog(true);
  setMessage('');
  try {
    await refreshCatalog();
    setMessage('Каталог обновлен.');
  } catch (e: unknown) {
    setMessage(e instanceof Error ? e.message : 'Ошибка обновления каталога');
  } finally {
    setRefreshingCatalog(false);
  }
};
```

Add button near Sync:

```tsx
<button
  onClick={handleRefreshCatalog}
  disabled={refreshingCatalog}
  className="mt-2 w-full py-1.5 rounded border border-blue-200 text-blue-700 text-sm disabled:opacity-50"
>
  {refreshingCatalog ? 'Refreshing' : 'Refresh Catalog'}
</button>
```

- [ ] **Step 5: Run build**

Run:

```powershell
cd D:\Learning\Sellary\sellary-cashier
npm run build
```

Expected: pass.

---

## Task 5: Cashier Unit Test Harness

**Problem:** Tauri cashier has no unit tests. The sync/auth bugs can return easily.

**Target behavior:**

- Add Vitest for cashier.
- Mock Tauri SQL and Store plugins.
- Add focused tests for:
  - `syncPendingSales` recovers stuck `syncing`.
  - `syncPendingSales` marks rows failed when backend push throws.
  - `restoreSession` restores valid session.
  - `logout` clears session and token.

**Files:**
- Modify: `sellary-cashier/package.json`
- Create: `sellary-cashier/vitest.config.ts`
- Create: `sellary-cashier/src/test/setup.ts`
- Create: `sellary-cashier/src/lib/__tests__/sync-service.test.ts`
- Create: `sellary-cashier/src/lib/__tests__/auth-store.test.ts`

- [ ] **Step 1: Add dev dependencies**

Run:

```powershell
cd D:\Learning\Sellary\sellary-cashier
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 2: Add test scripts**

Modify `sellary-cashier/package.json`:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc && vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest",
  "tauri": "tauri",
  "tauri:dev": "tauri dev",
  "tauri:build": "tauri build",
  "tauri:android:dev": "tauri android dev",
  "tauri:android:build": "tauri android build"
}
```

- [ ] **Step 3: Create Vitest config**

Create `sellary-cashier/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    restoreMocks: true,
  },
});
```

- [ ] **Step 4: Create setup file**

Create `sellary-cashier/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

vi.mock('@tauri-apps/plugin-store', () => {
  const data = new Map<string, unknown>();
  return {
    Store: {
      load: vi.fn(async () => ({
        get: vi.fn(async (key: string) => data.get(key)),
        set: vi.fn(async (key: string, value: unknown) => {
          data.set(key, value);
        }),
        delete: vi.fn(async (key: string) => {
          data.delete(key);
        }),
        save: vi.fn(async () => undefined),
      })),
    },
  };
});
```

Mock SQL per test file rather than globally because sync tests need specific DB behavior.

- [ ] **Step 5: Add sync-service tests**

Create `sellary-cashier/src/lib/__tests__/sync-service.test.ts`.

Use `vi.mock('../db')` and `vi.mock('../api')` to control:

- `checkHealth`
- `getPendingSales`
- `recoverSyncingSales`
- `updateOutboxStatus`
- `markOutboxSalesFailed`
- `pushSales`
- `addSyncEvent`

Minimum test cases:

```ts
it('recovers interrupted syncing sales before reading pending sales', async () => {
  // arrange checkHealth true, pending empty
  // assert recoverSyncingSales called before getPendingSales
});

it('marks sendable rows failed when pushSales throws', async () => {
  // arrange one pending sale and pushSales throwing
  // assert updateOutboxStatus(id, 'syncing') called
  // assert markOutboxSalesFailed([id], 'network down') called
  // assert result.failed === 1
});
```

- [ ] **Step 6: Add auth-store tests**

Create `sellary-cashier/src/lib/__tests__/auth-store.test.ts`.

Mock:

- `./api`
- `./session`
- `./db`
- `./storage`

Minimum test cases:

```ts
it('restores a valid persisted session', async () => {
  // arrange loadCashierSession valid and isSessionExpired false
  // call useAuthStore.getState().restoreSession()
  // expect true and state.isAuthenticated true
});

it('clears expired persisted session', async () => {
  // arrange loadCashierSession expired
  // expect clearCashierSession called and false returned
});

it('logout clears token and persisted session', async () => {
  // call logout
  // expect setAccessToken(null) and clearCashierSession
});
```

- [ ] **Step 7: Run tests**

Run:

```powershell
cd D:\Learning\Sellary\sellary-cashier
npm test
npm run build
```

Expected: tests pass and build passes.

---

## Task 6: Backend Sync Oversell Policy

**Problem:** Normal web sales reject insufficient stock, but sync sales allow negative stock and return `oversold` warnings. That may be acceptable for offline cashier, but it must be explicit and configurable.

**Target behavior:**

- Add `SYNC_ALLOW_OVERSELL` config with current default `True` to preserve behavior.
- If set to `False`, sync sale with insufficient stock returns a failed result and does not mutate stock.
- Add tests for both modes.

**Files:**
- Modify: `sellary-backend/core/config.py`
- Modify: `sellary-backend/services/sync_service.py`
- Modify: `sellary-backend/tests/unit/test_sync_service.py`

- [ ] **Step 1: Add config**

Modify `sellary-backend/core/config.py`:

```py
# Sync
SYNC_ALLOW_OVERSELL: bool = True
```

Place it near pagination or API settings.

- [ ] **Step 2: Enforce config in sync service**

Modify `sellary-backend/services/sync_service.py`.

Import settings:

```py
from core.config import settings
```

Inside `_create_sale`, before assigning negative stock:

```py
if new_quantity < 0 and not settings.SYNC_ALLOW_OVERSELL:
    for change in stock_changes:
        product_map[change["product_id"]].stock_quantity = change["previous_quantity"]
    return SyncSaleResult(
        client_sale_id=sale_create.client_sale_id,
        status="failed",
        error=(
            f"Insufficient stock for '{product.name}'. "
            f"Available: {previous_quantity}, Required: {item_create.quantity}"
        ),
    )
```

Make sure this happens before creating inventory logs.

- [ ] **Step 3: Add unit tests**

Modify `sellary-backend/tests/unit/test_sync_service.py`.

Add test for strict mode:

```py
def test_sync_sale_rejects_oversell_when_disabled(monkeypatch, db_session, company, user, product):
    monkeypatch.setattr("services.sync_service.settings.SYNC_ALLOW_OVERSELL", False)
    product.stock_quantity = Decimal("1")
    request = SyncSalesRequest(
        sales=[
            SyncSaleCreate(
                client_sale_id="client-oversell",
                idempotency_key="oversell-key-0001",
                created_at_client=datetime.utcnow(),
                payment_method="cash",
                paid_amount=Decimal("100.00"),
                change_amount=Decimal("0.00"),
                discount_amount=Decimal("0.00"),
                items=[
                    SyncSaleItemCreate(
                        product_id=product.id,
                        quantity=Decimal("2"),
                        sell_price=product.sell_price,
                    )
                ],
            )
        ]
    )

    result = SyncService(db_session).sync_sales(company, user, request)

    assert result.results[0].status == "failed"
    assert "Insufficient stock" in result.results[0].error
    assert product.stock_quantity == Decimal("1")
```

Adjust fixture names to match the existing test file. Do not invent new fixtures if equivalent ones already exist.

Add test for current default:

```py
def test_sync_sale_allows_oversell_when_enabled(monkeypatch, db_session, company, user, product):
    monkeypatch.setattr("services.sync_service.settings.SYNC_ALLOW_OVERSELL", True)
    product.stock_quantity = Decimal("1")
    # create request with quantity 2
    result = SyncService(db_session).sync_sales(company, user, request)
    assert result.results[0].status == "synced"
    assert result.results[0].warnings
    assert result.results[0].warnings[0].type == "oversold"
```

- [ ] **Step 4: Run backend tests**

Run:

```powershell
cd D:\Learning\Sellary\sellary-backend
.\.venv\Scripts\pytest.exe tests/unit/test_sync_service.py -q
.\.venv\Scripts\pytest.exe tests/integration tests/unit -q
```

Expected: all pass.

---

## Task 7: Frontend Lint Cleanup

**Problem:** Frontend build passes but `ServerHealthProvider` has a hook dependency warning.

**File:**
- Modify: `sellary-frontend/src/providers/ServerHealthProvider.tsx`
- Test: `sellary-frontend/src/providers/__tests__/ServerHealthProvider.test.tsx`

- [ ] **Step 1: Wrap checkHealth in useCallback**

Modify imports:

```ts
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
```

Wrap:

```ts
const checkHealth = useCallback(async () => {
  if (!navigator.onLine) {
    setIsServerReachable(false);
    setLatency(null);
    setLastChecked(new Date());
    return;
  }

  const start = performance.now();
  try {
    const response = await fetch('/health', { method: 'GET', cache: 'no-store' });
    setIsServerReachable(response.ok);
    setLatency(Math.round(performance.now() - start));
  } catch {
    setIsServerReachable(false);
    setLatency(null);
  } finally {
    setLastChecked(new Date());
  }
}, []);
```

Then include `checkHealth` in effect dependencies:

```ts
}, [checkHealth]);
```

Preserve existing behavior if exact code differs.

- [ ] **Step 2: Run focused tests**

Run:

```powershell
cd D:\Learning\Sellary\sellary-frontend
npx vitest run src/providers/__tests__/ServerHealthProvider.test.tsx
npm run lint
npm run build
```

Expected: tests pass, lint has no warning, build passes.

---

## Task 8: CI Workflow

**Problem:** There is no GitHub Actions workflow. Backend, frontend, and cashier can regress without a shared verification gate.

**Target behavior:**

- Pull requests and main pushes run backend tests, frontend build/tests, and cashier build/tests.
- Do not run Tauri installer build in every PR unless Windows runner time is acceptable. At minimum run `npm run build` for cashier; run `npm run tauri:build` on manual workflow dispatch or release branches.

**File:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

jobs:
  backend:
    name: Backend
    runs-on: windows-latest
    defaults:
      run:
        working-directory: sellary-backend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.13"
      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements.txt
      - name: Compile
        run: python -m compileall api core models repositories schemas services main.py
      - name: Tests
        run: pytest tests/integration tests/unit -q

  frontend:
    name: Frontend
    runs-on: windows-latest
    defaults:
      run:
        working-directory: sellary-frontend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
          cache-dependency-path: sellary-frontend/package-lock.json
      - name: Install dependencies
        run: npm ci
      - name: Unit tests
        run: npx vitest run
      - name: Build
        run: npm run build

  cashier:
    name: Tauri Cashier
    runs-on: windows-latest
    defaults:
      run:
        working-directory: sellary-cashier
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
          cache-dependency-path: sellary-cashier/package-lock.json
      - name: Install Rust stable
        uses: dtolnay/rust-toolchain@stable
      - name: Install dependencies
        run: npm ci
      - name: Unit tests
        run: npm test
      - name: Frontend build
        run: npm run build
      - name: Tauri build
        if: github.event_name == 'workflow_dispatch'
        run: npm run tauri:build
```

- [ ] **Step 2: Verify locally before relying on CI**

Run all local commands:

```powershell
cd D:\Learning\Sellary\sellary-backend
.\.venv\Scripts\pytest.exe tests/integration tests/unit -q

cd D:\Learning\Sellary\sellary-frontend
npx vitest run
npm run build

cd D:\Learning\Sellary\sellary-cashier
npm test
npm run build
```

Expected: all pass.

---

## Task 9: Railway And Netlify Deployment Hardening

**Problem:** Production currently works, but Railway auto-deploy from GitHub has failed before because the backend is in a subdirectory and Railway tried to build the repo root.

**Target behavior:**

- Railway service root directory is `sellary-backend`.
- Railway uses `sellary-backend/railway.json` with:
  - `preDeployCommand = alembic upgrade head`
  - `startCommand = uvicorn main:app --host 0.0.0.0 --port $PORT`
  - healthcheck `/health`
- Netlify builds from `sellary-frontend` and proxies `/api` to Railway.

**Files:**
- Check/Modify: `railway.toml`
- Check/Modify: `sellary-backend/railway.json`
- Check/Modify: `netlify.toml`
- Create/Modify: `docs/RELEASE_CHECKLIST.md`

- [ ] **Step 1: Confirm Railway service settings**

Run:

```powershell
cd D:\Learning\Sellary
railway status
railway deployment list --json
```

Expected:

- Service: `Sellary`
- URL: `https://sellary-production-30ec.up.railway.app`
- Latest active deployment: `SUCCESS`
- Deployment manifest includes start command and healthcheck.

- [ ] **Step 2: Fix Railway root directory**

Use Railway dashboard if CLI does not expose the setting:

```text
Railway Project -> Sellary service -> Settings -> Source -> Root Directory = sellary-backend
```

After setting the root directory, future GitHub auto-deploys should read `sellary-backend/railway.json`.

If root directory cannot be set, keep documented manual deploy command:

```powershell
cd D:\Learning\Sellary
railway deployment up .\sellary-backend --path-as-root --service Sellary --environment production --message "Deploy backend"
```

- [ ] **Step 3: Keep Netlify config as frontend-only**

`netlify.toml` must stay:

```toml
[build]
base = "sellary-frontend"
command = "npm run build"
publish = "sellary-frontend/.next"

[build.environment]
NODE_VERSION = "20"
NEXT_PUBLIC_API_URL = "/api"
NEXT_PUBLIC_API_PROXY_TARGET = "https://sellary-production-30ec.up.railway.app"

[[plugins]]
package = "@netlify/plugin-nextjs"
```

- [ ] **Step 4: Create release checklist**

Create `docs/RELEASE_CHECKLIST.md`:

```md
# Sellary Release Checklist

## Local Verification

- [ ] Backend: `cd sellary-backend && .\.venv\Scripts\pytest.exe tests/integration tests/unit -q`
- [ ] Frontend: `cd sellary-frontend && npx vitest run && npm run build`
- [ ] Cashier: `cd sellary-cashier && npm test && npm run build`
- [ ] Desktop installer when needed: `cd sellary-cashier && npm run tauri:build`

## Production Backend

- [ ] Confirm Railway service is online: `railway status`
- [ ] Confirm `/health`: `Invoke-RestMethod https://sellary-production-30ec.up.railway.app/health`
- [ ] Confirm migrations: `alembic upgrade head` runs through Railway preDeploy.

## Production Frontend

- [ ] Confirm Netlify deploy state is `ready`.
- [ ] Confirm `https://sellary-client.netlify.app` returns 200.
- [ ] Login smoke test.

## Tauri Cashier

- [ ] Login smoke test.
- [ ] Select company.
- [ ] Bootstrap products/categories.
- [ ] Create one sale online and confirm it syncs.
- [ ] Create one sale offline and confirm it remains pending.
- [ ] Reconnect and confirm pending sale syncs.
```

---

## Task 10: Documentation And Final QA

**Problem:** The repo changed architecture from PWA/offline web to Tauri offline cashier. Docs and issue lists need to match reality so future agents do not restore old systems.

**Files:**
- Modify: `DOCUMENTATION.md`
- Modify: `ISSUE_TASKS.md`
- Create: `docs/TAURI_CASHIER_RUNBOOK.md`

- [ ] **Step 1: Create Tauri cashier runbook**

Create `docs/TAURI_CASHIER_RUNBOOK.md`:

```md
# Tauri Cashier Runbook

## Purpose

`sellary-cashier` is the offline-first POS app for cashier terminals. It uses local SQLite for product catalog and sale outbox, then syncs to the backend through `/api/sync/*`.

## Commands

```powershell
cd sellary-cashier
npm run dev
npm run tauri:dev
npm run build
npm run tauri:build
```

## Backend URL

Production:

```text
https://sellary-production-30ec.up.railway.app
```

Local:

```text
http://127.0.0.1:8001
```

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

Run manual sync after Task 3 is implemented. The sync service should recover interrupted syncing rows automatically.
```

- [ ] **Step 2: Update DOCUMENTATION.md**

Ensure docs say:

- Restaurant module removed for now.
- PWA/offline web sync removed.
- Offline cashier is Tauri-based.
- Backend sync endpoints:
  - `GET /api/sync/bootstrap`
  - `POST /api/sync/sales`
- Company-scoped access token is required.

- [ ] **Step 3: Update ISSUE_TASKS.md**

Add remaining priorities:

```md
## Current P1

- Tauri mobile initialization and device testing.
- Tauri session restore with secure token storage.
- Cashier sync stuck-state recovery.
- Cashier unit test coverage.
- Railway auto-deploy root directory hardening.

## Current P2

- Configurable sync oversell policy.
- Catalog refresh UX.
- CI workflow.
- Release checklist.
```

- [ ] **Step 4: Final verification**

Run:

```powershell
cd D:\Learning\Sellary\sellary-backend
.\.venv\Scripts\pytest.exe tests/integration tests/unit -q

cd D:\Learning\Sellary\sellary-frontend
npx vitest run
npm run lint
npm run build

cd D:\Learning\Sellary\sellary-cashier
npm test
npm run build
npm run tauri:build
```

Expected:

- Backend: all tests pass.
- Frontend: tests/build/lint pass without warnings if Task 7 is done.
- Cashier: tests/build pass; Tauri desktop bundle builds.

---

## Final Acceptance Criteria

The implementation is complete only when all of these are true:

- [ ] `sellary-cashier/` is no longer an untracked mystery directory; source files are intentionally tracked when committing.
- [ ] Cashier can restore a valid session after app refresh/restart.
- [ ] Cashier logout clears persisted session and token.
- [ ] Cashier sales do not remain permanently stuck in `syncing`.
- [ ] Failed sync attempts return accurate failure counts.
- [ ] Local product stock changes immediately after local sale.
- [ ] Settings has a manual catalog refresh path.
- [ ] Backend sync oversell policy is explicit and tested.
- [ ] Frontend lint warning is fixed.
- [ ] CI workflow exists for backend/frontend/cashier.
- [ ] Railway deploy process is documented and root-directory issue is resolved or manual deploy command is documented.
- [ ] Docs clearly say PWA/offline web and Restaurant are removed for now.
- [ ] All verification commands pass.

## Do Not Do

- Do not add service workers back.
- Do not add `manifest.json` back for PWA.
- Do not restore Restaurant routes, table names, sale context fields, or old offline web queue.
- Do not store cashier username/password.
- Do not silently ignore sync failures.
- Do not mark the work complete without running the final verification commands.
