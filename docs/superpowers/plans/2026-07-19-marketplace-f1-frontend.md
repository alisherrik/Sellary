# Marketplace F1 — Frontend (Merchant UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every task is an independently testable, committable deliverable.

**Goal:** Add the merchant-facing UI in the existing Next.js admin (`sellary-frontend/`) that drives the already-merged F1 backend: a per-product **"Publish to marketplace"** toggle + **product image upload/preview** on the products page, and a **storefront settings form** (marketplace enable, logo, description, delivery/pickup) wired to `/api/company/marketplace`. All UI strings in Russian.

**Architecture:** Consume the F1 backend through the canonical layers already used by every other page:
```
page/component (React)  →  hooks/useQueries (TanStack Query)  →  lib/api (axios)  →  /api/* proxy  →  backend 8001
```
- Types extend `src/lib/types.ts` (add `is_published`/`image_url` to `Product`; add `MarketplaceSettings` + update payload).
- API functions extend `productsApi` (image upload) and add a new `companyApi` in `src/lib/api.ts`.
- A read hook (`useMarketplaceSettings`) is added to `src/hooks/useQueries.ts`, matching the existing `useServerHealth`/`useAuthStore`-gated pattern; a query key is added to `queryKeys`.
- The products page gets an inline publish toggle in each row + an image control inside the existing product modal.
- The storefront form is a new section component (`MarketplaceSettingsSection`) rendered on the existing `/settings` page, alongside `CompanyAdminSection`.

**Tech Stack:** Next.js 14 (App Router) / TypeScript / Tailwind / Zustand / TanStack Query v5 / axios / vitest + @testing-library/react + @testing-library/user-event (happy-dom). Icons from `@heroicons/react/24/outline`. Toasts via `react-hot-toast`.

## Global Constraints

- **Canonical modules (confirmed by reading the code):** `src/lib/api.ts` is canonical — the products page, settings page, `CompanyAdminSection`, and every `__tests__` import from `@/lib/api`. `src/api.ts` is the dead duplicate; **do not touch it**. State: `@/lib/store` (`useAuthStore`) is canonical for auth/company; `@/store/settingsStore` (Zustand, persisted) holds device-local settings. Marketplace storefront settings are **server-side** (per company), so they go through TanStack Query + `companyApi`, **not** the Zustand settings store.
- Dev server runs on **port 3000**; browser calls hit `/api/*`, which Next.js rewrites to backend **8001**. Never hardcode `http://…:8001` in UI code — use the relative `/api` base already configured in `src/lib/api.ts` (`API_URL`).
- **Tests:** run from `sellary-frontend/` with `npx vitest run <path>` (one-shot). Config: `vitest.config.ts` (happy-dom, `globals: true`, `@` → `./src`), setup `vitest.setup.ts` (jest-dom, mocked crypto/fetch/localStorage). Match the existing test patterns exactly:
  - Page/component tests wrap in a fresh `QueryClient` with `{ defaultOptions: { queries: { retry: false } } }` (see `products/__tests__/page.test.tsx`).
  - Hook tests use `renderHook` with the `createWrapper` pattern that mocks `@/providers/ServerHealthProvider` and seeds `useAuthStore` (see `hooks/__tests__/useQueries.test.tsx`).
  - Mock `@/lib/api` and `react-hot-toast` with `vi.mock`; mock `@/hooks/useQueries` when testing a page that reads through it.
- **UI strings in Russian** (project convention). Code, identifiers, and comments in English.
- Follow existing api/store/query patterns; do **not** invent new fetch wrappers or new global state.
- Backend contract is fixed (already on main): `PUT /api/products/{id}` accepts `is_published`, `image_url`; `GET/PUT` product returns them. `POST /api/products/{id}/image` (multipart field name **`file`**) returns the updated product. `GET/PATCH /api/company/marketplace` with fields `is_marketplace_enabled`, `logo_url`, `marketplace_description`, `supports_delivery`, `supports_pickup`.

---

## Task Overview

| # | Task | Deliverable |
|---|---|---|
| 1 | Types: marketplace fields + settings types | `Product.is_published/image_url`, `MarketplaceSettings`, `MarketplaceSettingsUpdate` |
| 2 | API layer: image upload + `companyApi` | `productsApi.uploadImage`, `companyApi.getMarketplace/updateMarketplace` |
| 3 | Query/mutation hooks | `useMarketplaceSettings` + `queryKeys.marketplaceSettings` |
| 4 | Products page: publish toggle | Inline `is_published` switch per row (optimistic-safe mutation) |
| 5 | Products page: image upload/preview control | Thumbnail + upload button in the product modal |
| 6 | Storefront settings section + wiring | `MarketplaceSettingsSection` rendered on `/settings` |

---

### Task 1: Types — product marketplace fields + settings types

**Files:**
- Modify: `sellary-frontend/src/lib/types.ts`
- Test: `sellary-frontend/src/lib/__tests__/marketplaceTypes.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Product.is_published?: boolean`, `Product.image_url?: string | null`; new `MarketplaceSettings` (response shape) and `MarketplaceSettingsUpdate` (partial patch shape).

> Types are compile-time only, so the "test" is a type-level assertion file that fails to compile / run if the fields are missing. It uses `vitest`'s runtime plus a structural check so it also runs green in the suite. This matches the repo convention of testable, committed increments.

- [ ] **Step 1: Write the failing test**

