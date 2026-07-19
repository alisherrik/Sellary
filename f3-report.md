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
