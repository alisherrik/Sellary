# POS Kassa UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Rebuild the Tauri cashier POS screen (`POSPage`) into a two-pane, local-first register that matches/exceeds the web POS, driven entirely by local SQLite via `insertSale` and surfacing sync state from `sync-store`.

**Architecture:** Framework-agnostic pricing/stock/unit helpers are copied verbatim from `sellary-frontend` (retyped to `LocalProduct`/`LocalProductUnit`) so money math never drifts. A small single-cart Zustand store (`cart-store.ts`) holds the one active cart. `POSPage` composes five presentational components (`SearchBar`, `CategoryChips`, `ProductGrid`, `CartPanel`, `PaymentModal`) and performs **optimistic completion**: build payload → `insertSale` (atomic local write + base-unit stock decrement) → clear cart → toast → refocus → fire-and-forget `requestSync('post-sale')`. Multi-UOM code paths are present but dormant (`hasMultipleUnits` returns false while local `product_units` is empty).

**Tech Stack:** Tauri 2 + React 19 + TypeScript + Vite + Tailwind v4 + Zustand 5 + Heroicons + react-hot-toast + @fontsource/inter; vitest + @testing-library/react for tests.

**Depends on:** **data-model plan** (`insertSale`, `NewSaleInput`, `LocalProduct`, `LocalCategory`, `getProducts`/`getCategories`/`getProductByBarcode` in `src/lib/db.ts` — the **canonical** `NewSaleInput`/`sale_items` field names live there; this plan constructs exactly those) MUST merge first. **sync-engine plan** (`sync-store.ts` exposing `useSyncStore` incl. `catalogRefreshedAt`, and `requestSync(reason, opts?)` in `sync-engine.ts`) MUST merge first. **offline-auth plan** owns `src/App.tsx` — it mounts the global `<Toaster/>` and registers the `/login`, `/cashier`, `/pin-setup`, `/pin-unlock`, `/history`, `/settings` routes; this plan **MUST NOT edit `App.tsx`** (its `toast(...)` calls and the `/history` nav link rely on that already-merged version).

> **Pinned merge order (INDEX):** `data-model → backend → offline-auth → sync-engine → pos-ui → history-ui`. This plan (**pos-ui**) merges **after sync-engine**. See the authoritative cross-plan contract: [`2026-07-10-cashier-local-first-INDEX.md`](2026-07-10-cashier-local-first-INDEX.md).

---

## File Structure

Files created/modified (all under `sellary-cashier/`):

**Create**
- `src/lib/format.ts` — `formatCurrency` (UZS, `ru-RU`) for the cashier. **pos-ui is the SOLE owner**; history-ui imports `formatCurrency` from it (identical signature).
- `src/lib/posStock.ts` — verbatim copy of web stock helpers (`remainingStock`/`nextAddQuantity`/`canAdd`/`isOverStock`).
- `src/lib/posPricing.ts` — verbatim copy of web pricing helpers (cash/discount/tax math).
- `src/lib/posUnits.ts` — multi-UOM helpers retyped to local types; dormant in Phase 1.
- `src/lib/cart-store.ts` — single-cart Zustand store + `CartLine` type.
- `src/lib/pos-grid.ts` — stock-badge tone/label + `willOversell` helper.
- `src/lib/pos-payload.ts` — builds `NewSaleInput` from the cart (the sale math).
- `src/lib/logout-guard.ts` — `evaluateLogout` decision (block / confirm / proceed).
- `src/pages/pos/SearchBar.tsx` — product search + barcode form.
- `src/pages/pos/CategoryChips.tsx` — category filter chips.
- `src/pages/pos/ProductGrid.tsx` — `rounded-3xl h-36` tiles + stock badges + skeleton/empty states.
- `src/pages/pos/CartPanel.tsx` — cart line edits + totals + pay bar.
- `src/pages/pos/PaymentModal.tsx` — cash/card+cardtype/mobile; credit disabled ("internet kerak").
- `src/lib/__tests__/format.test.ts`, `posStock.test.ts`, `posPricing.test.ts`, `posUnits.test.ts`, `cart-store.test.ts`, `pos-grid.test.ts`, `pos-payload.test.ts`, `logout-guard.test.ts` — unit tests.
- `src/pages/pos/__tests__/ProductGrid.test.tsx`, `PaymentModal.test.tsx` — RTL prop-driven tests.

**Modify**
- `package.json` — add `@fontsource/inter`, `@heroicons/react`, `react-hot-toast` (pos-ui installs these once; history-ui assumes they exist).
- `src/index.css` — Inter font import, Tailwind v4 `@custom-variant dark`, base font family.
- `src/pages/POSPage.tsx` — full rebuild composing the components above.

> **Not touched here:** `src/App.tsx` is owned by the offline-auth plan (it mounts `<Toaster/>` and registers all routes, including `/history`). This plan does **not** edit it.

---

## Task 1: Dependencies, fonts, dark variant

**Files:**
- Modify: `sellary-cashier/package.json:18-29` (dependencies)
- Modify: `sellary-cashier/src/index.css:1`

> **`src/App.tsx` is NOT edited here.** The offline-auth plan owns `App.tsx` and mounts the single global `<Toaster/>` there (and registers the `/history` route). This plan merges after offline-auth, so `toast(...)` calls made by `POSPage` already have a live `<Toaster/>`. Do not add one here.

- [ ] Add the three runtime deps. Run from `sellary-cashier/`:
  ```
  npm install @fontsource/inter@^5 @heroicons/react@^2 react-hot-toast@^2
  ```
  This edits `package.json` + `package-lock.json`. Verify the `dependencies` block now contains `@fontsource/inter`, `@heroicons/react`, `react-hot-toast`.
- [ ] Replace `src/index.css` (currently just `@import "tailwindcss";`) with the font import, the Tailwind v4 class-based dark variant, and Inter as the base UI font:
  ```css
  @import "tailwindcss";
  @import "@fontsource/inter/400.css";
  @import "@fontsource/inter/500.css";
  @import "@fontsource/inter/700.css";
  @import "@fontsource/inter/800.css";

  /* Tailwind v4: enable class-strategy dark: variants (.dark on <html>). */
  @custom-variant dark (&:where(.dark, .dark *));

  :root {
    font-family: "Inter", ui-sans-serif, system-ui, sans-serif;
  }
  ```
- [ ] Do **not** touch `src/App.tsx`. The global `<Toaster/>` and every route (incl. `/history`) are added by the offline-auth plan, which merges before this one (see the pinned merge order). `POSPage`'s `toast(...)` calls render against that Toaster.
- [ ] Run the existing suite to confirm no regressions. From `sellary-cashier/`:
  ```
  npm test
  ```
  Expect the pre-existing `sync-service.test.ts` suite to still pass (green). This task adds no tests of its own.
- [ ] Commit:
  ```
  git add sellary-cashier/package.json sellary-cashier/package-lock.json sellary-cashier/src/index.css
  git commit -m "chore(cashier): add POS UI deps, Inter font, dark variant"
  ```

---

## Task 2: `format.ts` (UZS, ru-RU)

**Files:**
- Create: `sellary-cashier/src/lib/format.ts`
- Test: `sellary-cashier/src/lib/__tests__/format.test.ts`

- [ ] Write the failing test `src/lib/__tests__/format.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { formatCurrency } from '../format';

  describe('formatCurrency', () => {
    it('formats a number as UZS with grouping', () => {
      const out = formatCurrency(1000);
      expect(out).toMatch(/1\D*000/);
      expect(out).toContain('UZS');
    });

    it('parses a numeric string', () => {
      expect(formatCurrency('2500')).toMatch(/2\D*500/);
    });

    it('falls back to 0 for non-numeric input', () => {
      expect(formatCurrency('abc')).toMatch(/0/);
    });
  });
  ```
- [ ] Run it and see it FAIL. From `sellary-cashier/`:
  ```
  npx vitest run src/lib/__tests__/format.test.ts
  ```
  Expected failure: `Failed to resolve import "../format"` (module does not exist yet).
- [ ] Create `src/lib/format.ts`:
  ```ts
  /** Cashier currency formatter — UZS, ru-RU grouping, no fractional soum. */
  export function formatCurrency(amount: number | string): string {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    const value = Number.isFinite(num) ? num : 0;
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'UZS',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  }
  ```
- [ ] Run and see PASS:
  ```
  npx vitest run src/lib/__tests__/format.test.ts
  ```
- [ ] Commit:
  ```
  git add sellary-cashier/src/lib/format.ts sellary-cashier/src/lib/__tests__/format.test.ts
  git commit -m "feat(cashier): add UZS formatCurrency helper"
  ```

---

## Task 3: Copy `posStock.ts` verbatim + parity test

**Files:**
- Create: `sellary-cashier/src/lib/posStock.ts`
- Test: `sellary-cashier/src/lib/__tests__/posStock.test.ts`

- [ ] Write the failing golden test `src/lib/__tests__/posStock.test.ts` (over-stock parity, part of §14 cashier test 8):
  ```ts
  import { describe, it, expect } from 'vitest';
  import { remainingStock, nextAddQuantity, canAdd, isOverStock } from '../posStock';

  describe('posStock parity', () => {
    it('remainingStock never goes below zero', () => {
      expect(remainingStock(5, 2)).toBe(3);
      expect(remainingStock(5, 9)).toBe(0);
      expect(remainingStock('10', 4)).toBe(6);
    });

    it('nextAddQuantity caps at one base unit or the remainder', () => {
      expect(nextAddQuantity(5, 0)).toBe(1);
      expect(nextAddQuantity(0.4, 0)).toBeCloseTo(0.4, 9);
      expect(nextAddQuantity(5, 5)).toBe(0);
    });

    it('canAdd respects the epsilon boundary', () => {
      expect(canAdd(5, 4, 1)).toBe(true);
      expect(canAdd(5, 5, 1)).toBe(false);
    });

    it('isOverStock detects a cart beyond available stock', () => {
      expect(isOverStock(5, 6)).toBe(true);
      expect(isOverStock(5, 5)).toBe(false);
    });
  });
  ```
- [ ] Run and see it FAIL:
  ```
  npx vitest run src/lib/__tests__/posStock.test.ts
  ```
  Expected failure: `Failed to resolve import "../posStock"`.
