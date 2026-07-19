# Track B Report: Marketplace F2 — Public Catalog API + Telegram initData Auth

## Status: DONE

**Branch:** `worktree-agent-a28f5cf79c0c39481`

---

## Deviation from Plan (Important)

The plan assumed F1 migrations and model fields (`is_published`, `image_url` on Product; `is_marketplace_enabled`, `logo_url`, `marketplace_description`, `supports_delivery`, `supports_pickup` on Company) were already applied in the worktree. They were NOT — the worktree was branched from `b8c9d0e1f2a3` (cash_shifts) without F1.

**Adaptation made:** Created both migrations (F1 `c9d0e1f2a3b4` + F2 `d0e1f2a3b4c5`) and added F1 model fields alongside F2 work. The plan's TDD flow, test code, and final state are identical to the spec. Combined into Task 1's commit as they form a single migration chain.

---

## Per-Task Summary

### Task 1: Migrations + railway.toml
- Created `20260719_1200-c9d0e1f2a3b4_add_marketplace_fields.py` (F1, chains off `b8c9d0e1f2a3`)
- Created `20260719_1300-d0e1f2a3b4c5_add_telegram_users_and_customer_telegram_id.py` (F2, chains off `c9d0e1f2a3b4`)
- Bumped `railway.toml` pin from `b8c9d0e1f2a3` → `d0e1f2a3b4c5`
- **Guard test:** `test_migration_chain.py` — 3/3 PASS
- **Commit:** `a80f2fb`

### Task 2: TelegramUser model + Customer.telegram_id + F1 model fields
- Created `models/telegram_user.py` (TelegramUser with BigInteger telegram_id unique)
- Updated `models/customer.py` (BigInteger telegram_id column + partial-unique index)
- Updated `models/company.py` (5 marketplace columns)
- Updated `models/product.py` (is_published + image_url)
- Registered `TelegramUser` in `models/__init__.py` + `__all__`
- Created `tests/unit/test_telegram_user_model.py` — 3/3 PASS
- **Commit:** `4288783`

### Task 3: Config + initData verify service
- Added `TELEGRAM_BOT_TOKEN` + `TELEGRAM_AUTH_MAX_AGE_SECONDS` to `core/config.py`
- Documented in `.env.example`
- Created `services/telegram_auth_service.py` (HMAC-SHA256, stdlib only)
- Created `tests/unit/test_telegram_auth_service.py` — 7/7 PASS
- **Commit:** `b3b4dfa`

### Task 4: Repository + FastAPI dependency
- Created `repositories/telegram_user_repository.py` (idempotent get-or-create)
- Created `api/shop_dependencies.py` (get_telegram_shopper: 401/503 error handling)
- Created `tests/unit/test_telegram_user_repository.py` — 2/2 PASS
- Created `tests/integration/test_shop_auth_dependency.py` — 3/3 PASS
- **Commit:** `1a1d7e6`

### Task 5: Shop schemas
- Created `schemas/shop.py` (ShopProduct/ShopSummary/ShopCategory/CatalogPage/ShopDetail)
- Created `tests/unit/test_shop_schemas.py` — 3/3 PASS
- **Commit:** `c85ab8e`

### Task 6: Catalog repository + shop service
- Created `repositories/shop_repository.py` (cross-company gated queries)
- Created `services/shop_service.py` (maps to schemas, sets in_stock bool)
- Created `tests/integration/test_shop_service.py` — 11/11 PASS
- **Commit:** `ebf07bd`

### Task 7: /api/shop router + registration
- Created `api/shop.py` (5 GET endpoints, all gated by get_telegram_shopper)
- Updated `api/__init__.py` (shop_router import + __all__)
- Updated `main.py` (import + include_router + CORS note comment)
- Created `tests/integration/test_shop_endpoints.py` — 9/9 PASS
- **Commit:** `3be210b`

### Task 8: Tenant-isolation regression
- Created `tests/integration/test_shop_tenant_isolation.py` — 2/2 PASS
- **Commit:** `8596366`