Create `sellary-frontend/src/lib/__tests__/marketplaceTypes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type {
  MarketplaceSettings,
  MarketplaceSettingsUpdate,
  Product,
} from '@/lib/types';

describe('marketplace types', () => {
  it('Product carries marketplace publish + image fields', () => {
    const product: Pick<Product, 'is_published' | 'image_url'> = {
      is_published: true,
      image_url: 'https://cdn.example/x.jpg',
    };
    expect(product.is_published).toBe(true);
    expect(product.image_url).toBe('https://cdn.example/x.jpg');
  });

  it('MarketplaceSettings holds the storefront shape', () => {
    const settings: MarketplaceSettings = {
      is_marketplace_enabled: false,
      logo_url: null,
      marketplace_description: null,
      supports_delivery: true,
      supports_pickup: true,
    };
    expect(settings.is_marketplace_enabled).toBe(false);
    expect(settings.supports_delivery).toBe(true);
  });

  it('MarketplaceSettingsUpdate allows partial edits', () => {
    const patch: MarketplaceSettingsUpdate = { supports_pickup: false };
    expect(patch.supports_pickup).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/marketplaceTypes.test.ts`
Expected: FAIL — TypeScript cannot resolve `MarketplaceSettings`/`MarketplaceSettingsUpdate`, and `Product` has no `is_published`/`image_url` (compile error surfaced by the test runner).

- [ ] **Step 3: Add the fields and types**

In `sellary-frontend/src/lib/types.ts`, add two fields to the existing `Product` interface (right after `is_active: boolean;`, ~line 144):

```ts
  is_published?: boolean;
  image_url?: string | null;
```

Then add the new types (place them after the `Product` interface block, ~line 149):

```ts
// Company storefront settings for the Telegram marketplace (F1). Read/updated
// through GET/PATCH /api/company/marketplace; server-side per company, not a
// device-local setting.
export interface MarketplaceSettings {
  is_marketplace_enabled: boolean;
  logo_url?: string | null;
  marketplace_description?: string | null;
  supports_delivery: boolean;
  supports_pickup: boolean;
}

// Partial patch for the storefront form — every field optional (PATCH semantics).
export interface MarketplaceSettingsUpdate {
  is_marketplace_enabled?: boolean;
  logo_url?: string | null;
  marketplace_description?: string | null;
  supports_delivery?: boolean;
  supports_pickup?: boolean;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/marketplaceTypes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sellary-frontend/src/lib/types.ts sellary-frontend/src/lib/__tests__/marketplaceTypes.test.ts
git commit -m "feat(marketplace-ui): add product marketplace fields + settings types"
```

---

### Task 2: API layer — product image upload + company marketplace API

**Files:**
- Modify: `sellary-frontend/src/lib/api.ts`
- Test: `sellary-frontend/src/lib/__tests__/marketplaceApi.test.ts`

**Interfaces:**
- Consumes: types from Task 1.
- Produces:
  - `productsApi.uploadImage(id: number, file: File): Promise<AxiosResponse<Product>>` — POSTs multipart to `/products/{id}/image` with field name `file` and `Content-Type: multipart/form-data`.
  - `companyApi.getMarketplace(): Promise<AxiosResponse<MarketplaceSettings>>` → `GET /company/marketplace`.
  - `companyApi.updateMarketplace(data: MarketplaceSettingsUpdate): Promise<AxiosResponse<MarketplaceSettings>>` → `PATCH /company/marketplace`.

> The shared axios instance already injects the company-scoped bearer token via its request interceptor and handles 401 redirects, so these functions just call `api.*`. The multipart call must override the instance default `Content-Type: application/json`.

- [ ] **Step 1: Write the failing test**

Create `sellary-frontend/src/lib/__tests__/marketplaceApi.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock axios so we can assert the request shape without a real network call.
const post = vi.fn(() => Promise.resolve({ data: {} }));
const get = vi.fn(() => Promise.resolve({ data: {} }));
const patch = vi.fn(() => Promise.resolve({ data: {} }));
const put = vi.fn(() => Promise.resolve({ data: {} }));
const del = vi.fn(() => Promise.resolve({ data: {} }));

vi.mock('axios', () => {
  const instance = {
    post,
    get,
    patch,
    put,
    delete: del,
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  };
  return { default: { create: () => instance } };
});

// Session helpers are imported at module load; stub them so import succeeds.
vi.mock('@/lib/session', () => ({
  getActiveAccessToken: () => 'token',
  clearStoredSession: vi.fn(),
}));
vi.mock('@/lib/owner-session', () => ({
  getOwnerAccessToken: () => null,
  clearOwnerSession: vi.fn(),
}));

import { companyApi, productsApi } from '@/lib/api';

beforeEach(() => vi.clearAllMocks());

describe('productsApi.uploadImage', () => {
  it('posts multipart form-data with the file field to the image endpoint', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', {
      type: 'image/jpeg',
    });

    await productsApi.uploadImage(7, file);

    expect(post).toHaveBeenCalledTimes(1);
    const [url, body, config] = post.mock.calls[0];
    expect(url).toBe('/products/7/image');
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('file')).toBe(file);
    expect(config?.headers?.['Content-Type']).toBe('multipart/form-data');
  });
});

describe('companyApi marketplace settings', () => {
  it('reads settings from GET /company/marketplace', async () => {
    await companyApi.getMarketplace();
    expect(get).toHaveBeenCalledWith('/company/marketplace');
  });

  it('patches a subset to /company/marketplace', async () => {
    await companyApi.updateMarketplace({ supports_delivery: false });
    expect(patch).toHaveBeenCalledWith('/company/marketplace', {
      supports_delivery: false,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/marketplaceApi.test.ts`