- [ ] Create `src/lib/posStock.ts` — **verbatim copy** of `sellary-frontend/src/lib/posStock.ts` (framework-agnostic, no retype needed):
  ```ts
  /**
   * POS stock helpers — the single source of truth for "how much can still be sold".
   *
   * All quantities here are in the product's BASE unit (the unit `stock_quantity`
   * is denominated in). The multi-UOM work converts a chosen unit to base units
   * before calling these, so the rules stay in one place.
   */

  // Guards against float dust (e.g. 0.1 + 0.2) when comparing decimal quantities.
  const EPSILON = 1e-9;

  /** Base units of a product still available, given how many are already in the cart. */
  export function remainingStock(stockQuantity: number | string, qtyInCart: number): number {
    return Math.max(0, Number(stockQuantity) - qtyInCart);
  }

  /** Quantity added by a catalog tile: one base unit, or the smaller positive remainder. */
  export function nextAddQuantity(
    stockQuantity: number | string,
    qtyInCart: number,
  ): number {
    const remaining = remainingStock(stockQuantity, qtyInCart);
    return remaining > EPSILON ? Math.min(1, remaining) : 0;
  }

  /** Can `addQty` more base units be added without exceeding available stock? */
  export function canAdd(
    stockQuantity: number | string,
    qtyInCart: number,
    addQty = 1,
  ): boolean {
    return qtyInCart + addQty <= Number(stockQuantity) + EPSILON;
  }

  /** Is a cart quantity already beyond what the stock can cover? */
  export function isOverStock(stockQuantity: number | string, qty: number): boolean {
    return qty > Number(stockQuantity) + EPSILON;
  }
  ```
- [ ] Run and see PASS:
  ```
  npx vitest run src/lib/__tests__/posStock.test.ts
  ```
- [ ] Commit:
  ```
  git add sellary-cashier/src/lib/posStock.ts sellary-cashier/src/lib/__tests__/posStock.test.ts
  git commit -m "feat(cashier): copy posStock helpers verbatim with parity test"
  ```

---

## Task 4: Copy `posPricing.ts` verbatim + golden pricing test

**Files:**
- Create: `sellary-cashier/src/lib/posPricing.ts`
- Test: `sellary-cashier/src/lib/__tests__/posPricing.test.ts`

- [ ] Write the failing golden test `src/lib/__tests__/posPricing.test.ts` (change + discount + tax parity, §14 cashier test 8):
  ```ts
  import { describe, it, expect } from 'vitest';
  import {
    calculateCashPayment,
    calculateDiscountFromEditedPrice,
    calculatePosPricing,
    formatEditableAmount,
    parseEditableAmount,
  } from '../posPricing';

  describe('posPricing golden cases', () => {
    it('computes cash change for sufficient payment', () => {
      const r = calculateCashPayment('12000', 10000);
      expect(r.isSufficient).toBe(true);
      expect(r.change).toBe(2000);
      expect(r.shortfall).toBe(0);
    });

    it('reports a shortfall when cash is insufficient', () => {
      const r = calculateCashPayment('8000', 10000);
      expect(r.isSufficient).toBe(false);
      expect(r.shortfall).toBe(2000);
      expect(r.change).toBe(0);
    });

    it('derives a per-unit discount from an edited price', () => {
      expect(calculateDiscountFromEditedPrice('9000', 10000)).toBe(1000);
      expect(calculateDiscountFromEditedPrice('-5', 10000)).toBe(0);
    });

    it('applies discounts and tax to the final total', () => {
      const r = calculatePosPricing({ subtotal: 10000, tax: 1200, itemDiscounts: 1000, overallDiscount: 0 });
      expect(r.totalBeforeDiscount).toBe(11200);
      expect(r.totalDiscount).toBe(1000);
      expect(r.finalTotal).toBe(10200);
    });

    it('round-trips editable amounts', () => {
      expect(formatEditableAmount(1234)).toBe('1234');
      expect(parseEditableAmount('1 234'.replace(' ', ''))).toBe(1234);
      expect(parseEditableAmount('')).toBeNull();
    });
  });
  ```
- [ ] Run and see it FAIL:
  ```
  npx vitest run src/lib/__tests__/posPricing.test.ts
  ```
  Expected failure: `Failed to resolve import "../posPricing"`.
- [ ] Create `src/lib/posPricing.ts` — **verbatim copy** of `sellary-frontend/src/lib/posPricing.ts`:
  ```ts
  const roundMoney = (value: number) => Math.round(value * 100) / 100;

  export function formatEditableAmount(value: number): string {
    if (!Number.isFinite(value)) {
      return '';
    }

    return Number.isInteger(value) ? String(value) : String(roundMoney(value));
  }

  export function parseEditableAmount(value: string): number | null {
    const normalized = value.trim().replace(',', '.');
    if (normalized === '') {
      return null;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  export function calculateCashPayment(value: string, total: number) {
    const parsedReceived = parseEditableAmount(value);
    const roundedTotal = roundMoney(Math.max(0, total));

    if (parsedReceived === null || parsedReceived < 0) {
      return {
        received: null,
        change: 0,
        shortfall: roundedTotal,
        isSufficient: false,
      };
    }

    const received = roundMoney(parsedReceived);
    const difference = roundMoney(received - roundedTotal);

    return {
      received,
      change: difference > 0 ? difference : 0,
      shortfall: difference < 0 ? Math.abs(difference) : 0,
      isSufficient: difference >= 0,
    };
  }

  export function calculateCreditInitialPayment(value: string, total: number) {
    const parsed = parseEditableAmount(value);
    const roundedTotal = roundMoney(Math.max(0, total));
    const amount = parsed === null ? 0 : roundMoney(Math.max(0, parsed));
    const exceedsTotal = amount > roundedTotal;

    return {
      amount,
      remaining: roundMoney(Math.max(0, roundedTotal - amount)),
      exceedsTotal,
      isValid: !exceedsTotal,
    };
  }

  export function calculateDiscountFromEditedPrice(value: string, originalPrice: number): number {
    const editedPrice = parseEditableAmount(value);
    if (editedPrice === null || editedPrice < 0) {
      return 0;
    }

    return roundMoney(originalPrice - editedPrice);
  }

  export function calculatePosPricing({
    subtotal,
    tax,
    itemDiscounts,
    overallDiscount,
  }: {
    subtotal: number;
    tax: number;
    itemDiscounts: number;
    overallDiscount: number;
  }) {
    const totalBeforeDiscount = roundMoney(subtotal + tax);
    const totalDiscount = roundMoney(itemDiscounts + overallDiscount);
    const finalTotal = roundMoney(Math.max(0, totalBeforeDiscount - totalDiscount));

    return {
      totalBeforeDiscount,
      totalDiscount,
      finalTotal,
    };
  }
  ```
- [ ] Run and see PASS:
  ```
  npx vitest run src/lib/__tests__/posPricing.test.ts
  ```
- [ ] Commit:
  ```
  git add sellary-cashier/src/lib/posPricing.ts sellary-cashier/src/lib/__tests__/posPricing.test.ts
  git commit -m "feat(cashier): copy posPricing helpers verbatim with golden tests"
  ```

---

## Task 5: `posUnits.ts` retyped (dormant multi-UOM)

**Files:**
- Create: `sellary-cashier/src/lib/posUnits.ts`
- Test: `sellary-cashier/src/lib/__tests__/posUnits.test.ts`

The web `posUnits.ts` imports `CartUnit`/`Product`/`ProductUnit` from Next-coupled `./types`. Retype to local, structural types so `LocalProduct` (from `db.ts`) satisfies the param without carrying a `units` field — keeping the picker dormant (§7.5).

- [ ] Write the failing test `src/lib/__tests__/posUnits.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { baseUnit, saleUnits, hasMultipleUnits, cartLineKey, toCartUnit } from '../posUnits';

  const product = { uom: 'шт', sell_price: 5000 };

  describe('posUnits (dormant multi-UOM)', () => {
    it('baseUnit maps a product to its base cart unit', () => {
      expect(baseUnit(product)).toEqual({ id: null, label: 'шт', factor: 1, price: 5000 });
    });

    it('hasMultipleUnits is false when no product_units exist (Phase 1)', () => {
      expect(hasMultipleUnits(product)).toBe(false);
      expect(saleUnits(product)).toHaveLength(1);
    });

    it('lights up when active units are present', () => {
      const withUnits = {
        ...product,
        units: [{ id: 7, name: 'ящик', factor: 12, sell_price: 55000, is_active: true, sort_order: 0 }],
      };
      expect(hasMultipleUnits(withUnits)).toBe(true);
      expect(saleUnits(withUnits)).toHaveLength(2);
      expect(toCartUnit(withUnits.units[0])).toEqual({ id: 7, label: 'ящик', factor: 12, price: 55000 });
    });

    it('cartLineKey is stable per product+unit', () => {
      expect(cartLineKey(3, null)).toBe('3:base');
      expect(cartLineKey(3, 7)).toBe('3:7');
    });
  });
  ```
- [ ] Run and see it FAIL:
  ```
  npx vitest run src/lib/__tests__/posUnits.test.ts
  ```
  Expected failure: `Failed to resolve import "../posUnits"`.
- [ ] Create `src/lib/posUnits.ts`:
  ```ts
  /**
   * Multi-UOM helpers for the cashier POS — retyped copy of the web helpers.
   * Phase 1: dormant. Local `product_units` is empty, LocalProduct carries no
   * `units`, so hasMultipleUnits() returns false and the register runs
   * base-unit-only. Lights up automatically once units are populated (Phase 2).
   */

  export interface LocalProductUnit {
    id: number;
    name: string;
    factor: number;
    sell_price: number | null;
    barcode?: string | null;
    is_active: boolean;
    sort_order: number;
  }

  export interface LocalCartUnit {
    id: number | null;
    label: string;
    factor: number;
    price: number;
  }

  // Structural product shape the helpers need. LocalProduct (db.ts) satisfies this;
  // `units` is optional and absent in Phase 1.
  export interface UnitBearingProduct {
    uom: string;
    sell_price: number;
    units?: LocalProductUnit[];
  }

  export function baseUnit(product: UnitBearingProduct): LocalCartUnit {
    return { id: null, label: product.uom, factor: 1, price: Number(product.sell_price) };
  }

  export function toCartUnit(unit: LocalProductUnit): LocalCartUnit {
    return {
      id: unit.id,
      label: unit.name,
      factor: Number(unit.factor),
      price: Number(unit.sell_price),
    };
  }

  /** All sellable units for a product: base unit first, then active extras. */
  export function saleUnits(product: UnitBearingProduct): LocalCartUnit[] {
    const extras = (product.units ?? [])
      .filter((unit) => unit.is_active !== false)
      .map(toCartUnit);
    return [baseUnit(product), ...extras];
  }

  /** Whether a product offers more than just its base unit. */
  export function hasMultipleUnits(product: UnitBearingProduct): boolean {
    return (product.units ?? []).some((unit) => unit.is_active !== false);
  }

  /** Stable identity for a cart line (product + chosen unit). */
  export function cartLineKey(productId: number, unitId: number | null): string {
    return `${productId}:${unitId ?? 'base'}`;
  }
  ```
