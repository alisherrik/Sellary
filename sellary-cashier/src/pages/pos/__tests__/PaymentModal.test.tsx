import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PaymentModal } from '../PaymentModal';

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
};

describe('PaymentModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<PaymentModal {...base} open={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('disables the В долг (credit) option with an internet hint', () => {
    render(<PaymentModal {...base} />);
    const credit = screen.getByText(/В долг/).closest('button')!;
    expect(credit).toBeDisabled();
    expect(credit.getAttribute('title')).toMatch(/интернет/i);
  });

  it('gates confirm until cash is sufficient', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(<PaymentModal {...base} onConfirm={onConfirm} cashReceived="5000" />);
    const confirm = screen.getByText('Завершить продажу').closest('button')!;
    expect(confirm).toBeDisabled();
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
