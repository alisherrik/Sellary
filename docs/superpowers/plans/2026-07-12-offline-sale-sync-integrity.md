# Offline Sale Sync Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Sellary Cashier from reporting an offline sale as synchronized unless a matching server sale exists, and ship the fix as cashier v0.2.5.

**Architecture:** Make the backend sale row the source of truth for idempotent success: failed results are never cached, and legacy null-sale cache entries are discarded and reprocessed. Add a cashier-side protocol guard so success-like responses without a server sale ID become permanent attention failures instead of false success.

**Tech Stack:** Python/FastAPI/SQLAlchemy/pytest; TypeScript/React/Vitest; Tauri 2/Rust/NSIS; GitHub Actions release workflow.

---

## File map

- Modify `sellary-backend/tests/unit/test_sync_service.py`: backend regression coverage for failed and legacy idempotency responses.
- Modify `sellary-backend/services/sync_service.py`: validate cached sale identity, remove invalid legacy cache entries, and cache only successful persisted sales.
- Modify `sellary-cashier/src/lib/__tests__/sync-engine.test.ts`: client protocol regression coverage.
- Modify `sellary-cashier/src/lib/sync-engine.ts`: reject success-like results without `sale_id`.
- Modify `sellary-cashier/package.json`: v0.2.5 package version.
- Modify `sellary-cashier/src-tauri/tauri.conf.json`: v0.2.5 bundle/updater version.
- Modify `sellary-cashier/src-tauri/Cargo.toml`: v0.2.5 Rust package version.
- Modify `sellary-cashier/src-tauri/Cargo.lock`: synchronized Rust package lock version.

### Task 1: Prove and fix backend failed-result caching

**Files:**
- Test: `sellary-backend/tests/unit/test_sync_service.py`
- Modify: `sellary-backend/services/sync_service.py`

- [ ] **Step 1: Write failing regression tests**

Add a test that sends a credit sale for a missing `client_customer_id`, asserts the result is `failed`, and asserts no `IdempotencyKey` exists for that key. Then create the customer, retry the identical request, and assert `synced`, a non-null `sale_id`, and exactly one matching `Sale` row.

Add a second test that pre-populates `IdempotencyService.store_response(..., response_body={"sale_id": None}, ...)`, sends an otherwise valid sale, and asserts it is reprocessed to `synced` with a real `sale_id` rather than returned as a null-ID duplicate.

- [ ] **Step 2: Run tests and verify RED**

Run from `sellary-backend`:

```powershell
.venv\Scripts\pytest.exe tests/unit/test_sync_service.py -k "failed_sale_does_not_cache or legacy_null_sale_cache" -v
```

Expected: both tests fail because the current backend caches failed results and returns the legacy null-ID entry as `duplicate`.

- [ ] **Step 3: Implement the minimal backend invariant**

In `SyncService._process_single_sale`:

1. When a cached response exists, accept it only if `sale_id` is non-null and a `Sale` with that ID, company, and `client_sale_id` exists.
2. If the cached response is invalid, delete the matching `IdempotencyKey` row and flush so the request can be reprocessed with the same key.
3. After `_create_sale`, immediately return any result whose status is not `synced` or whose `sale_id` is null; do not call `store_response`.
4. Preserve the existing successful replay response as `duplicate` with the real server ID.

- [ ] **Step 4: Run tests and verify GREEN**

```powershell
.venv\Scripts\pytest.exe tests/unit/test_sync_service.py -k "failed_sale_does_not_cache or legacy_null_sale_cache or sync_retry_is_idempotent" -v
```

Expected: all selected tests pass.

### Task 2: Add the cashier protocol guard

**Files:**
- Test: `sellary-cashier/src/lib/__tests__/sync-engine.test.ts`
- Modify: `sellary-cashier/src/lib/sync-engine.ts`

- [ ] **Step 1: Correct the existing success test and add a failing guard test**

Change the existing duplicate fixture to use a real `sale_id` and keep the assertion that it is marked synced. Add a parameterized test for both `synced` and `duplicate` results with `sale_id: null`; assert `markSaleSynced` is not called, `markPermanentFailure` receives `Server confirmed sale without sale_id`, `synced` remains zero, and `permanentFailed` becomes one.