Expected: FAIL — `productsApi.uploadImage` and `companyApi` are undefined.

- [ ] **Step 3: Add `uploadImage` to `productsApi`**

In `sellary-frontend/src/lib/api.ts`, add the import for the new types near the top type import block:

```ts
  MarketplaceSettings,
  MarketplaceSettingsUpdate,
  Product,
```
(add these names to the existing `import type { … } from './types';` list.)

Extend the `productsApi` object (after `getLowStock`, ~line 210):

```ts
  // Marketplace: upload a product image (multipart). Backend stores it on
  // Cloudinary and returns the updated product with image_url populated.
  uploadImage: (id: number, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<Product>(`/products/${id}/image`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
```

- [ ] **Step 4: Add `companyApi`**

In `sellary-frontend/src/lib/api.ts`, add a new export near `categoriesApi` (e.g. after the `metaApi` block, ~line 347):

```ts
export const companyApi = {
  // Storefront settings for the Telegram marketplace (F1). Company-scoped.
  getMarketplace: () => api.get<MarketplaceSettings>('/company/marketplace'),
  updateMarketplace: (data: MarketplaceSettingsUpdate) =>
    api.patch<MarketplaceSettings>('/company/marketplace', data),
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/marketplaceApi.test.ts`
Expected: PASS — upload posts FormData with the `file` field and multipart header; get/patch hit the right URLs.

- [ ] **Step 6: Commit**

```bash
git add sellary-frontend/src/lib/api.ts sellary-frontend/src/lib/__tests__/marketplaceApi.test.ts
git commit -m "feat(marketplace-ui): add product image upload + company marketplace API"
```

---

### Task 3: Query hook — `useMarketplaceSettings`

**Files:**
- Modify: `sellary-frontend/src/hooks/useQueries.ts`
- Test: `sellary-frontend/src/hooks/__tests__/useMarketplaceSettings.test.tsx`

**Interfaces:**
- Consumes: `companyApi.getMarketplace` (Task 2), `MarketplaceSettings` (Task 1).
- Produces: `useMarketplaceSettings(options?)` — a tenant-gated `useQuery<MarketplaceSettings>`; `queryKeys.marketplaceSettings(companyId)`.

> Mutations for updating settings and toggling publish are colocated with their components (`useMutation` in the settings section and products page respectively), matching how the products page already declares `useMutation` inline. Only the **read** needs a shared hook here, mirroring `useProducts`/`useSuppliers`.

- [ ] **Step 1: Write the failing test**

Create `sellary-frontend/src/hooks/__tests__/useMarketplaceSettings.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';

import { queryKeys, useMarketplaceSettings } from '../useQueries';
import * as api from '@/lib/api';
import { useAuthStore } from '@/lib/store';

vi.mock('@/lib/api', () => ({
  companyApi: {
    getMarketplace: vi.fn(),
  },
}));

let mockServerReachable = true;
const TEST_COMPANY_ID = 101;

vi.mock('@/providers/ServerHealthProvider', () => ({
  useServerHealth: () => ({
    isServerReachable: mockServerReachable,
    isNavigatorOnline: true,
    isChecking: false,
  }),
  ServerHealthProvider: ({ children }: { children: any }) => children,
}));

const createMockAxiosResponse = <T,>(data: T) => ({
  data,
  status: 200,
  statusText: 'OK',
  headers: {},
  config: {} as any,
});

const seedAuth = (companyId: number | null = TEST_COMPANY_ID) => {
  useAuthStore.setState({
    user: null as any,
    companies: [],
    currentCompany: companyId
      ? ({ id: companyId, name: 'Acme', slug: 'acme', is_active: true, role: 'admin', is_default: true } as any)
      : null,
    loginToken: null,
    accessToken: companyId ? 'token' : null,
    isAuthenticated: companyId !== null,
  });
};

const createWrapper = (reachable = true, companyId: number | null = TEST_COMPANY_ID) => {
  mockServerReachable = reachable;
  seedAuth(companyId);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = 'TestWrapper';
  return Wrapper;
};

beforeEach(() => {
  vi.clearAllMocks();
  seedAuth(null);
});

describe('useMarketplaceSettings', () => {
  it('fetches storefront settings when server is reachable', async () => {
    const settings = {
      is_marketplace_enabled: true,
      logo_url: null,
      marketplace_description: 'Магазин',
      supports_delivery: true,
      supports_pickup: false,
    };
    vi.mocked(api.companyApi.getMarketplace).mockResolvedValue(
      createMockAxiosResponse(settings),
    );

    const { result } = renderHook(() => useMarketplaceSettings(), {
      wrapper: createWrapper(true),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.companyApi.getMarketplace).toHaveBeenCalled();
    expect(result.current.data).toEqual(settings);
    expect(queryKeys.marketplaceSettings(TEST_COMPANY_ID)).toEqual([
      'marketplaceSettings',
      TEST_COMPANY_ID,
    ]);
  });

  it('does not fetch when the server is unreachable', () => {
    renderHook(() => useMarketplaceSettings(), { wrapper: createWrapper(false) });
    expect(api.companyApi.getMarketplace).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/__tests__/useMarketplaceSettings.test.tsx`
