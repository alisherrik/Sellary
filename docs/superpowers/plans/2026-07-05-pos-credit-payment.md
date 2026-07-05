# POS Credit Payment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a temporary `В долг` checkout option that records the sale as cash with the note `Продано в долг`.

**Architecture:** Keep `credit` as frontend-only UI state. At the API boundary, map it to the existing `cash` payment method and attach the existing sale `notes` field, avoiding backend enum and migration changes.

**Tech Stack:** Next.js 15, React 18, TypeScript, Vitest, Testing Library, TanStack Query

---

## File structure

- Modify `sellary-frontend/src/app/(protected)/pos/page.tsx`: render the credit option, manage its local selection state, hide cash-only controls, and map credit to the existing API contract.
- Modify `sellary-frontend/src/app/(protected)/pos/__tests__/page.test.tsx`: verify UI behavior and the exact credit-sale API payload.

### Task 1: Credit checkout behavior

**Files:**
- Modify: `sellary-frontend/src/app/(protected)/pos/__tests__/page.test.tsx`
- Modify: `sellary-frontend/src/app/(protected)/pos/page.tsx`

- [x] **Step 1: Write the failing component test**

Add a dedicated test that places a product in the cart, opens payment, selects `В долг`, confirms that `Получено наличными` disappears, completes the sale, and checks the payload:

```tsx
it('records a credit sale as cash with a Russian note', async () => {
  const user = userEvent.setup();
  vi.mocked(salesApi.create).mockResolvedValue({
    data: { id: 2, items: [], created_at: '2026-07-05T00:00:00Z' },
  } as never);
  useCartStore.getState().addItem(cashProduct);

  renderPOS();
  await user.click(screen.getByRole('button', { name: /оплатить/i }));
  await user.click(screen.getByRole('button', { name: /в долг/i }));

  expect(screen.queryByRole('textbox', { name: /получено наличными/i })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /завершить продажу/i }));

  await waitFor(() =>
    expect(salesApi.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_method: 'cash',
        notes: 'Продано в долг',
      }),
    ),
  );
  expect(vi.mocked(salesApi.create).mock.calls[0][0]).not.toHaveProperty('card_type');
});
```

Reset and configure `salesApi.create` in the relevant `beforeEach` so the test is isolated.

- [x] **Step 2: Run the test and verify RED**

Run:

```bash
npx vitest run "src/app/(protected)/pos/__tests__/page.test.tsx"
```

Expected: FAIL because no button named `В долг` exists.

- [x] **Step 3: Add the frontend-only credit option**

In `page.tsx`, add `DocumentTextIcon`, extend the local type, and add the fourth option:

```tsx
import {
  // existing icons
  DocumentTextIcon,
} from '@heroicons/react/24/outline';

type PosPaymentMethod = 'cash' | 'card' | 'mobile' | 'credit';

const PAYMENT_METHODS = [
  { id: 'cash', label: 'Наличные', Icon: BanknotesIcon },
  { id: 'card', label: 'Карта', Icon: CreditCardIcon },
  { id: 'mobile', label: 'Мобильный', Icon: DevicePhoneMobileIcon },
  { id: 'credit', label: 'В долг', Icon: DocumentTextIcon },
] as const;
```

Use `PosPaymentMethod` for the `paymentMethod` state and change the responsive payment grid to four columns:

```tsx
const [paymentMethod, setPaymentMethod] = useState<PosPaymentMethod>('cash');

<div className="mb-4 grid grid-cols-2 gap-2 sm:mb-6 sm:grid-cols-4 sm:gap-4">
```

- [x] **Step 4: Map credit state to the existing sale API contract**

Build the sale payload with the current backend enum and note:

```tsx
const isCreditSale = paymentMethod === 'credit';
const saleData: any = {
  items: saleItems,
  payment_method: isCreditSale ? 'cash' : paymentMethod,
  discount_amount: Math.max(
    0,
    items.reduce((sum, item) => sum + Math.max(0, item.discount || 0), 0) + overallDiscount,
  ),
  ...(isCreditSale ? { notes: 'Продано в долг' } : {}),
};
```

Keep the existing cash validation and cash controls conditional on `paymentMethod === 'cash'`. Credit therefore does not require cash received and does not show change. Preserve the existing card-only `card_type` logic.

- [x] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
npx vitest run "src/app/(protected)/pos/__tests__/page.test.tsx"
```

Expected: all POS component tests PASS.

- [x] **Step 6: Run full frontend verification**

Run:

```bash
npx vitest run
npm run build
```

Expected: 0 failed tests and Next.js production build exits 0.

- [x] **Step 7: Commit the implementation**

```bash
git add -- "sellary-frontend/src/app/(protected)/pos/page.tsx" "sellary-frontend/src/app/(protected)/pos/__tests__/page.test.tsx"
git commit -m "feat(pos): mark credit sales with a note"
```
