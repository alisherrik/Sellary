import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { mockGetSaleWithItems, mockGetProductById, mockGetCustomerByClientId, mockRequestSync } = vi.hoisted(() => ({
  mockGetSaleWithItems: vi.fn(),
  mockGetProductById: vi.fn(),
  mockGetCustomerByClientId: vi.fn(),
  mockRequestSync: vi.fn(),
}));

vi.mock('../../../lib/db', () => ({
  getSaleWithItems: mockGetSaleWithItems,
  getProductById: mockGetProductById,
  getCustomerByClientId: mockGetCustomerByClientId,
}));
vi.mock('../../../lib/sync-engine', () => ({ requestSync: mockRequestSync }));

import { SaleDetailPanel } from '../SaleDetailPanel';

function saleWithDeletedProduct(over = {}) {
  return {
    id: 1, client_sale_id: 'abcdef123456', idempotency_key: 'i', receipt_no: 42,
    server_sale_id: null, subtotal: 100, discount_amount: 0, tax_amount: 0, total_amount: 100,
    paid_amount: 120, change_amount: 20, payment_method: 'cash', card_type: null, notes: null,
    cashier_user_id: 7, cashier_username: 'kassir', sync_status: 'failed', error_kind: 'permanent',
    next_attempt_at: null, first_failed_at: null, last_error: 'Products not found', retry_count: 3,
    stock_applied: 1, created_at_client: '2026-07-10T09:00:00.000Z', synced_at: null,
    updated_at: '2026-07-10T09:00:00.000Z',
    items: [{
      id: 10, sale_id: 1, product_id: 999, product_name: 'Удалённый товар', barcode: '111',
      uom: 'шт', quantity: 2, unit_price: 50, tax_percent: 0, line_subtotal: 100, line_total: 100,
      sort_order: 0, product_unit_id: null, sold_unit_label: null, sold_unit_factor: null, sold_quantity: null,
    }],
    ...over,
  };
}

describe('SaleDetailPanel', () => {
  it('renders the receipt from the snapshot even though the product was deleted', async () => {
    mockGetSaleWithItems.mockResolvedValue(saleWithDeletedProduct());
    mockGetProductById.mockResolvedValue(null); // product gone from catalog
    render(<SaleDetailPanel saleId={1} onClose={() => {}} />);
    // product name comes from the sale_items snapshot, not the products table
    expect(await screen.findByText('Удалённый товар')).toBeInTheDocument();
    expect(screen.getByText('Чек #42')).toBeInTheDocument();
    expect(mockGetProductById).not.toHaveBeenCalled(); // never touches live catalog
  });

  it('surfaces a permanent error box with last_error and retries via requestSync', async () => {
    mockGetSaleWithItems.mockResolvedValue(saleWithDeletedProduct());
    render(<SaleDetailPanel saleId={1} onClose={() => {}} />);
    expect(await screen.findByText('Products not found')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Повторить/ }));
    await waitFor(() => expect(mockRequestSync).toHaveBeenCalledWith('manual', { force: true }));
  });

  it('reprints via window.print and shows the no-returns note', async () => {
    mockGetSaleWithItems.mockResolvedValue(saleWithDeletedProduct({ sync_status: 'synced', error_kind: null, server_sale_id: 555, synced_at: '2026-07-10T10:00:00.000Z' }));
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<SaleDetailPanel saleId={1} onClose={() => {}} />);
    await screen.findByText('Чек #42');
    fireEvent.click(screen.getByRole('button', { name: /Печать чека/ }));
    expect(printSpy).toHaveBeenCalled();
    expect(screen.getByText(/Возвраты и долги доступны в веб-версии/)).toBeInTheDocument();
  });

  it('shows a credit/debt summary with the customer name for a В долг sale', async () => {
    mockGetSaleWithItems.mockResolvedValue(
      saleWithDeletedProduct({
        payment_method: 'credit',
        customer_client_id: 'cust-1',
        total_amount: 100,
        paid_amount: 30,
        sync_status: 'synced',
        error_kind: null,
        server_sale_id: 700,
        synced_at: '2026-07-11T10:00:00.000Z',
      }),
    );
    mockGetCustomerByClientId.mockResolvedValue({ name: 'Иван Должник' });
    render(<SaleDetailPanel saleId={1} onClose={() => {}} />);
    expect(await screen.findByText('Иван Должник')).toBeInTheDocument();
    expect(screen.getByText('Продажа в долг')).toBeInTheDocument();
    expect(screen.getByText('Осталось')).toBeInTheDocument();
  });
});
