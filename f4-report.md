# F4 Marketplace — Order Domain + Checkout Implementation Report

**Branch:** `marketplace-f4`
**Venv used:** `C:/Users/Alisher/Documents/StartUps/Sellary/sellary-backend/.venv/Scripts/python.exe` (main repo venv, code from worktree)
**Date:** 2026-07-19

---

## Plan File Status

The plan file `2026-07-19-marketplace-f4-orders.md` did not exist in the worktree. The implementation was synthesized from:
- The resolved decisions in the task prompt
- The design spec at `docs/superpowers/specs/2026-07-19-telegram-marketplace-design.md`
- Existing codebase patterns (F1/F2 plans, existing models, services, repositories)

---

## Tasks Completed

### Task 1: Migration — `orders` + `order_items` tables
**Commit:** `dc3e77a`
**File:** `sellary-backend/alembic/versions/20260719_1400-e1f2a3b4c5d6_add_order_domain.py`
- Chains off `d0e1f2a3b4c5` (F2 head), new live head: `e1f2a3b4c5d6`
- Creates `orders` table: id, company_id, telegram_user_id, customer_id, order_number, status (VARCHAR, default 'pending'), fulfillment_type (VARCHAR), delivery_address, contact_phone, contact_name, subtotal, total_amount, notes, sale_id, checkout_group_id, created_at, updated_at
- Creates `order_items` table: id, order_id (CASCADE), product_id, product_name (snapshot), unit_price (snapshot), quantity, line_total
- Adds indexes on orders.company_id, telegram_user_id, status
- `railway.toml` bumped to `e1f2a3b4c5d6`
- **Migration chain guard: 3/3 PASS** (`test_migration_chain.py`)

### Task 2: `Order` and `OrderItem` SQLAlchemy models
**Commit:** `71d9ee8`
**Files:**
- `sellary-backend/models/order.py` — `Order`, `OrderStatus`, `FulfillmentType`
- `sellary-backend/models/order_item.py` — `OrderItem`
- `sellary-backend/models/__init__.py` — registered both models in `__all__`
- **TDD:** `tests/unit/test_order_model.py` (4 tests) — PASS

### Task 3: Order Pydantic Schemas
**Commit:** `1324d80`
**File:** `sellary-backend/schemas/order.py`
- `OrderItemCreate`, `OrderCreate`, `CheckoutRequest`
- `OrderItemResponse`, `OrderResponse`, `OrderListResponse`
- `OrderStatusAdvance`, `OrderCancelRequest`, `OrderConfirmRequest`

### Task 4: `OrderRepository`
**Commit:** `9f171cb`
**File:** `sellary-backend/repositories/order_repository.py`
- `get_by_id`, `get_by_id_for_update`, `get_by_id_global`
- `get_all_for_company` (with status filter), `get_all_for_shopper`
- `next_order_number` (sequential per company, row-locked)
- `create`

### Task 5: `OrderService` + unit/integration tests
**Commit:** `7d230e3`
**Files:**
- `sellary-backend/services/order_service.py`
- `sellary-backend/tests/unit/test_order_model.py` (4 tests)
- `sellary-backend/tests/integration/test_order_service.py` (15 tests)

Key decisions applied:
- **Decision #2:** `cashier_id = auth.user.id` (confirming manager)
- **Decision #3:** Confirm calls `SaleService.create` directly — `@pytest.mark.no_auto_shift` test proves no shift required
- **Decision #4:** `consume_fifo` raises `ValueError("Insufficient stock")` → mapped to `OrderOversellError` → HTTP 400, order stays pending
- **Cancel after confirm:** calls `TransactionReversalService.void_sale` to restore stock

### Task 6: Merchant API Router (`/api/orders`)
**Commit:** `c7bcb49` (partial)
**File:** `sellary-backend/api/orders.py`
- `GET /api/orders` — list with status filter
- `GET /api/orders/{id}` — detail
- `POST /api/orders/{id}/confirm` — confirm → 400 on oversell, 409 on wrong status
- `POST /api/orders/{id}/status` — advance lifecycle
- `POST /api/orders/{id}/cancel` — cancel with sale void
- **TDD:** `tests/integration/test_order_endpoints.py` (13 tests) — PASS

