# F5 — Merchant Order-Management UI

Implementation plan for the merchant-facing `/orders` page that consumes the F4 merchant order API.

## Goal

Give a shop owner a `/orders` page (in the `(protected)` route group) to see incoming online orders and manage their lifecycle: view a status-filtered list, open an order's detail, and act on it (Confirm → creates a Sale + decrements stock; advance status; cancel with a reason). The confirm-oversell error (400, order stays pending) is surfaced to the merchant, and status actions are gated by the current status and `fulfillment_type` (pickup skips `delivering`).

## Architecture

Follows the established frontend layering:

```
src/app/(protected)/orders/page.tsx   (UI: list + filter tabs + detail drawer + action buttons)
        │  reads via hooks
        ▼
src/hooks/useQueries.ts               (useOrders list + useOrder detail, query keys)
        │  calls
        ▼
src/lib/api.ts  → ordersApi            (list / get / confirm / advanceStatus / cancel)
        │  HTTP (axios `api`, auth interceptor attaches company-scoped token)
        ▼
/api/orders*  (Next rewrite proxy → backend :8001, F4 endpoints — already merged)
```

- Types live in `src/lib/types.ts` (`Order`, `OrderItem`, `OrderStatus`, `FulfillmentType`, `OrderListResponse`).
- Mutations are called imperatively in the page (matching the purchase-orders detail page's `runAction` pattern — NOT `useMutation`), then invalidate the `['orders']` query key + refetch the detail. This matches the closest existing precedent (`purchase-orders/[id]/page.tsx`) rather than the `useMutation` style used elsewhere; either is acceptable, but the imperative-`runAction` shape keeps action-error handling and 409-refresh in one place.
- Nav link added to the desktop sidebar (`Layout.tsx`) and the mobile `MoreSheet.tsx`.

## Tech Stack

Next.js 14 (App Router) · TypeScript · Tailwind · Zustand (`@/lib/store` — `useAuthStore` for `currentCompany.id`/`role`) · TanStack Query (`@/hooks/useQueries`) · axios (`@/lib/api`) · react-hot-toast · Heroicons · vitest + @testing-library/react + userEvent.

## Global Constraints

- **Dev server** runs on port 3000; browser `/api/*` calls are proxied to the backend on `127.0.0.1:8001` (Next rewrite). Never call `:8001` directly from the client.
- **Tests** run one-shot with `npx vitest run` from `sellary-frontend/` (the `npm test` script is watch mode). Run a single file with `npx vitest run src/app/\(protected\)/orders/__tests__/page.test.tsx`.
- **Russian UI strings** only. Code/comments/docstrings in English.
- **Canonical modules**: `@/lib/api` (NOT `src/api.ts`), `@/lib/store` (NOT `src/store/`), `@/hooks/useQueries`. Confirm before touching any duplicate layer.
- **Idempotency-Key on confirm**: generate via the existing `generateIdempotencyKey()` from `@/lib/api` and pass it as an `Idempotency-Key` header, exactly like `salesApi.create`/`purchaseOrdersApi.receive`. (Backend F4 does not currently *enforce* the header on confirm, but we send it defensively so a retry never double-creates a Sale if the server later adds enforcement.)
- **Status transitions must respect `fulfillment_type`**: `ready → delivering` is only offered for `fulfillment_type === 'delivery'`; **pickup skips `delivering`** and goes `ready → completed`. The forward-only transition map (verified in the backend) is authoritative — the UI must never offer a transition the backend will reject with 409.
- **Company-gating**: every query is enabled only when `isServerReachable && companyId !== null`, matching all other hooks. Mutations (`confirm`/`status`/`cancel`) require `manager` or `admin` on the backend; the UI shows the actions to all roles but relies on the backend 403 (surfaced via the standard error toast) — mirror the existing pages, which don't pre-gate mutation buttons by role except for admin-only voids.

## Backend facts verified (do not re-derive; read only if in doubt)

From `sellary-backend/models/order.py`, `schemas/order.py`, `api/orders.py`, `services/order_service.py`:

- **`OrderStatus` enum values** (strings): `pending`, `confirmed`, `preparing`, `ready`, `delivering`, `completed`, `cancelled`.
- **`FulfillmentType`**: `delivery`, `pickup`.
- **Forward-only transition map** (`_VALID_TRANSITIONS` in `order_service.py`):
  - `pending → {confirmed, cancelled}` — but `confirmed` is reached **only via `POST /confirm`** (not `/status`); `/status` accepts only `preparing|ready|delivering|completed`.
  - `confirmed → {preparing, cancelled}`
  - `preparing → {ready}`
  - `ready → {delivering, completed}`
  - `delivering → {completed}`
  - `completed → {}` (terminal), `cancelled → {}` (terminal)
- **`/status` payload** accepts only `preparing|ready|delivering|completed` (regex-validated). So the only `/status` moves the UI offers: `confirmed→preparing`, `preparing→ready`, `ready→delivering` (delivery only) or `ready→completed`, `delivering→completed`.
- **`/confirm`**: `POST /api/orders/{id}/confirm`, optional body `{ payment_method: "cash"|"card"|"mobile" }` (defaults `cash`). Returns the updated `OrderResponse`. **400** with `detail` = insufficient-stock message → order stays `pending`. **409** if not pending. **404** if missing. **422** for other value errors.
- **`/cancel`**: `POST /api/orders/{id}/cancel`, optional body `{ reason?: string }`. **409** if already cancelled or already completed.
- **`OrderResponse` shape**: `id, company_id, order_number (int), status, fulfillment_type, delivery_address (nullable), contact_phone, contact_name, subtotal, total_amount, notes (nullable), sale_id (nullable), checkout_group_id (nullable), created_at, updated_at, items[]`. `items[]` = `{ id, product_id (nullable), product_name, unit_price, quantity, line_total }`. Decimals are serialized as JSON numbers/strings — treat numeric-ish fields as `string` on the client to match how `Product.sell_price` etc. are typed (`string`), and coerce with `Number(...)`/`formatCurrency` for display.
- **List**: `GET /api/orders?status=<s>&skip=&limit=` → `OrderListResponse { items, total, skip, limit }`. `status` is optional; omit for "all".
- **`contact_phone` / `contact_name` are always present** (non-nullable). `delivery_address` is only meaningful for delivery orders.

---

## Task 1 — Order domain types

**Files**
- Modify: `src/lib/types.ts`

**Interfaces**
- Consumes: nothing.
- Produces: `OrderStatus`, `FulfillmentType`, `OrderItem`, `Order`, `OrderListResponse`, `OrderConfirmPayload`, `OrderCancelPayload`, `OrderStatusAdvance` — imported by Tasks 2–5.

**Step 1 (test).** Types are compile-time; assert them with a `expectTypeOf`-style runtime-safe test that constructs a literal `Order` and reads discriminated status. Create `src/lib/__tests__/orderTypes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Order, OrderStatus, FulfillmentType } from '@/lib/types';

describe('Order types', () => {
  it('accepts a well-formed order literal', () => {
    const status: OrderStatus = 'pending';
    const fulfillment: FulfillmentType = 'delivery';
    const order: Order = {
      id: 1,
      company_id: 1,
      order_number: 42,
      status,
      fulfillment_type: fulfillment,
      delivery_address: 'ул. Рудаки 10',
      contact_phone: '+992900001122',
      contact_name: 'Фируз',
      subtotal: '150.00',
      total_amount: '150.00',
      notes: null,
      sale_id: null,
      checkout_group_id: null,
      created_at: '2026-07-19T00:00:00Z',
      updated_at: '2026-07-19T00:00:00Z',
      items: [
        { id: 1, product_id: 5, product_name: 'Хлеб', unit_price: '3.00', quantity: '2', line_total: '6.00' },
      ],
    };
    expect(order.items[0].product_name).toBe('Хлеб');
    expect(order.status).toBe('pending');
  });
});
```

Run `npx vitest run src/lib/__tests__/orderTypes.test.ts` → fails (types missing).

**Step 2 (impl).** Append to `src/lib/types.ts` (after `MarketplaceSettingsUpdate`):

```ts
// --- Marketplace orders (F4/F5) ---

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'delivering'
  | 'completed'
  | 'cancelled';

export type FulfillmentType = 'delivery' | 'pickup';

export interface OrderItem {
  id: number;
  product_id: number | null;
  product_name: string;
  unit_price: string;
  quantity: string;
  line_total: string;
}

export interface Order {
  id: number;
  company_id: number;
  order_number: number;
  status: OrderStatus;
  fulfillment_type: FulfillmentType;
  delivery_address: string | null;
  contact_phone: string;
  contact_name: string;
  subtotal: string;
  total_amount: string;
  notes: string | null;
  sale_id: number | null;
  checkout_group_id: string | null;
  created_at: string;
  updated_at: string;
  items: OrderItem[];
}

export interface OrderListResponse {
  items: Order[];
  total: number;
  skip: number;
  limit: number;
}

export interface OrderConfirmPayload {
  payment_method?: 'cash' | 'card' | 'mobile';
}

export interface OrderCancelPayload {
  reason?: string;
}

// Only the statuses the merchant can set via POST /api/orders/{id}/status.
export type OrderStatusAdvanceTarget = 'preparing' | 'ready' | 'delivering' | 'completed';
```

Run the test → green.

---

## Task 2 — `ordersApi` in the canonical API layer

**Files**
- Modify: `src/lib/api.ts`
- Test: `src/lib/__tests__/ordersApi.test.ts` (Create)

**Interfaces**
- Consumes: `Order`, `OrderListResponse`, `OrderStatusAdvanceTarget`, `generateIdempotencyKey`.
- Produces: `ordersApi.list / getById / confirm / advanceStatus / cancel` — used by Task 3.

**Step 1 (test).** Create `src/lib/__tests__/ordersApi.test.ts`. Mock the default axios `api` instance the module creates. The existing `api.ts` exports `default api`; we assert the URL/params/headers passed to it. Mock `axios` at module level:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const get = vi.fn();
const post = vi.fn();

vi.mock('axios', () => ({
  default: {
    create: () => ({
      get,
      post,
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    }),
  },
}));

// Deterministic idempotency key.
let ordersApi: typeof import('@/lib/api')['ordersApi'];

beforeEach(async () => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: { items: [], total: 0, skip: 0, limit: 20 } });
  post.mockResolvedValue({ data: {} });
  ordersApi = (await import('@/lib/api')).ordersApi;
});

