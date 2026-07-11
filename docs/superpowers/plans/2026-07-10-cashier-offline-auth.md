# Cashier Offline Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Give the Tauri cashier a device-token + local-PIN offline-auth system so the app opens, unlocks, and sells for a week with no server round-trip after one online provisioning.

**Architecture:** A Rust argon2id command pair hashes/verifies the PIN (hash lives in the local `device_auth` row, secrets in Stronghold). `session.ts` gains device-credential + PIN helpers; `api.ts` gains `registerDevice`/`refreshDevice` (refresh sends NO bearer). `auth-store.ts` reworks the app-open gate to depend on `hasDevice && hasPin` (never on an expired `access_token`), adds throttled PIN unlock, single-flight opportunistic token refresh, and unsynced-blocked logout. New UI screens handle PIN setup, PIN unlock + lockout countdown, offline first-run, and a `needsReauth` banner.

**Tech Stack:** Rust (`argon2` crate, Tauri 2 commands), TypeScript, React 19, Zustand, `@tauri-apps/plugin-stronghold`, `@tauri-apps/plugin-sql`, Vitest.

**Depends on:** `backend-foundation` (the `/api/auth/devices/register` and `/api/auth/devices/refresh` endpoints + `DEVICE_TOKEN_EXPIRE_DAYS`) and `data-model` (the local `device_auth` table + its `db.ts` DAO: `getDeviceAuth`, `ensureDeviceAuth`, `setPinHash`, `bindDeviceIdentity`, `recordPinFailure`, `resetPinFailures`, plus `getUnsyncedCount`). Both must merge first.

> **Merge order (authoritative):** see the pinned chain in [`2026-07-10-cashier-local-first-INDEX.md`](2026-07-10-cashier-local-first-INDEX.md) §2 — `data-model → backend → offline-auth → sync-engine → pos-ui → history-ui`. This plan (offline-auth) is the **sole owner of `src/App.tsx`** per the INDEX §3 file-ownership table.

---

## File Structure

**Create**
- `sellary-cashier/src-tauri/src/pin.rs` — argon2id `pin_hash` / `pin_verify` Tauri commands (constant-time verify) + Rust unit tests.
- `sellary-cashier/src/lib/__tests__/session-device.test.ts` — device-credential + PIN session-helper tests.
- `sellary-cashier/src/lib/__tests__/device-api.test.ts` — `registerDevice` / `refreshDevice` tests (refresh no-bearer).
- `sellary-cashier/src/pages/PinSetupPage.tsx` — one-time PIN setup screen (provisioning step).
- `sellary-cashier/src/pages/PinUnlockPage.tsx` — PIN unlock + lockout countdown + "forgot PIN" recovery link.
- `sellary-cashier/src/components/OfflineFirstRunScreen.tsx` — blocking "internet needed for first setup" screen.
- `sellary-cashier/src/components/NeedsReauthBanner.tsx` — non-blocking amber "online login required" banner.

**Modify**
- `sellary-cashier/src-tauri/Cargo.toml` — add `argon2` dependency.
- `sellary-cashier/src-tauri/src/lib.rs` — `mod pin;` + register `pin_hash`/`pin_verify` in the invoke handler.
- `sellary-cashier/src/lib/session.ts` — device-credential (Stronghold) helpers + PIN helpers.
- `sellary-cashier/src/lib/api.ts` — `registerDevice` / `refreshDevice` + response types.
- `sellary-cashier/src/lib/auth-store.ts` — `hasDevice`/`hasPin`/`isLocked`/`lockedUntil`/`needsReauth` state; reworked `restoreSession`, `selectAndBootstrap`, `logout`; new `completePinSetup`, `unlockWithPin`, `ensureFreshAccessToken`.
- `sellary-cashier/src/lib/__tests__/auth-store.test.ts` — updated mocks + reworked restore/provision tests + new unlock/refresh/logout tests.
- `sellary-cashier/src/pages/LoginPage.tsx` — route to `/pin-setup` after provisioning.
- `sellary-cashier/src/pages/CashierShell.tsx` — orchestrate PIN unlock / offline-first-run / needsReauth gates.
- `sellary-cashier/src/App.tsx` — **sole owner** (Contract §3). Canonical file: `<Toaster/>` (react-hot-toast) + routes `/login`, `/cashier`, `/pin-setup`, `/pin-unlock`, `/history`, `/settings`, catch-all → `/login`. **pos-ui and history-ui MUST NOT edit App.tsx** — their routes already exist here.

---

## Interface assumptions (from the plans this depends on — reference, do NOT reimplement)

From **data-model** (`db.ts`), the `DeviceAuth` type and DAO exist with this shape:

```ts
export interface DeviceAuth {
  id: number;                          // always 1
  device_id: string;
  device_token_expires_at: string | null;
  pin_hash: string | null;
  pin_set_at: string | null;
  failed_pin_attempts: number;
  locked_until: string | null;
  user_id: number | null;
  username: string | null;
  company_id: number | null;
  company_name: string | null;
  user_role: string | null;
  last_online_auth_at: string | null;
}
getDeviceAuth(): Promise<DeviceAuth | null>;
ensureDeviceAuth(deviceId: string): Promise<DeviceAuth>;
setPinHash(hash: string): Promise<void>;          // '' clears the PIN
bindDeviceIdentity(i: DeviceIdentityInput): Promise<void>;   // Contract §4.6 — snake_case, 7 fields (see below)
recordPinFailure(lockUntil?: string | null): Promise<void>;   // increments failed_pin_attempts, sets locked_until
resetPinFailures(): Promise<void>;
getUnsyncedCount(): Promise<number>;              // pending + syncing + transient-failed (excludes permanent)
```

The `bindDeviceIdentity` argument is the canonical Contract §4.6 shape (snake_case, exactly 7 fields) — offline-auth's call in Task 8 MUST pass exactly these:

```ts
type DeviceIdentityInput = {
  user_id: number; username: string;
  company_id: number; company_name: string; user_role: string;
  device_token_expires_at: string | null; last_online_auth_at: string;
};
```

From **backend-foundation**, the endpoints respond as:

```
POST /api/auth/devices/register   (bearer: company-scoped access_token)
  body:     { name: string, device_id: string }
  response: { device_id: string, device_token: string, name: string | null, expires_at: string }

POST /api/auth/devices/refresh    (NO bearer)
  body:     { device_id: string, device_token: string }
  response: { access_token: string, token_type: string, expires_at: string }
```

> **Contract §4.7:** the refresh response field is `expires_at` (NOT `device_token_expires_at`). The cashier reads `res.expires_at` and stores it as the device-token expiry mirror. If either endpoint differs at merge time, adjust the TS types in Task 4 only; nothing else moves.

---

## Task 1: Rust argon2id PIN commands

**Files:**
- Create: `sellary-cashier/src-tauri/src/pin.rs`
- Modify: `sellary-cashier/src-tauri/Cargo.toml:20-29` (deps), `sellary-cashier/src-tauri/src/lib.rs:1-35`

> Rust build/test needs the Rust toolchain; treat `cargo test` and `npm run tauri:dev` as **manual gates** (they are not part of the automated cashier/CI vitest path).

- [ ] **Write the failing Rust test + command skeleton.** Create `sellary-cashier/src-tauri/src/pin.rs`:

```rust
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};

/// Hash a PIN with argon2id. Returns a PHC string (algorithm + params + salt + hash).
#[tauri::command]
pub fn pin_hash(pin: String) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(pin.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| e.to_string())
}

/// Verify a PIN against a stored PHC string. Constant-time (provided by the argon2 crate).
#[tauri::command]
pub fn pin_verify(pin: String, phc: String) -> Result<bool, String> {
    let parsed = PasswordHash::new(&phc).map_err(|e| e.to_string())?;
    Ok(Argon2::default()
        .verify_password(pin.as_bytes(), &parsed)
        .is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_then_verify_roundtrip() {
        let phc = pin_hash("1234".to_string()).unwrap();
        assert!(phc.starts_with("$argon2id$"), "must be argon2id: {phc}");
        assert!(pin_verify("1234".to_string(), phc.clone()).unwrap());
        assert!(!pin_verify("9999".to_string(), phc).unwrap());
    }

    #[test]
    fn distinct_salts_produce_distinct_hashes() {
        let a = pin_hash("1234".to_string()).unwrap();
        let b = pin_hash("1234".to_string()).unwrap();
        assert_ne!(a, b, "each hash must embed a fresh random salt");
        assert!(pin_verify("1234".to_string(), a).unwrap());
        assert!(pin_verify("1234".to_string(), b).unwrap());
    }

    #[test]
    fn malformed_phc_is_err() {
        assert!(pin_verify("1234".to_string(), "not-a-hash".to_string()).is_err());
    }
}
```

