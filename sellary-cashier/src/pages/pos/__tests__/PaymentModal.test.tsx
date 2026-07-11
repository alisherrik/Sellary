import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PaymentModal } from '../PaymentModal';
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

const creditBundle = (over = {}) => ({
  customers: [customer()],
  search: '',
  onSearch: () => {},
  selectedCustomerId: null as string | null,
  onSelect: () => {},
  qcName: '',
  onQcName: () => {},
  qcPhone: '',
  onQcPhone: () => {},
  qcDescription: '',
  onQcDescription: () => {},
  creatingCustomer: false,
  onCreateCustomer: () => {},
  paidAmount: '',
  onPaidAmount: () => {},
  paymentMethod: 'cash' as const,
  onPaymentMethod: () => {},
  ...over,
});

const base = {
  open: true,
  total: 10000,
  method: 'cash' as const,
  onMethod: () => {},
  cardType: null,
  onCardType: () => {},
  cashReceived: '',
  onCashReceived: () => {},
  loading: false,
  onConfirm: vi.fn(),
  onClose: () => {},
  credit: creditBundle(),
};

describe('PaymentModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<PaymentModal {...base} open={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('offers an enabled «В долг» tab and shows the picker when credit is active', () => {
    const onMethod = vi.fn();
    const { rerender } = render(<PaymentModal {...base} onMethod={onMethod} />);
    const creditTab = screen.getByText(/В долг/).closest('button')!;
    expect(creditTab).not.toBeDisabled();
    fireEvent.click(creditTab);
    expect(onMethod).toHaveBeenCalledWith('credit');
    rerender(<PaymentModal {...base} method="credit" />);
    expect(screen.getByLabelText('Поиск клиента')).toBeInTheDocument();
    expect(screen.getByText('Иван')).toBeInTheDocument();
  });

  it('gates the credit confirm on a selected customer and a valid initial payment', () => {
    const { rerender } = render(
      <PaymentModal {...base} method="credit" credit={creditBundle({ selectedCustomerId: null })} />,
    );
    expect(screen.getByText('Завершить продажу').closest('button')!).toBeDisabled();

    rerender(
      <PaymentModal {...base} method="credit" credit={creditBundle({ selectedCustomerId: 'c1', paidAmount: '4000' })} />,
    );
    expect(screen.getByText('Завершить продажу').closest('button')!).not.toBeDisabled();

    rerender(
      <PaymentModal {...base} method="credit" credit={creditBundle({ selectedCustomerId: 'c1', paidAmount: '15000' })} />,
    );
    expect(screen.getByText('Завершить продажу').closest('button')!).toBeDisabled();
  });

  it('gates confirm until cash is sufficient', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(<PaymentModal {...base} onConfirm={onConfirm} cashReceived="5000" />);
    expect(screen.getByText('Завершить продажу').closest('button')!).toBeDisabled();
    rerender(<PaymentModal {...base} onConfirm={onConfirm} cashReceived="12000" />);
    fireEvent.click(screen.getByText('Завершить продажу'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('gates confirm on card until a card type is chosen', () => {
    const { rerender } = render(<PaymentModal {...base} method="card" cardType={null} />);
    expect(screen.getByText('Завершить продажу').closest('button')!).toBeDisabled();
    rerender(<PaymentModal {...base} method="card" cardType="alif" />);
    expect(screen.getByText('Завершить продажу').closest('button')!).not.toBeDisabled();
  });
});
