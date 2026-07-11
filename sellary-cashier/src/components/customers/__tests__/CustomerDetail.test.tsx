import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { mockGetLedger, mockInsertPayment } = vi.hoisted(() => ({
  mockGetLedger: vi.fn(),
  mockInsertPayment: vi.fn(),
}));
vi.mock('../../../lib/db', () => ({
  getCustomerLedgerLocal: mockGetLedger,
  insertCustomerPayment: mockInsertPayment,
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { CustomerDetail } from '../CustomerDetail';
import type { CustomerWithBalance } from '../../../lib/db';

beforeEach(() => {
  mockGetLedger.mockClear();
  mockInsertPayment.mockClear();
});

function cust(over: Partial<CustomerWithBalance> = {}): CustomerWithBalance {
  return {
    client_customer_id: over.client_customer_id ?? 'c1',
    server_id: null,
    name: over.name ?? 'Иван',
    phone: over.phone ?? '901112233',
    email: null,
    address: null,
    description: null,
    is_active: 1,
    sync_status: 'synced',
    error_kind: null,
    local_balance: over.local_balance ?? 8000,
  };
}

describe('CustomerDetail', () => {
  it('disables the payment action when there is no local debt', async () => {
    mockGetLedger.mockResolvedValue([]);
    render(<CustomerDetail customer={cust({ local_balance: 0 })} onChanged={() => {}} />);
    const btn = await screen.findByRole('button', { name: 'Принять оплату долга' });
    expect(btn).toBeDisabled();
  });

  it('renders the local ledger with debt (+) and payment (−) signs', async () => {
    mockGetLedger.mockResolvedValue([
      { ref_id: 's1', kind: 'credit_sale', amount: 5000, description: null, receipt_no: 42, applied_amount: null, created_at_client: '2026-07-11T09:00:00.000Z', sync_status: 'pending', error_kind: null },
      { ref_id: 'p1', kind: 'payment', amount: -2000, description: 'частично', receipt_no: null, applied_amount: null, created_at_client: '2026-07-11T10:00:00.000Z', sync_status: 'pending', error_kind: null },
    ]);
    render(<CustomerDetail customer={cust({ local_balance: 3000 })} onChanged={() => {}} />);
    expect(await screen.findByText('Продажа в долг · чек #42')).toBeInTheDocument();
    expect(screen.getByText('Оплата долга')).toBeInTheDocument();
    expect(screen.getByText('частично')).toBeInTheDocument();
    // both ledger rows are unsynced → each shows a badge
    expect(screen.getAllByText('Ожидает')).toHaveLength(2);
  });

  it('shows an amber "переплата не применена" note only on a capped synced payment', async () => {
    mockGetLedger.mockResolvedValue([
      // capped: paid 5000 but server applied only 3000 → amber note
      { ref_id: 'p-cap', kind: 'payment', amount: -5000, description: null, receipt_no: null, applied_amount: 3000, created_at_client: '2026-07-11T11:00:00.000Z', sync_status: 'synced', error_kind: null },
      // fully applied synced payment → no note
      { ref_id: 'p-full', kind: 'payment', amount: -2000, description: null, receipt_no: null, applied_amount: 2000, created_at_client: '2026-07-11T10:00:00.000Z', sync_status: 'synced', error_kind: null },
      // unsynced payment (applied_amount null) → no note
      { ref_id: 'p-pend', kind: 'payment', amount: -1000, description: null, receipt_no: null, applied_amount: null, created_at_client: '2026-07-11T09:00:00.000Z', sync_status: 'pending', error_kind: null },
    ]);
    render(<CustomerDetail customer={cust({ local_balance: 0 })} onChanged={() => {}} />);
    // exactly one amber note, carrying the applied amount (3000)
    const notes = await screen.findAllByText(/переплата не применена/);
    expect(notes).toHaveLength(1);
    expect(notes[0].textContent ?? '').toMatch(/3/);
  });

  it('shows an empty-ledger note when there are no unsynced operations', async () => {
    mockGetLedger.mockResolvedValue([]);
    render(<CustomerDetail customer={cust({ local_balance: 3000 })} onChanged={() => {}} />);
    expect(await screen.findByText('Нет несинхронизированных операций')).toBeInTheDocument();
  });

  it('records a debt payment and calls onChanged', async () => {
    mockGetLedger.mockResolvedValue([]);
    mockInsertPayment.mockResolvedValue({ clientPaymentId: 'p1' });
    const onChanged = vi.fn();
    render(<CustomerDetail customer={cust({ local_balance: 8000 })} onChanged={onChanged} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Принять оплату долга' }));
    fireEvent.change(screen.getByLabelText('Сумма оплаты'), { target: { value: '4000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить оплату' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(mockInsertPayment).toHaveBeenCalledWith({
      customer_client_id: 'c1',
      amount: 4000,
      payment_method: 'cash',
      description: null,
    });
  });

  it('reloads the ledger when the derived local_balance changes', async () => {
    mockGetLedger.mockResolvedValue([]);
    const { rerender } = render(<CustomerDetail customer={cust({ local_balance: 8000 })} onChanged={() => {}} />);
    await waitFor(() => expect(mockGetLedger).toHaveBeenCalledTimes(1));
    rerender(<CustomerDetail customer={cust({ local_balance: 4000 })} onChanged={() => {}} />);
    await waitFor(() => expect(mockGetLedger).toHaveBeenCalledTimes(2));
  });
});