- [ ] **Run it and see it FAIL (compile error — `argon2` not a dependency yet).** Manual gate:
  `cd sellary-cashier/src-tauri && cargo test -p sellary_cashier_lib pin`
  Expected: `error[E0432]: unresolved import argon2` (crate not declared).

- [ ] **Add the `argon2` dependency.** Edit `sellary-cashier/src-tauri/Cargo.toml`, add under `[dependencies]` (after the `sha2 = "0.10"` line):

```toml
argon2 = "0.5"
```

- [ ] **Wire the module + register the commands.** Edit `sellary-cashier/src-tauri/src/lib.rs`. Add `mod pin;` under the existing `use` lines (top of file, after line 2):

```rust
mod pin;
```

  Then change the invoke handler (currently `tauri::generate_handler![greet]`) to:

```rust
        .invoke_handler(tauri::generate_handler![greet, pin::pin_hash, pin::pin_verify])
```

- [ ] **Confirm no ACL change is needed.** App-defined `#[tauri::command]` functions are callable from the main window in Tauri v2 without a capability/ACL entry (the ACL governs plugin/core commands only). Leave `sellary-cashier/src-tauri/capabilities/default.json` unchanged; the existing capability is sufficient.

- [ ] **Run and see PASS (manual gate).**
  `cd sellary-cashier/src-tauri && cargo test -p sellary_cashier_lib pin`
  Expected: 3 tests pass. Also confirm it builds on the app: `cd sellary-cashier && npm run tauri:dev` compiles (manual — needs Rust; this is the `windows-latest` CI build-check the spec §14 calls out).

- [ ] **Commit.**
  `git add sellary-cashier/src-tauri/src/pin.rs sellary-cashier/src-tauri/src/lib.rs sellary-cashier/src-tauri/Cargo.toml sellary-cashier/src-tauri/Cargo.lock`
  `git commit -m "feat(cashier): add argon2id pin_hash/pin_verify Tauri commands"`

---

## Task 2: Device-credential Stronghold helpers in session.ts

**Files:**
- Create: `sellary-cashier/src/lib/__tests__/session-device.test.ts`
- Modify: `sellary-cashier/src/lib/session.ts:1-9` (constants), append helpers at end of file.

The `device_token` is a bearer secret → it lives in Stronghold beside `access_token`; its expiry mirror lives in the session Store. This keeps the credential entirely within `session.ts` (no new DAO method needed).

- [ ] **Write the failing test.** Create `sellary-cashier/src/lib/__tests__/session-device.test.ts`. (The Stronghold plugin is unavailable under jsdom, so `getStrongholdStore()` returns `null` and the code falls back to the mocked `@tauri-apps/plugin-store` — the same fallback already mocked in `src/test/setup.ts`.)

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveDeviceCredential,
  loadDeviceCredential,
  clearDeviceCredential,
} from '../session';

describe('device credential (store fallback)', () => {
  beforeEach(async () => {
    await clearDeviceCredential();
  });

  it('returns null when nothing is stored', async () => {
    expect(await loadDeviceCredential()).toBeNull();
  });

  it('round-trips token + expiry', async () => {
    await saveDeviceCredential('dev-token-abc', '2026-12-31T00:00:00.000Z');
    const cred = await loadDeviceCredential();
    expect(cred).toEqual({
      deviceToken: 'dev-token-abc',
      expiresAt: '2026-12-31T00:00:00.000Z',
    });
  });

  it('clear removes the credential', async () => {
    await saveDeviceCredential('dev-token-abc', '2026-12-31T00:00:00.000Z');
    await clearDeviceCredential();
    expect(await loadDeviceCredential()).toBeNull();
  });
});
```

- [ ] **Run it and see it FAIL.**
  `cd sellary-cashier && npx vitest run src/lib/__tests__/session-device.test.ts`
  Expected: fails — `saveDeviceCredential` / `loadDeviceCredential` / `clearDeviceCredential` are not exported from `../session`.

- [ ] **Add the constants.** Edit `sellary-cashier/src/lib/session.ts`, after line 9 (`const STRONGHOLD_TOKEN_KEY = 'access_token';`):

```ts
const STRONGHOLD_DEVICE_TOKEN_KEY = 'device_token';
const DEVICE_TOKEN_FALLBACK_KEY = 'cashier_device_token_encoded';
const DEVICE_TOKEN_EXPIRES_KEY = 'cashier_device_token_expires_at';
```

- [ ] **Add the helpers.** Append to the end of `sellary-cashier/src/lib/session.ts` (before the final `export const sessionTestInternals` line, or after it — order does not matter):

```ts
export interface DeviceCredential {
  deviceToken: string;
  expiresAt: string;
}

export async function saveDeviceCredential(
  deviceToken: string,
  expiresAt: string
): Promise<void> {
  const tokenBytes = Array.from(new TextEncoder().encode(deviceToken));
  const st = await getStrongholdStore();
  if (st) {
    await st.remove(STRONGHOLD_DEVICE_TOKEN_KEY).catch(() => {});
    await st.insert(STRONGHOLD_DEVICE_TOKEN_KEY, tokenBytes);
  } else {
    const s = await getStore();
    await s.set(DEVICE_TOKEN_FALLBACK_KEY, btoa(deviceToken));
    await s.save();
  }
  const s = await getStore();
  await s.set(DEVICE_TOKEN_EXPIRES_KEY, expiresAt);
  await s.save();
}

export async function loadDeviceCredential(): Promise<DeviceCredential | null> {
  let deviceToken: string | null = null;

  const st = await getStrongholdStore();
  if (st) {
    try {
      const raw = await st.get(STRONGHOLD_DEVICE_TOKEN_KEY);
      if (raw && raw.length > 0) {
        deviceToken = new TextDecoder().decode(new Uint8Array(raw));
      }
    } catch {
      console.warn('Failed to read device token from Stronghold');
    }
  } else {
    const s = await getStore();
    const enc = (await s.get<string>(DEVICE_TOKEN_FALLBACK_KEY)) ?? null;
    if (enc) {
      try {
        deviceToken = atob(enc);
      } catch {
        deviceToken = null;
      }
    }
  }

  if (!deviceToken) {
    return null;
  }

  const s = await getStore();
  const expiresAt =
    (await s.get<string>(DEVICE_TOKEN_EXPIRES_KEY)) ?? new Date(0).toISOString();
  return { deviceToken, expiresAt };
}

export async function clearDeviceCredential(): Promise<void> {
  const st = await getStrongholdStore();
  if (st) {
    await st.remove(STRONGHOLD_DEVICE_TOKEN_KEY).catch(() => {});
  }
  const s = await getStore();
  await s.delete(DEVICE_TOKEN_FALLBACK_KEY).catch(() => {});
  await s.delete(DEVICE_TOKEN_EXPIRES_KEY).catch(() => {});
  await s.save();
}
```

- [ ] **Run and see PASS.**
  `cd sellary-cashier && npx vitest run src/lib/__tests__/session-device.test.ts`
  Expected: 3 tests pass.

- [ ] **Commit.**
  `git add sellary-cashier/src/lib/session.ts sellary-cashier/src/lib/__tests__/session-device.test.ts`
  `git commit -m "feat(cashier): persist device_token credential in session store"`

---

## Task 3: PIN session helpers (savePin / verifyPin / clearPin)

**Files:**
- Modify: `sellary-cashier/src/lib/session.ts:1-2` (imports), append helpers.
- Modify: `sellary-cashier/src/lib/__tests__/session-device.test.ts` (add PIN suite).

These wrap the Rust argon2 commands and delegate hash storage to the data-model DAO (`getDeviceAuth`, `setPinHash`).

- [ ] **Write the failing test.** Append to `sellary-cashier/src/lib/__tests__/session-device.test.ts`. Add these mocks at the very top of the file (above the existing imports):

```ts
import { vi } from 'vitest';

const { mockInvoke, mockGetDeviceAuth, mockSetPinHash } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockGetDeviceAuth: vi.fn(),
  mockSetPinHash: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));