Expected: FAIL — `useMarketplaceSettings` and `queryKeys.marketplaceSettings` don't exist.

- [ ] **Step 3: Add the query key + hook**

In `sellary-frontend/src/hooks/useQueries.ts`:

Add `companyApi` to the existing `@/lib/api` import (line 2):

```ts
import { reportsApi, productsApi, salesApi, shiftsApi, suppliersApi, purchaseOrdersApi, customersApi, companyApi } from '@/lib/api';
```

Add `MarketplaceSettings` to the `@/lib/types` import block (lines 5-9).

Add a query key inside `queryKeys` (after `topProducts`, ~line 35):

```ts
    marketplaceSettings: (companyId: number | null) => ['marketplaceSettings', tenantKey(companyId)] as const,
```

Add the hook (place near the other read hooks, e.g. after `useCustomerLedger`, ~line 308):

```ts
// Company storefront settings for the Telegram marketplace. Tenant-gated like
// every other read here so it never fires while offline or company-less.
export function useMarketplaceSettings(
    options?: Partial<UseQueryOptions<MarketplaceSettings>>,
) {
    const { isServerReachable } = useServerHealth();
    const companyId = useAuthStore((state) => state.currentCompany?.id ?? null);
    return useQuery<MarketplaceSettings>({
        queryKey: queryKeys.marketplaceSettings(companyId),
        queryFn: async () => {
            const response = await companyApi.getMarketplace();
            return response.data;
        },
        ...options,
        enabled: isServerReachable && companyId !== null && (options?.enabled !== false),
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/__tests__/useMarketplaceSettings.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sellary-frontend/src/hooks/useQueries.ts sellary-frontend/src/hooks/__tests__/useMarketplaceSettings.test.tsx
git commit -m "feat(marketplace-ui): add useMarketplaceSettings query hook"
```

---

### Task 4: Products page — per-product "Publish to marketplace" toggle

**Files:**
- Modify: `sellary-frontend/src/app/(protected)/products/page.tsx`
- Test: `sellary-frontend/src/app/(protected)/products/__tests__/marketplacePublish.test.tsx`

**Interfaces:**
- Consumes: `productsApi.update` (existing), `Product.is_published` (Task 1).
- Produces: a switch control (`role="switch"`, `aria-label="Опубликовать в маркетплейсе"`) in each desktop table row and mobile card that calls `productsApi.update(id, { is_published })` and invalidates `['products']`.

> The publish toggle is a first-class row action, not buried in the modal, because publishing is the merchant's main F1 action. It reuses the existing `role="switch"` pattern from the settings page. It mutates only `is_published` (partial update — backend applies `model_dump(exclude_unset=True)`), so it never disturbs stock or other fields.

- [ ] **Step 1: Write the failing test**

Create `sellary-frontend/src/app/(protected)/products/__tests__/marketplacePublish.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { productsApi } from '@/lib/api';
import Products from '../page';

const { product } = vi.hoisted(() => ({
  product: {
    id: 7,
    barcode: '700000000007',
    name: 'Тестовый товар',
    product_type: 'item',
    uom: 'dona',
    cost_price: '80',
    sell_price: '100',
    tax_percent: '0',
    stock_quantity: 37,
    min_stock_level: 5,
    is_active: true,
    is_published: false,
    image_url: null,
    created_at: '2026-06-14T00:00:00Z',
  },
}));

vi.mock('@/hooks/useQueries', () => ({
  useProducts: vi.fn(() => ({ data: [product], isLoading: false })),
}));

vi.mock('@/lib/api', () => ({
  categoriesApi: {
    getAll: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  productsApi: {
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({ data: { ...product, is_published: true } }),
    delete: vi.fn(),
    uploadImage: vi.fn(),
  },
  inventoryApi: { adjust: vi.fn() },
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

const renderProducts = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Products />
    </QueryClientProvider>,
  );
};

describe('Products marketplace publish toggle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('publishes a product via a partial is_published update', async () => {
    const user = userEvent.setup();
    renderProducts();

    const toggles = screen.getAllByRole('switch', {
      name: 'Опубликовать в маркетплейсе',
    });
    await user.click(toggles[0]);

    await waitFor(() => {
      expect(productsApi.update).toHaveBeenCalledWith(product.id, {
        is_published: true,
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "src/app/(protected)/products/__tests__/marketplacePublish.test.tsx"`
Expected: FAIL — no `switch` with that accessible name exists.

- [ ] **Step 3: Add the publish mutation**

In `sellary-frontend/src/app/(protected)/products/page.tsx`, add a mutation next to the existing product mutations (after `updateProductMutation`, ~line 251):

```tsx
  const publishProductMutation = useMutation({
    mutationFn: ({ id, is_published }: { id: number; is_published: boolean }) =>
      productsApi.update(id, { is_published }),
    onSuccess: (_res, variables) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(
        variables.is_published
          ? 'Товар опубликован в маркетплейсе'
          : 'Товар снят с публикации',
      );
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Не удалось изменить публикацию');
    },
  });
```

Add a small reusable switch above the `return` (near `stockBar`, ~line 73, module scope — or as an inline component inside the file). Place this helper component at module scope, after `catColor`:

