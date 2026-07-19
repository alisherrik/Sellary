# F7 — DB-backed, encrypted marketplace platform settings — Implementation Report

**Branch:** `marketplace-f7` (worktree `.claude/worktrees/f7`)
**Status:** DONE
**Venv used:** the MAIN repo's venv — `C:/Users/Alisher/Documents/StartUps/Sellary/sellary-backend/.venv/Scripts/python.exe` (no `.venv` exists in the worktree). Installed `cryptography` into it: **cryptography 45.0.7** (+ cffi 2.1.0, pycparser 3.0).
**Test env:** ran with `SELLARY_ENV=development` and a stable `SECRET_KEY="test-secret-key-32chars-minimum-abcdef"` (32+ chars) for the whole run; NOT committed. The crypto key derives from this SECRET_KEY, so it was held constant across the run.

---

## Per-task summary + TDD evidence

### Task 1 — Migration + `PlatformSetting` model — commit `3749b9e`
- RED: `tests/unit/test_platform_setting_model.py` → `ImportError: cannot import name 'PlatformSetting'`.
- GREEN: created `models/platform_setting.py` (table `platform_settings`, cols id/key(unique,indexed)/encrypted_value(Text)/updated_at); registered in `models/__init__.py`; created migration `alembic/versions/20260719_1600-a8b9c0d1e2f3_add_platform_settings.py` chaining off `f7a8b9c0d1e2`; bumped root `railway.toml` pin `f7a8b9c0d1e2` → `a8b9c0d1e2f3`.
- VERIFY: model test (2) + migration-chain guard (3) = **5 passed** (exactly two heads; dead head `20260319_0001` untouched; railway pin == live head `a8b9c0d1e2f3`).

### Task 2 — Crypto helper `core/crypto.py` — commit `59218c7`
- RED: `tests/unit/test_crypto.py` → module not found.
- GREEN: `core/crypto.py` — `derive_fernet_key` (sha256→urlsafe_b64), `encrypt_secret`, `decrypt_secret`, `SecretDecryptError`. Added `cryptography>=43,<46` to `requirements.txt`.
- VERIFY: **5 passed** (stable+32-byte key, roundtrip, nondeterministic IV, wrong-key raises, garbage raises).

### Task 3 — Repository + `PlatformSettingsService` — commit `e7e1dda`
- RED: `tests/unit/test_platform_settings_service.py` → no repo/service.
- GREEN: `repositories/platform_setting_repository.py` (get/upsert, flush) + `services/platform_settings_service.py` (resolve = DB-over-env, set = encrypt+upsert, get_masked, blank-preserves update_from_payload; decrypt failure → treated as unset so env fallback holds).
- VERIFY: **8 passed** (env fallback, DB overrides env, ciphertext-not-plaintext, masked never plaintext, env/unset source reporting, blank-preserves, trims non-blank).

### Task 4 — Rewire 5 call sites (+ ImageUploadService refactor) — commit `5f95a83`
- RED: `tests/unit/test_image_upload_service.py` (updated to string-URL ctor) + `tests/integration/test_platform_settings_rewire.py` → 3 failed.
- GREEN rewiring, env fallback preserved:
  - `api/shop_dependencies.py` — bot token via `PlatformSettingsService(db).resolve("telegram_bot_token")`.
  - `api/shop_orders.py` — added `bot_token` to `_NotifyPayload`; `_send_notify` uses `payload.bot_token`; `place_orders` resolves once (`resolved_bot_token`) and threads it in (background task stays DB-free).
  - `services/merchant_notify_service.py` — ctor builds `TelegramBotClient` with the resolved token.
  - `api/telegram_webhook.py` — `_verify_secret(secret_header, configured)`; route resolves `telegram_webhook_secret` and passes it in (dropped now-unused `settings` import).
  - `services/image_upload_service.py` — ctor now takes `cloudinary_url: str`; keeps `ValueError("Image upload not configured")` → 503.
  - `api/products.py` — image endpoint resolves `cloudinary_url` and passes it into `ImageUploadService`; dropped now-unused `settings` import.
- VERIFY: 6 new tests pass; regression sweep `-k "shop or webhook or merchant or notify or telegram or product or image"` = **186 passed**, 0 regressions.

### Task 5 — Owner API GET(masked)/PUT — commit `a59fa67`
- RED: `tests/integration/test_owner_platform_settings.py` → routes 404.
- GREEN: `schemas/platform_settings.py` (PlatformSettingView / Response / Update) + `GET`/`PUT /api/owner/platform-settings` in `api/owner.py`, both `Depends(require_super_admin)`. GET returns masked only; PUT applies blank-preserves, commits, returns fresh masked view.
- VERIFY: **4 passed** (super-admin required 401 for company token on GET+PUT; masked never plaintext; set + blank-preserves).