vi.mock('../db', () => ({
  getDeviceAuth: mockGetDeviceAuth,
  setPinHash: mockSetPinHash,
}));
```

  Then add the suite (and pull `savePin, verifyPin, clearPin` into the existing `import ... from '../session'`):

```ts
describe('PIN helpers', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockGetDeviceAuth.mockReset();
    mockSetPinHash.mockReset();
  });

  it('savePin hashes via the Rust command and stores the PHC', async () => {
    mockInvoke.mockResolvedValue('$argon2id$phc');
    await savePin('1234');
    expect(mockInvoke).toHaveBeenCalledWith('pin_hash', { pin: '1234' });
    expect(mockSetPinHash).toHaveBeenCalledWith('$argon2id$phc');
  });

  it('verifyPin returns false when no hash is stored', async () => {
    mockGetDeviceAuth.mockResolvedValue({ pin_hash: null });
    expect(await verifyPin('1234')).toBe(false);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('verifyPin delegates to the Rust command with the stored PHC', async () => {
    mockGetDeviceAuth.mockResolvedValue({ pin_hash: '$argon2id$phc' });
    mockInvoke.mockResolvedValue(true);
    expect(await verifyPin('1234')).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('pin_verify', {
      pin: '1234',
      phc: '$argon2id$phc',
    });
  });

  it('clearPin stores an empty hash', async () => {
    await clearPin();
    expect(mockSetPinHash).toHaveBeenCalledWith('');
  });
});
```

- [ ] **Run it and see it FAIL.**
  `cd sellary-cashier && npx vitest run src/lib/__tests__/session-device.test.ts`
  Expected: fails — `savePin` / `verifyPin` / `clearPin` are not exported.

- [ ] **Add the imports.** Edit `sellary-cashier/src/lib/session.ts`, add after line 2 (the plugin-stronghold import):

```ts
import { invoke } from '@tauri-apps/api/core';
import { getDeviceAuth, setPinHash } from './db';
```

- [ ] **Add the helpers.** Append to `sellary-cashier/src/lib/session.ts`:

```ts
export async function savePin(pin: string): Promise<void> {
  const phc = await invoke<string>('pin_hash', { pin });
  await setPinHash(phc);
}

export async function verifyPin(pin: string): Promise<boolean> {
  const auth = await getDeviceAuth();
  if (!auth || !auth.pin_hash) {
    return false;
  }
  return invoke<boolean>('pin_verify', { pin, phc: auth.pin_hash });
}

export async function clearPin(): Promise<void> {
  await setPinHash('');
}
```

- [ ] **Run and see PASS.**
  `cd sellary-cashier && npx vitest run src/lib/__tests__/session-device.test.ts`
  Expected: all suites pass (device credential + PIN).

- [ ] **Commit.**
  `git add sellary-cashier/src/lib/session.ts sellary-cashier/src/lib/__tests__/session-device.test.ts`
  `git commit -m "feat(cashier): add PIN save/verify/clear session helpers over argon2 command"`

---

## Task 4: Device register/refresh API calls

**Files:**
- Create: `sellary-cashier/src/lib/__tests__/device-api.test.ts`
- Modify: `sellary-cashier/src/lib/api.ts` (append types + functions after line 240)

`refreshDevice` is the offline-return call and MUST send **no** bearer, so it uses raw `fetch` (not `apiFetch`, which auto-attaches the bearer). `registerDevice` runs during provisioning while the company-scoped bearer is set, so it uses `apiFetch`.

- [ ] **Write the failing test.** Create `sellary-cashier/src/lib/__tests__/device-api.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerDevice,
  refreshDevice,
  setAccessToken,
  getAccessToken,
  setApiBaseUrl,
  ApiError,
} from '../api';

describe('device auth api', () => {
  beforeEach(async () => {
    await setApiBaseUrl('http://127.0.0.1:8001');
    setAccessToken(null);
    vi.restoreAllMocks();
  });

  it('registerDevice posts name + device_id with the bearer and returns the token', async () => {
    setAccessToken('bearer-xyz');
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        device_id: 'dev-1',
        device_token: 'secret-token',
        name: 'Kassa',
        expires_at: '2026-12-31T00:00:00Z',
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await registerDevice('Kassa', 'dev-1');

    expect(res.device_token).toBe('secret-token');
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ name: 'Kassa', device_id: 'dev-1' });
    expect(init.headers.Authorization).toBe('Bearer bearer-xyz');
  });

  it('refreshDevice sends NO Authorization header and stores the new access token', async () => {
    setAccessToken('stale-or-expired');
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'fresh-access',
        token_type: 'bearer',
        expires_at: '2027-01-01T00:00:00Z',
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await refreshDevice('dev-1', 'secret-token');

    expect(res.access_token).toBe('fresh-access');
    expect(getAccessToken()).toBe('fresh-access');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/auth/devices/refresh');
    expect(JSON.parse(init.body)).toEqual({
      device_id: 'dev-1',
      device_token: 'secret-token',
    });
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('refreshDevice throws ApiError with status on 401', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ detail: 'device revoked' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(refreshDevice('dev-1', 'bad')).rejects.toMatchObject({
      status: 401,
    });
    await expect(refreshDevice('dev-1', 'bad')).rejects.toBeInstanceOf(ApiError);
  });
});
```

- [ ] **Run it and see it FAIL.**
  `cd sellary-cashier && npx vitest run src/lib/__tests__/device-api.test.ts`
  Expected: fails — `registerDevice` / `refreshDevice` are not exported from `../api`.

- [ ] **Add the types + functions.** Append to `sellary-cashier/src/lib/api.ts` (after `pushSales`, before `formatApiError`):

```ts
export interface DeviceRegisterResponse {
  device_id: string;
  device_token: string;
  name: string | null;
  expires_at: string;
}

export interface DeviceRefreshResponse {
  access_token: string;
  token_type: string;
  expires_at: string; // Contract §4.7: device-token expiry mirror (NOT device_token_expires_at)
}

export async function registerDevice(
  name: string,
  deviceId?: string
): Promise<DeviceRegisterResponse> {
  const id = deviceId ?? crypto.randomUUID();
  return apiFetch<DeviceRegisterResponse>('/api/auth/devices/register', {
    method: 'POST',
    body: JSON.stringify({ name, device_id: id }),
  });
}

