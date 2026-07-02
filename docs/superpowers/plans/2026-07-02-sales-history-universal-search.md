# Sales History Universal Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a tenant-safe, typo-tolerant universal sales-history search with server results and keyboard-accessible suggestions.

**Architecture:** `GET /api/sales` receives a debounced query and filters every searchable sale property in the repository. A focused search service ranks tenant-scoped product/customer/cashier vocabulary plus static Russian aliases with RapidFuzz; high-confidence corrections augment result terms and a separate suggestions endpoint feeds an accessible React dropdown.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic, RapidFuzz, Next.js/React, TanStack Query, Vitest, Testing Library, Playwright, Railway, Netlify.

---

## File Structure

- Create `sellary-backend/services/sale_search_service.py`: normalization, alias candidates, fuzzy ranking, confidence policy.
- Modify `sellary-backend/repositories/sale_repository.py`: tenant-scoped vocabulary and universal result predicates.
- Modify `sellary-backend/services/sale_service.py`: resolve query variants and expose suggestions.
- Modify `sellary-backend/api/sales.py`: validated search/status-group params and suggestions route.
- Modify `sellary-backend/schemas/sale.py`: suggestion response contract.
- Modify `sellary-backend/requirements.txt`: RapidFuzz runtime dependency.
- Create `sellary-backend/tests/unit/test_sale_search_service.py`: pure fuzzy behavior.
- Extend `sellary-backend/tests/unit/test_sale_service.py` and `tests/integration/test_sales_endpoints.py`: repository/API search behavior.
- Create `sellary-frontend/src/components/sales/SalesSearch.tsx`: accessible search and suggestion UI.
- Create `sellary-frontend/src/components/sales/__tests__/SalesSearch.test.tsx`: interaction tests.
- Modify `sellary-frontend/src/lib/types.ts`, `src/lib/api.ts`, `src/hooks/useQueries.ts`: typed API/query plumbing.
- Extend `sellary-frontend/src/hooks/__tests__/useQueries.test.tsx`: suggestion query tests.
- Modify `sellary-frontend/src/app/(protected)/sales/page.tsx`: debounced server search integration.
- Create `sellary-frontend/src/app/(protected)/sales/__tests__/page.test.tsx`: page request/filter behavior.

### Task 1: Fuzzy Search Policy

- [ ] **Step 1: Write failing pure unit tests**

Create tests proving normalization, `колаа → Кола`, `aliff → Alif`, minimum display score, and the stricter auto-correction threshold:

```python
def test_rank_suggestions_finds_close_product_name():
    result = rank_candidates("колаа", [SearchCandidate("product", "Кола", "Кола")])
    assert result[0].label == "Кола"

def test_auto_terms_exclude_low_confidence_candidate():
    assert automatic_terms("xyz", [SearchCandidate("product", "Кола", "Кола")]) == ["xyz"]
```

- [ ] **Step 2: Verify RED**

Run: `.venv\Scripts\pytest.exe tests\unit\test_sale_search_service.py -v`

Expected: import failure because `services.sale_search_service` does not exist.

- [ ] **Step 3: Implement the minimal search service and schema**

Add `rapidfuzz>=3.0.0`, `SaleSearchSuggestion`, immutable `SearchCandidate`, Russian alias candidates, Unicode casefold/whitespace normalization, `rank_candidates`, and `automatic_terms`. Use display threshold 55 and automatic threshold 82. Keep original query first and deduplicate canonical terms.

- [ ] **Step 4: Verify GREEN**

Run the Task 1 pytest command and require all tests to pass.

### Task 2: Tenant-Scoped Universal Backend Search

- [ ] **Step 1: Write failing repository/service tests**

Add tests that create two companies and assert search matches sale ID, date, cashier, customer, product/barcode, payment, status, amount, notes, and void reason only inside the active company. Add typo tests proving a high-confidence product correction returns its sale and a low-confidence term returns none.

- [ ] **Step 2: Verify RED**

Run: `.venv\Scripts\pytest.exe tests\unit\test_sale_service.py -k "search or suggestion" -v`

Expected: `SaleService.get_all()` rejects `search`, and suggestions are missing.

- [ ] **Step 3: Implement repository candidate and predicate methods**

Extend `SaleRepository.get_all(..., search_terms=None, status_group=None)`. Build `OR` predicates from `cast(..., String).ilike()` for scalar fields and `Sale.cashier.has`, `Sale.customer.has`, `Sale.items.any(SaleItem.product.has(...))`, and `Sale.returns.any(...)` for relationships. Preserve `Sale.company_id == company_id` as the outer mandatory filter. Treat `status_group="returns"` as `IN (returned, partially_returned)`.

Add `get_search_candidates(company_id)` using distinct product, customer, and cashier values joined through that company's sales.

