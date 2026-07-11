import { describe, it, expect, beforeEach, vi } from 'vitest';

const {
  mockPushSales,
  mockFetchBootstrap,
  mockUpsertProducts,
  mockUpsertCategories,
  mockSetMeta,
} = vi.hoisted(() => ({
  mockPushSales: vi.fn(),
  mockFetchBootstrap: vi.fn(),
  mockUpsertProducts: vi.fn(),
  mockUpsertCategories: vi.fn(),
  mockSetMeta: vi.fn(),
}));

vi.mock('../api', () => ({
  pushSales: mockPushSales,
  fetchBootstrap: mockFetchBootstrap,
}));

// Per contract §4.1, sync-service does NOT import getUnsyncedBaseQtyByProduct —
// upsertProducts (data-model) is the sole stock subtractor. pullCatalog only forwards raw products.
vi.mock('../db', () => ({
  upsertProducts: mockUpsertProducts,
  upsertCategories: mockUpsertCategories,
  setMeta: mockSetMeta,
}));

import { pushOnce, pullCatalog } from '../sync-service';

function makeSale(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    client_sale_id: 'sale-1',
    idempotency_key: 'idem-1',
    created_at_client: '2026-07-10T00:00:00.000Z',
    payment_method: 'cash',
    card_type: null,
    discount_amount: 0,
    paid_amount: 100,
    change_amount: 0,
    notes: null,
    retry_count: 0,
    items: [{ product_id: 7, quantity: 3, unit_price: 50 }],
    ...overrides,
  } as never;
}

function makeServerProduct(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 7,
    barcode: null,
    name: 'Cola',
    uom: 'pcs',
    category_id: null,
    sell_price: 50,
    tax_percent: 0,
    stock_quantity: 100,
    is_active: true,
    updated_at: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpsertProducts.mockResolvedValue(undefined);
  mockUpsertCategories.mockResolvedValue(undefined);
  mockSetMeta.mockResolvedValue(undefined);
});

describe('pushOnce', () => {
  it('maps SaleWithItems to the SyncSale payload (unit_price -> sell_price, base quantity)', async () => {
    mockPushSales.mockResolvedValue({
      results: [{ client_sale_id: 'sale-1', status: 'synced', sale_id: 900, warnings: null, error: null }],
    });

    const results = await pushOnce([makeSale()]);

    expect(mockPushSales).toHaveBeenCalledTimes(1);
    const payload = mockPushSales.mock.calls[0][0];
    expect(payload).toEqual([
      {
        client_sale_id: 'sale-1',
        idempotency_key: 'idem-1',
        created_at_client: '2026-07-10T00:00:00.000Z',
        payment_method: 'cash',
        card_type: null,
        discount_amount: 0,
        paid_amount: 100,
        change_amount: 0,
        notes: null,
        items: [{ product_id: 7, quantity: 3, sell_price: 50 }],
      },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('synced');
  });
});

describe('pullCatalog raw pass-through (contract §4.1: upsertProducts is the sole subtractor)', () => {
  it('forwards the RAW server products to upsertProducts without pre-subtracting unsynced qty', async () => {
    mockFetchBootstrap.mockResolvedValue({
      server_time: '2026-07-10T01:00:00.000Z',
      products: [makeServerProduct({ id: 7, stock_quantity: 100 })],
      categories: [{ id: 1, name: 'Drinks', is_active: true, updated_at: null }],
    });

    const res = await pullCatalog();

    expect(mockUpsertCategories).toHaveBeenCalledTimes(1);
    const upserted = mockUpsertProducts.mock.calls[0][0];
    // Raw server stock — subtraction happens exactly once, inside upsertProducts.
    expect(upserted[0].stock_quantity).toBe(100);
    expect(mockSetMeta).toHaveBeenCalledWith('last_catalog_pull_at', '2026-07-10T01:00:00.000Z');
    expect(res).toEqual({ products: 1, categories: 1 });
  });

  it('passes bootstrap.products through by reference/value, unmodified across repeated pulls', async () => {
    mockFetchBootstrap.mockResolvedValue({
      server_time: '2026-07-10T01:00:00.000Z',
      products: [makeServerProduct({ id: 7, stock_quantity: 100 })],
      categories: [],
    });

    await pullCatalog();
    await pullCatalog();

    expect(mockUpsertProducts.mock.calls[0][0][0].stock_quantity).toBe(100);
    expect(mockUpsertProducts.mock.calls[1][0][0].stock_quantity).toBe(100);
  });
});