export async function refreshDevice(
  deviceId: string,
  deviceToken: string
): Promise<DeviceRefreshResponse> {
  const base = (await getApiBaseUrl()).replace(/\/$/, '');
  const response = await fetch(`${base}/api/auth/devices/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId, device_token: deviceToken }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(formatApiError(data, response.status), response.status, data);
  }
  const parsed = data as DeviceRefreshResponse;
  setAccessToken(parsed.access_token);
  return parsed;
}
```

- [ ] **Run and see PASS.**
  `cd sellary-cashier && npx vitest run src/lib/__tests__/device-api.test.ts`
  Expected: 3 tests pass.

- [ ] **Commit.**
  `git add sellary-cashier/src/lib/api.ts sellary-cashier/src/lib/__tests__/device-api.test.ts`
  `git commit -m "feat(cashier): add registerDevice + refreshDevice (no-bearer) api calls"`

---

## Task 5: auth-store state + restoreSession rework

**Files:**
- Modify: `sellary-cashier/src/lib/auth-store.ts` (imports, `AuthState`, initial state, `restoreSession`)
- Modify: `sellary-cashier/src/lib/__tests__/auth-store.test.ts` (mocks + restoreSession suite)

App-open now depends on `hasDevice && hasPin`, **never** on the access-token expiry. `restoreSession` returns `true` when the device is provisioned (→ show PIN unlock) and NEVER clears the session because the token expired. It does not set `isAuthenticated` (PIN unlock does that in Task 6).

- [ ] **Update the test mocks + rewrite the restoreSession suite.** Edit `sellary-cashier/src/lib/__tests__/auth-store.test.ts`.

  Extend the `vi.hoisted` block and mocks to cover the new dependencies. Replace the `vi.mock('../api', ...)`, `vi.mock('../db', ...)`, and `vi.mock('../session', ...)` blocks with:

```ts
vi.mock('../api', () => ({
  login: mockLogin,
  selectCompany: mockSelectCompany,
  setAccessToken: mockSetAccessToken,
  getAccessToken: mockGetAccessToken,
  fetchBootstrap: mockFetchBootstrap,
  registerDevice: mockRegisterDevice,
  refreshDevice: mockRefreshDevice,
  ApiError: class ApiError extends Error {
    status: number;
    constructor(m: string, s: number) { super(m); this.status = s; }
  },
}));

vi.mock('../db', () => ({
  upsertProducts: mockUpsertProducts,
  upsertCategories: mockUpsertCategories,
  setMeta: mockSetMeta,
  addSyncEvent: mockAddSyncEvent,
  getDeviceAuth: mockGetDeviceAuth,
  ensureDeviceAuth: mockEnsureDeviceAuth,
  bindDeviceIdentity: mockBindDeviceIdentity,
  recordPinFailure: mockRecordPinFailure,
  resetPinFailures: mockResetPinFailures,
  getUnsyncedCount: mockGetUnsyncedCount,
}));

vi.mock('../session', () => ({
  loadCashierSession: mockLoadCashierSession,
  saveCashierSession: mockSaveCashierSession,
  clearCashierSession: mockClearCashierSession,
  isSessionExpired: vi.fn(() => false),
  getTokenExpiresAt: vi.fn(() => '2026-06-01T00:00:00Z'),
  saveDeviceCredential: mockSaveDeviceCredential,
  loadDeviceCredential: mockLoadDeviceCredential,
  clearDeviceCredential: mockClearDeviceCredential,
  savePin: mockSavePin,
  verifyPin: mockVerifyPin,
  clearPin: mockClearPin,
}));
```

  Add all new `mock*` names to the `vi.hoisted({...})` object (`mockGetAccessToken`, `mockRegisterDevice`, `mockRefreshDevice`, `mockGetDeviceAuth`, `mockEnsureDeviceAuth`, `mockBindDeviceIdentity`, `mockRecordPinFailure`, `mockResetPinFailures`, `mockGetUnsyncedCount`, `mockSaveDeviceCredential`, `mockLoadDeviceCredential`, `mockClearDeviceCredential`, `mockSavePin`, `mockVerifyPin`, `mockClearPin`), each `vi.fn()`.

  Update the `beforeEach` `useAuthStore.setState({...})` reset to include the new fields:

```ts
useAuthStore.setState({
  isAuthenticated: false, isBootstrapping: false,
  hasDevice: false, hasPin: false, isLocked: false,
  lockedUntil: null, needsReauth: false,
  companyId: null, companyName: null, userId: null, username: null, userRole: null,
});
```

  Replace the entire existing `describe('restoreSession', ...)` block with:

```ts
describe('restoreSession', () => {
  it('opens (returns true) on an EXPIRED access_token when device + PIN exist', async () => {
    mockGetDeviceAuth.mockResolvedValue({
      device_id: 'dev-1', pin_hash: '$argon2id$x', locked_until: null,
      user_id: 1, username: 'cashier', company_id: 10,
      company_name: 'Test', user_role: 'cashier',
    });
    mockLoadDeviceCredential.mockResolvedValue({
      deviceToken: 'secret', expiresAt: '2027-01-01T00:00:00Z',
    });
    mockLoadCashierSession.mockResolvedValue({
      accessToken: 'expired-token', expiresAt: '2020-01-01T00:00:00Z',
      companyId: 10, companyName: 'Test', userId: 1,
      username: 'cashier', userRole: 'cashier',
    });

    const result = await useAuthStore.getState().restoreSession();

    expect(result).toBe(true);
    const state = useAuthStore.getState();
    expect(state.hasDevice).toBe(true);
    expect(state.hasPin).toBe(true);
    expect(state.isAuthenticated).toBe(false); // gated on PIN unlock
    expect(mockClearCashierSession).not.toHaveBeenCalled(); // never wiped on expiry
    expect(mockSetAccessToken).toHaveBeenCalledWith('expired-token');
    expect(state.companyId).toBe(10);
  });

  it('returns false when the device is not provisioned', async () => {
    mockGetDeviceAuth.mockResolvedValue(null);
    mockLoadDeviceCredential.mockResolvedValue(null);

    const result = await useAuthStore.getState().restoreSession();

    expect(result).toBe(false);
    expect(useAuthStore.getState().hasDevice).toBe(false);
  });

  it('returns false when device exists but PIN was never set', async () => {
    mockGetDeviceAuth.mockResolvedValue({ device_id: 'dev-1', pin_hash: null });
    mockLoadDeviceCredential.mockResolvedValue({ deviceToken: 's', expiresAt: 'x' });

    const result = await useAuthStore.getState().restoreSession();

    expect(result).toBe(false);
    expect(useAuthStore.getState().hasPin).toBe(false);
  });

  it('reflects an active lockout from device_auth', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    mockGetDeviceAuth.mockResolvedValue({
      device_id: 'dev-1', pin_hash: '$argon2id$x', locked_until: future,
      user_id: 1, username: 'c', company_id: 10, company_name: 'T', user_role: 'cashier',
    });
    mockLoadDeviceCredential.mockResolvedValue({ deviceToken: 's', expiresAt: 'x' });
    mockLoadCashierSession.mockResolvedValue(null);

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().isLocked).toBe(true);
    expect(useAuthStore.getState().lockedUntil).toBe(future);
  });
});
```

- [ ] **Run it and see it FAIL.**
  `cd sellary-cashier && npx vitest run src/lib/__tests__/auth-store.test.ts -t restoreSession`
  Expected: fails — new state fields undefined and old `restoreSession` clears the expired session / returns false.

- [ ] **Update imports + AuthState + initial state.** Edit `sellary-cashier/src/lib/auth-store.ts`.

  Replace the `import { login, ... } from './api';` and following imports (lines 2-18) with:

```ts
import {
  login,
  selectCompany,
  setAccessToken as setApiToken,
  getAccessToken,
  fetchBootstrap,
  registerDevice,
  refreshDevice,
  ApiError,
} from './api';
import type { LoginTokenResponse } from './api';
import {
  upsertProducts,
  upsertCategories,
  setMeta,
  addSyncEvent,
  getDeviceAuth,
  ensureDeviceAuth,
  bindDeviceIdentity,
  recordPinFailure,
  resetPinFailures,
  getUnsyncedCount,
} from './db';
import { setStoreValue } from './storage';
import { getErrorMessage } from './error';
import {
  saveCashierSession,
  loadCashierSession,
  clearCashierSession,
  getTokenExpiresAt,
  saveDeviceCredential,
  loadDeviceCredential,
  clearDeviceCredential,
  savePin,
  clearPin,
  verifyPin,
} from './session';
```

  Add to the `AuthState` interface (after `userRole: string | null;`):

```ts
  hasDevice: boolean;
  hasPin: boolean;
  isLocked: boolean;
  lockedUntil: string | null;
  needsReauth: boolean;

  completePinSetup: (pin: string) => Promise<void>;
  unlockWithPin: (pin: string) => Promise<boolean>;
  ensureFreshAccessToken: () => Promise<void>;
```

  Change the store factory signature from `create<AuthState>((set) => ({` to `create<AuthState>((set, get) => ({` and add the new fields to the initial state object (after `userRole: null,`):

```ts
  hasDevice: false,
  hasPin: false,
  isLocked: false,
  lockedUntil: null,
  needsReauth: false,
```

- [ ] **Rework restoreSession.** Replace the whole `restoreSession: async () => { ... }` body with:

```ts
  restoreSession: async () => {
    try {
      const auth = await getDeviceAuth();
      const cred = await loadDeviceCredential();
      const hasDevice = !!(auth && auth.device_id && cred);
      const hasPin = !!(auth && auth.pin_hash);
      set({ hasDevice, hasPin });

      if (!hasDevice || !hasPin || !auth) {
        return false;
      }

      // Load whatever identity/token cache we have; the token MAY be expired —
      // we still open the app (PIN unlock gates entry). Never clear on expiry.
      const session = await loadCashierSession();
      if (session) {
        setApiToken(session.accessToken);
        set({
          companyId: session.companyId,
          companyName: session.companyName,
          userId: session.userId,
          username: session.username,
          userRole: session.userRole,
        });
      } else {
        set({
          companyId: auth.company_id,
          companyName: auth.company_name,
          userId: auth.user_id,
          username: auth.username,
          userRole: auth.user_role,
        });
      }

      const locked = !!(auth.locked_until && Date.parse(auth.locked_until) > Date.now());
      set({ isLocked: locked, lockedUntil: locked ? auth.locked_until : null });
      return true;
    } catch (error) {
      console.error('Failed to restore session', error);
      return false;
    }
  },
```

- [ ] **Run and see PASS.**
  `cd sellary-cashier && npx vitest run src/lib/__tests__/auth-store.test.ts -t restoreSession`
  Expected: 4 restoreSession tests pass.

- [ ] **Commit.**
  `git add sellary-cashier/src/lib/auth-store.ts sellary-cashier/src/lib/__tests__/auth-store.test.ts`
  `git commit -m "feat(cashier): gate app-open on hasDevice+hasPin, never on token expiry"`

---

## Task 6: PIN unlock with throttled lockout

**Files:**
- Modify: `sellary-cashier/src/lib/auth-store.ts` (lockout constants + `unlockWithPin`)
- Modify: `sellary-cashier/src/lib/__tests__/auth-store.test.ts` (unlockWithPin suite)

Implements spec §14 cashier test 6 (lockout after 5 fails). `unlockWithPin` verifies the PIN locally (argon2), resets counters on success, and on failure records the attempt — arming an exponential-backoff `locked_until` once attempts reach the threshold.

- [ ] **Write the failing test.** Append to `sellary-cashier/src/lib/__tests__/auth-store.test.ts`:

```ts
describe('unlockWithPin', () => {
  it('authenticates on a correct PIN and resets failure counters', async () => {
    mockGetDeviceAuth.mockResolvedValue({
      device_id: 'dev-1', pin_hash: '$argon2id$x', locked_until: null,
      failed_pin_attempts: 2, user_id: 1, username: 'c',
      company_id: 10, company_name: 'T', user_role: 'cashier',
    });
    mockVerifyPin.mockResolvedValue(true);
    mockLoadDeviceCredential.mockResolvedValue(null); // no bg refresh path

    const ok = await useAuthStore.getState().unlockWithPin('1234');

    expect(ok).toBe(true);
    expect(mockResetPinFailures).toHaveBeenCalled();
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.isLocked).toBe(false);
    expect(state.companyId).toBe(10);
  });

  it('records a failure without locking below the threshold', async () => {
    mockGetDeviceAuth.mockResolvedValue({
      device_id: 'dev-1', pin_hash: '$argon2id$x', locked_until: null,
      failed_pin_attempts: 1,
    });
    mockVerifyPin.mockResolvedValue(false);

    const ok = await useAuthStore.getState().unlockWithPin('0000');

    expect(ok).toBe(false);
    expect(mockRecordPinFailure).toHaveBeenCalledWith(null);
    expect(useAuthStore.getState().isLocked).toBe(false);
  });

  it('locks after the 5th consecutive failure', async () => {
    mockGetDeviceAuth.mockResolvedValue({
      device_id: 'dev-1', pin_hash: '$argon2id$x', locked_until: null,
      failed_pin_attempts: 4, // this failure makes 5
    });
    mockVerifyPin.mockResolvedValue(false);

    const ok = await useAuthStore.getState().unlockWithPin('0000');

    expect(ok).toBe(false);
    const [lockArg] = mockRecordPinFailure.mock.calls[0];
    expect(typeof lockArg).toBe('string');
    expect(Date.parse(lockArg)).toBeGreaterThan(Date.now());
    expect(useAuthStore.getState().isLocked).toBe(true);
  });

  it('refuses while an unexpired lockout is active', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    mockGetDeviceAuth.mockResolvedValue({
      device_id: 'dev-1', pin_hash: '$argon2id$x', locked_until: future,
    });

    const ok = await useAuthStore.getState().unlockWithPin('1234');

    expect(ok).toBe(false);
    expect(mockVerifyPin).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isLocked).toBe(true);
  });
});
```

- [ ] **Run it and see it FAIL.**
  `cd sellary-cashier && npx vitest run src/lib/__tests__/auth-store.test.ts -t unlockWithPin`
  Expected: fails — `unlockWithPin` is not a function.

- [ ] **Add lockout constants.** Edit `sellary-cashier/src/lib/auth-store.ts`, add above `export const useAuthStore = create...`:

```ts
const MAX_PIN_ATTEMPTS = 5;
const LOCK_BASE_SECONDS = 30;
const LOCK_CAP_SECONDS = 15 * 60;

function computeLockUntil(attempts: number): string | null {
  if (attempts < MAX_PIN_ATTEMPTS) {
    return null;
  }
  const over = attempts - MAX_PIN_ATTEMPTS;
  const seconds = Math.min(LOCK_CAP_SECONDS, LOCK_BASE_SECONDS * 2 ** over);
  return new Date(Date.now() + seconds * 1000).toISOString();
}
```

- [ ] **Add the unlockWithPin action.** Insert into the store object (e.g. after `restoreSession`):

```ts
  unlockWithPin: async (pin) => {
    const auth = await getDeviceAuth();
    if (!auth) {
      return false;
    }
    if (auth.locked_until && Date.parse(auth.locked_until) > Date.now()) {
      set({ isLocked: true, lockedUntil: auth.locked_until });
      return false;
    }

    const ok = await verifyPin(pin);
    if (!ok) {
      const attempts = (auth.failed_pin_attempts ?? 0) + 1;
      const lockUntil = computeLockUntil(attempts);
      await recordPinFailure(lockUntil);
      set({ isLocked: !!lockUntil, lockedUntil: lockUntil });
      return false;
    }

    await resetPinFailures();
    set({
      isAuthenticated: true,
      isLocked: false,
      lockedUntil: null,
      needsReauth: false,
      companyId: auth.company_id,
      companyName: auth.company_name,
      userId: auth.user_id,
      username: auth.username,
      userRole: auth.user_role,
    });
    // Non-blocking: try to freshen the sync credential if online / near-expiry.
    void get().ensureFreshAccessToken();
    return true;
  },
```

  > `ensureFreshAccessToken` is added in Task 7; until then the tests here stub `mockLoadDeviceCredential` to `null` so the (as-yet-empty) call is harmless. To keep the file compiling before Task 7, add a temporary stub action `ensureFreshAccessToken: async () => {},` now and replace its body in Task 7.

- [ ] **Run and see PASS.**
  `cd sellary-cashier && npx vitest run src/lib/__tests__/auth-store.test.ts -t unlockWithPin`
  Expected: 4 unlockWithPin tests pass.

- [ ] **Commit.**
  `git add sellary-cashier/src/lib/auth-store.ts sellary-cashier/src/lib/__tests__/auth-store.test.ts`
  `git commit -m "feat(cashier): add PIN unlock with exponential-backoff lockout"`

---

## Task 7: Single-flight opportunistic access-token refresh

**Files:**
- Modify: `sellary-cashier/src/lib/auth-store.ts` (module-level single-flight + `ensureFreshAccessToken`)
- Modify: `sellary-cashier/src/lib/__tests__/auth-store.test.ts` (ensureFreshAccessToken suite)

Opportunistic: when online and the access token is missing or within ~12h of expiry and a device credential exists, refresh. On 401/403 set `needsReauth` (banner) but keep the app usable; on network errors stay silently offline. Single-flight so bursts collapse to one call.

- [ ] **Write the failing test.** Append to `sellary-cashier/src/lib/__tests__/auth-store.test.ts`:

```ts
describe('ensureFreshAccessToken', () => {
  it('refreshes when the token is near expiry and stores the new credential', async () => {
    mockLoadDeviceCredential.mockResolvedValue({
      deviceToken: 'secret', expiresAt: '2027-01-01T00:00:00Z',
    });
    mockLoadCashierSession.mockResolvedValue({
      accessToken: 'old', expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      companyId: 10, companyName: 'T', userId: 1, username: 'c', userRole: 'cashier',
    });
    mockGetDeviceAuth.mockResolvedValue({
      device_id: 'dev-1', company_id: 10, company_name: 'T',
      user_id: 1, username: 'c', user_role: 'cashier',
    });
    mockRefreshDevice.mockResolvedValue({
      access_token: 'fresh', token_type: 'bearer',
      expires_at: '2027-06-01T00:00:00Z',
    });

    await useAuthStore.getState().ensureFreshAccessToken();

    expect(mockRefreshDevice).toHaveBeenCalledWith('dev-1', 'secret');
    expect(mockSetAccessToken).toHaveBeenCalledWith('fresh');
    expect(mockSaveDeviceCredential).toHaveBeenCalledWith('secret', '2027-06-01T00:00:00Z');
    expect(useAuthStore.getState().needsReauth).toBe(false);
  });

  it('skips the network when the token is comfortably fresh', async () => {
    mockLoadDeviceCredential.mockResolvedValue({ deviceToken: 's', expiresAt: 'x' });
    mockLoadCashierSession.mockResolvedValue({
      accessToken: 'ok', expiresAt: new Date(Date.now() + 48 * 3600_000).toISOString(),
      companyId: 10, companyName: 'T', userId: 1, username: 'c', userRole: 'cashier',
    });

    await useAuthStore.getState().ensureFreshAccessToken();

    expect(mockRefreshDevice).not.toHaveBeenCalled();
  });

  it('sets needsReauth on a 401/403 but does not throw', async () => {
    mockLoadDeviceCredential.mockResolvedValue({ deviceToken: 's', expiresAt: 'x' });
    mockLoadCashierSession.mockResolvedValue(null); // no token → needs refresh
    mockGetDeviceAuth.mockResolvedValue({ device_id: 'dev-1' });
    const { ApiError } = await import('../api');
    mockRefreshDevice.mockRejectedValue(new ApiError('revoked', 403));

    await expect(useAuthStore.getState().ensureFreshAccessToken()).resolves.toBeUndefined();
    expect(useAuthStore.getState().needsReauth).toBe(true);
  });

  it('stays silent (no needsReauth) on a network error', async () => {
    mockLoadDeviceCredential.mockResolvedValue({ deviceToken: 's', expiresAt: 'x' });
    mockLoadCashierSession.mockResolvedValue(null);
    mockGetDeviceAuth.mockResolvedValue({ device_id: 'dev-1' });
    mockRefreshDevice.mockRejectedValue(new Error('Network failure'));

    await useAuthStore.getState().ensureFreshAccessToken();

    expect(useAuthStore.getState().needsReauth).toBe(false);
  });

  it('is single-flight (concurrent calls collapse to one refresh)', async () => {
    mockLoadDeviceCredential.mockResolvedValue({ deviceToken: 's', expiresAt: 'x' });
    mockLoadCashierSession.mockResolvedValue(null);
    mockGetDeviceAuth.mockResolvedValue({ device_id: 'dev-1' });
    mockRefreshDevice.mockImplementation(
      () => new Promise((r) => setTimeout(() => r({
        access_token: 'fresh', token_type: 'bearer',
        expires_at: '2027-06-01T00:00:00Z',
      }), 30))
    );

    await Promise.all([
      useAuthStore.getState().ensureFreshAccessToken(),
      useAuthStore.getState().ensureFreshAccessToken(),
    ]);

    expect(mockRefreshDevice).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Run it and see it FAIL.**
  `cd sellary-cashier && npx vitest run src/lib/__tests__/auth-store.test.ts -t ensureFreshAccessToken`
  Expected: fails — the Task-6 stub `ensureFreshAccessToken` does nothing, so `mockRefreshDevice` is never called.

- [ ] **Add the single-flight lock + near-expiry helper.** Edit `sellary-cashier/src/lib/auth-store.ts`, add near the lockout constants:

```ts
const REFRESH_WINDOW_MS = 12 * 60 * 60 * 1000; // refresh within 12h of expiry

let refreshInFlight: Promise<void> | null = null;

function needsTokenRefresh(expiresAt: string | undefined | null): boolean {
  if (!expiresAt) return true;
  const exp = Date.parse(expiresAt);
  if (Number.isNaN(exp)) return true;
  return exp - Date.now() <= REFRESH_WINDOW_MS;
}
```

- [ ] **Replace the stub `ensureFreshAccessToken` with the real body.**

```ts
  ensureFreshAccessToken: async () => {
    if (refreshInFlight) {
      return refreshInFlight;
    }
    refreshInFlight = (async () => {
      try {
        const cred = await loadDeviceCredential();
        if (!cred) {
          return;
        }
        const session = await loadCashierSession();
        if (!needsTokenRefresh(session?.expiresAt)) {
          return;
        }
        const auth = await getDeviceAuth();
        if (!auth?.device_id) {
          return;
        }
        const res = await refreshDevice(auth.device_id, cred.deviceToken);
        setApiToken(res.access_token);
        await saveCashierSession({
          accessToken: res.access_token,
          expiresAt: getTokenExpiresAt(res.access_token),
          companyId: auth.company_id ?? 0,
          companyName: auth.company_name ?? '',
          userId: auth.user_id ?? 0,
          username: auth.username ?? '',
          userRole: auth.user_role ?? '',
        });
        await saveDeviceCredential(cred.deviceToken, res.expires_at);
        set({ needsReauth: false });
      } catch (e: unknown) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          set({ needsReauth: true });
        }
        // network / other errors: stay offline silently, app keeps working
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  },
```

- [ ] **Run and see PASS.**
  `cd sellary-cashier && npx vitest run src/lib/__tests__/auth-store.test.ts -t ensureFreshAccessToken`
  Expected: 5 ensureFreshAccessToken tests pass.

- [ ] **Commit.**
  `git add sellary-cashier/src/lib/auth-store.ts sellary-cashier/src/lib/__tests__/auth-store.test.ts`
  `git commit -m "feat(cashier): single-flight opportunistic device-token refresh"`

---

## Task 8: Provisioning rework (register + PIN + bootstrap) and unsynced-blocked logout

**Files:**
- Modify: `sellary-cashier/src/lib/auth-store.ts` (`selectAndBootstrap`, `completePinSetup`, `logout`)
- Modify: `sellary-cashier/src/lib/__tests__/auth-store.test.ts` (provisioning + logout suites)

Provisioning order (owned by `selectAndBootstrap` → `completePinSetup`): `select-company → registerDevice → PIN setup → bootstrap`. `selectAndBootstrap` now registers the device and binds identity but does NOT set `isAuthenticated` (that waits for PIN + catalog). `completePinSetup` sets the PIN, pulls the first catalog, then authenticates. `logout` hard-blocks while unsynced sales exist and, on success, wipes device + PIN + session.

- [ ] **Rewrite the provisioning + logout test suites.** In `sellary-cashier/src/lib/__tests__/auth-store.test.ts`, replace the existing `describe('selectAndBootstrap', ...)` and `describe('logout', ...)` blocks with:

```ts
describe('selectAndBootstrap (device provisioning)', () => {
  it('selects company, registers the device, binds identity, awaits PIN', async () => {
    mockSelectCompany.mockResolvedValue(makeTokenResponse());
    mockGetDeviceAuth.mockResolvedValue(null);
    mockRegisterDevice.mockResolvedValue({
      device_id: 'dev-1', device_token: 'secret',
      name: 'Kassa', expires_at: '2027-01-01T00:00:00Z',
    });

    await useAuthStore.getState().selectAndBootstrap('login-token', 10);

    expect(mockSelectCompany).toHaveBeenCalledWith('login-token', 10);
    expect(mockSetAccessToken).toHaveBeenCalledWith('token-abc');
    expect(mockRegisterDevice).toHaveBeenCalledWith('Kassa', expect.any(String));
    expect(mockSaveDeviceCredential).toHaveBeenCalledWith('secret', '2027-01-01T00:00:00Z');
    expect(mockEnsureDeviceAuth).toHaveBeenCalledWith('dev-1');
    expect(mockBindDeviceIdentity).toHaveBeenCalledWith({
      user_id: 1, username: 'cashier', company_id: 10,
      company_name: 'Test Company', user_role: 'cashier',
      device_token_expires_at: '2027-01-01T00:00:00Z', // reg.expires_at
      last_online_auth_at: expect.any(String),
    });
    const state = useAuthStore.getState();
    expect(state.hasDevice).toBe(true);
    expect(state.hasPin).toBe(false);
    expect(state.isAuthenticated).toBe(false); // not until PIN + bootstrap
  });

  it('does not swallow a register failure', async () => {
    mockSelectCompany.mockResolvedValue(makeTokenResponse());
    mockGetDeviceAuth.mockResolvedValue(null);
    mockRegisterDevice.mockRejectedValue(new Error('rate limited'));

    await expect(
      useAuthStore.getState().selectAndBootstrap('login-token', 10)
    ).rejects.toThrow('register device: rate limited');
    expect(useAuthStore.getState().isBootstrapping).toBe(false);
  });
});

describe('completePinSetup', () => {
  it('sets the PIN, pulls the catalog, and authenticates', async () => {
    mockSavePin.mockResolvedValue(undefined);
    mockGetAccessToken.mockReturnValue('token-abc');
    mockFetchBootstrap.mockResolvedValue(makeBootstrap());

    await useAuthStore.getState().completePinSetup('1234');

    expect(mockSavePin).toHaveBeenCalledWith('1234');
    expect(mockFetchBootstrap).toHaveBeenCalled();
    expect(mockUpsertProducts).toHaveBeenCalledWith([]);
    expect(mockSaveCashierSession).toHaveBeenCalled();
    const state = useAuthStore.getState();
    expect(state.hasPin).toBe(true);
    expect(state.isAuthenticated).toBe(true);
    expect(state.companyId).toBe(10);
  });
});

describe('logout', () => {
  it('hard-blocks while unsynced sales exist', async () => {
    mockGetUnsyncedCount.mockResolvedValue(3);
    useAuthStore.setState({ isAuthenticated: true });

    await expect(useAuthStore.getState().logout()).rejects.toThrow(/3/);
    expect(mockClearDeviceCredential).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('clears device + PIN + session when nothing is unsynced', async () => {
    mockGetUnsyncedCount.mockResolvedValue(0);
    useAuthStore.setState({
      isAuthenticated: true, hasDevice: true, hasPin: true, needsReauth: true,
    });

    await useAuthStore.getState().logout();

    expect(mockSetAccessToken).toHaveBeenCalledWith(null);
    expect(mockClearCashierSession).toHaveBeenCalled();
    expect(mockClearDeviceCredential).toHaveBeenCalled();
    expect(mockClearPin).toHaveBeenCalled();
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.hasDevice).toBe(false);
    expect(state.hasPin).toBe(false);
    expect(state.needsReauth).toBe(false);
  });
});
```

- [ ] **Run it and see it FAIL.**
  `cd sellary-cashier && npx vitest run src/lib/__tests__/auth-store.test.ts -t "provisioning|completePinSetup|logout"`
  Expected: fails — old `selectAndBootstrap` bootstraps immediately and old `logout` never checks unsynced count.

- [ ] **Rework selectAndBootstrap.** Replace the whole `selectAndBootstrap: async (loginToken, companyId) => { ... }` body with:

```ts
  selectAndBootstrap: async (loginToken, companyId) => {
    set({ isBootstrapping: true });
    let phase = 'select company';
    try {
      const tokenRes = await selectCompany(loginToken, companyId);
      setApiToken(tokenRes.access_token);

      phase = 'register device';
      const existing = await getDeviceAuth();
      const deviceId = existing?.device_id ?? crypto.randomUUID();
      const reg = await registerDevice('Kassa', deviceId);
      await saveDeviceCredential(reg.device_token, reg.expires_at);
      await ensureDeviceAuth(reg.device_id);
      // Contract §4.6: snake_case DeviceIdentityInput, exactly 7 fields.
      // device_token_expires_at mirrors the register response; last_online_auth_at
      // is "now" because we just authenticated online.
      await bindDeviceIdentity({
        user_id: tokenRes.user.id,
        username: tokenRes.user.username,
        company_id: tokenRes.current_company.id,
        company_name: tokenRes.current_company.name,
        user_role: tokenRes.current_company.role,
        device_token_expires_at: reg.expires_at,
        last_online_auth_at: new Date().toISOString(),
      });

      set({
        isBootstrapping: false,
        hasDevice: true,
        hasPin: false,
        companyId: tokenRes.current_company.id,
        companyName: tokenRes.current_company.name,
        userId: tokenRes.user.id,
        username: tokenRes.user.username,
        userRole: tokenRes.current_company.role,
      });

      await addSyncEvent('device_register', 'success').catch(() => {});
    } catch (e: unknown) {
      set({ isBootstrapping: false });
      const msg = `${phase}: ${getErrorMessage(e, 'Provisioning failed')}`;
      console.error('Device provisioning failed', { phase, error: e });
      await addSyncEvent('device_register', 'error', msg).catch(() => {});
      throw new Error(msg);
    }
  },
```

- [ ] **Add completePinSetup.** Insert into the store object (after `selectAndBootstrap`):

```ts
  completePinSetup: async (pin) => {
    set({ isBootstrapping: true });
    let phase = 'set pin';
    try {
      await savePin(pin);
      set({ hasPin: true });

      phase = 'download bootstrap catalog';
      const bootstrap = await fetchBootstrap();
      await upsertCategories(bootstrap.categories);
      await upsertProducts(bootstrap.products);
      await setMeta('last_bootstrap_time', bootstrap.server_time);
      await setMeta('last_company_id', String(bootstrap.company_id));
      await setStoreValue('last_company_id', bootstrap.company_id);

      const accessToken = getAccessToken();
      if (accessToken) {
        await saveCashierSession({
          accessToken,
          expiresAt: getTokenExpiresAt(accessToken),
          companyId: bootstrap.company_id,
          companyName: bootstrap.company_name,
          userId: bootstrap.user_id,
          username: bootstrap.user_username,
          userRole: bootstrap.user_role,
        });
      }

      set({
        isAuthenticated: true,
        isBootstrapping: false,
        companyId: bootstrap.company_id,
        companyName: bootstrap.company_name,
        userId: bootstrap.user_id,
        username: bootstrap.user_username,
        userRole: bootstrap.user_role,
      });
      await addSyncEvent('bootstrap', 'success').catch(() => {});
    } catch (e: unknown) {
      set({ isBootstrapping: false });
      const msg = `${phase}: ${getErrorMessage(e, 'Bootstrap failed')}`;
      console.error('PIN setup / bootstrap failed', { phase, error: e });
      await addSyncEvent('bootstrap', 'error', msg).catch(() => {});
      throw new Error(msg);
    }
  },
```

- [ ] **Rework logout.** Replace the whole `logout: async () => { ... }` body with:

```ts
  logout: async () => {
    const unsynced = await getUnsyncedCount().catch(() => 0);
    if (unsynced > 0) {
      throw new Error(
        `Есть ${unsynced} неотправленных продаж. Дождитесь синхронизации.`
      );
    }
    setApiToken(null);
    await clearCashierSession().catch((error) => {
      console.warn('Failed to clear session', error);
    });
    await clearDeviceCredential().catch(() => {});
    await clearPin().catch(() => {});
    set({
      isAuthenticated: false,
      hasDevice: false,
      hasPin: false,
      isLocked: false,
      lockedUntil: null,
      needsReauth: false,
      companyId: null,
      companyName: null,
      userId: null,
      username: null,
      userRole: null,
    });
  },
```

- [ ] **Run and see PASS (whole auth-store file).**
  `cd sellary-cashier && npx vitest run src/lib/__tests__/auth-store.test.ts`
  Expected: all suites (loginUser, provisioning, completePinSetup, restoreSession, unlockWithPin, ensureFreshAccessToken, logout) pass.

- [ ] **Commit.**
  `git add sellary-cashier/src/lib/auth-store.ts sellary-cashier/src/lib/__tests__/auth-store.test.ts`
  `git commit -m "feat(cashier): register->pin->bootstrap provisioning + unsynced-blocked logout"`

---

## Task 9: Offline-auth UI screens + routing

**Files:**
- Create: `sellary-cashier/src/pages/PinSetupPage.tsx`, `sellary-cashier/src/pages/PinUnlockPage.tsx`
- Create: `sellary-cashier/src/components/OfflineFirstRunScreen.tsx`, `sellary-cashier/src/components/NeedsReauthBanner.tsx`
- Create: `sellary-cashier/src/pages/__tests__/PinUnlockPage.test.tsx`
- Modify: `sellary-cashier/src/App.tsx`, `sellary-cashier/src/pages/CashierShell.tsx`, `sellary-cashier/src/pages/LoginPage.tsx`

- [ ] **Write the failing UI test (lockout countdown + unlock wiring).** Create `sellary-cashier/src/pages/__tests__/PinUnlockPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockUnlock, mockNavigate } = vi.hoisted(() => ({
  mockUnlock: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}));

import { useAuthStore } from '../../lib/auth-store';
import { PinUnlockPage } from '../PinUnlockPage';

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    unlockWithPin: mockUnlock,
    isLocked: false,
    lockedUntil: null,
  } as never);
});