describe('ordersApi', () => {
  it('lists with a status filter', async () => {
    await ordersApi.list({ status: 'pending' });
    expect(get).toHaveBeenCalledWith('/orders', { params: { status: 'pending' } });
  });

  it('lists without a status filter (all)', async () => {
    await ordersApi.list();
    expect(get).toHaveBeenCalledWith('/orders', { params: undefined });
  });

  it('gets a single order', async () => {
    await ordersApi.getById(7);
    expect(get).toHaveBeenCalledWith('/orders/7');
  });

  it('confirms with an Idempotency-Key header and default cash payment', async () => {
    await ordersApi.confirm(7);
    expect(post).toHaveBeenCalledWith(
      '/orders/7/confirm',
      { payment_method: 'cash' },
      { headers: { 'Idempotency-Key': expect.any(String) } },
    );
  });

  it('reuses a supplied Idempotency-Key on confirm retry', async () => {
    await ordersApi.confirm(7, 'cash', 'fixed-key-123');
    expect(post).toHaveBeenCalledWith(
      '/orders/7/confirm',
      { payment_method: 'cash' },
      { headers: { 'Idempotency-Key': 'fixed-key-123' } },
    );
  });

  it('advances status', async () => {
    await ordersApi.advanceStatus(7, 'preparing');
    expect(post).toHaveBeenCalledWith('/orders/7/status', { status: 'preparing' });
  });

  it('cancels with a reason', async () => {
    await ordersApi.cancel(7, 'Нет в наличии');
    expect(post).toHaveBeenCalledWith('/orders/7/cancel', { reason: 'Нет в наличии' });
  });
});
```

Run → fails (`ordersApi` undefined).

**Step 2 (impl).** Add to `src/lib/api.ts` (import `Order`, `OrderListResponse`, `OrderStatusAdvanceTarget` into the type block at top; add the object near `companyApi`):

```ts
export const ordersApi = {
  // Merchant order list. `status` is optional; omit for all statuses.
  list: (params?: { status?: string; skip?: number; limit?: number }) =>
    api.get<OrderListResponse>('/orders', { params }),
  getById: (id: number) => api.get<Order>(`/orders/${id}`),
  // Confirm → creates a Sale + decrements stock. Idempotency-Key guards retries.
  confirm: (
    id: number,
    paymentMethod: 'cash' | 'card' | 'mobile' = 'cash',
    idempotencyKey?: string,
  ) => {
    const key = idempotencyKey || generateIdempotencyKey();
    return api.post<Order>(
      `/orders/${id}/confirm`,
      { payment_method: paymentMethod },
      { headers: { 'Idempotency-Key': key } },
    );
  },
  advanceStatus: (id: number, status: OrderStatusAdvanceTarget) =>
    api.post<Order>(`/orders/${id}/status`, { status }),
  cancel: (id: number, reason?: string) =>
    api.post<Order>(`/orders/${id}/cancel`, { reason }),
};
```

Run → green. (`generateIdempotencyKey` is defined later in the file at module scope — it's hoisted as a `const` arrow, so reference it only inside the method bodies, which is fine.)

---

## Task 3 — Query keys + `useOrders` / `useOrder` hooks

**Files**
- Modify: `src/hooks/useQueries.ts`
- Test: `src/hooks/__tests__/useOrders.test.tsx` (Create; check whether `src/hooks/__tests__/` exists — if not, create it)

**Interfaces**
- Consumes: `ordersApi`, `Order`, `OrderListResponse`, `useServerHealth`, `useAuthStore`.
- Produces: `queryKeys.orders`, `queryKeys.order`, `useOrders(params)`, `useOrder(id)` — used by Task 4/5. The `['orders']` prefix is what mutations invalidate.

**Step 1 (test).** Create `src/hooks/__tests__/useOrders.test.tsx`. Follow the mock shape from the customers page test (mock `ServerHealthProvider`, `@/lib/store`, `@/lib/api`), render the hook via `renderHook` with a `QueryClientProvider` wrapper:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { useOrders, useOrder, queryKeys } from '@/hooks/useQueries';
import { ordersApi } from '@/lib/api';

vi.mock('@/providers/ServerHealthProvider', () => ({
  useServerHealth: () => ({ isServerReachable: true }),
}));
vi.mock('@/lib/store', () => ({
  useAuthStore: (selector: any) => selector({ currentCompany: { id: 1, role: 'admin' } }),
}));
vi.mock('@/lib/api', () => ({
  ordersApi: { list: vi.fn(), getById: vi.fn() },
}));

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

beforeEach(() => vi.clearAllMocks());

describe('useOrders / useOrder', () => {
  it('fetches the order list with a status filter', async () => {
    vi.mocked(ordersApi.list).mockResolvedValue({
      data: { items: [{ id: 1, order_number: 42, status: 'pending' }], total: 1, skip: 0, limit: 20 },
    } as never);

    const { result } = renderHook(() => useOrders({ status: 'pending' }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(ordersApi.list).toHaveBeenCalledWith({ status: 'pending' });
    expect(result.current.data?.items).toHaveLength(1);
  });

  it('fetches a single order detail', async () => {
    vi.mocked(ordersApi.getById).mockResolvedValue({
      data: { id: 7, order_number: 7, status: 'confirmed' },
    } as never);

    const { result } = renderHook(() => useOrder(7), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(ordersApi.getById).toHaveBeenCalledWith(7);
  });

  it('builds tenant-scoped query keys', () => {
    expect(queryKeys.orders(1, { status: 'pending' })[0]).toBe('orders');
    expect(queryKeys.order(1, 7)).toEqual(['order', 1, 7]);
  });
});
```