- [ ] Run and see PASS:
  ```
  npx vitest run src/lib/__tests__/posUnits.test.ts
  ```
- [ ] Commit:
  ```
  git add sellary-cashier/src/lib/posUnits.ts sellary-cashier/src/lib/__tests__/posUnits.test.ts
  git commit -m "feat(cashier): add retyped posUnits helpers (dormant multi-UOM)"
  ```

---

## Task 6: `cart-store.ts` single-cart Zustand

**Files:**
- Create: `sellary-cashier/src/lib/cart-store.ts`
- Test: `sellary-cashier/src/lib/__tests__/cart-store.test.ts`

Single cart (no sessions, no persistence — a cart is transient until `insertSale`). Consumes `LocalProduct` from `db.ts` (data-model plan).

- [ ] Write the failing test `src/lib/__tests__/cart-store.test.ts`:
  ```ts
  import { describe, it, expect, beforeEach } from 'vitest';
  import { useCartStore } from '../cart-store';
  import { cartLineKey } from '../posUnits';
  import type { LocalProduct } from '../db';

  const make = (over: Partial<LocalProduct> = {}): LocalProduct => ({
    id: 1, barcode: null, name: 'A', uom: 'шт', category_id: null,
    sell_price: 1000, tax_percent: 0, stock_quantity: 10, is_active: true,
    updated_at: '2026-01-01', ...over,
  });

  beforeEach(() => useCartStore.setState({ items: [] }));

  describe('cart-store', () => {
    it('adds a new line and merges repeat adds of the same product+unit', () => {
      const p = make();
      useCartStore.getState().addItem(p);
      useCartStore.getState().addItem(p, undefined, 2);
      const { items } = useCartStore.getState();
      expect(items).toHaveLength(1);
      expect(items[0].quantity).toBe(3);
    });

    it('updates quantity and removes by line key', () => {
      const p = make();
      const s = useCartStore.getState();
      s.addItem(p);
      const key = cartLineKey(p.id, null);
      s.updateQuantity(key, 5);
      expect(useCartStore.getState().items[0].quantity).toBe(5);
      s.removeItem(key);
      expect(useCartStore.getState().items).toHaveLength(0);
    });

    it('setDiscount stores a per-unit discount on the line', () => {
      const p = make();
      const s = useCartStore.getState();
      s.addItem(p);
      s.setDiscount(cartLineKey(p.id, null), 250);
      expect(useCartStore.getState().items[0].discount).toBe(250);
    });

    it('changeUnit merges onto an existing collision line and resets discount', () => {
      const p = make();
      const s = useCartStore.getState();
      s.addItem(p); // base line
      s.addItem(p, { id: 7, label: 'ящик', factor: 12, price: 11000 }, 1);
      const baseKey = cartLineKey(p.id, null);
      // move the box line onto the base line
      const boxKey = cartLineKey(p.id, 7);
      useCartStore.getState().changeUnit(boxKey, { id: null, label: 'шт', factor: 1, price: 1000 });
      const items = useCartStore.getState().items;
      expect(items).toHaveLength(1);
      expect(items[0].quantity).toBe(2);
      expect(items[0].discount).toBe(0);
      expect(baseKey).toBe('1:base');
    });

    it('getSubtotal and getTax sum line prices and per-product tax', () => {
      const s = useCartStore.getState();
      s.addItem(make({ id: 1, sell_price: 1000, tax_percent: 12 }), undefined, 2);
      s.addItem(make({ id: 2, sell_price: 500, tax_percent: 0 }), undefined, 1);
      expect(useCartStore.getState().getSubtotal()).toBe(2500);
      expect(useCartStore.getState().getTax()).toBeCloseTo(240, 9);
    });

    it('clearCart empties the cart', () => {
      const s = useCartStore.getState();
      s.addItem(make());
      s.clearCart();
      expect(useCartStore.getState().items).toHaveLength(0);
    });
  });
  ```
- [ ] Run and see it FAIL:
  ```
  npx vitest run src/lib/__tests__/cart-store.test.ts
  ```
  Expected failure: `Failed to resolve import "../cart-store"`.
- [ ] Create `src/lib/cart-store.ts`:
  ```ts
  import { create } from 'zustand';
  import type { LocalProduct } from './db';
  import { baseUnit, cartLineKey, type LocalCartUnit } from './posUnits';

  export interface CartLine {
    product: LocalProduct;
    unit: LocalCartUnit;
    quantity: number;
    discount: number; // per-unit amount subtracted from unit.price (0 = none)
  }

  interface CartState {
    items: CartLine[];
    addItem: (product: LocalProduct, unit?: LocalCartUnit, quantity?: number) => void;
    removeItem: (key: string) => void;
    updateQuantity: (key: string, quantity: number) => void;
    changeUnit: (key: string, unit: LocalCartUnit) => void;
    setDiscount: (key: string, discount: number) => void;
    clearCart: () => void;
    getSubtotal: () => number;
    getTax: () => number;
  }

  const keyOf = (line: CartLine) => cartLineKey(line.product.id, line.unit.id);
  const lineSubtotal = (line: CartLine) => line.unit.price * line.quantity;

  export const useCartStore = create<CartState>((set, get) => ({
    items: [],

    addItem: (product, unit, quantity = 1) =>
      set((state) => {
        const resolved = unit ?? baseUnit(product);
        const key = cartLineKey(product.id, resolved.id);
        const existing = state.items.find((line) => keyOf(line) === key);
        if (existing) {
          return {
            items: state.items.map((line) =>
              keyOf(line) === key ? { ...line, quantity: line.quantity + quantity } : line,
            ),
          };
        }
        return { items: [...state.items, { product, unit: resolved, quantity, discount: 0 }] };
      }),

    removeItem: (key) =>
      set((state) => ({ items: state.items.filter((line) => keyOf(line) !== key) })),

    updateQuantity: (key, quantity) =>
      set((state) => ({
        items: state.items.map((line) => (keyOf(line) === key ? { ...line, quantity } : line)),
      })),

    changeUnit: (key, unit) =>
      set((state) => {
        const target = state.items.find((line) => keyOf(line) === key);
        if (!target) return state;
        const newKey = cartLineKey(target.product.id, unit.id);
        const collision = state.items.find((line) => line !== target && keyOf(line) === newKey);
        if (collision) {
          // Merge quantities onto the existing line, drop the source.
          return {
            items: state.items
              .filter((line) => line !== target)
              .map((line) =>
                line === collision
                  ? { ...line, quantity: line.quantity + target.quantity }
                  : line,
              ),
          };
        }
        // Discount reset — it was relative to the previous unit's price.
        return {
          items: state.items.map((line) =>
            line === target ? { ...line, unit, discount: 0 } : line,
          ),
        };
      }),

    setDiscount: (key, discount) =>
      set((state) => ({
        items: state.items.map((line) => (keyOf(line) === key ? { ...line, discount } : line)),
      })),

    clearCart: () => set({ items: [] }),

    getSubtotal: () => get().items.reduce((sum, line) => sum + lineSubtotal(line), 0),

    getTax: () =>
      get().items.reduce(
        (sum, line) => sum + lineSubtotal(line) * (Number(line.product.tax_percent) / 100),
        0,
      ),
  }));
  ```
- [ ] Run and see PASS:
  ```
  npx vitest run src/lib/__tests__/cart-store.test.ts
  ```
- [ ] Commit:
  ```
  git add sellary-cashier/src/lib/cart-store.ts sellary-cashier/src/lib/__tests__/cart-store.test.ts
  git commit -m "feat(cashier): add single-cart Zustand store"
  ```

---

## Task 7: `pos-grid.ts` stock-badge helper

**Files:**
- Create: `sellary-cashier/src/lib/pos-grid.ts`
- Test: `sellary-cashier/src/lib/__tests__/pos-grid.test.ts`

Encodes §5.4/§9 grid coloring: `stock < 0` red (oversold), `left <= 0` amber, `left > 0` emerald. Overselling is tolerated, so tiles stay addable; the badge only signals state.

- [ ] Write the failing test `src/lib/__tests__/pos-grid.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { stockBadge, willOversell } from '../pos-grid';

  describe('stockBadge', () => {
    it('emerald with remaining count when stock is available', () => {
      expect(stockBadge(5, 'шт', 0)).toEqual({ tone: 'ok', label: '5 шт' });
      expect(stockBadge(5, 'шт', 2)).toEqual({ tone: 'ok', label: '3 шт' });
    });

    it('amber when nothing is left', () => {
      expect(stockBadge(0, 'шт', 0)).toEqual({ tone: 'empty', label: 'нет' });
      expect(stockBadge(5, 'шт', 5)).toEqual({ tone: 'empty', label: 'в корзине' });
    });

    it('red when stock is already negative (oversold)', () => {
      expect(stockBadge(-2, 'шт', 0)).toEqual({ tone: 'oversold', label: '-2 шт' });
    });
  });

  describe('willOversell', () => {
    it('true once the next unit drives resulting stock to/below zero', () => {
      expect(willOversell(1, 0)).toBe(true);
      expect(willOversell(2, 0)).toBe(false);
      expect(willOversell(3, 2)).toBe(true);
    });
  });
  ```
- [ ] Run and see it FAIL:
  ```
  npx vitest run src/lib/__tests__/pos-grid.test.ts
  ```
  Expected failure: `Failed to resolve import "../pos-grid"`.
