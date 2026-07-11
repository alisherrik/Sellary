import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PaymentChip } from '../PaymentChip';

describe('PaymentChip', () => {
  it('renders cash by default and is case-insensitive', () => {
    render(<PaymentChip method="CASH" />);
    expect(screen.getByText(/Наличные/)).toBeInTheDocument();
  });
  it('renders the card brand label from card_type', () => {
    render(<PaymentChip method="card" cardType="ALIF" />);
    expect(screen.getByText(/Alif/)).toBeInTheDocument();
  });
  it('renders mobile', () => {
    render(<PaymentChip method="mobile" />);
    expect(screen.getByText(/Мобильный/)).toBeInTheDocument();
  });
  it('renders the credit (В долг) variant', () => {
    render(<PaymentChip method="credit" />);
    expect(screen.getByText(/В долг/)).toBeInTheDocument();
  });
  it('is case-insensitive for credit', () => {
    render(<PaymentChip method="CREDIT" />);
    expect(screen.getByText(/В долг/)).toBeInTheDocument();
  });
});