Run → fails.

**Step 2 (impl).** In `src/hooks/useQueries.ts`:
- Add to the `import { ... } from '@/lib/api'` line: `ordersApi`.
- Add to the type import: `Order, OrderListResponse`.
- Add to `queryKeys`:

```ts
    orders: (companyId: number | null, params?: any) => ['orders', tenantKey(companyId), params] as const,
    order: (companyId: number | null, id: number) => ['order', tenantKey(companyId), id] as const,
```

- Add the hooks (after `useMarketplaceSettings`):

```ts
// Merchant marketplace order list. Refetches on window focus so a merchant
// leaving the tab open sees new incoming orders without a manual reload
// (real-time push is deferred to F6). `params.status` filters server-side.
export function useOrders(
  params?: { status?: string; skip?: number; limit?: number },
  options?: Partial<UseQueryOptions<OrderListResponse>>,
) {
  const { isServerReachable } = useServerHealth();
  const companyId = useAuthStore((state) => state.currentCompany?.id ?? null);
  return useQuery<OrderListResponse>({
    queryKey: queryKeys.orders(companyId, params),
    queryFn: async () => {
      const response = await ordersApi.list(params);
      return response.data;
    },
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
    ...options,
    enabled: isServerReachable && companyId !== null && (options?.enabled !== false),
  });
}

export function useOrder(id: number, options?: Partial<UseQueryOptions<Order>>) {
  const { isServerReachable } = useServerHealth();
  const companyId = useAuthStore((state) => state.currentCompany?.id ?? null);
  return useQuery<Order>({
    queryKey: queryKeys.order(companyId, id),
    queryFn: async () => {
      const response = await ordersApi.getById(id);
      return response.data;
    },
    ...options,
    enabled:
      isServerReachable && companyId !== null && Number.isFinite(id) && (options?.enabled !== false),
  });
}
```