- [ ] **Step 4: Implement service orchestration**

`SaleService.get_all(search=...)` loads candidates only for non-empty search, builds automatic terms, and passes them to the repository. `get_search_suggestions(query, limit)` ranks the same candidates plus static aliases and returns Pydantic suggestion objects.

- [ ] **Step 5: Verify GREEN**

Run the Task 2 test command, then `.venv\Scripts\pytest.exe tests\unit\test_sale_search_service.py tests\unit\test_sale_service.py -q`.

### Task 3: FastAPI Contracts

- [ ] **Step 1: Write failing endpoint tests**

Test `GET /api/sales?search=...`, `status_group=returns`, `GET /api/sales/search-suggestions?q=колаа`, whitespace behavior, 100-character validation, and cross-company isolation.

- [ ] **Step 2: Verify RED**

Run: `.venv\Scripts\pytest.exe tests\integration\test_sales_endpoints.py -k "search or suggestion" -v`

Expected: missing route/query behavior.

- [ ] **Step 3: Add API parameters and route**

Declare `search: Optional[str] = Query(None, max_length=100)`, `status_group: Optional[Literal["returns"]]`, and a `/search-suggestions` route before `/{sale_id}` with `q` length 2–100 and `limit` 1–10. Trim whitespace before calling the service.

- [ ] **Step 4: Verify GREEN**

Run Task 3 tests, then all sales backend tests.

### Task 4: Typed Frontend Data Layer

- [ ] **Step 1: Write failing hook tests**

Assert `useSaleSearchSuggestions("колаа")` calls `salesApi.getSearchSuggestions("колаа", 8)`, does not call below two characters/offline, and includes tenant ID in its query key.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/hooks/__tests__/useQueries.test.tsx`

Expected: missing hook/API/type.

- [ ] **Step 3: Implement types, API, and hook**

Add:

```ts
export interface SaleSearchSuggestion {
  kind: 'product' | 'cashier' | 'customer' | 'status' | 'payment';
  label: string;
  value: string;
  score: number;
}
```

Add `salesApi.getSearchSuggestions`, a tenant-aware query key, and `useSaleSearchSuggestions` enabled only for trimmed queries of length at least two.

- [ ] **Step 4: Verify GREEN**

Run the Task 4 Vitest command.

### Task 5: Accessible Search Component

- [ ] **Step 1: Write failing component tests**

Test placeholder and value changes, source labels, clear action, mouse selection, ArrowDown/ArrowUp/Enter selection, Escape close, and loading indicator.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/components/sales/__tests__/SalesSearch.test.tsx`

Expected: component import failure.

- [ ] **Step 3: Implement `SalesSearch`**

Use `MagnifyingGlassIcon`, `XMarkIcon`, and `ArrowPathIcon`. Render a relative combobox with `role="combobox"`, `aria-expanded`, `aria-controls`, a `role="listbox"`, and `role="option"` rows. Keep active index local, reset it when suggestions change, and call `onSelect(suggestion.value)`.

- [ ] **Step 4: Verify GREEN**

Run the Task 5 Vitest command.

### Task 6: Sales Page Integration

- [ ] **Step 1: Write failing page tests**

Mock hooks and fake timers. Assert 300 ms debounce, `{limit: 200, search}` server params, status/status-group params, clear behavior, retained data during fetching, and selected suggestion replacement.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run 'src/app/(protected)/sales/__tests__/page.test.tsx'`

Expected: no search control or server parameters.

- [ ] **Step 3: Integrate the component**

Add `searchInput`, `useDebounce(searchInput, 300)`, stable `salesParams`, `useSales(salesParams, { placeholderData: previous => previous })`, and `useSaleSearchSuggestions(searchInput)`. Map tabs to `status=completed`, `status=cancelled`, or `status_group=returns`; make `visibleSales` equal server results. Place `SalesSearch` between tabs and refresh with responsive width.

- [ ] **Step 4: Verify GREEN**

Run Task 6 tests, all frontend Vitest tests, lint, and production build.

### Task 7: Full Verification and Deployment

- [ ] Run backend compile and `pytest tests/integration tests/unit`.
- [ ] Run frontend `npx vitest run`, `npm run lint`, and `npm run build`.
- [ ] Review `git diff --check`, stage only feature files, and commit intentionally.
- [ ] Push `main`; monitor Railway deployment and Netlify GitHub deploy to success.
- [ ] Verify Railway `/health`, authenticated `/api/sales?search=...`, typo suggestions, and zero new HTTP 500 logs.
- [ ] Use Playwright against Netlify production: owner login → company → sales history → exact search → typo suggestion → keyboard selection → clear; check DOM, console, screenshot, and responsive mobile viewport.