```tsx
function PublishSwitch({
  published,
  disabled,
  onToggle,
}: {
  published: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={published}
      aria-label="Опубликовать в маркетплейсе"
      disabled={disabled}
      onClick={onToggle}
      title={published ? 'Опубликован в маркетплейсе' : 'Не опубликован'}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        published ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          published ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}
```

- [ ] **Step 4: Render the switch in the desktop table and mobile card**

In the desktop table, add a header cell after «Уровень запаса» (~line 608):

```tsx
                      <th className="px-4 py-3 text-center font-medium">Маркетплейс</th>
```

Add the matching body cell before the actions cell (~line 660, right before the `<td className="px-4 py-3">` that holds edit/delete):

```tsx
                          <td className="px-4 py-3 text-center">
                            <PublishSwitch
                              published={Boolean(product.is_published)}
                              disabled={publishProductMutation.isPending}
                              onToggle={() =>
                                publishProductMutation.mutate({
                                  id: product.id,
                                  is_published: !product.is_published,
                                })
                              }
                            />
                          </td>
```

In the mobile card action row (~line 575, the `<div className="flex gap-1">` with edit/delete), prepend the switch:

```tsx
                            <PublishSwitch
                              published={Boolean(product.is_published)}
                              disabled={publishProductMutation.isPending}
                              onToggle={() =>
                                publishProductMutation.mutate({
                                  id: product.id,
                                  is_published: !product.is_published,
                                })
                              }
                            />
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run "src/app/(protected)/products/__tests__/marketplacePublish.test.tsx"`
Then re-run the existing page test to confirm no regression:
`npx vitest run "src/app/(protected)/products/__tests__/page.test.tsx"`
Expected: both PASS. (The existing test's `product` fixture lacks `is_published`, so `Boolean(product.is_published)` renders an unpublished switch — no interference with its stock-edit assertions.)

- [ ] **Step 6: Commit**

```bash
git add "sellary-frontend/src/app/(protected)/products/page.tsx" "sellary-frontend/src/app/(protected)/products/__tests__/marketplacePublish.test.tsx"
git commit -m "feat(marketplace-ui): add per-product publish toggle on products page"
```

---

### Task 5: Products page — product image upload + preview control

**Files:**
- Modify: `sellary-frontend/src/app/(protected)/products/page.tsx`
- Test: `sellary-frontend/src/app/(protected)/products/__tests__/marketplaceImage.test.tsx`

**Interfaces:**
- Consumes: `productsApi.uploadImage` (Task 2), `Product.image_url` (Task 1).
- Produces: inside the product **edit** modal, an image block that shows the current `image_url` thumbnail (or a placeholder), a hidden `<input type="file" accept="image/*">` triggered by a button labelled «Загрузить фото», and on select calls `productsApi.uploadImage(editingProduct.id, file)`, updates the preview to the returned `image_url`, and invalidates `['products']`.

> Image upload requires an existing product id (the endpoint is `/products/{id}/image`), so the control only appears when editing (`editingProduct` set), not while creating. On create, the merchant saves first, then re-opens to add a photo. This keeps the modal logic simple and matches the backend contract.

- [ ] **Step 1: Write the failing test**

Create `sellary-frontend/src/app/(protected)/products/__tests__/marketplaceImage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { productsApi } from '@/lib/api';
import Products from '../page';

const { product } = vi.hoisted(() => ({
  product: {
    id: 7,
    barcode: '700000000007',
    name: 'Тестовый товар',
    product_type: 'item',
    uom: 'dona',
    cost_price: '80',
    sell_price: '100',
    tax_percent: '0',
    stock_quantity: 37,
    min_stock_level: 5,
    is_active: true,
    is_published: false,
    image_url: null,
    created_at: '2026-06-14T00:00:00Z',
  },
}));

vi.mock('@/hooks/useQueries', () => ({
  useProducts: vi.fn(() => ({ data: [product], isLoading: false })),
}));

vi.mock('@/lib/api', () => ({
  categoriesApi: {
    getAll: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  productsApi: {
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({ data: product }),
    delete: vi.fn(),
    uploadImage: vi
      .fn()
      .mockResolvedValue({ data: { ...product, image_url: 'https://cdn.example/up.jpg' } }),
  },
  inventoryApi: { adjust: vi.fn() },
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

const renderProducts = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Products />
    </QueryClientProvider>,
  );
};

describe('Products marketplace image upload', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uploads a chosen image for the edited product and shows the preview', async () => {
    const user = userEvent.setup();
    renderProducts();

    await user.click(screen.getAllByRole('button', { name: 'Редактировать' })[0]);
    expect(screen.getByText('Редактировать товар')).toBeInTheDocument();

    const file = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', {
      type: 'image/jpeg',
    });
    const input = screen.getByLabelText('Загрузить фото товара') as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => {
      expect(productsApi.uploadImage).toHaveBeenCalledWith(product.id, file);
    });

    await waitFor(() => {
      expect(screen.getByAltText('Фото товара')).toHaveAttribute(
        'src',
        'https://cdn.example/up.jpg',
      );
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "src/app/(protected)/products/__tests__/marketplaceImage.test.tsx"`
Expected: FAIL — no file input labelled «Загрузить фото товара».

- [ ] **Step 3: Add image state + upload mutation**

In `sellary-frontend/src/app/(protected)/products/page.tsx`, add local state for the current preview (near the other `useState` declarations, ~line 89):

```tsx
  const [imagePreview, setImagePreview] = useState<string | null>(null);
```

Set/clear it when opening the modal. In `handleEditProduct` (after `setEditingProduct(product);`, ~line 272) add:

```tsx
    setImagePreview(product.image_url ?? null);
```

In `handleCreateProduct` (~line 264) add:

```tsx
    setImagePreview(null);
```

Add the upload mutation next to the other product mutations (~line 251):

```tsx
  const uploadImageMutation = useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) =>
      productsApi.uploadImage(id, file),
    onSuccess: (response) => {
      setImagePreview((response.data as Product).image_url ?? null);
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Фото загружено');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Не удалось загрузить фото');
    },
  });

  const handleImageSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file || !editingProduct) return;
    uploadImageMutation.mutate({ id: editingProduct.id, file });
  };
```

- [ ] **Step 4: Render the image control in the edit modal**

In the product modal `<form>`, inside the grid or right after the «Описание» textarea block (~line 834, before the additional-units block), add — rendered only when editing:

```tsx
              {editingProduct && (
                <div className="mt-3 sm:mt-4 rounded-xl border border-gray-200 dark:border-gray-600 p-3">
                  <label className="mb-2 block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">
                    Фото для маркетплейса
                  </label>
                  <div className="flex items-center gap-3">
                    {imagePreview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={imagePreview}
                        alt="Фото товара"
                        className="h-16 w-16 shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-[11px] text-gray-400 dark:bg-gray-700">
                        Нет фото
                      </div>
                    )}
                    <div className="min-w-0">
                      <label className="inline-flex cursor-pointer items-center rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700 hover:bg-blue-100">
                        {uploadImageMutation.isPending ? 'Загрузка…' : 'Загрузить фото'}
                        <input
                          type="file"
                          accept="image/*"
                          aria-label="Загрузить фото товара"
                          disabled={uploadImageMutation.isPending}
                          onChange={handleImageSelected}
                          className="hidden"
                        />
                      </label>
                      <p className="mt-1 text-[11px] text-gray-400">
                        JPG или PNG, до 5&nbsp;МБ. Показывается покупателям в маркетплейсе.
                      </p>
                    </div>
                  </div>
                </div>
              )}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run "src/app/(protected)/products/__tests__/marketplaceImage.test.tsx"`
Then re-run the previous two products tests to confirm no regression:
`npx vitest run "src/app/(protected)/products/__tests__/page.test.tsx" "src/app/(protected)/products/__tests__/marketplacePublish.test.tsx"`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add "sellary-frontend/src/app/(protected)/products/page.tsx" "sellary-frontend/src/app/(protected)/products/__tests__/marketplaceImage.test.tsx"
git commit -m "feat(marketplace-ui): add product image upload + preview in edit modal"
```

---

### Task 6: Storefront settings section + `/settings` wiring

**Files:**
- Create: `sellary-frontend/src/components/settings/MarketplaceSettingsSection.tsx`
- Modify: `sellary-frontend/src/app/(protected)/settings/page.tsx`
- Test: `sellary-frontend/src/components/settings/__tests__/MarketplaceSettingsSection.test.tsx`

**Interfaces:**
- Consumes: `useMarketplaceSettings` (Task 3), `companyApi.updateMarketplace` (Task 2), `MarketplaceSettings`/`MarketplaceSettingsUpdate` (Task 1).
- Produces: a settings section with an enable-marketplace switch, a logo URL input, a description textarea, and delivery/pickup switches. Submitting calls `companyApi.updateMarketplace(patch)` (only changed fields), invalidates `queryKeys.marketplaceSettings`, and toasts. Rendered on `/settings` after `CompanyAdminSection`.

> The form mirrors the local `formData` + submit pattern used in the products modal and `CompanyAdminSection`. The logo is captured as a URL string in F1 (the backend takes `logo_url` directly; a Cloudinary logo-upload endpoint is out of F1 scope per the backend plan). Description max length 500 matches the backend schema.

- [ ] **Step 1: Write the failing test**

Create `sellary-frontend/src/components/settings/__tests__/MarketplaceSettingsSection.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { companyApi } from '@/lib/api';
import { useMarketplaceSettings } from '@/hooks/useQueries';
import MarketplaceSettingsSection from '../MarketplaceSettingsSection';

vi.mock('@/hooks/useQueries', () => ({
  useMarketplaceSettings: vi.fn(),
  queryKeys: { marketplaceSettings: (id: number | null) => ['marketplaceSettings', id ?? 'no-company'] },
}));

vi.mock('@/lib/api', () => ({
  companyApi: {
    updateMarketplace: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

const settings = {
  is_marketplace_enabled: false,
  logo_url: null,
  marketplace_description: null,
  supports_delivery: true,
  supports_pickup: true,
};

const renderSection = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MarketplaceSettingsSection />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useMarketplaceSettings).mockReturnValue({
    data: settings,
    isLoading: false,
  } as any);
});

describe('MarketplaceSettingsSection', () => {
  it('hydrates the form from the loaded settings', () => {
    renderSection();
    expect(
      screen.getByRole('switch', { name: 'Включить маркетплейс' }),
    ).toHaveAttribute('aria-checked', 'false');
    expect(
      screen.getByRole('switch', { name: 'Доставка' }),
    ).toHaveAttribute('aria-checked', 'true');
  });

  it('saves only the changed fields', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole('switch', { name: 'Включить маркетплейс' }));
    await user.type(
      screen.getByLabelText('Описание магазина'),
      'Лучший магазин',
    );
    await user.click(screen.getByRole('switch', { name: 'Самовывоз' }));

    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => {
      expect(companyApi.updateMarketplace).toHaveBeenCalledWith({
        is_marketplace_enabled: true,
        marketplace_description: 'Лучший магазин',
        supports_pickup: false,
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/settings/__tests__/MarketplaceSettingsSection.test.tsx`
Expected: FAIL — `MarketplaceSettingsSection` module does not exist.

- [ ] **Step 3: Create the section component**

Create `sellary-frontend/src/components/settings/MarketplaceSettingsSection.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BuildingStorefrontIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';

import { companyApi } from '@/lib/api';
import { queryKeys, useMarketplaceSettings } from '@/hooks/useQueries';
import { useAuthStore } from '@/lib/store';
import type { MarketplaceSettings, MarketplaceSettingsUpdate } from '@/lib/types';

type FormState = {
  is_marketplace_enabled: boolean;
  logo_url: string;
  marketplace_description: string;
  supports_delivery: boolean;
  supports_pickup: boolean;
};

const toForm = (s: MarketplaceSettings): FormState => ({
  is_marketplace_enabled: s.is_marketplace_enabled,
  logo_url: s.logo_url ?? '',
  marketplace_description: s.marketplace_description ?? '',
  supports_delivery: s.supports_delivery,
  supports_pickup: s.supports_pickup,
});

// Only send fields that actually changed (PATCH semantics). Empty strings map
// back to null so clearing a field is expressible.
const buildPatch = (
  initial: MarketplaceSettings,
  form: FormState,
): MarketplaceSettingsUpdate => {
  const patch: MarketplaceSettingsUpdate = {};
  if (form.is_marketplace_enabled !== initial.is_marketplace_enabled)
    patch.is_marketplace_enabled = form.is_marketplace_enabled;
  if (form.logo_url !== (initial.logo_url ?? ''))
    patch.logo_url = form.logo_url.trim() || null;
  if (form.marketplace_description !== (initial.marketplace_description ?? ''))
    patch.marketplace_description = form.marketplace_description.trim() || null;
  if (form.supports_delivery !== initial.supports_delivery)
    patch.supports_delivery = form.supports_delivery;
  if (form.supports_pickup !== initial.supports_pickup)
    patch.supports_pickup = form.supports_pickup;
  return patch;
};

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm font-medium text-gray-900">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-blue-600' : 'bg-gray-300'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}

export default function MarketplaceSettingsSection() {
  const { data: settings, isLoading } = useMarketplaceSettings();
  const queryClient = useQueryClient();
  const companyId = useAuthStore((state) => state.currentCompany?.id ?? null);
  const [form, setForm] = useState<FormState | null>(null);

  // Hydrate the editable form once settings load, and re-sync if they change.
  useEffect(() => {
    if (settings) setForm(toForm(settings));
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (patch: MarketplaceSettingsUpdate) =>
      companyApi.updateMarketplace(patch),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.marketplaceSettings(companyId),
      });
      toast.success('Настройки магазина сохранены');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Не удалось сохранить настройки');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings || !form) return;
    const patch = buildPatch(settings, form);
    if (Object.keys(patch).length === 0) {
      toast.success('Изменений нет');
      return;
    }
    saveMutation.mutate(patch);
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="border-b border-gray-100 p-4 sm:p-6">
        <div className="flex items-center gap-2">
          <BuildingStorefrontIcon className="h-5 w-5 text-gray-500" />
          <h2 className="text-lg font-semibold text-gray-900">Магазин в маркетплейсе</h2>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Настройте витрину: включите магазин, добавьте логотип и описание, выберите
          способы доставки.
        </p>
      </div>

      <div className="p-4 sm:p-6">
        {isLoading || !form ? (
          <p className="text-sm text-gray-500">Загрузка настроек…</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <Toggle
              label="Включить маркетплейс"
              checked={form.is_marketplace_enabled}
              onChange={(next) =>
                setForm((f) => (f ? { ...f, is_marketplace_enabled: next } : f))
              }
            />

            <div>
              <label
                htmlFor="mp-logo"
                className="mb-1 block text-sm font-medium text-gray-700"
              >
                Ссылка на логотип
              </label>
              <input
                id="mp-logo"
                type="url"
                value={form.logo_url}
                onChange={(e) =>
                  setForm((f) => (f ? { ...f, logo_url: e.target.value } : f))
                }
                placeholder="https://…"
                className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm"
              />
            </div>

            <div>
              <label
                htmlFor="mp-description"
                className="mb-1 block text-sm font-medium text-gray-700"
              >
                Описание магазина
              </label>
              <textarea
                id="mp-description"
                maxLength={500}
                value={form.marketplace_description}
                onChange={(e) =>
                  setForm((f) =>
                    f ? { ...f, marketplace_description: e.target.value } : f,
                  )
                }
                placeholder="Коротко о вашем магазине"
                className="h-20 w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-3 rounded-xl border border-gray-200 p-4">
              <p className="text-sm font-semibold text-gray-900">Способы получения</p>
              <Toggle
                label="Доставка"
                checked={form.supports_delivery}
                onChange={(next) =>
                  setForm((f) => (f ? { ...f, supports_delivery: next } : f))
                }
              />
              <Toggle
                label="Самовывоз"
                checked={form.supports_pickup}
                onChange={(next) =>
                  setForm((f) => (f ? { ...f, supports_pickup: next } : f))
                }
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saveMutation.isPending}
                className="inline-flex h-11 items-center justify-center rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {saveMutation.isPending ? 'Сохранение…' : 'Сохранить'}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run the section test to verify it passes**

Run: `npx vitest run src/components/settings/__tests__/MarketplaceSettingsSection.test.tsx`
Expected: PASS — form hydrates from settings and saves only changed fields.

- [ ] **Step 5: Wire the section into the settings page**

In `sellary-frontend/src/app/(protected)/settings/page.tsx`, add the import next to `CompanyAdminSection` (line 8):

```tsx
import MarketplaceSettingsSection from '@/components/settings/MarketplaceSettingsSection';
```

Render it just before `<CompanyAdminSection />` (line 233):

```tsx
      <MarketplaceSettingsSection />
      <CompanyAdminSection />
```

- [ ] **Step 6: Verify full marketplace-UI suite + lint**

Run:
```bash
npx vitest run src/lib/__tests__/marketplaceTypes.test.ts src/lib/__tests__/marketplaceApi.test.ts src/hooks/__tests__/useMarketplaceSettings.test.tsx "src/app/(protected)/products/__tests__/marketplacePublish.test.tsx" "src/app/(protected)/products/__tests__/marketplaceImage.test.tsx" "src/app/(protected)/products/__tests__/page.test.tsx" src/components/settings/__tests__/MarketplaceSettingsSection.test.tsx
npm run lint
```
Expected: all tests PASS; lint clean.

- [ ] **Step 7: Commit**

```bash
git add "sellary-frontend/src/components/settings/MarketplaceSettingsSection.tsx" "sellary-frontend/src/app/(protected)/settings/page.tsx" "sellary-frontend/src/components/settings/__tests__/MarketplaceSettingsSection.test.tsx"
git commit -m "feat(marketplace-ui): add storefront settings section on /settings"
```

---

## Self-Review Notes

**Scope-item → task mapping:**

| Scope item (from prompt) | Task(s) |
|---|---|
| Types: `is_published`, `image_url` on `Product` | Task 1 |
| Types: marketplace settings type | Task 1 (`MarketplaceSettings` + `MarketplaceSettingsUpdate`) |
| API-layer functions | Task 2 (`productsApi.uploadImage`, `companyApi.getMarketplace/updateMarketplace`) |
| TanStack query/mutation hooks | Task 3 (`useMarketplaceSettings` read hook + query key); update/toggle mutations colocated in Tasks 4/5/6 to match the codebase's inline-`useMutation` convention |
| Products-page publish toggle (`is_published`) | Task 4 |
| Products-page image upload/preview control | Task 5 |
| Storefront settings form/page | Task 6 |
| Tests for all of the above | Every task ships its vitest test (write-fail-implement-pass-commit) |

**Consistency checks:**
- **Canonical module:** all edits target `src/lib/api.ts`, `src/lib/types.ts`, `src/hooks/useQueries.ts`, `src/lib/store.ts` (`useAuthStore`) — the modules the products page, settings page, and existing tests already use. The dead `src/api.ts` and `src/store/*` (except device-local `settingsStore`, untouched) are avoided.
- **Settings page location:** confirmed at `src/app/(protected)/settings/page.tsx`; the storefront form is added as a section component rendered there, mirroring `CompanyAdminSection` (no new route needed).
- **Backend contract match:** image endpoint uses multipart field `file` and returns the updated product; `PUT /api/products/{id}` accepts partial `{ is_published }` / `{ image_url }`; `GET/PATCH /api/company/marketplace` field names (`is_marketplace_enabled`, `logo_url`, `marketplace_description`, `supports_delivery`, `supports_pickup`) all match the F1 backend plan.
- **Test-pattern match:** page tests use a fresh `QueryClient({ retry: false })` and mock `@/hooks/useQueries` + `@/lib/api` + `react-hot-toast` (as in `products/__tests__/page.test.tsx`); the hook test uses the `renderHook` + mocked-`ServerHealthProvider` + seeded-`useAuthStore` pattern (as in `hooks/__tests__/useQueries.test.tsx`).
- **Offline safety:** `useMarketplaceSettings` is gated on `isServerReachable && companyId !== null` like every other read hook, so it never loops offline (the codebase's "Request Loop Prevention" invariant).
- **No regressions:** the existing `products/__tests__/page.test.tsx` fixture omits `is_published`/`image_url`; `Boolean(product.is_published)` and the `editingProduct &&` guard keep the new UI inert for it. Tasks 4/5 explicitly re-run that test.

**Assumptions:**
- `logo_url` is entered as a URL string in F1 (no dedicated logo-upload endpoint in the F1 backend plan — only `POST /products/{id}/image` exists). A logo Cloudinary upload can be a later enhancement.
- Update/toggle mutations live inside their consuming components (not centralized in `useQueries.ts`), matching the existing convention (`products/page.tsx` declares all its `useMutation`s inline).
- The publish toggle is surfaced as a first-class row action (not inside the modal) for merchant efficiency; the image control lives in the edit modal because the upload endpoint requires an existing product id.
```