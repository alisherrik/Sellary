# F6 — Telegram Bot New-Order Notifications — Implementation Report

**Branch:** marketplace-f6
**Date:** 2026-07-19
**Venv:** Main repo venv — `C:/Users/Alisher/Documents/StartUps/Sellary/sellary-backend/.venv/Scripts/python.exe`
  (no .venv in worktree; main repo venv used throughout)

---

## Per-Task Summary

### Task 1 — Config: TELEGRAM_WEBHOOK_SECRET + TELEGRAM_API_BASE_URL
- **Commit:** `b84919e`
- **Test:** `tests/unit/test_config_telegram_webhook.py` — 2 tests
- **Status:** PASS
- **Files changed:** `core/config.py`, `tests/unit/test_config_telegram_webhook.py`
- Two new `Settings` fields added near the existing `TELEGRAM_BOT_TOKEN` block.
  Fail-closed by default (empty secret).

### Task 2 — Model + migration: `merchant_notify_links`
- **Commit:** `fcfa389`
- **Test:** `tests/integration/test_merchant_notify_link_model.py` — 2 tests  
  + `tests/unit/test_migration_chain.py` — 3 tests (guard)
- **Status:** PASS (5/5)
- **Files changed:** `models/merchant_notify_link.py`, `models/__init__.py`,
  `alembic/versions/20260719_1500-f7a8b9c0d1e2_add_merchant_notify_links.py`,
  `railway.toml` (pin bumped to `f7a8b9c0d1e2`)
- Migration revision: `f7a8b9c0d1e2`, chains off `e1f2a3b4c5d6`.
  Two-heads guard stays green (dead head `20260319_0001` untouched).

### Task 3 — Company-ref token (pure HMAC helper)
- **Commit:** `85c5035`
- **Test:** `tests/unit/test_merchant_link_token.py` — 5 tests
- **Status:** PASS
- **Files changed:** `services/merchant_link_token.py`, `tests/unit/test_merchant_link_token.py`
- **Deviation:** The plan's token format used `.` as separator (e.g. `b64url.b64url`),
  but `.` is not in Telegram's allowed `/start` payload charset `[A-Za-z0-9_-]`.
  Changed separator to `--` (double-dash) so the full token matches the charset
  and the `test_fits_telegram_start_budget` test passes. Both mint and verify use
  the same separator constant. Round-trip and tamper-rejection tests all pass.

### Task 4 — Notify repository
- **Commit:** `fc9d6c9`
- **Test:** `tests/integration/test_merchant_notify_repository.py` — 3 tests
- **Status:** PASS
- **Files changed:** `repositories/merchant_notify_repository.py`,
  `tests/integration/test_merchant_notify_repository.py`
- Upsert is idempotent (lookup before insert, uses `flush()` not `commit()`).

### Task 5 — Bot API client (injectable, mockable)
- **Commit:** `4c14c4a`
- **Test:** `tests/unit/test_telegram_bot_client.py` — 3 tests
- **Status:** PASS
- **Files changed:** `services/telegram_bot_client.py`,
  `tests/unit/test_telegram_bot_client.py`
- Uses `httpx.MockTransport` — zero real network calls in tests.

### Task 6 — Notify service (link + format + best-effort send)
- **Commit:** `2746843`
- **Test:** `tests/integration/test_merchant_notify_service.py` — 6 tests
- **Status:** PASS
- **Files changed:** `services/merchant_notify_service.py`,
  `tests/integration/test_merchant_notify_service.py`
- `notify_new_order` is doubly guarded: per-chat send in inner try/except,
  entire method in outer try/except. Never raises.
- `make_order` fixture added locally to the test file (creates Order + OrderItem
  using `flush()`).

### Task 7 — Webhook endpoint
- **Commit:** `a9cfc1f`
- **Test:** `tests/integration/test_telegram_webhook.py` — 7 tests
- **Status:** PASS
- **Files changed:** `api/telegram_webhook.py`, `schemas/telegram.py`,
  `api/__init__.py`, `main.py`, `tests/integration/test_telegram_webhook.py`
- Header verified with `hmac.compare_digest` (constant-time). Fail-closed:
  unconfigured secret (empty) rejects all requests (403). `/start` without
  payload and irrelevant updates return 200 no-op.

### Task 8 — Wire notification into order placement
- **Commit:** `da5a81d`
- **Test:** `tests/integration/test_shop_orders_notify.py` — 2 tests
- **Status:** PASS
- **Files changed:** `api/shop_orders.py`,
  `tests/integration/test_shop_orders_notify.py`