### Task 6 — Owner-panel UI — commit `8a8a571`
- RED: `src/components/owner/__tests__/PlatformSettingsSection.test.tsx` → component missing.
- GREEN: `PlatformSettingsSection.tsx` (three password inputs, masked/source hints, Save omits blank fields = blank-preserves); types in `src/lib/types.ts`; `ownerApi.getPlatformSettings`/`updatePlatformSettings` in `src/lib/api.ts`; wired into `OwnerDashboard.tsx` (loadAll parallel fetch, `handleSavePlatformSettings` + toast, guarded render).
- VERIFY: component test **2 passed**; full frontend suite **182 passed (37 files)**; `npm run build` succeeded.

### Task 7 — Verification + deploy note — commit `74fe13e`
- `.env.example`: SECRET_KEY rotation warning (invalidates DB-stored secrets) + the three vars marked OPTIONAL FALLBACK (Owner-panel DB value overrides).
- Full verification below.

---

## Final verification counts

| Gate | Result |
|------|--------|
| Backend compile gate (`compileall api core models repositories schemas services main.py`) | PASS (no errors) |
| Migration-chain guard (`test_migration_chain.py`) | PASS — exactly two heads, dead head `20260319_0001` intact, railway pin == live head `a8b9c0d1e2f3` |
| F7 backend tests (model 2 + crypto 5 + service 8 + image 4 + rewire 2 + owner 4) | all PASS |
| **Full backend suite** (`tests/integration tests/unit`) | **688 passed, 0 failed** (431.94s) |
| Owner-panel UI test | 2 passed |
| Full frontend suite (`npx vitest run`) | 182 passed (37 files) |
| Frontend production build (`npm run build`) | PASS |

The full 688-pass backend suite is the env-fallback proof: every pre-existing test still passes with no DB values stored (resolver returns `settings.*`).

---

## Migration head created
New head **`a8b9c0d1e2f3`** (`add platform_settings`), down_revision `f7a8b9c0d1e2`. Root `railway.toml` pin bumped to match.

---

## Files changed
**Backend (new):** `models/platform_setting.py`, `core/crypto.py`, `repositories/platform_setting_repository.py`, `services/platform_settings_service.py`, `schemas/platform_settings.py`, `alembic/versions/20260719_1600-a8b9c0d1e2f3_add_platform_settings.py`; tests: `tests/unit/test_platform_setting_model.py`, `tests/unit/test_crypto.py`, `tests/unit/test_platform_settings_service.py`, `tests/integration/test_platform_settings_rewire.py`, `tests/integration/test_owner_platform_settings.py`.
**Backend (modified):** `models/__init__.py`, `requirements.txt`, `api/shop_dependencies.py`, `api/shop_orders.py`, `api/telegram_webhook.py`, `api/products.py`, `api/owner.py`, `services/merchant_notify_service.py`, `services/image_upload_service.py`, `tests/unit/test_image_upload_service.py`, `.env.example`.
**Root:** `railway.toml`.
**Frontend (new):** `src/components/owner/PlatformSettingsSection.tsx`, `src/components/owner/__tests__/PlatformSettingsSection.test.tsx`.
**Frontend (modified):** `src/lib/types.ts`, `src/lib/api.ts`, `src/components/owner/OwnerDashboard.tsx`.

---

## Deviations
1. **Existing `test_image_upload_service.py` rewritten** (not just added). The plan's ctor refactor (`ImageUploadService(cloudinary_url: str)`) breaks the 3 pre-existing tests that passed a `_Settings` object. I updated them to pass string URLs and kept the plan's new `test_unconfigured_url_raises_not_configured`. This is the required consequence of the refactor, not a scope change.
2. **`cryptography` resolved to 45.0.7** (within the pinned `>=43,<46`).
3. **`sellary-frontend/package-lock.json`** was modified by `npm install`/`npm run build`; reverted to keep the change surface minimal (no intentional frontend dependency change). Requirements/lock for backend unaffected beyond the added `cryptography` line.

## Concerns
- **`sellary-backend/railway.json`** carries its own stale `preDeployCommand = "alembic upgrade e5f6a7b8c9d0"`. The migration guard only reads the ROOT `railway.toml` (which is now correct), so tests are green, but the JSON pin is independently stale (pre-existing condition, not introduced by F7). Out of scope for this plan; flagging for the controller.
- Frontend `npm install` was required (no `node_modules` in the worktree); the resulting lock churn was reverted.
