import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGetCustomers, mockGetLedger, mockInsertPayment } = vi.hoisted(() => ({
  mockGetCustomers: vi.fn(),
  mockGetLedger: vi.fn(),
  mockInsertPayment: vi.fn(),
}));
vi.mock('../../lib/db', () => ({
  getCustomersWithLocalBalance: mockGetCustomers,
  getCustomerLedgerLocal: mockGetLedger,
  insertCustomerPayment: mockInsertPayment,
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { CustomersPage } from '../CustomersPage';
import type { CustomerWithBalance } from '../../lib/db';

function cust(over: Partial<CustomerWithBalance> = {}): CustomerWithBalance {
  return {
    client_customer_id: over.client_customer_id ?? 'c1',
    server_id: null,
    name: over.name ?? 'Иван',
    phone: over.phone ?? null,
    email: null,
    address: null,
    description: null,
    is_active: 1,
    sync_status: over.sync_status ?? 'synced',
    error_kind: null,
    local_balance: over.local_balance ?? 0,
  };
}

function normDigits(t: string): string {
  return t.replace(/[\s  ]/g, '');
}

describe('CustomersPage', () => {
  it('loads customers and shows a positive debt', async () => {
    mockGetLedger.mockResolvedValue([]);
    mockGetCustomers.mockResolvedValue([cust({ client_customer_id: 'c1', name: 'Иван', local_balance: 10000 })]);
    render(
      <MemoryRouter>
        <CustomersPage />
      </MemoryRouter>,
    );
    // name shows in both the list card and the detail header
    expect((await screen.findAllByText('Иван')).length).toBeGreaterThanOrEqual(1);
    const debt = await screen.findAllByText((t) => normDigits(t).includes('10000'));
    expect(debt.length).toBeGreaterThanOrEqual(1);
  });

  it('records a payment and refetches so the shown debt drops', async () => {
    mockGetLedger.mockResolvedValue([]);
    mockInsertPayment.mockResolvedValue({ clientPaymentId: 'p1' });
    mockGetCustomers
      .mockResolvedValueOnce([cust({ client_customer_id: 'c1', name: 'Иван', local_balance: 10000 })])
      .mockResolvedValueOnce([cust({ client_customer_id: 'c1', name: 'Иван', local_balance: 6000 })]);
    render(
      <MemoryRouter>
        <CustomersPage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Принять оплату долга' }));
    fireEvent.change(screen.getByLabelText('Сумма оплаты'), { target: { value: '4000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить оплату' }));

    await waitFor(() => expect(mockGetCustomers).toHaveBeenCalledTimes(2));
    const dropped = await screen.findAllByText((t) => normDigits(t).includes('6000'));
    expect(dropped.length).toBeGreaterThanOrEqual(1);
    expect(mockInsertPayment).toHaveBeenCalledWith({
      customer_client_id: 'c1',
      amount: 4000,
      payment_method: 'cash',
      description: null,
    });
  });

  it('filters to only customers with debt via the "Есть долг" tab', async () => {
    mockGetLedger.mockResolvedValue([]);
    mockGetCustomers.mockResolvedValue([
      cust({ client_customer_id: 'c1', name: 'Должник', local_balance: 5000 }),
      cust({ client_customer_id: 'c2', name: 'Чистый', local_balance: 0 }),
    ]);
    render(
      <MemoryRouter>
        <CustomersPage />
      </MemoryRouter>,
    );
    // 'Должник' renders in both the list card and the auto-selected detail header
    // (same dual-rendering as the single-customer case above), so use the plural query.
    await screen.findAllByText('Должник');
    fireEvent.click(screen.getByRole('button', { name: 'Есть долг' }));
    await waitFor(() => expect(screen.queryByText('Чистый')).not.toBeInTheDocument());
    expect(screen.getAllByText('Должник').length).toBeGreaterThanOrEqual(1);
  });
});