---

## TDD Evidence

All tests were written before/alongside implementation following TDD. Each test file was confirmed to import-fail (ModuleNotFoundError) before the implementation was created.

### Compile Gate
```
python -m compileall api core models repositories schemas services main.py
Exit code: 0 (PASS)
```

### Migration Chain Guard
```
tests/unit/test_migration_chain.py::test_exactly_two_heads_and_dead_head_untouched PASS
tests/unit/test_migration_chain.py::test_railway_pin_matches_live_head PASS
tests/unit/test_migration_chain.py::test_live_head_reaches_dead_head_free_lineage PASS
```

### Full F2 Suite (43 tests)
```
43 passed, 2 warnings in 1.35s
```

### Full Suite (No Regressions)
```
576 passed, 29 warnings in 152.86s
```

---

## Files Changed

### New files
- `sellary-backend/alembic/versions/20260719_1200-c9d0e1f2a3b4_add_marketplace_fields.py`
- `sellary-backend/alembic/versions/20260719_1300-d0e1f2a3b4c5_add_telegram_users_and_customer_telegram_id.py`
- `sellary-backend/models/telegram_user.py`
- `sellary-backend/api/shop_dependencies.py`
- `sellary-backend/api/shop.py`
- `sellary-backend/repositories/telegram_user_repository.py`
- `sellary-backend/repositories/shop_repository.py`
- `sellary-backend/schemas/shop.py`
- `sellary-backend/services/telegram_auth_service.py`
- `sellary-backend/services/shop_service.py`
- `sellary-backend/tests/unit/test_telegram_user_model.py`
- `sellary-backend/tests/unit/test_telegram_auth_service.py`
- `sellary-backend/tests/unit/test_telegram_user_repository.py`
- `sellary-backend/tests/unit/test_shop_schemas.py`
- `sellary-backend/tests/integration/test_shop_auth_dependency.py`
- `sellary-backend/tests/integration/test_shop_service.py`
- `sellary-backend/tests/integration/test_shop_endpoints.py`
- `sellary-backend/tests/integration/test_shop_tenant_isolation.py`

### Modified files
- `railway.toml` (pin bumped to `d0e1f2a3b4c5`)
- `sellary-backend/models/product.py` (is_published + image_url)
- `sellary-backend/models/company.py` (marketplace fields)
- `sellary-backend/models/customer.py` (telegram_id + partial-unique index)
- `sellary-backend/models/__init__.py` (TelegramUser registered)
- `sellary-backend/core/config.py` (TELEGRAM_BOT_TOKEN + TELEGRAM_AUTH_MAX_AGE_SECONDS)
- `sellary-backend/.env.example` (documenting new keys)
- `sellary-backend/api/__init__.py` (shop_router)
- `sellary-backend/main.py` (shop_router + CORS note comment)

---

## Migration Head Created

New live head: **`d0e1f2a3b4c5`**  
Chains: `b8c9d0e1f2a3` → `c9d0e1f2a3b4` (F1) → `d0e1f2a3b4c5` (F2)  
Dead head `20260319_0001` untouched. Exactly 2 heads maintained.

---

## Concerns

1. **F1 prerequisite not in worktree:** The worktree lacked F1 work. I added F1's migration and model fields as a pre-step to F2. The plan is satisfied because the final state is identical; both migrations are properly chained.

2. **Venv sharing:** The worktree uses the main repo's `.venv` (no worktree-local venv). All tests run correctly because Python path resolution uses the worktree's source files when `cwd` is set to the worktree's `sellary-backend/`. No issues observed.

3. **SQLite partial-unique index:** The `uq_customers_company_telegram_id` migration uses only `postgresql_where` (no SQLite equivalent). The model defines both `sqlite_where` and `postgresql_where` for test compatibility. SQLite ignores partial indexes it doesn't support, so `test_telegram_id_is_unique` may not exercise the per-company constraint in unit tests — but this is consistent with the existing `client_customer_id` pattern.