describe('PinUnlockPage', () => {
  it('unlocks and navigates to /cashier on success', async () => {
    mockUnlock.mockResolvedValue(true);
    render(<MemoryRouter><PinUnlockPage /></MemoryRouter>);

    fireEvent.change(screen.getByLabelText(/PIN/i), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: /Войти|Разблокировать/i }));

    await waitFor(() => expect(mockUnlock).toHaveBeenCalledWith('1234'));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/cashier', { replace: true }));
  });

  it('shows a lockout countdown and blocks input while locked', () => {
    useAuthStore.setState({
      isLocked: true,
      lockedUntil: new Date(Date.now() + 90_000).toISOString(),
    } as never);
    render(<MemoryRouter><PinUnlockPage /></MemoryRouter>);

    expect(screen.getByText(/Слишком много попыток/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Войти|Разблокировать/i })).toBeDisabled();
  });
});
```

- [ ] **Run it and see it FAIL.**
  `cd sellary-cashier && npx vitest run src/pages/__tests__/PinUnlockPage.test.tsx`
  Expected: fails — `../PinUnlockPage` does not exist.

- [ ] **Create PinUnlockPage.** Create `sellary-cashier/src/pages/PinUnlockPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../lib/auth-store';

function remainingLabel(lockedUntil: string | null): string {
  if (!lockedUntil) return '';
  const ms = Date.parse(lockedUntil) - Date.now();
  if (ms <= 0) return '';
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function PinUnlockPage() {
  const navigate = useNavigate();
  const { unlockWithPin, isLocked, lockedUntil } = useAuthStore();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(remainingLabel(lockedUntil));

  useEffect(() => {
    if (!isLocked || !lockedUntil) return;
    const t = setInterval(() => setCountdown(remainingLabel(lockedUntil)), 1000);
    return () => clearInterval(t);
  }, [isLocked, lockedUntil]);

  const locked = isLocked && !!lockedUntil && Date.parse(lockedUntil) > Date.now();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const ok = await unlockWithPin(pin);
      if (ok) {
        navigate('/cashier', { replace: true });
      } else {
        setError('Неверный PIN');
        setPin('');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4 dark:bg-gray-900">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow dark:bg-gray-800">
        <h1 className="mb-4 text-center text-xl font-bold dark:text-white">Введите PIN</h1>
        {locked && (
          <div className="mb-3 rounded bg-amber-50 p-3 text-center text-sm text-amber-700">
            Слишком много попыток. Попробуйте через {countdown}.
          </div>
        )}
        {error && !locked && (
          <div className="mb-3 rounded bg-red-50 p-2 text-center text-sm text-red-600">{error}</div>
        )}
        <label htmlFor="pin-input" className="mb-1 block text-sm font-medium dark:text-gray-200">PIN</label>
        <input
          id="pin-input"
          type="password"
          inputMode="numeric"
          value={pin}
          disabled={locked || busy}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          className="mb-4 w-full rounded border px-3 py-2 text-center text-lg tracking-widest"
          autoFocus
        />
        <button
          type="submit"
          disabled={locked || busy || pin.length < 4}
          className="w-full rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          Разблокировать
        </button>
        <button
          type="button"
          onClick={() => navigate('/login', { replace: true })}
          className="mt-4 w-full text-center text-sm text-blue-600 underline"
        >
          Забыли PIN? Войдите через интернет
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Run and see PASS.**
  `cd sellary-cashier && npx vitest run src/pages/__tests__/PinUnlockPage.test.tsx`
  Expected: 2 tests pass.

- [ ] **Create PinSetupPage.** Create `sellary-cashier/src/pages/PinSetupPage.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../lib/auth-store';
import { getErrorMessage } from '../lib/error';

export function PinSetupPage() {
  const navigate = useNavigate();
  const { completePinSetup, isBootstrapping } = useAuthStore();
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (pin.length < 4) {
      setError('PIN должен содержать минимум 4 цифры');
      return;
    }
    if (pin !== confirm) {
      setError('PIN-коды не совпадают');
      return;
    }
    try {
      await completePinSetup(pin);
      navigate('/cashier', { replace: true });
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Не удалось сохранить PIN'));
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4 dark:bg-gray-900">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow dark:bg-gray-800">
        <h1 className="mb-1 text-center text-xl font-bold dark:text-white">Задайте PIN</h1>
        <p className="mb-4 text-center text-sm text-gray-500">
          PIN нужен для входа без интернета.
        </p>
        {error && (
          <div className="mb-3 rounded bg-red-50 p-2 text-center text-sm text-red-600">{error}</div>
        )}
        <label className="mb-1 block text-sm font-medium dark:text-gray-200">Новый PIN</label>
        <input
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          className="mb-3 w-full rounded border px-3 py-2 text-center text-lg tracking-widest"
          autoFocus
        />
        <label className="mb-1 block text-sm font-medium dark:text-gray-200">Повторите PIN</label>
        <input
          type="password"
          inputMode="numeric"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))}
          className="mb-4 w-full rounded border px-3 py-2 text-center text-lg tracking-widest"
        />
        <button
          type="submit"
          disabled={isBootstrapping}
          className="w-full rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {isBootstrapping ? 'Загрузка каталога...' : 'Сохранить PIN'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Create OfflineFirstRunScreen.** Create `sellary-cashier/src/components/OfflineFirstRunScreen.tsx`:

```tsx
export function OfflineFirstRunScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4 dark:bg-gray-900">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow dark:bg-gray-800">
        <div className="mb-3 text-4xl">📡</div>
        <h1 className="mb-2 text-xl font-bold dark:text-white">
          Для первой настройки нужен интернет
        </h1>
        <p className="text-sm text-gray-500">
          Подключитесь к сети и войдите, чтобы зарегистрировать кассу и задать PIN.
          После первой настройки касса работает офлайн.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Create NeedsReauthBanner.** Create `sellary-cashier/src/components/NeedsReauthBanner.tsx`:

```tsx
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../lib/auth-store';

export function NeedsReauthBanner() {
  const navigate = useNavigate();
  const needsReauth = useAuthStore((s) => s.needsReauth);
  if (!needsReauth) return null;
  return (
    <div className="flex items-center justify-between gap-3 bg-amber-100 px-4 py-2 text-sm text-amber-800">
      <span>Требуется вход через интернет. Продажи сохраняются локально.</span>
      <button
        type="button"
        onClick={() => navigate('/login')}
        className="rounded bg-amber-600 px-3 py-1 font-medium text-white"
      >
        Войти через интернет
      </button>
    </div>
  );
}
```

- [ ] **Write the canonical App.tsx.** This plan is the **sole owner** of `sellary-cashier/src/App.tsx` (Contract §3). Replace the ENTIRE file with the canonical version below — the `<Toaster/>` (react-hot-toast) plus all six routes (`/login`, `/cashier`, `/pin-setup`, `/pin-unlock`, `/history`, `/settings`) and the catch-all → `/login`. Every downstream plan's route already exists here, so **pos-ui and history-ui MUST NOT edit `App.tsx`** — they only add nav links inside their own screens.

```tsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { LoginPage } from "./pages/LoginPage";
import { CashierShell } from "./pages/CashierShell";
import { PinSetupPage } from "./pages/PinSetupPage";
import { PinUnlockPage } from "./pages/PinUnlockPage";
import { HistoryPage } from "./pages/HistoryPage";
import { SettingsPage } from "./pages/SettingsPage";

function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/cashier" element={<CashierShell />} />
        <Route path="/pin-setup" element={<PinSetupPage />} />
        <Route path="/pin-unlock" element={<PinUnlockPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
```

  > **Merge-order note (Contract §2 chain `… → offline-auth → sync-engine → pos-ui → history-ui`):** `react-hot-toast` is installed by **pos-ui** and `HistoryPage` is created by **history-ui**, both of which merge *after* offline-auth. When this plan lands standalone ahead of them, the `react-hot-toast` and `./pages/HistoryPage` imports will not yet resolve. Either (a) install `react-hot-toast` and land a `HistoryPage` placeholder as part of this plan's App.tsx step, or (b) execute the plans in the pinned order and treat this canonical App.tsx as the reconciled end-state. The route/Toaster shape above is authoritative regardless.

- [ ] **Route to PIN setup after provisioning in LoginPage.** Edit `sellary-cashier/src/pages/LoginPage.tsx`, in `handleCompanySelect`, change the post-`selectAndBootstrap` navigation from `navigate('/cashier', { replace: true });` to:

```tsx
      await selectAndBootstrap(loginToken, companyId);
      navigate('/pin-setup', { replace: true });
```

- [ ] **Orchestrate gates in CashierShell.** Replace the body of `sellary-cashier/src/pages/CashierShell.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../lib/auth-store';
import { POSPage } from './POSPage';
import { PinUnlockPage } from './PinUnlockPage';
import { NeedsReauthBanner } from '../components/NeedsReauthBanner';
import { OfflineFirstRunScreen } from '../components/OfflineFirstRunScreen';

type Gate = 'checking' | 'pos' | 'pin' | 'offline-first-run';

export function CashierShell() {
  const { isAuthenticated, hasDevice, hasPin, restoreSession } = useAuthStore();
  const navigate = useNavigate();
  const [gate, setGate] = useState<Gate>('checking');

  useEffect(() => {
    async function check() {
      if (isAuthenticated) {
        setGate('pos');
        return;
      }
      const provisioned = await restoreSession();
      if (provisioned) {
        setGate('pin'); // device + PIN exist → unlock (token may be expired)
        return;
      }
      // Not provisioned. If device exists but PIN is missing, resume setup.
      if (useAuthStore.getState().hasDevice && !useAuthStore.getState().hasPin) {
        navigate('/pin-setup', { replace: true });
        return;
      }
      if (navigator.onLine) {
        navigate('/login', { replace: true });
      } else {
        setGate('offline-first-run');
      }
    }
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isAuthenticated) {
    return (
      <>
        <NeedsReauthBanner />
        <POSPage />
      </>
    );
  }
  if (gate === 'pin') return <PinUnlockPage />;
  if (gate === 'offline-first-run') return <OfflineFirstRunScreen />;
  return null;
}
```

- [ ] **Run the full cashier suite and see everything PASS.**
  `cd sellary-cashier && npm test`
  Expected: all vitest files pass (session-device, device-api, auth-store, PinUnlockPage, plus the pre-existing sync-service). Also `npx tsc --noEmit` compiles cleanly.

- [ ] **Commit.**
  `git add sellary-cashier/src/pages/PinSetupPage.tsx sellary-cashier/src/pages/PinUnlockPage.tsx sellary-cashier/src/pages/__tests__/PinUnlockPage.test.tsx sellary-cashier/src/components/OfflineFirstRunScreen.tsx sellary-cashier/src/components/NeedsReauthBanner.tsx sellary-cashier/src/App.tsx sellary-cashier/src/pages/CashierShell.tsx sellary-cashier/src/pages/LoginPage.tsx`
  `git commit -m "feat(cashier): PIN setup/unlock, offline-first-run, needsReauth UI + routing"`

---

## Definition of done

- [ ] `cd sellary-cashier && npm test` is green (all vitest files, including the new session-device, device-api, auth-store additions, and PinUnlockPage).
- [ ] `cd sellary-cashier && npx tsc --noEmit` compiles with no errors.
- [ ] Manual gate: `cd sellary-cashier/src-tauri && cargo test -p sellary_cashier_lib pin` passes, and `cd sellary-cashier && npm run tauri:dev` builds the argon2 command on Windows (spec §14 CI note: confirm `argon2` builds on `windows-latest`).
- [ ] Spec §14 cashier test 6 (argon2 PIN round-trip + constant-time + lockout after 5 + countdown) and test 7 (restoreSession opens on an expired access_token when `hasDevice && hasPin`) are covered by Tasks 1, 3, 5, 6, 9.
- [ ] `restoreSession` never clears the session because the access token expired; logout hard-blocks while `getUnsyncedCount() > 0`.
