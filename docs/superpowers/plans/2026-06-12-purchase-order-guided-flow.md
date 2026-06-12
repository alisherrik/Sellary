# Purchase Order Guided Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Replace Sellary's modal-heavy Purchase Orders UI with the approved full-page Guided Flow for draft creation, review/send, and partial/full receiving.

**Architecture:** Keep the existing FastAPI purchase-order contract and state machine. Move calculations and validation into pure helpers, split the current 577-line route into focused purchase-order components, and use dedicated App Router pages for list, create, detail, and draft edit. TanStack Query route containers own server state; editor and receive components own temporary form state.

**Tech Stack:** Next.js App Router, React 18, TypeScript, Tailwind CSS, TanStack Query, Axios, Heroicons, Vitest, Testing Library.

**Design spec:** docs/superpowers/specs/2026-06-12-purchase-order-guided-flow-design.md

**Visual target:** docs/design-references/2026-06-12-purchase-order-guided-flow.png

---

## File Map

Create:

- sellary-frontend/src/features/purchase-orders/purchaseOrderForm.ts
- sellary-frontend/src/features/purchase-orders/__tests__/purchaseOrderForm.test.ts
- sellary-frontend/src/components/purchase-orders/PurchaseOrderStatusBadge.tsx
- sellary-frontend/src/components/purchase-orders/PurchaseOrderStepper.tsx
- sellary-frontend/src/components/purchase-orders/ProductCombobox.tsx
- sellary-frontend/src/components/purchase-orders/PurchaseOrderItemsTable.tsx
- sellary-frontend/src/components/purchase-orders/PurchaseOrderSummary.tsx
- sellary-frontend/src/components/purchase-orders/PurchaseOrderEditor.tsx
- sellary-frontend/src/components/purchase-orders/PurchaseOrderReceiveStage.tsx
- sellary-frontend/src/components/purchase-orders/__tests__/*.test.tsx
- sellary-frontend/src/app/(protected)/purchase-orders/new/page.tsx
- sellary-frontend/src/app/(protected)/purchase-orders/[id]/page.tsx
- sellary-frontend/src/app/(protected)/purchase-orders/[id]/edit/page.tsx
- sellary-frontend/src/app/(protected)/purchase-orders/__tests__/page.test.tsx

Modify:

- sellary-frontend/src/lib/types.ts
- sellary-frontend/src/lib/api.ts
- sellary-frontend/src/hooks/useQueries.ts
- sellary-frontend/src/hooks/__tests__/useQueries.test.tsx
- sellary-frontend/src/app/(protected)/purchase-orders/page.tsx
- sellary-frontend/src/app/(protected)/purchase-orders/loading.tsx
- sellary-frontend/src/app/globals.css only if a shared utility is required

Delete:

- sellary-frontend/src/components/ReceiveItemsModal.tsx after all imports are removed

---

### Task 1: Add Typed Form Models And Pure Helpers

**Files:**

- Create: sellary-frontend/src/features/purchase-orders/purchaseOrderForm.ts
- Create: sellary-frontend/src/features/purchase-orders/__tests__/purchaseOrderForm.test.ts
- Modify: sellary-frontend/src/lib/types.ts

- [ ] **Step 1: Write failing helper tests**

Cover empty form initialization, decimal totals, duplicate products, invalid rows, payload mapping, remaining quantity, and receive limits.

    import { describe, expect, it } from 'vitest';
    import {
      buildPurchaseOrderPayload,
      calculateOrderTotal,
      createEmptyPurchaseOrderForm,
      getDuplicateProductIds,
      getRemainingQuantity,
      validatePurchaseOrderForm,
      validateReceiveQuantity,
    } from '../purchaseOrderForm';

    describe('purchaseOrderForm', () => {
      it('creates one editable row', () => {
        expect(createEmptyPurchaseOrderForm().items).toHaveLength(1);
      });

      it('calculates totals', () => {
        expect(calculateOrderTotal([
          { key: 'a', product_id: '1', quantity_ordered: '2', unit_cost: '12.50' },
          { key: 'b', product_id: '2', quantity_ordered: '3', unit_cost: '5' },
        ])).toBe(40);
      });

      it('detects duplicate products', () => {
        expect(getDuplicateProductIds([
          { key: 'a', product_id: '7', quantity_ordered: '1', unit_cost: '2' },
          { key: 'b', product_id: '7', quantity_ordered: '2', unit_cost: '2' },
        ])).toEqual(new Set([7]));
      });

      it('maps valid input to the backend contract', () => {
        expect(buildPurchaseOrderPayload({
          supplier_id: '3',
          expected_delivery_date: '2026-06-20',
          notes: 'До 12:00',
          items: [{ key: 'a', product_id: '9', quantity_ordered: '4.5', unit_cost: '18.25' }],
        })).toEqual({
          supplier_id: 3,
          expected_delivery_date: '2026-06-20T00:00:00.000Z',
          notes: 'До 12:00',
          items: [{ product_id: 9, quantity_ordered: 4.5, unit_cost: 18.25 }],
        });
      });

      it('validates receiving limits', () => {
        expect(getRemainingQuantity({ quantity_ordered: 10, quantity_received: 4 })).toBe(6);
        expect(validateReceiveQuantity(7, 6)).toBe('Максимум: 6');
        expect(validateReceiveQuantity(6, 6)).toBeNull();
      });
    });

- [ ] **Step 2: Run the helper test and verify red**

Run from sellary-frontend:

    npx vitest run src/features/purchase-orders/__tests__/purchaseOrderForm.test.ts

Expected: FAIL because purchaseOrderForm.ts does not exist.

- [ ] **Step 3: Add request types to src/lib/types.ts**

    export interface PurchaseOrderItemPayload {
      product_id: number;
      quantity_ordered: number;
      unit_cost: number;
    }

    export interface PurchaseOrderPayload {
      supplier_id: number;
      expected_delivery_date: string | null;
      notes: string | null;
      items: PurchaseOrderItemPayload[];
    }

    export interface ReceivePurchaseOrderPayload {
      items: Array<{ item_id: number; quantity_to_receive: number }>;
    }

- [ ] **Step 4: Implement the pure helper API**

The module must export these exact types/functions:

    export interface PurchaseOrderItemInput {
      key: string;
      product_id: string;
      quantity_ordered: string;
      unit_cost: string;
    }

    export interface PurchaseOrderFormData {
      supplier_id: string;
      expected_delivery_date: string;
      notes: string;
      items: PurchaseOrderItemInput[];
    }

    export const createPurchaseOrderItemInput = (): PurchaseOrderItemInput => ({
      key: crypto.randomUUID(),
      product_id: '',
      quantity_ordered: '1',
      unit_cost: '',
    });

    export const calculateOrderTotal = (items: PurchaseOrderItemInput[]) =>
      items.reduce(
        (sum, item) =>
          sum + (Number(item.quantity_ordered) || 0) * (Number(item.unit_cost) || 0),
        0,
      );

    export const getRemainingQuantity = (
      item: { quantity_ordered: number; quantity_received: number },
    ) => Math.max(0, Number(item.quantity_ordered) - Number(item.quantity_received));

Validation must require supplier, product, quantity greater than zero, cost zero or greater, and unique product IDs. buildPurchaseOrderPayload must convert strings only at the API boundary. mapPurchaseOrderToForm must preserve draft values from PurchaseOrder.

- [ ] **Step 5: Run helper tests**

    npx vitest run src/features/purchase-orders/__tests__/purchaseOrderForm.test.ts

Expected: PASS.

- [ ] **Step 6: Commit**

    git add src/lib/types.ts src/features/purchase-orders
    git commit -m "feat: add purchase order form model"

---

### Task 2: Type The API And Add A Detail Query

**Files:**

- Modify: sellary-frontend/src/lib/api.ts
- Modify: sellary-frontend/src/hooks/useQueries.ts
- Modify: sellary-frontend/src/hooks/__tests__/useQueries.test.tsx

- [ ] **Step 1: Add a failing hook test**

    it('loads a company-scoped purchase order detail', async () => {
      vi.mocked(purchaseOrdersApi.getById).mockResolvedValue({ data: purchaseOrder } as never);
      const { result } = renderHook(() => usePurchaseOrder(42), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(purchaseOrdersApi.getById).toHaveBeenCalledWith(42);
      expect(result.current.data).toEqual(purchaseOrder);
    });

- [ ] **Step 2: Run and verify red**

    npx vitest run src/hooks/__tests__/useQueries.test.tsx

Expected: FAIL because usePurchaseOrder is missing.

- [ ] **Step 3: Type purchaseOrdersApi**

Use PurchaseOrderPayload and ReceivePurchaseOrderPayload for create, update, and receive. Return PurchaseOrder from getById, create, update, send, receive, and cancel. Preserve generated Idempotency-Key behavior for send, receive, and cancel.

- [ ] **Step 4: Add query key and hook**

    purchaseOrder: (companyId: number | null, id: number) =>
      ['purchaseOrder', tenantKey(companyId), id] as const,

    export function usePurchaseOrder(
      id: number,
      options?: Partial<UseQueryOptions<PurchaseOrder>>,
    ) {
      const { isServerReachable } = useServerHealth();
      const companyId = useAuthStore((state) => state.currentCompany?.id ?? null);
      return useQuery<PurchaseOrder>({
        queryKey: queryKeys.purchaseOrder(companyId, id),
        queryFn: async () => (await purchaseOrdersApi.getById(id)).data,
        ...options,
        enabled:
          isServerReachable &&
          companyId !== null &&
          Number.isFinite(id) &&
          options?.enabled !== false,
      });
    }

- [ ] **Step 5: Run hook tests**

    npx vitest run src/hooks/__tests__/useQueries.test.tsx

Expected: PASS.

- [ ] **Step 6: Commit**

    git add src/lib/api.ts src/hooks/useQueries.ts src/hooks/__tests__/useQueries.test.tsx
    git commit -m "refactor: type purchase order queries"

---

### Task 3: Build Lifecycle Presentation

**Files:**

- Create: sellary-frontend/src/components/purchase-orders/PurchaseOrderStatusBadge.tsx
- Create: sellary-frontend/src/components/purchase-orders/PurchaseOrderStepper.tsx
- Create: sellary-frontend/src/components/purchase-orders/__tests__/PurchaseOrderStepper.test.tsx

- [ ] **Step 1: Write failing stepper tests**

Assert that supplier is current for a new draft, receiving is unavailable for draft, receiving is current for partial receipt, and aria-current="step" is present.

- [ ] **Step 2: Run and verify red**

    npx vitest run src/components/purchase-orders/__tests__/PurchaseOrderStepper.test.tsx

- [ ] **Step 3: Implement one status map**

    const statusConfig = {
      draft: { label: 'Черновик', className: 'bg-gray-100 text-gray-800' },
      sent: { label: 'Отправлен', className: 'bg-blue-50 text-blue-700' },
      partially_received: {
        label: 'Частично получен',
        className: 'bg-blue-50 text-blue-700',
      },
      received: { label: 'Получен', className: 'bg-green-50 text-green-700' },
      cancelled: { label: 'Отменён', className: 'bg-red-50 text-red-700' },
    } satisfies Record<
      PurchaseOrderStatus,
      { label: string; className: string }
    >;

Export PurchaseOrderStatusBadge and getPurchaseOrderStatusLabel.

- [ ] **Step 4: Implement the stepper**

Render Поставщик, Товары, Проверка, Приёмка as an ordered list. Editor stages are clickable only when unlocked. Receipt unlocks only for sent, partially_received, or received. Each stage exposes current/completed/unavailable state in Russian via aria-label.

- [ ] **Step 5: Run tests and commit**

    npx vitest run src/components/purchase-orders/__tests__/PurchaseOrderStepper.test.tsx
    git add src/components/purchase-orders
    git commit -m "feat: add purchase order lifecycle UI"

---

### Task 4: Build Product Search And Item Entry

**Files:**

- Create: sellary-frontend/src/components/purchase-orders/ProductCombobox.tsx
- Create: sellary-frontend/src/components/purchase-orders/PurchaseOrderItemsTable.tsx
- Create: sellary-frontend/src/components/purchase-orders/__tests__/PurchaseOrderItemsTable.test.tsx

- [ ] **Step 1: Write failing interaction tests**

Cover product search selection, cost seeding, duplicate rejection, quantity edits, live row subtotal, add row, and remove row.

    it('selects a product and seeds current cost', async () => {
      renderItems();
      await user.type(screen.getByRole('combobox', { name: /товар/i }), 'Молоко');
      await user.click(
        await screen.findByRole('option', { name: /Молоко 3,2%.*шт.*12,50/i }),
      );
      expect(onChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ product_id: '7', unit_cost: '12.50' }),
        ]),
      );
    });

- [ ] **Step 2: Run and verify red**

    npx vitest run src/components/purchase-orders/__tests__/PurchaseOrderItemsTable.test.tsx

- [ ] **Step 3: Implement ProductCombobox**

Use productsApi.search(query) after 250ms when at least two characters are entered. Display product name, barcode, UOM, and current cost. Support ArrowUp, ArrowDown, Enter, and Escape with combobox/listbox/option semantics. Show loading, empty, and API error states.

Public contract:

    interface ProductComboboxProps {
      value: Product | null;
      excludedProductIds: Set<number>;
      error?: string;
      onSelect: (product: Product) => void;
    }

- [ ] **Step 4: Implement PurchaseOrderItemsTable**

Desktop columns: Товар, Ед., Количество, Цена, Сумма, remove. Below sm, render labeled stacked fields. Use stable row keys. Keep at least one row. Seed cost_price on selection. Reject duplicates before mutating a row. Use tabular, right-aligned numeric values.

- [ ] **Step 5: Run tests and commit**

    npx vitest run src/components/purchase-orders/__tests__/PurchaseOrderItemsTable.test.tsx
    git add src/components/purchase-orders
    git commit -m "feat: add guided purchase item entry"

---

### Task 5: Build The Guided Editor And Create/Edit Routes

**Files:**

- Create: sellary-frontend/src/components/purchase-orders/PurchaseOrderSummary.tsx
- Create: sellary-frontend/src/components/purchase-orders/PurchaseOrderEditor.tsx
- Create: sellary-frontend/src/components/purchase-orders/__tests__/PurchaseOrderEditor.test.tsx
- Create: sellary-frontend/src/app/(protected)/purchase-orders/new/page.tsx
- Create: sellary-frontend/src/app/(protected)/purchase-orders/[id]/edit/page.tsx

- [ ] **Step 1: Write failing editor tests**

Test supplier-stage blocking, item-stage validation, blue live total, draft save, save-before-send call order, input preservation after API failure, and dirty-exit confirmation.

    it('saves before sending', async () => {
      const onSave = vi.fn().mockResolvedValue(purchaseOrder);
      const onSend = vi.fn().mockResolvedValue({
        ...purchaseOrder,
        status: 'sent',
      });
      renderEditor({ validForm: true, initialStep: 'review', onSave, onSend });
      await user.click(
        screen.getByRole('button', { name: 'Отправить поставщику' }),
      );
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSend).toHaveBeenCalledWith(purchaseOrder.id);
      expect(onSave.mock.invocationCallOrder[0]).toBeLessThan(
        onSend.mock.invocationCallOrder[0],
      );
    });

- [ ] **Step 2: Run and verify red**

    npx vitest run src/components/purchase-orders/__tests__/PurchaseOrderEditor.test.tsx

- [ ] **Step 3: Implement PurchaseOrderSummary**

Show supplier, expected date, line count, summed quantity, blue heavy total, and notes. Desktop: sticky 320px rail. Mobile: normal summary plus one sticky action footer.

- [ ] **Step 4: Implement PurchaseOrderEditor**

Public contract:

    interface PurchaseOrderEditorProps {
      initialOrder?: PurchaseOrder;
      suppliers: Supplier[];
      onSave: (
        payload: PurchaseOrderPayload,
        id?: number,
      ) => Promise<PurchaseOrder>;
      onSend: (id: number) => Promise<PurchaseOrder>;
      onComplete: (order: PurchaseOrder) => void;
    }

Rules:

- Initialize from mapPurchaseOrderToForm or createEmptyPurchaseOrderForm.
- Block editing when status is not draft.
- Validate supplier before items and all rows before review/save.
- Focus the first element carrying data-error="true".
- Support Ctrl+S and Cmd+S for draft save.
- Register beforeunload only while dirty and not submitting.
- Confirm navigation only while dirty.
- Save/create first, then send the returned ID.
- Preserve state and render role="alert" after request failure.

- [ ] **Step 5: Implement /purchase-orders/new**

Load active suppliers. Create through purchaseOrdersApi.create, send through purchaseOrdersApi.send, invalidate purchase order list, then route to /purchase-orders/{id}.

- [ ] **Step 6: Implement /purchase-orders/[id]/edit**

Parse useParams(), load usePurchaseOrder(id), and update through purchaseOrdersApi.update. Render loading, invalid ID, not found, and non-draft states before the editor.

- [ ] **Step 7: Run tests and commit**

    npx vitest run src/components/purchase-orders/__tests__/PurchaseOrderEditor.test.tsx src/features/purchase-orders/__tests__/purchaseOrderForm.test.ts
    git add src/components/purchase-orders "src/app/(protected)/purchase-orders/new" "src/app/(protected)/purchase-orders/[id]/edit"
    git commit -m "feat: add guided purchase order editor"

---

### Task 6: Build Detail And Inline Receiving

**Files:**

- Create: sellary-frontend/src/components/purchase-orders/PurchaseOrderReceiveStage.tsx
- Create: sellary-frontend/src/components/purchase-orders/__tests__/PurchaseOrderReceiveStage.test.tsx
- Create: sellary-frontend/src/app/(protected)/purchase-orders/[id]/page.tsx
- Delete: sellary-frontend/src/components/ReceiveItemsModal.tsx

- [ ] **Step 1: Write failing receive tests**

Test zero initialization, Receive All Remaining, maximum validation, positive-row-only payload, disabled confirmation, partial success refresh, and preserved values after failure.

    it('submits positive rows only', async () => {
      renderReceiveStage();
      await user.clear(
        screen.getByLabelText('Принять сейчас, Молоко 3,2%'),
      );
      await user.type(
        screen.getByLabelText('Принять сейчас, Молоко 3,2%'),
        '4',
      );
      await user.click(
        screen.getByRole('button', { name: 'Подтвердить приёмку' }),
      );
      expect(onReceive).toHaveBeenCalledWith({
        items: [{ item_id: 11, quantity_to_receive: 4 }],
      });
    });

- [ ] **Step 2: Run and verify red**

    npx vitest run src/components/purchase-orders/__tests__/PurchaseOrderReceiveStage.test.tsx

- [ ] **Step 3: Implement receive state**

Use Record<number, string> initialized to "0". Validate each value against ordered minus received. Build the payload with positive valid rows only. Progress is sum(received) / sum(ordered), not completed-line count. Keep confirmation disabled while zero, invalid, or pending.

- [ ] **Step 4: Implement detail route**

Show title, status, supplier, dates, notes, items, total, progress, and next action. Draft supports edit/send/delete. Sent and partial support inline receive/cancel. Received shows completion without controls. Refetch after 409 before presenting the state-transition error. Invalidate list and detail keys after every successful mutation.

- [ ] **Step 5: Remove obsolete modal**

    rg -n "ReceiveItemsModal" src

Expected before deletion: only old page/modal references. Replace them, then delete src/components/ReceiveItemsModal.tsx and rerun the scan expecting no results.

- [ ] **Step 6: Run tests and commit**

    npx vitest run src/components/purchase-orders/__tests__/PurchaseOrderReceiveStage.test.tsx
    git add src/components/purchase-orders "src/app/(protected)/purchase-orders/[id]"
    git rm src/components/ReceiveItemsModal.tsx
    git commit -m "feat: add inline purchase order receiving"

---

### Task 7: Refactor The List Into A Clean Entry Point

**Files:**

- Modify: sellary-frontend/src/app/(protected)/purchase-orders/page.tsx
- Create: sellary-frontend/src/app/(protected)/purchase-orders/__tests__/page.test.tsx
- Modify: sellary-frontend/src/app/(protected)/purchase-orders/loading.tsx

- [ ] **Step 1: Write failing list tests**

Test create navigation, client-side supplier/order-number search, status filter, row detail navigation, empty reset action, and mobile labels.

- [ ] **Step 2: Run and verify red**

    npx vitest run "src/app/(protected)/purchase-orders/__tests__/page.test.tsx"

- [ ] **Step 3: Replace modal state with list concerns**

Keep only searchQuery, statusFilter, and supplierFilter. Send only supported status and supplier_id params to usePurchaseOrders. Apply number/supplier search locally:

    const visibleOrders = useMemo(() => {
      const query = searchQuery.trim().toLocaleLowerCase('ru-RU');
      if (!query) return purchaseOrders;
      return purchaseOrders.filter(
        (order) =>
          String(order.id).includes(query) ||
          order.supplier?.name.toLocaleLowerCase('ru-RU').includes(query),
      );
    }, [purchaseOrders, searchQuery]);

Use links for create and detail. Show one status-based row action: Продолжить for draft, Принять for sent/partial, Открыть for terminal states. Keep destructive actions on detail.

- [ ] **Step 4: Improve loading and empty states**

No data: explain and show Создать закупку. Filtered empty: show Сбросить фильтры. Loading: preserve table skeleton and filter silhouette.

- [ ] **Step 5: Run tests and commit**

    npx vitest run "src/app/(protected)/purchase-orders/__tests__/page.test.tsx"
    git add "src/app/(protected)/purchase-orders"
    git commit -m "refactor: simplify purchase order list flow"

---

### Task 8: Accessibility And Responsive Polish

**Files:**

- Modify purchase-order files created in Tasks 3-7
- Modify sellary-frontend/src/app/globals.css only when local Tailwind cannot express a reusable rule

- [ ] **Step 1: Add failing semantic assertions**

Assert Russian accessible names for icon buttons, aria-invalid and aria-describedby on invalid fields, aria-current="step", disabled zero receipt, and only one enabled submit action in the accessibility tree.

- [ ] **Step 2: Run focused suite and verify red**

    npx vitest run src/features/purchase-orders src/components/purchase-orders "src/app/(protected)/purchase-orders/__tests__/page.test.tsx"

- [ ] **Step 3: Apply exact visual rules**

- Inputs and mobile actions: min-h-11.
- Focus: focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2.
- Desktop editor: lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6.
- Numeric values: tabular-nums.
- Main total: text-blue-600 font-black.
- Mobile item rows: visible labels, no dependence on hidden table headers.
- Stepper: overflow-x-auto with fixed minimum stage widths.
- Motion: motion-reduce:transition-none.
- No nested cards, gradients, third accent color, or heavy back-office shadow.

- [ ] **Step 4: Run focused tests and commit**

    npx vitest run src/features/purchase-orders src/components/purchase-orders "src/app/(protected)/purchase-orders/__tests__/page.test.tsx"
    git add src/app/globals.css src/components/purchase-orders src/features/purchase-orders "src/app/(protected)/purchase-orders"
    git commit -m "fix: polish purchase order guided flow"

---

### Task 9: Full Verification And Manual Acceptance

- [ ] **Step 1: Run all frontend tests**

    npx vitest run

Expected: exit code 0 and no failures.

- [ ] **Step 2: Run lint**

    npm run lint

Expected: exit code 0. If Next 15 rejects next lint, record that output and run:

    npx eslint src --ext .ts,.tsx

- [ ] **Step 3: Run production build**

    npm run build

Expected: exit code 0 and route output includes list, new, detail, and edit purchase-order routes.

- [ ] **Step 4: Scan obsolete state/imports**

    rg -n "ReceiveItemsModal|showModal|showViewModal|showReceiveModal" src

Expected: no purchase-order references.

- [ ] **Step 5: Desktop smoke test**

Start backend from sellary-backend with .venv\Scripts\python.exe main.py. Start frontend from sellary-frontend with npm run dev. Verify:

1. Create opens full-page editor.
2. Empty supplier and invalid rows are blocked.
3. Product search works by name/barcode and seeds cost.
4. Duplicate product is rejected inline.
5. Draft saves, reopens, and edits.
6. Review total matches row subtotals.
7. Send changes status to Отправлен.
8. Partial receipt updates progress and stock.
9. Final receipt changes status to Получен and removes receive controls.

- [ ] **Step 6: Mobile smoke test**

At 390px verify list rows, horizontal stepper, stacked fields, visible labels, sticky action area, receive quantities, and no horizontal page overflow.

- [ ] **Step 7: Review scope and user changes**

    git status --short
    git diff --check
    git diff --stat

Expected: only planned purchase-order frontend files and docs are part of this work. Existing unrelated sellary-backend/railway.json remains untouched.

- [ ] **Step 8: Commit verification corrections only when needed**

    git add sellary-frontend/src
    git commit -m "test: verify purchase order guided flow"

Do not create an empty commit.

---

## Completion Criteria

- Modal create/edit/view/receive flow is removed.
- Creation and draft edit use the full-page Guided Flow.
- Supplier, live total, and next action remain clear throughout.
- Save draft and save-then-send call the existing API in order.
- Sent orders support valid partial and final receipt inline.
- Search by order number/supplier visibly works.
- Focused tests, full Vitest, lint/fallback lint, and production build pass.
- Desktop and 390px manual lifecycle checks have no blocker.

