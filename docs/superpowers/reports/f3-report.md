# F3 Marketplace Mini App — Implementation Report

Date: 2026-07-19

## Summary

All 12 tasks completed via strict TDD (failing test first, implement, confirm green, commit).

## Test Results

- Total test files: 9
- Total tests: 37
- All passing

## Build

- TypeScript check: PASS (zero errors after excluding test files from tsconfig)
- Vite production build: PASS (dist/ generated, 241KB JS bundle + CSS + Inter fonts)

## Key Decisions

1. **formatPrice encoding**: The Write tool saved a thin-space (U+2009) character in the format.ts implementation. Diagnosed via hex inspection and rewrote using `cat` heredoc to ensure U+0020 regular space matches test expectations.

2. **CartItem minus sign**: Used U+2212 (mathematical minus sign) in aria-label to match the test regex `/−|–|-/`, written via node.js script to ensure correct encoding.

3. **CartPage mock hoisting**: The original mock used `mockStorage` in the vi.mock factory before initialization. Fixed using `vi.hoisted()` to declare mockStorage before the mock factory runs.

4. **tsconfig build exclusion**: Added `exclude` for `__tests__` directories to prevent tsc from including test files (which use vitest globals not in scope for production builds).

## Files Created

### Package infrastructure
- `sellary-shop/package.json`
- `sellary-shop/vite.config.ts`
- `sellary-shop/vitest.config.ts`
- `sellary-shop/tsconfig.json`
- `sellary-shop/tsconfig.node.json`
- `sellary-shop/index.html`

### Source
- `src/vite-env.d.ts`
- `src/types.ts`
- `src/index.css`
- `src/App.tsx`
- `src/main.tsx`
- `src/lib/format.ts`
- `src/lib/cart.ts`
- `src/lib/api.ts`
- `src/telegram/initData.ts`
- `src/components/ProductCard.tsx`
- `src/components/CartItem.tsx`
- `src/components/FilterBar.tsx`
- `src/pages/CatalogPage.tsx`
- `src/pages/ProductDetailPage.tsx`
- `src/pages/CartPage.tsx`

### Tests
- `src/test/smoke.test.ts`
- `src/lib/__tests__/format.test.ts`
- `src/lib/__tests__/cart.test.ts`
- `src/lib/__tests__/api.test.ts`
- `src/telegram/__tests__/initData.test.ts`
- `src/components/__tests__/ProductCard.test.tsx`
- `src/components/__tests__/CartItem.test.tsx`
- `src/components/__tests__/FilterBar.test.tsx`
- `src/pages/__tests__/CartPage.test.tsx`

## Git Commits

1. `chore(shop): scaffold sellary-shop Vite+React+TS package`
2. `feat(shop): formatPrice utility`
3. `feat(shop): pure cart module with localStorage persistence`
4. `feat(shop): Telegram initData parser + dev fallback`
5. `feat(shop): shopFetch wrapper with Telegram initData header`
6. `feat(shop): ProductCard component`
7. `feat(shop): CartItem component`
8. `feat(shop): FilterBar component`
9. `feat(shop): CatalogPage, ProductDetailPage, CartPage + App routing`
10. `test(shop): CartPage tests`

---

## Fix pass (review findings)

Commit: `759d39c` — `fix(shop): coerce sell_price, add dev proxy + env example, gate initData fallback to dev, use Link nav`

### Fix 1 — sell_price coercion (Critical)
Added `normalizeProduct` and `normalizeCatalogPage` helpers to `src/lib/api.ts`. Called at fetch boundaries in `CatalogPage.tsx` (catalog list) and `ProductDetailPage.tsx` (single product). New tests in `api.test.ts` assert string `"12000.00"` → number `12000`, and all catalog page items are coerced.

### Fix 2 — Dev proxy + .env.example (Important)
Added `server.proxy: { '/api': { target: 'http://localhost:8001', changeOrigin: true } }` to `vite.config.ts`. Created `sellary-shop/.env.example` documenting `VITE_API_BASE_URL` (leave blank in dev to use proxy). `shopFetch`'s existing `VITE_API_BASE_URL ?? ''` behavior is unchanged.

### Fix 3 — initData dev-gate (Important)
`getInitDataString()` now returns `DEV_INIT_DATA` only when `import.meta.env.DEV` is true; returns `''` otherwise. Tests use `vi.stubEnv` + `vi.resetModules()` + dynamic import to verify both branches. Note: vitest re-evaluates the module after `resetModules()` so the env stub is picked up correctly.

### Fix 4 — SPA navigation (Important)
Replaced all `<a href="...">` navigation in `CatalogPage.tsx`, `CartPage.tsx`, and `ProductDetailPage.tsx` with `<Link to="...">` from react-router-dom. Russian labels preserved. Existing CartPage tests updated to wrap renders in `<MemoryRouter>` (required by Link).

### Fix 5 — Cheap hardening (Minor)
- Added corrupt-localStorage recovery test: `storage.setItem('sellary_shop_cart', 'not-json')` → `getItems()` returns `[]`.
- Deleted `src/test/smoke.test.ts` (the pointless `1+1===2` test).

### Test + Build results
- `npx vitest run`: **8 test files, 43 tests, all passed**
- `npm run build` (tsc + vite): **clean, zero errors** — 241KB JS bundle
