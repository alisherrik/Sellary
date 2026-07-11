import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { mockInsertCustomerPayment } = vi.hoisted(() => ({ mockInsertCustomerPayment: vi.fn() }));
vi.mock('../../../lib/db', () => ({ insertCustomerPayment: mockInsertCustomerPayment }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { DebtPaymentModal } from '../DebtPaymentModal';
import type { CustomerWithBalance } from '../../../lib/db';

function cust(over: Partial<CustomerWithBalance> = {}): CustomerWithBalance {
  return {
    client_customer_id: over.client_customer_id ?? 'c1',
    server_id: null,
    name: over.name ?? 'Иван',
    phone: null,
    email: null,
    address: null,
    description: null,
    is_active: 1,
    sync_status: 'synced',
    error_kind: null,
    local_balance: over.local_balance ?? 10000,
  };
}

describe('DebtPaymentModal', () => {
  // vitest.config.ts only sets restoreMocks (a no-op for plain vi.fn(), not vi.spyOn); without an
  // explicit clear, call history from earlier `it` blocks leaks into later not.toHaveBeenCalled() checks.
  beforeEach(() => {
    mockInsertCustomerPayment.mockClear();
  });

  it('inserts a payment into the outbox and calls onSaved', async () => {
    mockInsertCustomerPayment.mockResolvedValue({ clientPaymentId: 'p1' });
    const onSaved = vi.fn();
    render(<DebtPaymentModal customer={cust()} onClose={() => {}} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText('Сумма оплаты'), { target: { value: '3000' } });
    fireEvent.change(screen.getByLabelText('Способ оплаты'), { target: { value: 'card' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить оплату' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mockInsertCustomerPayment).toHaveBeenCalledWith({
      customer_client_id: 'c1',
      amount: 3000,
      payment_method: 'card',
      description: null,
    });
  });

  it('trims a description and passes it through', async () => {
    mockInsertCustomerPayment.mockResolvedValue({ clientPaymentId: 'p2' });
    render(<DebtPaymentModal customer={cust()} onClose={() => {}} onSaved={() => {}} />);
    fireEvent.change(screen.getByLabelText('Сумма оплаты'), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText('Примечание'), { target: { value: '  за муку  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить оплату' }));
    await waitFor(() => expect(mockInsertCustomerPayment).toHaveBeenCalled());
    expect(mockInsertCustomerPayment.mock.calls[0][0].description).toBe('за муку');
  });

  it('rejects a non-positive amount and never inserts', async () => {
    const onSaved = vi.fn();
    render(<DebtPaymentModal customer={cust()} onClose={() => {}} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('Сумма оплаты'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить оплату' }));
    await Promise.resolve();
    expect(mockInsertCustomerPayment).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('rejects an amount greater than the current local debt', async () => {
    const onSaved = vi.fn();
    render(<DebtPaymentModal customer={cust({ local_balance: 5000 })} onClose={() => {}} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('Сумма оплаты'), { target: { value: '99999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить оплату' }));
    await Promise.resolve();
    expect(mockInsertCustomerPayment).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('calls onClose from the cancel button', () => {
    const onClose = vi.fn();
    render(<DebtPaymentModal customer={cust()} onClose={onClose} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