Run → green.

---

## Task 4 — Status helpers + status badge (pure logic, fully unit-tested)

Isolating the transition/label logic keeps the page test focused on rendering and lets us exhaustively test the pickup-vs-delivery gating.

**Files**
- Create: `src/features/orders/orderStatus.ts`
- Test: `src/features/orders/__tests__/orderStatus.test.ts`

**Interfaces**
- Consumes: `OrderStatus`, `FulfillmentType`, `OrderStatusAdvanceTarget` from `@/lib/types`.
- Produces:
  - `STATUS_LABELS: Record<OrderStatus, string>` (Russian)
  - `STATUS_BADGE_CLASSES: Record<OrderStatus, string>` (Tailwind)
  - `nextStatusActions(status, fulfillment): { target: OrderStatusAdvanceTarget; label: string }[]`
  - `canConfirm(status)`, `canCancel(status)` booleans
  - Used by Task 5.

**Step 1 (test).** Create `src/features/orders/__tests__/orderStatus.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  STATUS_LABELS,
  nextStatusActions,
  canConfirm,
  canCancel,
} from '@/features/orders/orderStatus';

describe('order status helpers', () => {
  it('labels every status in Russian', () => {
    expect(STATUS_LABELS.pending).toBe('Новый');
    expect(STATUS_LABELS.confirmed).toBe('Подтверждён');
    expect(STATUS_LABELS.cancelled).toBe('Отменён');
  });

  it('only pending can be confirmed', () => {
    expect(canConfirm('pending')).toBe(true);
    expect(canConfirm('confirmed')).toBe(false);
    expect(canConfirm('completed')).toBe(false);
  });

  it('cannot cancel completed or already-cancelled orders', () => {
    expect(canCancel('pending')).toBe(true);
    expect(canCancel('confirmed')).toBe(true);
    expect(canCancel('delivering')).toBe(true);
    expect(canCancel('completed')).toBe(false);
    expect(canCancel('cancelled')).toBe(false);
  });

  it('offers preparing after confirmed', () => {
    expect(nextStatusActions('confirmed', 'delivery').map((a) => a.target)).toEqual(['preparing']);
  });

  it('offers ready after preparing', () => {
    expect(nextStatusActions('preparing', 'pickup').map((a) => a.target)).toEqual(['ready']);
  });

  it('delivery order at ready can go to delivering', () => {
    expect(nextStatusActions('ready', 'delivery').map((a) => a.target)).toEqual(['delivering']);
  });

  it('pickup order at ready skips delivering and completes', () => {
    expect(nextStatusActions('ready', 'pickup').map((a) => a.target)).toEqual(['completed']);
  });

  it('delivering completes', () => {
    expect(nextStatusActions('delivering', 'delivery').map((a) => a.target)).toEqual(['completed']);
  });

  it('terminal and pre-confirm states offer no /status actions', () => {
    expect(nextStatusActions('pending', 'delivery')).toEqual([]);
    expect(nextStatusActions('completed', 'delivery')).toEqual([]);
    expect(nextStatusActions('cancelled', 'pickup')).toEqual([]);
  });
});
```

