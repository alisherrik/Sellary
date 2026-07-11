import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CustomerList } from '../CustomerList';
import type { CustomerWithBalance } from '../../../lib/db';

function cust(over: Partial<CustomerWithBalance> = {}): CustomerWithBalance {
  return {
    client_customer_id: over.client_customer_id ?? 'c1',
    server_id: over.server_id ?? null,
    name: over.name ?? 'Иван',
    phone: over.phone ?? null,
    email: null,
    address: null,
    description: over.description ?? null,
    is_active: 1,
    sync_status: over.sync_status ?? 'synced',
    error_kind: over.error_kind ?? null,
    local_balance: over.local_balance ?? 0,
  };
}

const noop = () => {};

describe('CustomerList', () => {
  it('renders a positive local debt in red and a sync badge for unsynced customers', () => {
    const { container } = render(
      <CustomerList
        customers={[cust({ client_customer_id: 'c1', name: 'Иван', phone: '901112233', local_balance: 5000, sync_status: 'pending' })]}
        selectedClientId={null}
        onSelect={noop}
        search=""
        onSearch={noop}
        filter="all"
        onFilter={noop}
        counts={{ all: 1, debt: 1, clear: 0 }}
        loading={false}
      />,
    );
    expect(screen.getByText('901112233')).toBeInTheDocument();
    const debt = container.querySelector('.text-red-600');
    expect(debt).not.toBeNull();
    expect(debt?.textContent ?? '').toMatch(/5/);
    // SyncStatusBadge for a pending row renders "Ожидает"
    expect(screen.getByText('Ожидает')).toBeInTheDocument();
  });

  it('does not render a sync badge for a synced customer and greys a zero balance', () => {
    const { container } = render(
      <CustomerList
        customers={[cust({ client_customer_id: 'c2', name: 'Ольга', local_balance: 0, sync_status: 'synced' })]}
        selectedClientId={null}
        onSelect={noop}
        search=""
        onSearch={noop}
        filter="all"
        onFilter={noop}
        counts={{ all: 1, debt: 0, clear: 1 }}
        loading={false}
      />,
    );
    expect(screen.queryByText('Ожидает')).not.toBeInTheDocument();
    expect(container.querySelector('.text-red-600')).toBeNull();
    expect(container.querySelector('.text-gray-400')).not.toBeNull();
  });

  it('calls onSelect with the clicked customer', () => {
    const onSelect = vi.fn();
    render(
      <CustomerList
        customers={[cust({ client_customer_id: 'c9', name: 'Пётр' })]}
        selectedClientId={null}
        onSelect={onSelect}
        search=""
        onSearch={noop}
        filter="all"
        onFilter={noop}
        counts={{ all: 1, debt: 0, clear: 1 }}
        loading={false}
      />,
    );
    fireEvent.click(screen.getByText('Пётр'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].client_customer_id).toBe('c9');
  });

  it('propagates the search box value', () => {
    const onSearch = vi.fn();
    render(
      <CustomerList
        customers={[]}
        selectedClientId={null}
        onSelect={noop}
        search=""
        onSearch={onSearch}
        filter="all"
        onFilter={noop}
        counts={{ all: 0, debt: 0, clear: 0 }}
        loading={false}
      />,
    );
    fireEvent.change(screen.getByLabelText('Поиск клиентов'), { target: { value: 'ив' } });
    expect(onSearch).toHaveBeenCalledWith('ив');
  });

  it('shows an empty state when there are no customers', () => {
    render(
      <CustomerList
        customers={[]}
        selectedClientId={null}
        onSelect={noop}
        search=""
        onSearch={noop}
        filter="all"
        onFilter={noop}
        counts={{ all: 0, debt: 0, clear: 0 }}
        loading={false}
      />,
    );
    expect(screen.getByText('Клиентов пока нет')).toBeInTheDocument();
  });
});
