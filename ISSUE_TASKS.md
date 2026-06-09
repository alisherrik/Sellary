# Sellary Issue Tasks

Updated: 2026-05-26

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

## P0 - Must fix before pilot

### [ ] T1. Align customer data contract

Problem:
- Customer API schema currently treats `phone` as required, but stored data and tests allow `NULL`.
- This breaks customer list responses and name-only customer creation.

Work:
- Decide whether `phone` is truly required for MVP.
- Apply the same rule across SQLAlchemy models, Pydantic schemas, API validation, and frontend assumptions.
- Update customer create, read, and update behavior to match the decided contract.
- Clean up or migrate any conflicting test data.

Done when:
- `GET /api/customers` works for all stored customer rows.
- Creating a customer with only a name behaves consistently.
- Customer endpoint tests pass without response validation errors.

### [ ] T2. Fix product response serialization

Problem:
- Product endpoints return ORM category objects, but the response schema expects `category` as a `dict`.
- Product detail and barcode lookups fail response validation.

Work:
- Replace the loose `dict` field with a proper nested schema or an explicit serializer.
- Make sure all product endpoints return the same response shape.
- Verify frontend product screens still consume the response correctly.

Done when:
- Product detail and barcode endpoints serialize successfully.
- Product API tests pass without `ResponseValidationError`.

### [ ] T3. Fix sale item defaults and DB compatibility

Problem:
- `sale_items.created_at` uses an invalid string default for tests.
- `sale_items.tax_percent` is non-null, but some fixtures and flows create rows without it.
- Cancel and return tests fail because of these model-level issues.

Work:
- Replace the `created_at` default with a proper SQLAlchemy-compatible timestamp default.
- Add a safe default for `tax_percent` or guarantee it is always set before insert.
- Check related defaults for sale and return models for SQLite and Postgres compatibility.

Done when:
- No `Invalid isoformat string: 'now()'` errors remain.
- No `NOT NULL constraint failed: sale_items.tax_percent` errors remain.
- Sale cancel and return tests pass.

### [ ] T4. Harden idempotency conflict handling

Problem:
- Duplicate idempotency inserts can surface as raw `IntegrityError` instead of a clean conflict flow.

Work:
- Make duplicate-key handling safe after flush conflicts.
- Return a consistent conflict response or cached response path.
- Preserve transaction integrity after idempotency collisions.

Done when:
- Duplicate idempotency key tests pass.
- API behavior is consistent for replayed and conflicting requests.

### [ ] T5. Normalize sales and returns error semantics

Problem:
- Some not-found scenarios are currently returned as generic `400` errors.

Work:
- Separate validation failures from missing-resource failures.
- Return `404` for missing sales, sale items, and related resources where appropriate.
- Keep `409` for true state-transition or idempotency conflicts.

Done when:
- Sales and returns endpoints use consistent status codes.
- Not-found test cases pass with the expected response codes.

## P1 - Must stabilize right after P0

### [ ] T6. Align the sales list contract

Problem:
- The backend currently returns a list of sales, while older tests expect a paginated envelope with `items` and `total`.
- The product needs one canonical contract.

Work:
- Decide whether `/api/sales` should return a raw array or a paginated object.
- Update backend schema, frontend hooks, and tests to one shared shape.
- Document the contract in the backend and frontend README or API notes.

Done when:
- Backend, frontend, and tests all agree on the same `/api/sales` response format.
- No integration tests fail because of the contract mismatch.

### [ ] T7. Update tests for required idempotency headers

Problem:
- Several integration tests post to sales and returns endpoints without `Idempotency-Key`, but the API now requires it.

Work:
- Add reusable test helpers for idempotency headers.
- Update create sale, cancel sale, and return tests to use the current contract.
- Keep at least one test that verifies requests fail when the header is missing.

Done when:
- Sales and return integration tests no longer fail because headers are missing.
- Idempotency requirements are covered explicitly by tests.

### [ ] T8. Update stale backend tests to match current response types

Problem:
- Some unit tests still treat typed response objects like dictionaries.
- A few tests also depend on older fixture assumptions.

Work:
- Update unit tests to access response fields using the current typed API.
- Fix fixtures or assertions that no longer match generated names or response objects.
- Remove false negatives so the suite reflects real regressions.

Done when:
- Backend unit tests fail only for real product issues, not outdated assertions.

### [ ] T9. Add a release gate verification pass

Problem:
- We need one reliable signal that the retail MVP is stable enough for pilot use.

Work:
- Run backend unit and integration suites after fixes.
- Run frontend tests and production build.
- Do one manual smoke test for: login, product lookup, sale completion, stock deduction, sales history, supplier flow, and purchase order receive.
- Record the final pass/fail results in a short verification note.

Done when:
- Backend tests are green.
- Frontend tests and build are green.
- Core retail flow is manually verified end to end.

## P2 - Keep out of MVP

### [x] T10. Keep restaurant as Phase 2 only (RESOLVED - removed from codebase)

Resolved: Restaurant module has been fully removed from frontend and backend. All restaurant routes,
components, stores, and feature flags are deleted. Not part of the Sellary product.

### [x] T11. Keep offline sync as Phase 2 only (RESOLVED - removed from codebase, replaced by Tauri)

Resolved: PWA/Service Worker offline mode has been fully removed from frontend. Offline sync
has been replaced by the Tauri desktop cashier app (`sellary-cashier`), which provides
native offline POS capability with outbox sync.

## Suggested execution order

1. T1 customer contract
2. T2 product serialization
3. T3 sale item defaults and DB compatibility
4. T4 idempotency conflict handling
5. T5 sales and returns error semantics
6. T6 sales list contract
7. T7 update idempotency tests
8. T8 refresh stale backend tests
9. T9 full verification pass

T10 and T11 resolved: Restaurant removed, PWA offline replaced by Tauri cashier app.
