# Purchase Order Guided Flow Design

**Date:** 2026-06-12  
**Status:** Approved direction  
**Selected concept:** Option 2, Guided Purchase Flow  
**Visual reference:** `docs/design-references/2026-06-12-purchase-order-guided-flow.png`

## Goal

Replace the current modal-heavy Purchase Orders experience with a full-page,
guided workflow that makes creating, reviewing, sending, and receiving a
purchase order easy to understand without hiding totals or item-level errors.

The redesign must preserve Sellary's current backend state machine:

```text
DRAFT -> SENT -> PARTIALLY_RECEIVED -> RECEIVED
            \-> CANCELLED
```

## Users And Success Criteria

The primary user is a store owner or manager working on desktop. Mobile remains
supported for quick review and receiving, but dense order creation is optimized
for a keyboard and a wider screen.

The flow succeeds when the user can:

1. Create a valid draft without using a long modal.
2. Add products and understand quantity, unit cost, row subtotal, and order total.
3. Find and fix invalid rows before submission.
4. Review the full order before sending it to the supplier.
5. Receive all or part of a sent order while seeing ordered, received, and remaining quantities.
6. Return later and immediately understand the current status and next action.

## Information Architecture

### Purchase Order List

`/purchase-orders` remains the entry point. It contains:

- Page title and `Создать закупку` primary action.
- Search by order number or supplier name, performed client-side over loaded rows because the current list endpoint has no search parameter.
- Status and supplier filters.
- Desktop table and compact mobile rows.
- One clear row-level primary action based on status; secondary actions live in an overflow menu.
- Clicking a row opens `/purchase-orders/{id}`.

### Guided Editor

`/purchase-orders/new` creates a purchase order. `/purchase-orders/{id}/edit`
edits a draft. Both use the same editor and three editable stages:

1. **Поставщик**: supplier, expected delivery date, and notes.
2. **Товары**: searchable product entry, quantity, unit cost, and live totals.
3. **Проверка**: read-only review, save draft, or save and send.

The fourth stage, **Приёмка**, is visible in the stepper but locked until the
purchase order is sent. This keeps the complete lifecycle visible without
pretending that receiving is part of draft creation.

### Detail And Receiving

`/purchase-orders/{id}` shows the saved order, status, supplier, dates, items,
totals, receipt progress, and the next valid action.

For `sent` and `partially_received` orders, the fourth stage becomes active and
shows the receiving workspace inline:

- Ordered, already received, remaining, and `Принять сейчас` quantities.
- `Принять всё оставшееся` bulk action.
- Row-level maximum validation.
- Sticky footer with selected line count and total units to receive.
- Green `Подтвердить приёмку` action, because green is reserved for completion.

The current backend does not expose separate receipt documents or an activity
timeline. The first implementation therefore shows cumulative receiving state,
not invented receipt history.

## Interaction Rules

### Draft Creation And Editing

- Moving from supplier to items requires a supplier.
- Moving from items to review requires at least one valid item.
- A valid item has a product, quantity greater than zero, and unit cost zero or greater.
- The same product cannot appear twice. Selecting an existing product focuses its row and shows an inline message.
- The product picker searches by name or barcode and displays UOM and current cost as context.
- Selecting a product seeds unit cost from `cost_price`; the user can override it.
- `Сохранить черновик` creates or updates without changing status.
- `Отправить поставщику` first saves current edits, then calls the send endpoint.
- While either request is pending, submission controls are disabled and keep a stable label with a small loading indicator.
- Leaving with unsaved changes requires confirmation.

### Receiving

- Initial receive quantities are zero; stock is never changed by merely opening the page.
- Each value must be greater than zero and no greater than remaining quantity.
- Zero rows are omitted from the request.
- Confirmation is disabled until at least one valid positive quantity exists.
- A successful partial receipt keeps the user on the detail page and refreshes the order.
- A successful final receipt displays the completed state and removes receiving controls.
- API errors remain visible near the action area in addition to the global toast.

## Visual Design

The screen follows Sellary's `Quiet Counter` design system:

- Inter typography and readable 14-16px body text.
- `#f9fafb` application background and white working surfaces.
- Register Blue `#2563eb` for primary actions, focus, selection, and money.
- Confirm Green `#16a34a` only for successful receiving/completion.
- Red only for destructive actions and invalid values.
- Flat surfaces, hairline dividers, 6-8px control radii, and minimal shadow.
- The total is the heaviest number in its area and uses tabular numerals.
- The summary rail remains visible on desktop; the primary action becomes a sticky bottom bar on mobile.
- No nested card stacks, decorative gradients, or icon-only primary actions.

## Responsive Behavior

- At `lg` and above, the editor uses a flexible main column plus a 320px sticky summary rail.
- Below `lg`, the summary moves below the current stage and the primary action becomes sticky at the bottom.
- Product rows become stacked item panels below `sm`; labels stay visible and inputs remain at least 44px tall.
- The stepper horizontally scrolls on narrow screens without shrinking labels into unreadable text.

## Components And Boundaries

- Route pages own data loading, mutations, navigation, and query invalidation.
- `PurchaseOrderEditor` owns stage navigation and form state.
- `PurchaseOrderItemsTable` owns line rendering and product selection.
- `PurchaseOrderSummary` is derived display only and never owns form state.
- `PurchaseOrderReceiveStage` owns receive quantities and request validation.
- Pure helpers convert API data to form data, validate rows, calculate totals, and build API payloads.

This separation allows calculations and validation to be unit-tested without
rendering a page, while interaction tests cover stage navigation and submission.

## Error, Empty, And Loading States

- List loading uses the existing table skeleton.
- Empty list explains that no purchases exist and offers `Создать закупку`.
- Missing order renders a clear not-found state with a return link.
- Supplier/product loading is local to the relevant control.
- Failed save, send, cancel, delete, and receive actions preserve user input.
- Invalid server state transitions show the backend message and refetch the order.

## Accessibility

- Every input has a visible label and associated error text.
- Stage controls expose current/completed/disabled state to assistive technology.
- Product search supports keyboard navigation, Enter selection, and Escape close.
- Focus moves to the first invalid field when a stage validation fails.
- Icon buttons have Russian accessible names.
- Focus rings use Sellary blue and are never removed.
- Status is communicated by text, not color alone.

## Testing And Acceptance

Unit tests cover calculations, duplicate detection, payload mapping, remaining
quantity, and receive validation. Component tests cover stage gating, live
totals, saving, save-and-send ordering, partial receiving, disabled actions,
and preservation of input after API failure.

Acceptance requires:

- Frontend Vitest suite passes.
- Next.js production build passes.
- Manual desktop smoke test for create -> save draft -> edit -> send -> partial receive -> final receive.
- Manual mobile-width smoke test for list, review, and receive controls.

## Out Of Scope

- Supplier invoices, accounts payable, payment status, taxes, discounts, shipping, and landed-cost accounting.
- Separate shipment/receipt records and receipt history; these require backend schema and API work.
- PDF generation, printing, email delivery, barcode receiving, and automatic draft autosave.
- Changes to the backend purchase-order state machine.