Run → fails.

**Step 2 (impl).** Create `src/features/orders/orderStatus.ts`:

```ts
import type { FulfillmentType, OrderStatus, OrderStatusAdvanceTarget } from '@/lib/types';

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Новый',
  confirmed: 'Подтверждён',
  preparing: 'Готовится',
  ready: 'Готов',
  delivering: 'В доставке',
  completed: 'Завершён',
  cancelled: 'Отменён',
};

export const STATUS_BADGE_CLASSES: Record<OrderStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-blue-100 text-blue-700',
  preparing: 'bg-indigo-100 text-indigo-700',
  ready: 'bg-teal-100 text-teal-700',
  delivering: 'bg-purple-100 text-purple-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-200 text-gray-600',
};

export const FULFILLMENT_LABELS: Record<FulfillmentType, string> = {
  delivery: 'Доставка',
  pickup: 'Самовывоз',
};

interface StatusAction {
  target: OrderStatusAdvanceTarget;
  label: string;
}

// Forward-only /status moves, gated by fulfillment_type. Mirrors the backend
// _VALID_TRANSITIONS map but excludes `confirmed` (reached via /confirm) and
// terminal states. Pickup skips `delivering`.
export function nextStatusActions(
  status: OrderStatus,
  fulfillment: FulfillmentType,
): StatusAction[] {
  switch (status) {
    case 'confirmed':
      return [{ target: 'preparing', label: 'В работу' }];
    case 'preparing':
      return [{ target: 'ready', label: 'Готов' }];
    case 'ready':
      return fulfillment === 'delivery'
        ? [{ target: 'delivering', label: 'Передать в доставку' }]
        : [{ target: 'completed', label: 'Выдан клиенту' }];
    case 'delivering':
      return [{ target: 'completed', label: 'Доставлен' }];
    default:
      return [];
  }
}

export function canConfirm(status: OrderStatus): boolean {
  return status === 'pending';
}

export function canCancel(status: OrderStatus): boolean {
  return status !== 'completed' && status !== 'cancelled';
}
```

Run → green.

---

## Task 5 — `/orders` page: list + filter tabs + detail drawer + actions

**Files**
- Create: `src/app/(protected)/orders/page.tsx`
- Test: `src/app/(protected)/orders/__tests__/page.test.tsx`