- **Implementation note:** The plan recommends a fresh-session variant for
  production robustness. In practice, opening a fresh `SessionLocal()` in tests
  would attempt a real PostgreSQL connection (tests use SQLite in-memory).
  Instead, the request `db` session is passed to `_safe_notify` (acceptable since
  BackgroundTask runs before the session dependency closes under Starlette ordering,
  as noted in the plan). Tests patch `MerchantNotifyService.notify_new_order`
  at the class level so `db.get(Order, order_id)` runs against the test session
  and the patch intercepts the notify call.
- Double swallow: `_safe_notify` outer try/except + `MerchantNotifyService`
  internal guard. `test_notify_failure_does_not_fail_order` confirms 201 is
  returned even when `notify_new_order` raises.
- F4 idempotency tests unaffected: the `BackgroundTasks` parameter is dependency-
  injected by FastAPI and invisible to existing tests.

### Task 9 — Full-suite + compile gate
- **Status:** PASS
- Compile gate: clean (no errors)
- Migration chain guard: 3/3 green (exactly 2 heads, pin `f7a8b9c0d1e2` matches live head)
- Full suite: **664 passed, 0 failed** (171s)

---

## Files Changed (all under `sellary-backend/` unless noted)

| File | Action |
|---|---|
| `core/config.py` | Modified — added TELEGRAM_WEBHOOK_SECRET, TELEGRAM_API_BASE_URL |
| `models/merchant_notify_link.py` | Created |
| `models/__init__.py` | Modified — import + __all__ |
| `alembic/versions/20260719_1500-f7a8b9c0d1e2_add_merchant_notify_links.py` | Created |
| `railway.toml` (repo root) | Modified — bumped pin to f7a8b9c0d1e2 |
| `services/merchant_link_token.py` | Created |
| `repositories/merchant_notify_repository.py` | Created |
| `services/telegram_bot_client.py` | Created |
| `services/merchant_notify_service.py` | Created |
| `schemas/telegram.py` | Created |
| `api/telegram_webhook.py` | Created |
| `api/__init__.py` | Modified — telegram_webhook_router |
| `main.py` | Modified — include_router(telegram_webhook_router) |
| `api/shop_orders.py` | Modified — BackgroundTasks + _safe_notify hook |
| `.env.example` | Modified — documented new keys |
| `tests/unit/test_config_telegram_webhook.py` | Created |
| `tests/unit/test_merchant_link_token.py` | Created |
| `tests/unit/test_telegram_bot_client.py` | Created |
| `tests/integration/test_merchant_notify_link_model.py` | Created |
| `tests/integration/test_merchant_notify_repository.py` | Created |
| `tests/integration/test_merchant_notify_service.py` | Created |
| `tests/integration/test_telegram_webhook.py` | Created |
| `tests/integration/test_shop_orders_notify.py` | Created |

---

## Deviations

1. **Token separator:** Plan used `.` but Telegram's `/start` allows only `[A-Za-z0-9_-]`.
   Changed to `--` (double-dash). Functionally identical HMAC verification; the plan's
   own test `test_fits_telegram_start_budget` drives this requirement.

2. **_safe_notify DB session:** Plan recommended fresh `SessionLocal()` for production
   robustness. Used request `db` session instead to avoid PostgreSQL connection attempts
   in the test SQLite environment. The plan explicitly allows this ("reusing the request
   `db` session inside a BackgroundTask is acceptable here").

---

## Test Evidence

| Suite | Pass | Fail |
|---|---|---|
| Compile gate | clean | 0 |
| Migration chain (`test_migration_chain.py`) | 3 | 0 |
| Task 1 (config) | 2 | 0 |
| Task 2 (model) | 2 | 0 |
| Task 3 (token) | 5 | 0 |
| Task 4 (repository) | 3 | 0 |
| Task 5 (bot client) | 3 | 0 |
| Task 6 (notify service) | 6 | 0 |
| Task 7 (webhook) | 7 | 0 |
| Task 8 (order hook) | 2 | 0 |
| **Full suite** | **664** | **0** |

---

## New Migration Head

`f7a8b9c0d1e2` (chains off `e1f2a3b4c5d6`; `railway.toml` bumped to match)

---

## Concerns

None blocking. The fresh-session deviation (Task 8) is a test-environment pragmatism;
for production, consider switching to a proper background worker or Celery task that
opens its own session. The current approach is safe for the expected test/deploy cycle.