- [ ] Create `src/lib/pos-grid.ts`:
  ```ts
  import { remainingStock } from './posStock';

  export type StockTone = 'ok' | 'empty' | 'oversold';

  export interface StockBadge {
    tone: StockTone;
    label: string;
  }

  /**
   * Grid tile stock badge (§5.4 / §9). Overselling is tolerated (an offline sale
   * is a historical fact), so tiles stay clickable; the badge only signals state.
   *   stock < 0  → red    "-N uom"      (перерасход)
   *   left  <= 0 → amber  "нет"/"в корзине"
   *   left  > 0  → emerald "N uom"
   */
  export function stockBadge(
    stockQuantity: number,
    uom: string,
    qtyInCart: number,
  ): StockBadge {
    if (stockQuantity < 0) {
      return { tone: 'oversold', label: `${stockQuantity} ${uom}` };
    }
    const left = remainingStock(stockQuantity, qtyInCart);
    if (left <= 0) {
      return { tone: 'empty', label: qtyInCart > 0 ? 'в корзине' : 'нет' };
    }
    return { tone: 'ok', label: `${left} ${uom}` };
  }

  /** True when adding one more base unit drives the resulting stock to/below zero. */
  export function willOversell(stockQuantity: number, qtyInCart: number): boolean {
    return stockQuantity - (qtyInCart + 1) <= 0;
  }
  ```
- [ ] Run and see PASS:
  ```
  npx vitest run src/lib/__tests__/pos-grid.test.ts
  ```
- [ ] Commit:
  ```
  git add sellary-cashier/src/lib/pos-grid.ts sellary-cashier/src/lib/__tests__/pos-grid.test.ts
  git commit -m "feat(cashier): add POS grid stock-badge helper"
  ```

---

## Task 8: `pos-payload.ts` — build `NewSaleInput` from the cart

**Files:**
- Create: `sellary-cashier/src/lib/pos-payload.ts`
- Test: `sellary-cashier/src/lib/__tests__/pos-payload.test.ts`

This is the sale math that feeds `insertSale`. Payment method/card type are written **canonical lowercase** (§7.4). Sale-level `subtotal`/`tax_amount`/`discount_amount` mirror the cart totals; `sale_items` carry base-unit snapshots (`quantity ×= factor`, `unit_price /= factor` — §7.5). Consumes `NewSaleInput` from `db.ts` (data-model plan) — see Interface Assumptions.

- [ ] Write the failing test `src/lib/__tests__/pos-payload.test.ts` (§14 cashier test 8: change/discount/tax parity, and canonical lowercase):
  ```ts
  import { describe, it, expect } from 'vitest';
  import { buildNewSaleInput, newSaleIds } from '../pos-payload';
  import type { CartLine } from '../cart-store';
  import type { LocalProduct } from '../db';

  const product = (over: Partial<LocalProduct> = {}): LocalProduct => ({
    id: 1, barcode: 'B1', name: 'Кола', uom: 'шт', category_id: null,
    sell_price: 5000, tax_percent: 12, stock_quantity: 100, is_active: true,
    updated_at: '2026-01-01', ...over,
  });
  const line = (over: Partial<CartLine> = {}): CartLine => ({
    product: product(),
    unit: { id: null, label: 'шт', factor: 1, price: 5000 },
    quantity: 2,
    discount: 0,
    ...over,
  });

  describe('buildNewSaleInput', () => {
    it('computes subtotal, tax, total, and cash change', () => {
      const input = buildNewSaleInput({
        items: [line()],
        paymentMethod: 'cash',
        cardType: null,
        cashReceived: '12000',
        cashier: { userId: 9, username: 'kassir' },
        nowIso: '2026-07-10T10:00:00.000Z',
        clientSaleId: 'cs-1',
        idempotencyKey: 'ik-1',
      });
      expect(input.subtotal).toBe(10000);
      expect(input.tax_amount).toBeCloseTo(1200, 9);
      expect(input.total_amount).toBe(11200);
      expect(input.paid_amount).toBe(12000);
      expect(input.change_amount).toBe(800);
      expect(input.payment_method).toBe('cash');
      expect(input.card_type).toBeNull();
      expect(input.cashier_user_id).toBe(9);
    });

    it('applies a per-unit discount to the sale total', () => {
      const input = buildNewSaleInput({
        items: [line({ discount: 500 })], // 500 off, summed once per web parity
        paymentMethod: 'card',
        cardType: 'alif',
        cashReceived: '',
        cashier: { userId: null, username: null },
        nowIso: '2026-07-10T10:00:00.000Z',
        clientSaleId: 'cs-2',
        idempotencyKey: 'ik-2',
      });
      expect(input.discount_amount).toBe(500);
      expect(input.total_amount).toBe(10700); // 10000 + 1200 - 500
      expect(input.payment_method).toBe('card');
      expect(input.card_type).toBe('alif');
      expect(input.change_amount).toBe(0);
    });

    it('snapshots base-unit item fields', () => {
      const input = buildNewSaleInput({
        items: [line({ unit: { id: 7, label: 'ящик', factor: 12, price: 60000 }, quantity: 1 })],
        paymentMethod: 'mobile',
        cardType: null,
        cashReceived: '',
        cashier: { userId: 1, username: 'k' },
        nowIso: '2026-07-10T10:00:00.000Z',
        clientSaleId: 'cs-3',
        idempotencyKey: 'ik-3',
      });
      const item = input.items[0];
      expect(item.product_id).toBe(1);
      expect(item.product_name).toBe('Кола');
      expect(item.barcode).toBe('B1');
      expect(item.uom).toBe('шт');
      expect(item.quantity).toBe(12);        // 1 box × factor 12 → base units
      expect(item.unit_price).toBe(5000);    // 60000 / 12 → per base unit
      expect(item.tax_percent).toBe(12);
      expect(item.line_subtotal).toBe(60000);
      expect(item.sort_order).toBe(0);
    });
  });

  describe('newSaleIds', () => {
    it('returns two distinct non-empty ids', () => {
      const { clientSaleId, idempotencyKey } = newSaleIds();
      expect(clientSaleId).toBeTruthy();
      expect(idempotencyKey).toBeTruthy();
      expect(clientSaleId).not.toBe(idempotencyKey);
    });
  });
  ```
- [ ] Run and see it FAIL:
  ```
  npx vitest run src/lib/__tests__/pos-payload.test.ts
  ```
  Expected failure: `Failed to resolve import "../pos-payload"`.
- [ ] Create `src/lib/pos-payload.ts`:
  ```ts
  import type { NewSaleInput } from './db';
  import { calculateCashPayment, calculatePosPricing } from './posPricing';
  import type { CartLine } from './cart-store';

  export interface SaleIdentity {
    userId: number | null;
    username: string | null;
  }

  export type CashierPaymentMethod = 'cash' | 'card' | 'mobile';
  export type CashierCardType = 'alif' | 'eskhata' | 'dc';

  const round2 = (v: number) => Math.round(v * 100) / 100;

  /** Fresh unique ids for a new sale (client_sale_id + idempotency_key). */
  export function newSaleIds(): { clientSaleId: string; idempotencyKey: string } {
    return {
      clientSaleId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
    };
  }

  /**
   * Build the local NewSaleInput from the cart. Money mirrors the cart totals
   * (calculatePosPricing); sale_items carry base-unit snapshots so the receipt is
   * drift-proof and the sync payload stays base-unit (§7.5). payment_method /
   * card_type are canonical lowercase (§7.4).
   */
  export function buildNewSaleInput(params: {
    items: CartLine[];
    paymentMethod: CashierPaymentMethod;
    cardType: CashierCardType | null;
    cashReceived: string;
    cashier: SaleIdentity;
    nowIso: string;
    clientSaleId: string;
    idempotencyKey: string;
  }): NewSaleInput {
    const {
      items, paymentMethod, cardType, cashReceived, cashier, nowIso, clientSaleId, idempotencyKey,
    } = params;

    const saleItems = items.map((line, index) => {
      const factor = line.unit.factor || 1;
      const baseQty = round2(line.quantity * factor);
      const baseUnitPrice = round2(line.unit.price / factor);
      const taxPercent = Number(line.product.tax_percent);
      const lineSubtotal = round2(baseUnitPrice * baseQty);
      const lineTotal = round2(lineSubtotal * (1 + taxPercent / 100));
      return {
        product_id: line.product.id,
        product_name: line.product.name,
        barcode: line.product.barcode,
        uom: line.product.uom,
        quantity: baseQty,
        unit_price: baseUnitPrice,
        tax_percent: taxPercent,
        line_subtotal: lineSubtotal,
        line_total: lineTotal,
        sort_order: index,
      };
    });

    const subtotal = round2(
      items.reduce((sum, line) => sum + line.unit.price * line.quantity, 0),
    );
    const taxAmount = round2(
      items.reduce(
        (sum, line) =>
          sum + line.unit.price * line.quantity * (Number(line.product.tax_percent) / 100),
        0,
      ),
    );
    const discountAmount = round2(
      items.reduce((sum, line) => sum + Math.max(0, line.discount || 0), 0),
    );
    const { finalTotal } = calculatePosPricing({
      subtotal,
      tax: taxAmount,
      itemDiscounts: discountAmount,
      overallDiscount: 0,
    });

    const cash = calculateCashPayment(cashReceived, finalTotal);
    const paidAmount = paymentMethod === 'cash' ? cash.received ?? finalTotal : finalTotal;
    const changeAmount = paymentMethod === 'cash' ? cash.change : 0;

    return {
      client_sale_id: clientSaleId,
      idempotency_key: idempotencyKey,
      created_at_client: nowIso,
      payment_method: paymentMethod,
      card_type: paymentMethod === 'card' ? cardType : null,
      subtotal,
      discount_amount: discountAmount,
      tax_amount: taxAmount,
      total_amount: finalTotal,
      paid_amount: paidAmount,
      change_amount: changeAmount,
      notes: null,
      cashier_user_id: cashier.userId,
      cashier_username: cashier.username,
      items: saleItems,
    };
  }
  ```
- [ ] Run and see PASS:
  ```
  npx vitest run src/lib/__tests__/pos-payload.test.ts
  ```
- [ ] Commit:
  ```
  git add sellary-cashier/src/lib/pos-payload.ts sellary-cashier/src/lib/__tests__/pos-payload.test.ts
  git commit -m "feat(cashier): build NewSaleInput payload from cart"
  ```

---

## Task 9: `logout-guard.ts` — logout gating decision

**Files:**
- Create: `sellary-cashier/src/lib/logout-guard.ts`
- Test: `sellary-cashier/src/lib/__tests__/logout-guard.test.ts`

Encodes §10 + §14 cashier test 5 (badge/gate math): hard-block on unsynced, confirm-only on permanent needs-attention, else proceed.