**Interfaces**
- Consumes: `useOrders`, `useOrder` (`@/hooks/useQueries`), `ordersApi` (`@/lib/api`), `orderStatus` helpers, `formatCurrency`/`formatDate` (`@/lib/utils` — verify these exist; they're used by the PO detail page), `useQueryClient`, `toast`.
- Produces: the merchant `/orders` route. No exports consumed elsewhere.

**Behavior spec**
- **Filter tabs** (Russian): `Новые` (pending), `Активные` (a client-side union — confirmed/preparing/ready/delivering; implement as separate server calls OR a single all-fetch filtered client-side; **decision: fetch all with no status param and filter client-side** to keep it one request and let the "Активные" tab span multiple statuses cleanly), `Завершённые` (completed), `Отменённые` (cancelled), and `Все`. Each tab shows a count. The pending tab label carries a red badge with the pending count when > 0 ("new orders" badge).
- **List rows/cards**: order_number (`#42`), status badge (`STATUS_BADGE_CLASSES`), fulfillment label, contact_name, total_amount (via `formatCurrency`), created_at (via `formatDate`), item count. Clicking a row opens the detail drawer (right-side panel on desktop, full-screen sheet on mobile) — store `selectedId` in state and render `useOrder(selectedId)`.
- **Detail drawer**: full item table (product_name, quantity, unit_price, line_total), customer block (contact_name, contact_phone, `delivery_address` only when delivery, notes), status badge, and an **actions row** driven by the helpers:
  - `canConfirm(status)` → **Подтвердить заказ** button (calls `ordersApi.confirm`).
  - `nextStatusActions(status, fulfillment_type)` → one button per action (calls `ordersApi.advanceStatus`).
  - `canCancel(status)` → **Отменить** button opening a small reason prompt (a textarea in the drawer or `window.prompt`; use an inline textarea + confirm button for testability), calls `ordersApi.cancel(id, reason)`.
- **Confirm-oversell handling**: on a 400 from confirm, read `error.response.data.detail`, show it in an inline `role="alert"` error box inside the drawer AND a `toast.error`; do NOT close the drawer; refetch the order (it stays `pending`, so the Confirm button remains).
- After any successful action: `queryClient.invalidateQueries({ queryKey: ['orders'] })`, `queryClient.invalidateQueries({ queryKey: ['order'] })`, refetch the detail, `toast.success`. On confirm success also invalidate `['products']` and `['sales']` (a Sale was created + stock changed).
- Use the same `runAction(action, successMsg)` wrapper shape as `purchase-orders/[id]/page.tsx` (sets `isActing`, clears/【sets】`actionError`, on 409 refetches).
- Empty state per tab ("Нет заказов"). Loading skeletons like other pages.

**Step 1 (test).** Create `src/app/(protected)/orders/__tests__/page.test.tsx`. Mirror the customers-page test harness. Mock `@/lib/api` (`ordersApi` + `generateIdempotencyKey`), `@/providers/ServerHealthProvider`, `@/lib/store`, `react-hot-toast`. Because the page uses `useOrders`/`useOrder` (real hooks → real `ordersApi`), mocking `ordersApi` is enough.

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import OrdersPage from '../page';
import { ordersApi } from '@/lib/api';

vi.mock('@/providers/ServerHealthProvider', () => ({
  useServerHealth: () => ({ isServerReachable: true }),
}));
vi.mock('@/lib/store', () => ({
  useAuthStore: (selector: any) => selector({ currentCompany: { id: 1, role: 'admin' } }),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api', () => ({
  generateIdempotencyKey: vi.fn(() => 'order-key-001'),
  ordersApi: {
    list: vi.fn(),
    getById: vi.fn(),
    confirm: vi.fn(),
    advanceStatus: vi.fn(),
    cancel: vi.fn(),
  },
}));

const pendingDelivery = {
  id: 10, company_id: 1, order_number: 42, status: 'pending',
  fulfillment_type: 'delivery', delivery_address: 'ул. Рудаки 10',
  contact_phone: '+992900001122', contact_name: 'Фируз', subtotal: '150.00',
  total_amount: '150.00', notes: null, sale_id: null, checkout_group_id: null,
  created_at: '2026-07-19T00:00:00Z', updated_at: '2026-07-19T00:00:00Z',
  items: [{ id: 1, product_id: 5, product_name: 'Хлеб', unit_price: '3.00', quantity: '2', line_total: '6.00' }],
};
const readyPickup = { ...pendingDelivery, id: 11, order_number: 43, status: 'ready', fulfillment_type: 'pickup', delivery_address: null, contact_name: 'Мадина' };

const renderPage = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OrdersPage />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ordersApi.list).mockResolvedValue({
    data: { items: [pendingDelivery, readyPickup], total: 2, skip: 0, limit: 100 },
  } as never);
  vi.mocked(ordersApi.getById).mockImplementation((id: number) =>
    Promise.resolve({ data: id === 10 ? pendingDelivery : readyPickup } as never),
  );
});