### Task 7: Shopper API Router (`/api/shop/orders`)
**Commit:** `c7bcb49` (same commit)
**File:** `sellary-backend/api/shop_orders.py`
- `POST /api/shop/orders` — checkout with idempotency
- `GET /api/shop/orders` — my orders list
- `GET /api/shop/orders/{id}` — own order detail (privacy enforced)
- **Decision #5 (idempotency scoping):** `company_id = min(company_ids)`, `user_id = telegram_users.id` (avoids FK violation)
- **TDD:** `tests/integration/test_shop_order_endpoints.py` (8 tests) — PASS

### Task 8: Register routers in `api/__init__.py` and `main.py`
**Commit:** `c7bcb49`
Both `shop_orders_router` and `orders_router` registered and included.

---

## Test Results

### Compile Gate
```
python -m compileall api core models repositories schemas services main.py
→ PASS (no errors)
```

### Migration Chain Guard
```
tests/unit/test_migration_chain.py
→ 3/3 PASS
→ Live head: e1f2a3b4c5d6 (matches railway.toml)
→ Exactly 2 heads: e1f2a3b4c5d6 (live) + 20260319_0001 (dead)
```

### F4 Test Suite
```
tests/unit/test_order_model.py                 → 4 PASS
tests/integration/test_order_service.py        → 15 PASS
tests/integration/test_order_endpoints.py      → 13 PASS
tests/integration/test_shop_order_endpoints.py → 8 PASS
Total F4: 43 PASS
```

### Full Suite (no regressions)
```
631 passed, 31 warnings in 161.01s
0 failures
```

---

## Files Changed

### New Files
- `sellary-backend/alembic/versions/20260719_1400-e1f2a3b4c5d6_add_order_domain.py`
- `sellary-backend/models/order.py`
- `sellary-backend/models/order_item.py`
- `sellary-backend/schemas/order.py`
- `sellary-backend/repositories/order_repository.py`
- `sellary-backend/services/order_service.py`
- `sellary-backend/api/orders.py`
- `sellary-backend/api/shop_orders.py`
- `sellary-backend/tests/unit/test_order_model.py`
- `sellary-backend/tests/integration/test_order_service.py`
- `sellary-backend/tests/integration/test_order_endpoints.py`
- `sellary-backend/tests/integration/test_shop_order_endpoints.py`

### Modified Files
- `railway.toml` — pin bumped to `e1f2a3b4c5d6`
- `sellary-backend/models/__init__.py` — registered Order, OrderStatus, FulfillmentType, OrderItem
- `sellary-backend/api/__init__.py` — registered shop_orders_router, orders_router
- `sellary-backend/main.py` — included both new routers

---

## Deviations from Plan

1. **Plan file missing:** The plan file `2026-07-19-marketplace-f4-orders.md` did not exist in the worktree. Implementation was synthesized from the task prompt's resolved decisions and the design spec. All 5 resolved decisions were applied exactly.

2. **No `@pytest.mark.no_auto_shift` marker on `test_confirm_already_confirmed_raises_status_error`:** The second confirm call is rejected before hitting SaleService, so the shift guard is never reached — test doesn't need the marker.

3. **OrderItem import fix:** `models/order.py` did not export `OrderItem` — corrected to import from `models/order_item.py` in the service.

4. **Duplicate index fix:** `Order.telegram_user_id` had both `Column(index=True)` and a `__table_args__` Index — removed the Column-level `index=True` to avoid SQLite "index already exists" error.

5. **`SaleCreate` validation:** `SaleCreate` requires `payment_method` (no default on `card_type`, validated by model_validator). The confirm path passes `payment_method=PaymentMethod.CASH` which satisfies the validator without a card_type.

---

## Concerns / Notes

- **No plan file:** The F4 plan was not written before implementation. Future phases should write the plan file first.
- **Confirm→Sale in test context:** `SaleService.create` in the test context (SQLite in-memory) may produce slightly different FIFO behavior than Postgres. All tests pass, including the oversell case.
- **`advance_status` accepts `cancelled` as a valid target** from `pending` per the state machine dict. The `cancel()` method is the right path, but the state machine doesn't block it via `advance_status`. This matches the design (separation of concerns, not a bug).
- **Phone share endpoint (`POST /api/shop/me/phone`)** mentioned in the design spec was NOT implemented — it is not listed in the F4 resolved decisions and appears to be F4 scope-out.