- [ ] **Step 2: Run the focused test and verify RED**

Run from `sellary-cashier`:

```powershell
npx vitest run src/lib/__tests__/sync-engine.test.ts
```

Expected: the new guard cases fail because the current engine calls `markSaleSynced(localId, null)`.

- [ ] **Step 3: Implement the minimal client guard**

In the sales result loop, treat `synced`/`duplicate` as success only when `r.sale_id != null`. For a success-like status without an ID, call `markPermanentFailure(localId, 'Server confirmed sale without sale_id')` and increment `permanentFailed`. Preserve normal handling for explicit `failed` results.

- [ ] **Step 4: Run the focused test and verify GREEN**

```powershell
npx vitest run src/lib/__tests__/sync-engine.test.ts
```

Expected: the complete sync-engine test file passes.

### Task 3: Verify affected packages

**Files:**
- No production files beyond Tasks 1–2.

- [ ] **Step 1: Run backend sync tests and compile check**

From `sellary-backend`:

```powershell
.venv\Scripts\pytest.exe tests/unit/test_sync_service.py tests/integration/test_sync_endpoints.py tests/integration/test_sync_credit_sales.py tests/integration/test_sync_client_sale_id.py -v
.venv\Scripts\python.exe -m compileall api core models repositories schemas services main.py
```

Expected: zero failed tests and compile exit code 0.

- [ ] **Step 2: Run cashier test suite and web build**

From `sellary-cashier`:

```powershell
npm test
npm run build
```

Expected: all Vitest tests pass and the TypeScript/Vite production build exits 0.

### Task 4: Bump v0.2.5 and build the Windows release artifact

**Files:**
- Modify: `sellary-cashier/package.json`
- Modify: `sellary-cashier/src-tauri/tauri.conf.json`
- Modify: `sellary-cashier/src-tauri/Cargo.toml`
- Modify: `sellary-cashier/src-tauri/Cargo.lock`

- [ ] **Step 1: Set all authoritative versions to 0.2.5**

Replace `0.2.4` with `0.2.5` in the three files named by `.github/workflows/release.yml`; synchronize the `sellary-cashier` package entry in `Cargo.lock` through Cargo.

- [ ] **Step 2: Verify version consistency**

```powershell
rg -n '0\.2\.[45]' package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
```

Expected: authoritative package/config entries are `0.2.5`; unrelated third-party dependency versions are unchanged.

- [ ] **Step 3: Build Tauri/NSIS locally**

```powershell
npm run tauri:build
```

Expected: exit code 0 and a v0.2.5 NSIS installer under `src-tauri/target/release/bundle/nsis/`.

### Task 5: Final verification and release publication

**Files:**
- Review all files in Tasks 1–4.

- [ ] **Step 1: Inspect the scoped diff**

```powershell
git diff --check
git status --short
git diff -- sellary-backend/services/sync_service.py sellary-backend/tests/unit/test_sync_service.py sellary-cashier/src/lib/sync-engine.ts sellary-cashier/src/lib/__tests__/sync-engine.test.ts sellary-cashier/package.json sellary-cashier/src-tauri/tauri.conf.json sellary-cashier/src-tauri/Cargo.toml sellary-cashier/src-tauri/Cargo.lock
```

Expected: only the intended sync fix, regression tests, and version bump are present.

- [ ] **Step 2: Re-run fresh release gates**

Run the backend focused/full sync verification, `npm test`, `npm run build`, and `npm run tauri:build` again after the version bump. Read the complete output and require zero failures.

- [ ] **Step 3: Commit intentionally**

Commit the implementation and release version as scoped commits without altering the user's pre-existing history.

- [ ] **Step 4: Publish only after local verification**

Push `main`, create and push tag `v0.2.5`, then monitor `.github/workflows/release.yml` until it publishes the signed Windows installer and updater manifest. If credentials or GitHub authorization are unavailable, stop after the verified local artifact and report the exact blocker without claiming the remote release exists.