describe('Merchant orders page', () => {
  it('shows the incoming order list with a new-order badge', async () => {
    renderPage();
    expect(await screen.findByText(/#42/)).toBeInTheDocument();
    expect(screen.getByText('Фируз')).toBeInTheDocument();
    // "Новые" tab carries the pending count.
    expect(screen.getByRole('tab', { name: /Новые/ })).toHaveTextContent('1');
  });

  it('confirms a pending order with an Idempotency-Key and refreshes', async () => {
    const user = userEvent.setup();
    vi.mocked(ordersApi.confirm).mockResolvedValue({
      data: { ...pendingDelivery, status: 'confirmed', sale_id: 99 },
    } as never);

    renderPage();
    await user.click(await screen.findByText(/#42/));
    await user.click(await screen.findByRole('button', { name: /Подтвердить заказ/ }));

    await waitFor(() =>
      expect(ordersApi.confirm).toHaveBeenCalledWith(10, 'cash', expect.any(String)),
    );
  });

  it('shows the oversell error and keeps the order pending on 400', async () => {
    const user = userEvent.setup();
    vi.mocked(ordersApi.confirm).mockRejectedValue({
      response: { status: 400, data: { detail: 'Insufficient stock for Хлеб' } },
    });

    renderPage();
    await user.click(await screen.findByText(/#42/));
    await user.click(await screen.findByRole('button', { name: /Подтвердить заказ/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Insufficient stock');
    // Order stays pending → Confirm button is still there.
    expect(screen.getByRole('button', { name: /Подтвердить заказ/ })).toBeInTheDocument();
  });

  it('pickup order at ready offers "выдан клиенту", not delivering', async () => {
    const user = userEvent.setup();
    vi.mocked(ordersApi.advanceStatus).mockResolvedValue({
      data: { ...readyPickup, status: 'completed' },
    } as never);

    renderPage();
    await user.click(await screen.findByText(/#43/));
    // No "в доставку" action for pickup.
    expect(screen.queryByRole('button', { name: /доставку/i })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /Выдан клиенту/i }));

    await waitFor(() => expect(ordersApi.advanceStatus).toHaveBeenCalledWith(11, 'completed'));
  });

  it('cancels an order with a reason', async () => {
    const user = userEvent.setup();
    vi.mocked(ordersApi.cancel).mockResolvedValue({
      data: { ...pendingDelivery, status: 'cancelled' },
    } as never);

    renderPage();
    await user.click(await screen.findByText(/#42/));
    await user.click(await screen.findByRole('button', { name: /^Отменить$/ }));
    await user.type(screen.getByLabelText(/Причина отмены/), 'Нет в наличии');
    await user.click(screen.getByRole('button', { name: /Подтвердить отмену/ }));

    await waitFor(() => expect(ordersApi.cancel).toHaveBeenCalledWith(10, 'Нет в наличии'));
  });
});
```

Run → fails (no page).

**Step 2 (impl).** Create `src/app/(protected)/orders/page.tsx`. Key structure (write the real component to satisfy every test above):
- `'use client';` top.
- State: `activeTab` (`'new' | 'active' | 'done' | 'cancelled' | 'all'`), `selectedId: number | null`, `cancelReason: string`, `showCancelForm: boolean`, `actionError: string`, `isActing: boolean`.
- `const listQuery = useOrders();` (fetch all, no status param) — derive per-tab arrays client-side with a `matchesTab` helper (`new`→pending; `active`→confirmed/preparing/ready/delivering; `done`→completed; `cancelled`→cancelled; `all`→everything). Compute `pendingCount` for the badge.
- Tabs rendered as `role="tab"` buttons; the "Новые" tab shows `pendingCount` when > 0 (satisfies the badge assertion).
- List: map filtered orders to clickable rows/cards (`onClick={() => { setSelectedId(o.id); setActionError(''); setShowCancelForm(false); }}`). Show `#{order_number}`, `STATUS_LABELS`/badge, `FULFILLMENT_LABELS`, `contact_name`, `formatCurrency(total_amount)`, `formatDate(created_at)`, item count.
- Detail drawer: `const detailQuery = useOrder(selectedId ?? 0, { enabled: selectedId !== null });`. Render items table, customer block (address only when `fulfillment_type === 'delivery'`), and the actions:
  - `runAction` wrapper (copy the PO-detail pattern; on 409 refetch; set `actionError` from `error.response.data.detail`).
  - Confirm button when `canConfirm(order.status)`: `runAction(() => ordersApi.confirm(order.id).then(() => {}), 'Заказ подтверждён')` then invalidate `['orders'],['order'],['products'],['sales']` + `detailQuery.refetch()`. On 400 the `runAction` catch sets `actionError` and does NOT close the drawer.
  - `nextStatusActions(order.status, order.fulfillment_type).map(a => <button>{a.label}</button>)` → `ordersApi.advanceStatus(order.id, a.target)`.
  - Cancel: a button `Отменить` (when `canCancel`) toggles `showCancelForm`; the form has a `<textarea aria-label="Причина отмены">` bound to `cancelReason` and a `Подтвердить отмену` button → `ordersApi.cancel(order.id, cancelReason || undefined)`.
  - Error box: `{actionError && <div role="alert" className="...text-red-700">{actionError}</div>}`.
- Loading skeletons + empty states.

Run the page test → iterate to green. Then run the whole orders suite: `npx vitest run src/app/\(protected\)/orders src/features/orders src/hooks/__tests__/useOrders.test.tsx src/lib/__tests__/ordersApi.test.ts src/lib/__tests__/orderTypes.test.ts`.

---

## Task 6 — Navigation links (sidebar + mobile MoreSheet)

**Files**
- Modify: `src/components/Layout.tsx`
- Modify: `src/components/mobile/MoreSheet.tsx`
- Test: `src/components/__tests__/Layout.orders-link.test.tsx` (Create) — or extend an existing Layout/MoreSheet test if present. Check `src/components/mobile/__tests__/MoreSheet.test.tsx` and add an assertion there for the mobile link.

**Interfaces**
- Consumes: nothing new (static nav arrays).
- Produces: a `/orders` link reachable from desktop sidebar and mobile "Ещё" sheet.

**Step 1 (test).** Add to `src/components/mobile/__tests__/MoreSheet.test.tsx` an assertion that the sheet, when open, renders a "Заказы" item linking to `/orders`. For the sidebar, create a focused test that renders `Layout` with an authenticated store mock and asserts a link with name `Заказы` and `href="/orders"` exists. (If `Layout` is heavy to render in isolation, instead assert against the exported `navigation` array — but it's currently module-private; simplest is a render test with the auth store mocked to `isAuthenticated: true`. Follow whatever the existing Layout tests do; if none exist, prefer the MoreSheet test plus a lightweight render assertion.)

Example addition to the MoreSheet test:

```ts
it('links to the merchant orders page', () => {
  render(<MoreSheet isOpen onClose={() => {}} />);
  expect(screen.getByRole('button', { name: /Заказы/ })).toBeInTheDocument();
});
```

Run → fails.

**Step 2 (impl).**
- In `src/components/Layout.tsx`, add to the `navigation` array (import an icon such as `InboxArrowDownIcon` from `@heroicons/react/24/outline`), placed after "История продаж" or near "Закупки":

```ts
  { name: 'Заказы', href: '/orders', icon: InboxArrowDownIcon, prefetchKey: null },
```

- In `src/components/mobile/MoreSheet.tsx`, add to `moreItems` (import an icon, e.g. `InboxArrowDownIcon`):

```ts
  { label: 'Заказы', href: '/orders', icon: InboxArrowDownIcon },
```

Run → green. Confirm the existing MoreSheet test (and any Layout test) still passes.

---

## Task 7 — Full suite regression

**Step.** From `sellary-frontend/`, run `npx vitest run` and `npm run lint`. Fix any type/lint fallout (e.g. unused imports, `formatCurrency`/`formatDate` import path). Confirm no existing test regressed (nav-array length assertions, MoreSheet snapshot-style tests, etc.). This task has no new files — it's the verification gate.

---

## Self-Review Notes

Scope-item → task mapping:

| Scope item | Task(s) |
| --- | --- |
| Types for Order/OrderItem/OrderStatus/FulfillmentType | Task 1 (+ `OrderListResponse`, payload types, `OrderStatusAdvanceTarget`) |
| API-layer functions (list w/ status filter, get detail, confirm w/ Idempotency-Key, advance status, cancel) | Task 2 |
| TanStack Query hooks + keys; mutations invalidate list/detail | Task 3 (hooks/keys) + Task 5 (invalidation in `runAction`) |
| `/orders` page: list, filter tabs, cards, new-order badge, detail drawer, action buttons gated by status + fulfillment_type, oversell error | Task 5 (rendering) + Task 4 (gating/label logic, unit-tested) |
| Add `/orders` to nav | Task 6 (sidebar + MoreSheet) |
| Russian UI strings, existing page/test patterns | Tasks 4–6 (labels), harness copied from customers/PO-detail |
| Tests incl. confirm-oversell error + status-transition gating | Task 4 (exhaustive gating unit tests) + Task 5 (oversell alert, pickup-skips-delivering, confirm/cancel flows) |

Design decisions & deferrals:
- **Real-time new-order push is F6** (Telegram bot). This page instead uses `refetchOnWindowFocus: true` + a 30 s `refetchInterval` on the list so a merchant sees new orders without a manual reload. Documented in the `useOrders` hook comment.
- **Idempotency-Key on confirm**: sent via `generateIdempotencyKey()` even though F4's backend confirm handler does not currently read the header — defensive and consistent with `salesApi`/`purchaseOrdersApi`. If a retry semantics change is wanted later, the plumbing is already there.
- **Tabs fetch-all + client filter**: the "Активные" tab spans four statuses; fetching all once and filtering client-side is simpler and cheaper than four server calls, and lets tab counts render without extra requests. If order volume grows this can move to server-side `status` params (the API and `useOrders` already accept `params.status`).
- **Role gating**: mutation buttons are shown to all roles; the backend enforces manager/admin and returns 403, surfaced by the standard error toast — matching how existing pages (except admin-only voids) behave. No client-side pre-gating added.
- **`confirmed` is not a `/status` target**: it's reached only through `/confirm`; `nextStatusActions` deliberately omits it, and the confirm button is the only path from `pending`.
- **Verify before coding**: confirm `formatCurrency`/`formatDate` exist in `@/lib/utils` (used by the PO detail page) and that `src/hooks/__tests__/` / `src/lib/__tests__/` dirs exist or create them. Confirm the `navigation`/`moreItems` arrays are the only nav sources (BottomTabBar's 4 fixed tabs stay unchanged — orders lives under "Ещё").
