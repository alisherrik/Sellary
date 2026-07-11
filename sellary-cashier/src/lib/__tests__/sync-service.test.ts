import { describe, it, expect, beforeEach, vi } from 'vitest';

const {
  mockPushSales,
  mockFetchBootstrap,
  mockPushCustomers,
  mockPushPayments,
  mockUpsertProducts,
  mockUpsertCategories,
  mockSetMeta,
  mockReconcileCustomerBalances,
  mockUpsertServerCustomers,
} = vi.hoisted(() => ({
  mockPushSales: vi.fn(),
  mockFetchBootstrap: vi.fn(),
  mockPushCustomers: vi.fn(),
  mockPushPayments: vi.fn(),
  mockUpsertProducts: vi.fn(),
  mockUpsertCategories: vi.fn(),
  mockSetMeta: vi.fn(),
  mockReconcileCustomerBalances: vi.fn(),
  mockUpsertServerCustomers: vi.fn(),
}));

vi.mock('../api', () => ({
  pushSales: mockPushSales,
  fetchBootstrap: mockFetchBootstrap,
  pushCustomers: mockPushCustomers,
  pushPayments: mockPushPayments,
}));

// Per contract §4.1, sync-service does NOT import getUnsyncedBaseQtyByProduct —
// upsertProducts (data-model) is the sole stock subtractor. pullCatalog only forwards raw products.
vi.mock('../db', () => ({
  upsertProducts: mockUpsertProducts,
  upsertCategories: mockUpsertCategories,
  setMeta: mockSetMeta,
  reconcileCustomerBalances: mockReconcileCustomerBalances,
  upsertServerCustomers: mockUpsertServerCustomers,
}));

import { pushOnce, pullCatalog, pushCustomersOnce, pushPaymentsOnce } from '../sync-service';

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

function makeCustomer(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    client_customer_id: 'c1',
    server_id: null,
    name: 'Иван',
    phone: '+998901234567',
    email: null,
    address: null,
    description: null,
    retry_count: 0,
    ...overrides,
  } as never;
}

function makePayment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    client_payment_id: 'p1',
    idempotency_key: 'idem-p1',
    customer_client_id: 'c1',
    amount: 50,
    payment_method: 'cash',
    description: null,
    retry_count: 0,
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpsertProducts.mockResolvedValue(undefined);
  mockUpsertCategories.mockResolvedValue(undefined);
  mockSetMeta.mockResolvedValue(undefined);
  mockReconcileCustomerBalances.mockResolvedValue(undefined);
  mockUpsertServerCustomers.mockResolvedValue(undefined);
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
        client_customer_id: null,
        initial_payment_method: null,
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
      customers: [],
    });

    const res = await pullCatalog();

    expect(mockUpsertCategories).toHaveBeenCalledTimes(1);
    const upserted = mockUpsertProducts.mock.calls[0][0];
    // Raw server stock — subtraction happens exactly once, inside upsertProducts.
    expect(upserted[0].stock_quantity).toBe(100);
    expect(mockSetMeta).toHaveBeenCalledWith('last_catalog_pull_at', '2026-07-10T01:00:00.000Z');
    expect(res).toEqual({ products: 1, categories: 1, customers: 0 });
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

describe('pushCustomersOnce', () => {
  it('maps LocalCustomer[] to the SyncCustomer payload and returns server results', async () => {
    mockPushCustomers.mockResolvedValue({
      results: [{ client_customer_id: 'c1', status: 'synced', server_id: 55 }],
    });

    const results = await pushCustomersOnce([makeCustomer()]);

    expect(mockPushCustomers).toHaveBeenCalledTimes(1);
    expect(mockPushCustomers.mock.calls[0][0]).toEqual([
      { client_customer_id: 'c1', name: 'Иван', phone: '+998901234567', email: null, address: null, description: null },
    ]);
    expect(results[0].server_id).toBe(55);
  });
});

describe('pushPaymentsOnce', () => {
  it('maps LocalCustomerPayment[] (customer_client_id -> client_customer_id) and returns results', async () => {
    mockPushPayments.mockResolvedValue({
      results: [{ client_payment_id: 'p1', status: 'synced', applied_amount: 30, warnings: null }],
    });

    const results = await pushPaymentsOnce([makePayment()]);

    expect(mockPushPayments).toHaveBeenCalledTimes(1);
    expect(mockPushPayments.mock.calls[0][0]).toEqual([
      { client_payment_id: 'p1', idempotency_key: 'idem-p1', client_customer_id: 'c1', amount: 50, payment_method: 'cash', description: null },
    ]);
    expect(results[0].applied_amount).toBe(30);
  });
});

describe('pushOnce credit fields', () => {
  it('forwards customer_client_id + initial_payment_method for a credit sale', async () => {
    mockPushSales.mockResolvedValue({
      results: [{ client_sale_id: 'sale-1', status: 'synced', sale_id: 900, warnings: null, error: null }],
    });

    await pushOnce([makeSale({ payment_method: 'credit', customer_client_id: 'c1', initial_payment_method: 'cash', paid_amount: 20 })]);

    const payload = mockPushSales.mock.calls[0][0];
    expect(payload[0].payment_method).toBe('credit');
    expect(payload[0].client_customer_id).toBe('c1');
    expect(payload[0].initial_payment_method).toBe('cash');
  });
});

describe('pullCatalog reconciles customers (raw server balances)', () => {
  it('forwards bootstrap.customers to reconcileCustomerBalances and counts them', async () => {
    mockFetchBootstrap.mockResolvedValue({
      server_time: '2026-07-10T01:00:00.000Z',
      products: [],
      categories: [],
      customers: [
        { id: 1, client_customer_id: 'srv:1', name: 'Иван', phone: null, email: null, address: null, description: null, balance: 120, is_active: true },
      ],
    });

    const res = await pullCatalog();

    expect(mockReconcileCustomerBalances).toHaveBeenCalledTimes(1);
    const forwarded = mockReconcileCustomerBalances.mock.calls[0][0];
    expect(forwarded[0].balance).toBe(120); // RAW server balance, not pre-subtracted
    expect(res.customers).toBe(1);
  });

  it('upserts server-origin customers BEFORE reconciling balances, so new web-created customers populate the local list', async () => {
    const bootstrapCustomer = {
      id: 2, client_customer_id: null, name: 'Web Client', phone: null, email: null,
      address: null, description: null, balance: 0, is_active: true,
    };
    mockFetchBootstrap.mockResolvedValue({
      server_time: '2026-07-10T01:00:00.000Z',
      products: [],
      categories: [],
      customers: [bootstrapCustomer],
    });

    await pullCatalog();

    expect(mockUpsertServerCustomers).toHaveBeenCalledWith([bootstrapCustomer]);
    expect(mockUpsertServerCustomers.mock.invocationCallOrder[0]).toBeLessThan(
      mockReconcileCustomerBalances.mock.invocationCallOrder[0],
    );
  });
});
