import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SalesTable } from '../SalesTable';
import type { LocalSale } from '../../../lib/db';

function sale(over: Partial<LocalSale> = {}): LocalSale {
  return {
    id: 1, client_sale_id: 'abcdef123456', idempotency_key: 'i', receipt_no: 42,
    server_sale_id: null, subtotal: 100, discount_amount: 0, tax_amount: 0, total_amount: 100,
    paid_amount: 100, change_amount: 0, payment_method: 'cash', card_type: null, notes: null,
    cashier_user_id: null, cashier_username: null,
    customer_client_id: null, initial_payment_method: null,
    sync_status: 'pending', error_kind: null,
    next_attempt_at: null, first_failed_at: null, last_error: null, retry_count: 0, stock_applied: 1,
    acknowledged: 0,
    created_at_client: '2026-07-10T09:00:00.000Z', synced_at: null, updated_at: '2026-07-10T09:00:00.000Z',
    ...over,
  };
}

describe('SalesTable', () => {
  it('renders a row with receipt number and sync badge', () => {
    render(<SalesTable sales={[sale()]} selectedId={null} onRowClick={() => {}} hasMore={false} loadingMore={false} onLoadMore={() => {}} />);
    expect(screen.getByText('#42')).toBeInTheDocument();
    expect(screen.getByText('Ожидает')).toBeInTheDocument();
  });
  it('fires onRowClick with the sale', () => {
    const onRowClick = vi.fn();
    render(<SalesTable sales={[sale()]} selectedId={null} onRowClick={onRowClick} hasMore={false} loadingMore={false} onLoadMore={() => {}} />);
    fireEvent.click(screen.getByText('#42'));
    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });
  it('shows load-more only when hasMore', () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(<SalesTable sales={[sale()]} selectedId={null} onRowClick={() => {}} hasMore onLoadMore={onLoadMore} loadingMore={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Показать ещё/ }));
    expect(onLoadMore).toHaveBeenCalled();
    rerender(<SalesTable sales={[sale()]} selectedId={null} onRowClick={() => {}} hasMore={false} onLoadMore={onLoadMore} loadingMore={false} />);
    expect(screen.queryByRole('button', { name: /Показать ещё/ })).not.toBeInTheDocument();
  });
  it('renders an empty state', () => {
    render(<SalesTable sales={[]} selectedId={null} onRowClick={() => {}} hasMore={false} loadingMore={false} onLoadMore={() => {}} />);
    expect(screen.getByText('Продажи не найдены')).toBeInTheDocument();
  });
});
