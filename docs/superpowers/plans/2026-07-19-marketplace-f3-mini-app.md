# F3 Marketplace Mini App — Implementation Plan

> Synthesized from spec at runtime on 2026-07-19.

This plan covers the `sellary-shop/` Vite+React+TS package: the Telegram Mini App shopper storefront.

## Tasks completed (TDD)
1. Scaffold package (package.json, vite/vitest/ts configs, index.html)
2. `lib/format.ts` — formatPrice utility
3. `lib/cart.ts` — pure cart module with localStorage persistence
4. `telegram/initData.ts` — Telegram initData parser + dev fallback
5. `lib/api.ts` — shopFetch wrapper with Telegram initData header
6. `src/types.ts` — shared type definitions
7. `components/ProductCard.tsx` — product card with add-to-cart
8. `components/CartItem.tsx` — cart item with quantity controls
9. `components/FilterBar.tsx` — search + shop/category filters
10. Pages: CatalogPage, ProductDetailPage, CartPage + App routing + main.tsx
11. CartPage tests
12. Full suite + build verification
