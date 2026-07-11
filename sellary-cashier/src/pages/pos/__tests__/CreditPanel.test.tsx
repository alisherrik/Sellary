import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CreditPanel, type CreditPanelProps } from '../CreditPanel';
import type { CustomerWithBalance } from '../../../lib/db';

const customer = (over: Partial<CustomerWithBalance> = {}): CustomerWithBalance => ({
  client_customer_id: 'c1',
  server_id: 1,
  name: 'Иван',
  phone: '+998901112233',
  email: null,
  address: null,
  description: null,
  is_active: 1,
  sync_status: 'synced',
  error_kind: null,
  local_balance: 0,
  ...over,
});

function setup(over: Partial<CreditPanelProps> = {}) {
  const props: CreditPanelProps = {
    total: 10000,
    customers: [customer()],
    search: '',
    onSearch: vi.fn(),
    selectedCustomerId: null,
    onSelect: vi.fn(),
    qcName: '',
    onQcName: vi.fn(),
    qcPhone: '',
    onQcPhone: vi.fn(),
    qcDescription: '',
    onQcDescription: vi.fn(),
    creatingCustomer: false,
    onCreateCustomer: vi.fn(),
    paidAmount: '',
    onPaidAmount: vi.fn(),
    paymentMethod: 'cash',
    onPaymentMethod: vi.fn(),
    ...over,
  };
  const utils = render(<CreditPanel {...props} />);
  return { props, ...utils };
}

describe('CreditPanel', () => {
  it('renders a customer debt in red when local_balance > 0', () => {
    const { container } = setup({ customers: [customer({ name: 'Должник', local_balance: 5000 })] });
    expect(screen.getByText('Должник')).toBeInTheDocument();
    expect(container.querySelector('.text-red-600')).not.toBeNull();
  });

  it('calls onSelect with the client_customer_id when a customer row is clicked', () => {
    const { props } = setup({ customers: [customer({ client_customer_id: 'c9', name: 'Пётр' })] });
    fireEvent.click(screen.getByText('Пётр'));
    expect(props.onSelect).toHaveBeenCalledWith('c9');
  });

  it('disables «Создать клиента» until both name and phone are present', () => {
    const { rerender, props } = setup({ qcName: '', qcPhone: '' });
    expect(screen.getByRole('button', { name: /Создать клиента/ })).toBeDisabled();
    rerender(<CreditPanel {...props} qcName="Анна" qcPhone="+998900000000" />);
    const btn = screen.getByRole('button', { name: /Создать клиента/ });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(props.onCreateCustomer).toHaveBeenCalled();
  });

  it('flags an initial payment greater than the total', () => {
    setup({ paidAmount: '15000', total: 10000 });
    expect(screen.getByText(/Первый платёж больше суммы продажи/)).toBeInTheDocument();
  });

  it('shows the «Останется долг» label and forwards the paid-amount input', () => {
    const { props } = setup({ paidAmount: '4000', total: 10000 });
    expect(screen.getByText('Останется долг')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Оплачено сейчас'), { target: { value: '6000' } });
    expect(props.onPaidAmount).toHaveBeenCalledWith('6000');
  });
});