- [ ] Write the failing test `src/lib/__tests__/logout-guard.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { evaluateLogout } from '../logout-guard';

  describe('evaluateLogout', () => {
    it('hard-blocks while unsynced sales exist', () => {
      const d = evaluateLogout(3, 0);
      expect(d.action).toBe('blocked');
      if (d.action === 'blocked') expect(d.message).toContain('3');
    });

    it('blocks even when needs-attention is also present', () => {
      expect(evaluateLogout(1, 2).action).toBe('blocked');
    });

    it('asks for confirmation when only permanent failures remain', () => {
      const d = evaluateLogout(0, 2);
      expect(d.action).toBe('confirm');
      if (d.action === 'confirm') expect(d.message).toContain('2');
    });

    it('proceeds when nothing is outstanding', () => {
      expect(evaluateLogout(0, 0).action).toBe('proceed');
    });
  });
  ```
- [ ] Run and see it FAIL:
  ```
  npx vitest run src/lib/__tests__/logout-guard.test.ts
  ```
  Expected failure: `Failed to resolve import "../logout-guard"`.
- [ ] Create `src/lib/logout-guard.ts`:
  ```ts
  export type LogoutDecision =
    | { action: 'blocked'; message: string }
    | { action: 'confirm'; message: string }
    | { action: 'proceed' };

  /**
   * §10 logout gating.
   *  - any unsynced (pending + syncing + transient-failed) sale → hard block + syncNow.
   *  - only permanent needs-attention rows → confirm, allow proceed.
   *  - otherwise → proceed.
   */
  export function evaluateLogout(
    unsyncedCount: number,
    needsAttentionCount: number,
  ): LogoutDecision {
    if (unsyncedCount > 0) {
      return {
        action: 'blocked',
        message: `Есть ${unsyncedCount} неотправленных продаж. Дождитесь синхронизации.`,
      };
    }
    if (needsAttentionCount > 0) {
      return {
        action: 'confirm',
        message: `${needsAttentionCount} продаж не удалось отправить, они останутся на устройстве. Выйти?`,
      };
    }
    return { action: 'proceed' };
  }
  ```
- [ ] Run and see PASS:
  ```
  npx vitest run src/lib/__tests__/logout-guard.test.ts
  ```
- [ ] Commit:
  ```
  git add sellary-cashier/src/lib/logout-guard.ts sellary-cashier/src/lib/__tests__/logout-guard.test.ts
  git commit -m "feat(cashier): add logout gating decision helper"
  ```

---

## Task 10: `SearchBar` + `CategoryChips` components

**Files:**
- Create: `sellary-cashier/src/pages/pos/SearchBar.tsx`
- Create: `sellary-cashier/src/pages/pos/CategoryChips.tsx`

Pure presentational components (no store coupling). No dedicated vitest — verified by the type-check gate at the end of this task and exercised by `POSPage` (Task 14) + `ProductGrid`/`PaymentModal` RTL tests. Keyboard F2 focuses the barcode input (wired in Task 14; the ref is passed in here).

- [ ] Create `src/pages/pos/SearchBar.tsx`:
  ```tsx
  import type { FormEvent, RefObject } from 'react';
  import { MagnifyingGlassIcon, QrCodeIcon } from '@heroicons/react/24/outline';

  interface SearchBarProps {
    search: string;
    onSearch: (value: string) => void;
    barcode: string;
    onBarcode: (value: string) => void;
    onBarcodeSubmit: (e: FormEvent) => void;
    barcodeRef: RefObject<HTMLInputElement | null>;
  }

  export function SearchBar({
    search, onSearch, barcode, onBarcode, onBarcodeSubmit, barcodeRef,
  }: SearchBarProps) {
    return (
      <div className="mb-3 flex items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Поиск товара…"
            className="h-11 w-full rounded-2xl border border-gray-200 bg-white pl-10 pr-3 text-sm shadow-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
        </div>
        <form onSubmit={onBarcodeSubmit} className="relative w-52">
          <QrCodeIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
          <input
            ref={barcodeRef}
            type="text"
            value={barcode}
            onChange={(e) => onBarcode(e.target.value)}
            placeholder="Штрихкод (F2)"
            className="h-11 w-full rounded-2xl border border-gray-200 bg-white pl-10 pr-3 font-mono text-sm shadow-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
        </form>
      </div>
    );
  }
  ```
- [ ] Create `src/pages/pos/CategoryChips.tsx`:
  ```tsx
  import type { LocalCategory } from '../../lib/db';

  interface CategoryChipsProps {
    categories: LocalCategory[];
    selected: number | null;
    onSelect: (id: number | null) => void;
  }

  export function CategoryChips({ categories, selected, onSelect }: CategoryChipsProps) {
    return (
      <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto whitespace-nowrap px-1">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`h-9 shrink-0 rounded-xl px-4 text-[13px] font-bold transition-colors ${
            selected === null
              ? 'bg-gray-900 text-white dark:bg-gray-600'
              : 'border border-gray-200 bg-white text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
          }`}
        >
          Все
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => onSelect(cat.id === selected ? null : cat.id)}
            className={`h-9 shrink-0 rounded-xl px-4 text-[13px] font-bold transition-colors ${
              selected === cat.id
                ? 'bg-blue-600 text-white'
                : 'border border-gray-200 bg-white text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>
    );
  }
  ```
- [ ] Type-check gate (no test file for these). From `sellary-cashier/`:
  ```
  npx tsc --noEmit
  ```
  Expect no errors from the two new files (`LocalCategory` resolves from the data-model plan's `db.ts`).
- [ ] Commit:
  ```
  git add sellary-cashier/src/pages/pos/SearchBar.tsx sellary-cashier/src/pages/pos/CategoryChips.tsx
  git commit -m "feat(cashier): add SearchBar and CategoryChips components"
  ```

---

## Task 11: `ProductGrid` component + RTL test

**Files:**
- Create: `sellary-cashier/src/pages/pos/ProductGrid.tsx`
- Test: `sellary-cashier/src/pages/pos/__tests__/ProductGrid.test.tsx`

`rounded-3xl h-36` tiles + stock badges (§7.1); skeletons on first bootstrap; empty state (§7.6). Tiles remain clickable even at 0 stock (oversell tolerated). RTL test covers the three badge tones (§5.4).

- [ ] Write the failing test `src/pages/pos/__tests__/ProductGrid.test.tsx`:
  ```tsx
  import { describe, it, expect, vi } from 'vitest';
  import { render, screen, fireEvent } from '@testing-library/react';
  import { ProductGrid } from '../ProductGrid';
  import type { LocalProduct } from '../../../lib/db';

  const p = (over: Partial<LocalProduct> = {}): LocalProduct => ({
    id: 1, barcode: null, name: 'Кола', uom: 'шт', category_id: null,
    sell_price: 5000, tax_percent: 0, stock_quantity: 5, is_active: true,
    updated_at: '2026-01-01', ...over,
  });

  describe('ProductGrid', () => {
    it('renders skeletons while loading', () => {
      const { container } = render(
        <ProductGrid products={[]} loading cartBaseByProduct={new Map()} onAdd={() => {}} />,
      );
      expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    });

    it('renders an empty state', () => {
      render(<ProductGrid products={[]} loading={false} cartBaseByProduct={new Map()} onAdd={() => {}} />);
      expect(screen.getByText('Товары не найдены')).toBeInTheDocument();
    });

    it('shows emerald, amber, and red badges for the three stock states', () => {
      render(
        <ProductGrid
          loading={false}
          cartBaseByProduct={new Map()}
          onAdd={() => {}}
          products={[
            p({ id: 1, name: 'В наличии', stock_quantity: 5 }),
            p({ id: 2, name: 'Нет', stock_quantity: 0 }),
            p({ id: 3, name: 'Перерасход', stock_quantity: -2 }),
          ]}
        />,
      );
      expect(screen.getByText('5 шт').className).toContain('emerald');
      expect(screen.getByText('нет').className).toContain('amber');
      expect(screen.getByText('-2 шт').className).toContain('red');
    });

    it('calls onAdd when a tile is clicked (even at zero stock)', () => {
      const onAdd = vi.fn();
      render(
        <ProductGrid loading={false} cartBaseByProduct={new Map()} onAdd={onAdd}
          products={[p({ id: 2, name: 'Нет', stock_quantity: 0 })]} />,
      );
      fireEvent.click(screen.getByText('Нет'));
      expect(onAdd).toHaveBeenCalledTimes(1);
    });
  });
  ```
- [ ] Run and see it FAIL:
  ```
  npx vitest run src/pages/pos/__tests__/ProductGrid.test.tsx
  ```
  Expected failure: `Failed to resolve import "../ProductGrid"`.
- [ ] Create `src/pages/pos/ProductGrid.tsx`:
  ```tsx
  import type { LocalProduct } from '../../lib/db';
  import { formatCurrency } from '../../lib/format';
  import { stockBadge, type StockTone } from '../../lib/pos-grid';

  interface ProductGridProps {
    products: LocalProduct[];
    loading: boolean;
    cartBaseByProduct: Map<number, number>;
    onAdd: (product: LocalProduct) => void;
  }

  const toneClass: Record<StockTone, string> = {
    ok: 'bg-emerald-100 text-emerald-700',
    empty: 'bg-amber-100 text-amber-700',
    oversold: 'bg-red-100 text-red-700',
  };

  export function ProductGrid({ products, loading, cartBaseByProduct, onAdd }: ProductGridProps) {
    if (loading) {
      return (
        <div className="grid grid-cols-3 gap-2.5 xl:grid-cols-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="h-36 animate-pulse rounded-3xl border border-gray-100 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
            >
              <div className="mb-3 h-10 w-10 rounded-2xl bg-gray-200 dark:bg-gray-700" />
              <div className="mb-2 h-3 w-3/4 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-3 w-1/2 rounded bg-gray-200 dark:bg-gray-700" />
            </div>
          ))}
        </div>
      );
    }

    if (products.length === 0) {
      return <div className="py-16 text-center text-sm text-gray-400">Товары не найдены</div>;
    }

    return (
      <div className="grid grid-cols-3 gap-2.5 xl:grid-cols-4">
        {products.map((product) => {
          const badge = stockBadge(
            Number(product.stock_quantity),
            product.uom,
            cartBaseByProduct.get(product.id) ?? 0,
          );
          return (
            <button
              key={product.id}
              type="button"
              onClick={() => onAdd(product)}
              className="group relative flex h-36 flex-col overflow-hidden rounded-3xl border border-gray-100 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-lg active:scale-95 dark:border-gray-700 dark:bg-gray-800"
            >
              <span className={`absolute right-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-bold ${toneClass[badge.tone]}`}>
                {badge.label}
              </span>
              <div className="mb-auto grid h-10 w-10 place-items-center rounded-2xl bg-gray-100 text-base font-bold text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                {product.name.charAt(0).toUpperCase()}
              </div>
              <h3 className="line-clamp-2 text-[13px] font-bold leading-tight text-gray-900 dark:text-white">
                {product.name}
              </h3>
              <div className="mt-1 text-[16px] font-extrabold tabular-nums text-gray-900 dark:text-white">
                {formatCurrency(product.sell_price)}
              </div>
            </button>
          );
        })}
      </div>
    );
  }
  ```
- [ ] Run and see PASS:
  ```
  npx vitest run src/pages/pos/__tests__/ProductGrid.test.tsx
  ```
- [ ] Commit:
  ```
  git add sellary-cashier/src/pages/pos/ProductGrid.tsx sellary-cashier/src/pages/pos/__tests__/ProductGrid.test.tsx
  git commit -m "feat(cashier): add ProductGrid with stock badges and skeleton/empty states"
  ```

---

## Task 12: `CartPanel` component

**Files:**
- Create: `sellary-cashier/src/pages/pos/CartPanel.tsx`

Cart line edits (qty +/-, editable price → per-unit discount, remove), oversold inline amber strip (§9), totals + green pay bar (§7.1). Presentational; state lives in `POSPage`. Verified via type-check + Task 14 integration + manual gate.

- [ ] Create `src/pages/pos/CartPanel.tsx`:
  ```tsx
  import { ShoppingBagIcon, TrashIcon } from '@heroicons/react/24/outline';
  import type { CartLine } from '../../lib/cart-store';
  import { cartLineKey } from '../../lib/posUnits';
  import { formatCurrency } from '../../lib/format';
  import { calculateDiscountFromEditedPrice, formatEditableAmount } from '../../lib/posPricing';

  interface CartPanelProps {
    items: CartLine[];
    subtotal: number;
    tax: number;
    finalTotal: number;
    oversoldKeys: Set<string>;
    priceEdits: Record<string, string>;
    onPriceEditChange: (key: string, value: string) => void;
    onPriceEditCommit: (key: string, discount: number) => void;
    onQuantity: (key: string, quantity: number) => void;
    onRemove: (key: string) => void;
    onPay: () => void;
  }

  export function CartPanel({
    items, subtotal, tax, finalTotal, oversoldKeys,
    priceEdits, onPriceEditChange, onPriceEditCommit, onQuantity, onRemove, onPay,
  }: CartPanelProps) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 px-5 pb-2 pt-4">
          <h2 className="text-[18px] font-extrabold text-gray-900 dark:text-white">Чек</h2>
          <span className="ml-auto text-[13px] font-semibold text-gray-400">{items.length} позиций</span>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-2">
          {items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <ShoppingBagIcon className="mb-3 h-16 w-16 text-gray-200 dark:text-gray-600" />
              <p className="text-sm font-medium text-gray-500 dark:text-gray-300">Корзина пуста</p>
              <p className="text-xs text-gray-400">Нажмите на товар слева, чтобы добавить</p>
            </div>
          ) : (
            items.map((line) => {
              const key = cartLineKey(line.product.id, line.unit.id);
              const unitPrice = line.unit.price;
              const finalPrice = unitPrice - (line.discount || 0);
              const oversold = oversoldKeys.has(key);
              return (
                <div key={key} className="rounded-2xl bg-gray-50 p-3 dark:bg-gray-700/50">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-bold text-gray-900 dark:text-white">{line.product.name}</p>
                      <p className="text-[12px] text-gray-400">{formatCurrency(unitPrice)} / {line.unit.label}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        aria-label={`Меньше: ${line.product.name}`}
                        onClick={() => {
                          const next = line.quantity - 1;
                          if (next <= 0) onRemove(key);
                          else onQuantity(key, next);
                        }}
                        className="grid h-8 w-8 place-items-center rounded-xl bg-white text-lg font-bold text-gray-600 shadow-sm dark:bg-gray-800 dark:text-gray-200"
                      >
                        −
                      </button>
                      <span className="w-10 text-center text-sm font-extrabold text-gray-900 dark:text-white">
                        {line.quantity}
                      </span>
                      <button
                        type="button"
                        aria-label={`Больше: ${line.product.name}`}
                        onClick={() => onQuantity(key, line.quantity + 1)}
                        className="grid h-8 w-8 place-items-center rounded-xl bg-blue-600 text-lg font-bold text-white"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[11px] text-gray-400">Цена</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label={`Цена: ${line.product.name}`}
                      value={priceEdits[key] ?? formatEditableAmount(finalPrice)}
                      onChange={(e) => onPriceEditChange(key, e.target.value)}
                      onBlur={() => {
                        const raw = priceEdits[key];
                        if (raw !== undefined) {
                          onPriceEditCommit(key, calculateDiscountFromEditedPrice(raw, unitPrice));
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      }}
                      className="w-24 rounded-lg border border-gray-200 bg-white px-2 py-1 text-right text-[13px] font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                    />
                    <span className="ml-auto text-[14px] font-extrabold tabular-nums text-gray-900 dark:text-white">
                      {formatCurrency(finalPrice * line.quantity)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Удалить ${line.product.name}`}
                      onClick={() => onRemove(key)}
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-white hover:text-red-600 dark:hover:bg-gray-800"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                  {oversold && (
                    <div className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                      Товара не хватает на складе — продажа сохранится как перерасход.
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="border-t border-gray-100 p-4 dark:border-gray-700">
          <div className="mb-1 flex justify-between text-[13px] text-gray-500">
            <span>Подытог</span><span className="tabular-nums">{formatCurrency(subtotal)}</span>
          </div>
          <div className="mb-1 flex justify-between text-[13px] text-gray-500">
            <span>Налог</span><span className="tabular-nums">{formatCurrency(tax)}</span>
          </div>
          <div className="mb-3 flex items-end justify-between">
            <span className="font-bold text-gray-900 dark:text-white">Итого</span>
            <span className="text-[28px] font-extrabold leading-none tabular-nums text-gray-900 dark:text-white">
              {formatCurrency(finalTotal)}
            </span>
          </div>
          <button
            type="button"
            onClick={onPay}
            disabled={items.length === 0}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-[17px] font-extrabold text-white shadow-lg transition-all hover:brightness-105 active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#22c55e,#16a34a)' }}
          >
            Оплатить →
            <kbd className="rounded bg-white/20 px-1.5 py-0.5 text-[11px] font-semibold">Enter</kbd>
          </button>
        </div>
      </div>
    );
  }
  ```
- [ ] Type-check gate:
  ```
  npx tsc --noEmit
  ```
  Expect no errors.
- [ ] Commit:
  ```
  git add sellary-cashier/src/pages/pos/CartPanel.tsx
  git commit -m "feat(cashier): add CartPanel with line edits, oversold strip, totals"
  ```

---

## Task 13: `PaymentModal` component + RTL test

**Files:**
- Create: `sellary-cashier/src/pages/pos/PaymentModal.tsx`
- Test: `sellary-cashier/src/pages/pos/__tests__/PaymentModal.test.tsx`

cash / card+cardtype / mobile (§7.4). "В долг" rendered but disabled with an amber "internet kerak" hint. Cash shows change; confirm is gated (cash sufficient, card type chosen). RTL test covers the credit-disabled and confirm-gating states.

- [ ] Write the failing test `src/pages/pos/__tests__/PaymentModal.test.tsx`:
  ```tsx
  import { describe, it, expect, vi } from 'vitest';
  import { render, screen, fireEvent } from '@testing-library/react';
  import { PaymentModal } from '../PaymentModal';

  const base = {
    open: true,
    total: 10000,
    method: 'cash' as const,
    onMethod: () => {},
    cardType: null,
    onCardType: () => {},
    cashReceived: '',
    onCashReceived: () => {},
    loading: false,
    onConfirm: vi.fn(),
    onClose: () => {},
  };

  describe('PaymentModal', () => {
    it('renders nothing when closed', () => {
      const { container } = render(<PaymentModal {...base} open={false} />);
      expect(container.firstChild).toBeNull();
    });

    it('disables the В долг (credit) option with an internet hint', () => {
      render(<PaymentModal {...base} />);
      const credit = screen.getByText(/В долг/).closest('button')!;
      expect(credit).toBeDisabled();
      expect(credit.getAttribute('title')).toMatch(/интернет/i);
    });

    it('gates confirm until cash is sufficient', () => {
      const onConfirm = vi.fn();
      const { rerender } = render(<PaymentModal {...base} onConfirm={onConfirm} cashReceived="5000" />);
      const confirm = screen.getByText('Завершить продажу').closest('button')!;
      expect(confirm).toBeDisabled();
      rerender(<PaymentModal {...base} onConfirm={onConfirm} cashReceived="12000" />);
      fireEvent.click(screen.getByText('Завершить продажу'));
      expect(onConfirm).toHaveBeenCalled();
    });

    it('gates confirm on card until a card type is chosen', () => {
      const { rerender } = render(<PaymentModal {...base} method="card" cardType={null} />);
      expect(screen.getByText('Завершить продажу').closest('button')!).toBeDisabled();
      rerender(<PaymentModal {...base} method="card" cardType="alif" />);
      expect(screen.getByText('Завершить продажу').closest('button')!).not.toBeDisabled();
    });
  });
  ```
- [ ] Run and see it FAIL:
  ```
  npx vitest run src/pages/pos/__tests__/PaymentModal.test.tsx
  ```
  Expected failure: `Failed to resolve import "../PaymentModal"`.
- [ ] Create `src/pages/pos/PaymentModal.tsx`:
  ```tsx
  import {
    BanknotesIcon, CreditCardIcon, DevicePhoneMobileIcon, DocumentTextIcon,
  } from '@heroicons/react/24/outline';
  import { formatCurrency } from '../../lib/format';
  import { calculateCashPayment } from '../../lib/posPricing';
  import type { CashierCardType, CashierPaymentMethod } from '../../lib/pos-payload';

  const CARD_TYPES: { id: CashierCardType; label: string }[] = [
    { id: 'alif', label: 'Alif' },
    { id: 'eskhata', label: 'Eskhata' },
    { id: 'dc', label: 'DC' },
  ];

  const METHODS: { id: CashierPaymentMethod; label: string; Icon: typeof BanknotesIcon }[] = [
    { id: 'cash', label: 'Наличные', Icon: BanknotesIcon },
    { id: 'card', label: 'Карта', Icon: CreditCardIcon },
    { id: 'mobile', label: 'Мобильный', Icon: DevicePhoneMobileIcon },
  ];

  interface PaymentModalProps {
    open: boolean;
    total: number;
    method: CashierPaymentMethod;
    onMethod: (m: CashierPaymentMethod) => void;
    cardType: CashierCardType | null;
    onCardType: (c: CashierCardType) => void;
    cashReceived: string;
    onCashReceived: (v: string) => void;
    loading: boolean;
    onConfirm: () => void;
    onClose: () => void;
  }

  export function PaymentModal(props: PaymentModalProps) {
    const {
      open, total, method, onMethod, cardType, onCardType,
      cashReceived, onCashReceived, loading, onConfirm, onClose,
    } = props;
    if (!open) return null;

    const cash = calculateCashPayment(cashReceived, total);
    const canConfirm =
      !loading &&
      (method !== 'cash' || cash.isSufficient) &&
      (method !== 'card' || cardType !== null);

    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
        <div className="relative w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-gray-800">
          <div className="mb-4 flex items-end justify-between">
            <span className="font-bold text-gray-900 dark:text-white">К оплате</span>
            <span className="text-[28px] font-extrabold tabular-nums text-gray-900 dark:text-white">
              {formatCurrency(total)}
            </span>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2">
            {METHODS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => onMethod(id)}
                className={`flex items-center justify-center gap-2 rounded-2xl border py-3 text-sm font-bold ${
                  method === id
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-gray-200 bg-white text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
                }`}
              >
                <Icon className="h-5 w-5" /> {label}
              </button>
            ))}
            <button
              type="button"
              disabled
              title="Для продажи в долг нужен интернет"
              className="flex cursor-not-allowed items-center justify-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 py-3 text-sm font-bold text-amber-600 opacity-70 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400"
            >
              <DocumentTextIcon className="h-5 w-5" /> В долг · internet kerak
            </button>
          </div>

          {method === 'card' && (
            <div className="mb-3 grid grid-cols-3 gap-2">
              {CARD_TYPES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onCardType(c.id)}
                  className={`rounded-xl border py-2 text-sm font-semibold ${
                    cardType === c.id
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-gray-200 bg-white text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}

          {method === 'cash' && (
            <div className="mb-3">
              <input
                type="number"
                value={cashReceived}
                onChange={(e) => onCashReceived(e.target.value)}
                placeholder="Получено"
                className="mb-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
              {cash.received !== null && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Сдача</span>
                  <span className="font-bold text-green-600 tabular-nums">{formatCurrency(cash.change)}</span>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-12 flex-1 rounded-2xl border border-gray-200 font-bold text-gray-600 dark:border-gray-600 dark:text-gray-300"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={!canConfirm}
              className="h-12 flex-[2] rounded-2xl text-[16px] font-extrabold text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#22c55e,#16a34a)' }}
            >
              {loading ? 'Сохранение…' : 'Завершить продажу'}
            </button>
          </div>
        </div>
      </div>
    );
  }
  ```
- [ ] Run and see PASS:
  ```
  npx vitest run src/pages/pos/__tests__/PaymentModal.test.tsx
  ```
- [ ] Commit:
  ```
  git add sellary-cashier/src/pages/pos/PaymentModal.tsx sellary-cashier/src/pages/pos/__tests__/PaymentModal.test.tsx
  git commit -m "feat(cashier): add PaymentModal (cash/card/mobile, credit disabled)"
  ```

---

## Task 14: Rebuild `POSPage` (compose, optimistic completion, states, keyboard, guarded logout)

**Files:**
- Modify: `sellary-cashier/src/pages/POSPage.tsx` (full rewrite, currently lines 1-439)

Composes the components; owns state; subscribes to `sync-store`; performs optimistic completion (§7.3); renders offline strip / the `Не отправлено: N` unsynced badge / stale-catalog chip (§7.6, §9); adds an `История` nav link to the header (the `/history` route is registered by offline-auth's `App.tsx` — this page only links to it); F2/Enter/Esc keyboard (§7.6); guarded logout (§10). Consumes `insertSale` (data-model plan) and `useSyncStore` + `requestSync` (sync-engine plan) — see Interface Assumptions.

> **Stale-catalog chip source:** the chip reads `catalogRefreshedAt` from `sync-store`, which sync-engine's init loads from `meta('last_catalog_pull_at')` on startup. It therefore reflects the last real catalog pull even after a cold start following a week offline — `POSPage` does **not** trigger its own in-session pull to populate it.
>
> **Post-sale sync:** after `insertSale`, `POSPage` fires `requestSync('post-sale')` **without awaiting it** — the pay path never blocks on the network. No vitest here (heavy store/db integration) — verified by type-check + the manual desktop render gate; every decision it makes is already unit-tested via the extracted helpers (`pos-payload`, `pos-grid`, `logout-guard`, `cart-store`).

- [ ] Replace the entire contents of `src/pages/POSPage.tsx` with:
  ```tsx
  import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
  import { useNavigate } from 'react-router-dom';
  import toast from 'react-hot-toast';
  import {
    getProducts, getCategories, getProductByBarcode, insertSale,
  } from '../lib/db';
  import type { LocalProduct, LocalCategory } from '../lib/db';
  import { useAuthStore } from '../lib/auth-store';
  import { useSyncStore } from '../lib/sync-store';
  import { requestSync } from '../lib/sync-engine';
  import { useCartStore } from '../lib/cart-store';
  import { cartLineKey } from '../lib/posUnits';
  import { isOverStock } from '../lib/posStock';
  import { calculatePosPricing } from '../lib/posPricing';
  import { willOversell } from '../lib/pos-grid';
  import {
    buildNewSaleInput, newSaleIds, type CashierCardType, type CashierPaymentMethod,
  } from '../lib/pos-payload';
  import { evaluateLogout } from '../lib/logout-guard';
  import { SearchBar } from './pos/SearchBar';
  import { CategoryChips } from './pos/CategoryChips';
  import { ProductGrid } from './pos/ProductGrid';
  import { CartPanel } from './pos/CartPanel';
  import { PaymentModal } from './pos/PaymentModal';

  const STALE_CATALOG_DAYS = 3;

  export function POSPage() {
    const navigate = useNavigate();
    const { logout, username, companyName, userId } = useAuthStore();
    const {
      online, unsyncedCount, needsAttentionCount, catalogRefreshedAt, syncNow,
    } = useSyncStore();

    const {
      items, addItem, updateQuantity, removeItem, setDiscount, clearCart, getSubtotal, getTax,
    } = useCartStore();

    const [products, setProducts] = useState<LocalProduct[]>([]);
    const [categories, setCategories] = useState<LocalCategory[]>([]);
    const [loadingCatalog, setLoadingCatalog] = useState(true);
    const [search, setSearch] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
    const [barcode, setBarcode] = useState('');
    const [showPayment, setShowPayment] = useState(false);
    const [method, setMethod] = useState<CashierPaymentMethod>('cash');
    const [cardType, setCardType] = useState<CashierCardType | null>(null);
    const [cashReceived, setCashReceived] = useState('');
    const [loading, setLoading] = useState(false);
    const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});
    const [confirmLogout, setConfirmLogout] = useState<string | null>(null);
    const barcodeRef = useRef<HTMLInputElement>(null);

    const reloadProducts = useCallback(async () => {
      const list = await getProducts();
      setProducts(list);
    }, []);

    useEffect(() => {
      (async () => {
        try {
          const [p, c] = await Promise.all([getProducts(), getCategories()]);
          setProducts(p);
          setCategories(c);
        } finally {
          setLoadingCatalog(false);
        }
      })();
    }, []);

    // Base-unit demand per product across all cart lines (units share stock).
    const cartBaseByProduct = useMemo(() => {
      const map = new Map<number, number>();
      for (const line of items) {
        const base = line.quantity * (line.unit.factor ?? 1);
        map.set(line.product.id, (map.get(line.product.id) ?? 0) + base);
      }
      return map;
    }, [items]);

    const visibleProducts = useMemo(() => {
      const q = search.trim().toLowerCase();
      return products.filter((p) => {
        if (selectedCategory !== null && p.category_id !== selectedCategory) return false;
        if (q && !(p.name.toLowerCase().includes(q) || (p.barcode ?? '').toLowerCase().includes(q))) {
          return false;
        }
        return true;
      });
    }, [products, search, selectedCategory]);

    const subtotal = getSubtotal();
    const tax = getTax();
    const itemDiscounts = items.reduce((sum, line) => sum + Math.max(0, line.discount || 0), 0);
    const { finalTotal } = calculatePosPricing({ subtotal, tax, itemDiscounts, overallDiscount: 0 });

    const oversoldKeys = useMemo(() => {
      const set = new Set<string>();
      for (const line of items) {
        const base = cartBaseByProduct.get(line.product.id) ?? 0;
        if (isOverStock(Number(line.product.stock_quantity), base)) {
          set.add(cartLineKey(line.product.id, line.unit.id));
        }
      }
      return set;
    }, [items, cartBaseByProduct]);

    // `catalogRefreshedAt` comes from sync-store, which sync-engine's init hydrates
    // from meta('last_catalog_pull_at') — so this is accurate after a cold start too.
    const staleDays = useMemo(() => {
      if (!catalogRefreshedAt) return null;
      const days = Math.floor((Date.now() - new Date(catalogRefreshedAt).getTime()) / 86400000);
      return days > STALE_CATALOG_DAYS ? days : null;
    }, [catalogRefreshedAt]);

    const handleAdd = useCallback((product: LocalProduct) => {
      addItem(product, undefined, 1);
    }, [addItem]);

    const handleBarcodeSubmit = useCallback(async (e: React.FormEvent) => {
      e.preventDefault();
      const code = barcode.trim();
      if (!code) return;
      const product = await getProductByBarcode(code);
      if (product) {
        handleAdd(product);
        setBarcode('');
      } else {
        toast.error('Товар не найден');
      }
      barcodeRef.current?.focus();
    }, [barcode, handleAdd]);

    const onPriceEditChange = useCallback((key: string, value: string) => {
      setPriceEdits((prev) => ({ ...prev, [key]: value }));
    }, []);
    const onPriceEditCommit = useCallback((key: string, discount: number) => {
      setDiscount(key, discount);
      setPriceEdits((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }, [setDiscount]);

    const openPayment = useCallback(() => {
      if (items.length === 0) return;
      setCashReceived(String(Math.ceil(finalTotal)));
      setMethod('cash');
      setCardType(null);
      setShowPayment(true);
    }, [items.length, finalTotal]);

    // Optimistic completion (§7.3): all local & synchronous, then non-awaited sync.
    const handleComplete = useCallback(async () => {
      if (items.length === 0 || loading) return;
      setLoading(true);
      const { clientSaleId, idempotencyKey } = newSaleIds();
      const input = buildNewSaleInput({
        items,
        paymentMethod: method,
        cardType,
        cashReceived,
        cashier: { userId, username },
        nowIso: new Date().toISOString(),
        clientSaleId,
        idempotencyKey,
      });
      const oversold = oversoldKeys.size > 0;
      try {
        await insertSale(input);        // atomic local row + base-unit stock decrement
        clearCart();
        setShowPayment(false);
        setCashReceived('');
        setPriceEdits({});
        setLoading(false);
        toast.success('Продажа завершена');
        if (oversold) toast('Продажа с перерасходом склада', { icon: '⚠️' });
        barcodeRef.current?.focus();
        void reloadProducts();          // show decremented stock immediately
        void requestSync('post-sale');  // fire-and-forget — never awaited on the pay path
      } catch (err) {
        setLoading(false);
        toast.error('Не удалось сохранить продажу');
        console.error('insertSale failed', err);
      }
    }, [items, loading, method, cardType, cashReceived, userId, username, oversoldKeys, clearCart, reloadProducts]);

    // Keyboard: F2 → barcode; Enter → open/confirm; Esc → close.
    useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'F2') { e.preventDefault(); barcodeRef.current?.focus(); return; }
        if (e.key === 'Escape') { if (showPayment) setShowPayment(false); return; }
        if (e.key === 'Enter') {
          const target = e.target as HTMLElement;
          if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
          if (showPayment) handleComplete();
          else if (items.length > 0) openPayment();
        }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [showPayment, items.length, handleComplete, openPayment]);

    const handleLogout = useCallback(async () => {
      const decision = evaluateLogout(unsyncedCount, needsAttentionCount);
      if (decision.action === 'blocked') {
        toast.error(decision.message);
        void syncNow();
        return;
      }
      if (decision.action === 'confirm') {
        setConfirmLogout(decision.message);
        return;
      }
      await logout();
      navigate('/login', { replace: true });
    }, [unsyncedCount, needsAttentionCount, syncNow, logout, navigate]);

    const doLogout = useCallback(async () => {
      setConfirmLogout(null);
      await logout();
      navigate('/login', { replace: true });
    }, [logout, navigate]);

    return (
      <div className="flex h-screen flex-col bg-gray-50 dark:bg-gray-900">
        <header className="flex shrink-0 items-center justify-between border-b border-gray-100 bg-white px-4 py-2 dark:border-gray-700 dark:bg-gray-800">
          <div>
            <h1 className="text-sm font-bold text-gray-900 dark:text-white">{companyName || 'Sellary Kassa'}</h1>
            <p className="text-xs text-gray-400">{username}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className={`inline-block h-2 w-2 rounded-full ${online ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-xs text-gray-500">{online ? 'Online' : 'Offline'}</span>
            </div>
            {unsyncedCount > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                Не отправлено: {unsyncedCount}
              </span>
            )}
            {staleDays !== null && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600 dark:bg-amber-900/20 dark:text-amber-400">
                Каталог обновлён {staleDays} дн. назад
              </span>
            )}
            <button onClick={() => syncNow()} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
              Синхронизация
            </button>
            <button onClick={() => navigate('/history')} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
              История
            </button>
            <button onClick={() => navigate('/settings')} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
              Настройки
            </button>
            <button onClick={handleLogout} className="text-xs font-medium text-red-500 hover:text-red-600">
              Выход
            </button>
          </div>
        </header>

        {!online && (
          <div className="bg-amber-50 px-4 py-1.5 text-center text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
            Оффлайн — продажи сохраняются локально
          </div>
        )}

        <div className="flex min-h-0 flex-1 gap-4 p-4">
          <main className="flex min-w-0 flex-1 flex-col">
            <SearchBar
              search={search}
              onSearch={setSearch}
              barcode={barcode}
              onBarcode={setBarcode}
              onBarcodeSubmit={handleBarcodeSubmit}
              barcodeRef={barcodeRef}
            />
            <CategoryChips categories={categories} selected={selectedCategory} onSelect={setSelectedCategory} />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ProductGrid
                products={visibleProducts}
                loading={loadingCatalog}
                cartBaseByProduct={cartBaseByProduct}
                onAdd={handleAdd}
              />
            </div>
          </main>

          <aside className="hidden w-[420px] shrink-0 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800 lg:block">
            <CartPanel
              items={items}
              subtotal={subtotal}
              tax={tax}
              finalTotal={finalTotal}
              oversoldKeys={oversoldKeys}
              priceEdits={priceEdits}
              onPriceEditChange={onPriceEditChange}
              onPriceEditCommit={onPriceEditCommit}
              onQuantity={updateQuantity}
              onRemove={removeItem}
              onPay={openPayment}
            />
          </aside>
        </div>

        <PaymentModal
          open={showPayment}
          total={finalTotal}
          method={method}
          onMethod={setMethod}
          cardType={cardType}
          onCardType={setCardType}
          cashReceived={cashReceived}
          onCashReceived={setCashReceived}
          loading={loading}
          onConfirm={handleComplete}
          onClose={() => setShowPayment(false)}
        />

        {confirmLogout && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setConfirmLogout(null)} />
            <div className="relative w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl dark:bg-gray-800">
              <p className="mb-4 text-sm font-medium text-gray-900 dark:text-gray-100">{confirmLogout}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmLogout(null)}
                  className="h-11 flex-1 rounded-2xl border border-gray-200 font-bold text-gray-600 dark:border-gray-600 dark:text-gray-300"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={doLogout}
                  className="h-11 flex-1 rounded-2xl bg-red-600 font-bold text-white hover:bg-red-700"
                >
                  Выйти
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
  ```
- [ ] Type-check gate. From `sellary-cashier/`:
  ```
  npx tsc --noEmit
  ```
  Expect no errors. (`insertSale`/`NewSaleInput` resolve from the data-model plan's `db.ts`; `useSyncStore`/`requestSync` from the sync-engine plan. If either dependency plan is not yet merged, tsc will report the missing import — that is the signal to merge dependencies first.)
- [ ] Run the full cashier suite and confirm all green:
  ```
  npm test
  ```
  Expect every unit + RTL test (Tasks 2-13) plus the pre-existing `sync-service.test.ts` to pass.
- [ ] MANUAL desktop render gate (not automatable — needs the Rust toolchain). From `sellary-cashier/`:
  ```
  npm run tauri:dev
  ```
  Confirm by eye: two-pane register renders; tiles are `rounded-3xl` with stock badges; search + barcode + category chips filter; adding to cart and paying (cash/card/mobile) completes instantly with a "Продажа завершена" toast; the offline strip appears when the backend is down; the "Не отправлено: N" badge tracks unsynced sales; the "История" link navigates to `/history`; F2 focuses the barcode, Enter opens/confirms payment, Esc closes; guarded logout blocks while unsynced. Dark mode looks correct when `<html>` has `class="dark"`.
- [ ] Commit:
  ```
  git add sellary-cashier/src/pages/POSPage.tsx
  git commit -m "feat(cashier): rebuild POS Kassa UI on the local-first model"
  ```

---

## Interface Assumptions (must match the dependency plans)

This plan composes against names owned by other plans. If any differs, adjust the consumer (`pos-payload.ts`, `POSPage.tsx`) — do not rename the dependency.

**From the data-model plan (`src/lib/db.ts`):** the data-model plan is the **canonical owner** of `NewSaleInput` / `NewSaleItemInput` and the `sale_items` columns. The shape reproduced below is a mirror for convenience — do **not** invent differing field names; if the data-model plan's exported names ever differ, follow the data-model plan and adjust `pos-payload.ts`.
- `insertSale(input: NewSaleInput): Promise<{ saleId: number; receiptNo: number }>` — atomic local write that also decrements base-unit stock.
- `NewSaleInput` shape this plan constructs in `pos-payload.ts` (mirror of the data-model plan's canonical `NewSaleInput` + `NewSaleItemInput`):
  ```ts
  interface NewSaleInput {
    client_sale_id: string;
    idempotency_key: string;
    created_at_client: string;              // ISO
    payment_method: 'cash' | 'card' | 'mobile';
    card_type: 'alif' | 'eskhata' | 'dc' | null;
    subtotal: number;
    discount_amount: number;
    tax_amount: number;
    total_amount: number;
    paid_amount: number;
    change_amount: number;
    notes: string | null;
    cashier_user_id: number | null;
    cashier_username: string | null;
    items: Array<{
      product_id: number;
      product_name: string;
      barcode: string | null;
      uom: string;
      quantity: number;      // base units
      unit_price: number;    // per base unit
      tax_percent: number;
      line_subtotal: number;
      line_total: number;
      sort_order: number;
    }>;
  }
  ```
- `LocalProduct` (unchanged from today's `db.ts`: `id, barcode, name, uom, category_id, sell_price, tax_percent, stock_quantity, is_active, updated_at`) and `LocalCategory` (`id, name, is_active, updated_at`).
- `getProducts(search?)`, `getCategories()`, `getProductByBarcode(barcode)` remain exported.

**From the sync-engine plan:**
- `src/lib/sync-store.ts` exports `useSyncStore` (Zustand) exposing at least `{ online: boolean; unsyncedCount: number; needsAttentionCount: number; catalogRefreshedAt: string | null; syncNow: () => Promise<void> | void }`.
- `src/lib/sync-engine.ts` exports `requestSync(reason: string, opts?: { force?: boolean }): Promise<unknown>`.

**From auth-store (already present):** `useAuthStore` exposes `logout`, `username`, `companyName`, and `userId` (the latter already exists in `auth-store.ts` state).
