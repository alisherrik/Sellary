import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CloseShiftForm } from '../CloseShiftForm';
import type { CashShift, ShiftTotals } from '@/lib/types';

/**
 * Смена №5 of company 2, closed on 26.07 at 12 633.12 — which is exactly
 * 12 583.12 expected plus the 50.00 taken on card. Three of the shop's five
 * closes had that shape, and the other two were the expected figure typed back
 * verbatim. This form exists to break that habit.
 */
const totals: ShiftTotals = {
  cash_sales: '642.83',
  card_sales: '50.00',
  card_by_type: { dc: '44.00', alif: '6.00' },
  mobile_sales: '0.00',
  credit_sales: '31.00',
  debt_payments_by_method: { cash: '284.00' },
  refunds_by_method: {},
  sales_count: 43,
  expected_cash: '12583.12',
};

const shift = {
  id: 8,
  shift_number: 5,
  status: 'open',
  opening_cash: '11656.29',
  totals,
} as CashShift;

const renderForm = (overrides?: Partial<ShiftTotals>) => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <CloseShiftForm
      shift={shift}
      totals={{ ...totals, ...overrides }}
      submitting={false}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  );
  return { onConfirm, onCancel };
};

const field = () => screen.getByLabelText('Посчитанные наличные в кассе');

describe('CloseShiftForm', () => {
  it('never shows the expected figure before a number is entered', () => {
    renderForm();
    // The old form put it in the placeholder, and every production close came
    // back as that number or that number plus the card takings.
    expect(field()).toHaveValue(null);
    expect(field()).not.toHaveAttribute('placeholder');
    expect(screen.queryByText('Ожидается в кассе')).not.toBeInTheDocument();
  });

  it('will not submit an empty count', () => {
    renderForm();
    expect(screen.getByRole('button', { name: 'Подтвердить закрытие' })).toBeDisabled();
  });

  it('shows the arithmetic once the cashier commits to a number', async () => {
    renderForm();
    await userEvent.type(field(), '12580.12');
    expect(screen.getByText('Ожидается в кассе')).toBeInTheDocument();
    expect(screen.getByText('Вы насчитали')).toBeInTheDocument();
    expect(screen.getByText('Недостача')).toBeInTheDocument();
  });

  it('names the card takings when the difference is exactly them', async () => {
    renderForm();
    await userEvent.type(field(), '12633.12'); // expected + card 50.00
    expect(screen.getByRole('alert')).toHaveTextContent('выручку по карте');
    expect(screen.getByRole('alert')).toHaveTextContent('50');
  });

  it('names credit sales when those were added instead', async () => {
    renderForm();
    await userEvent.type(field(), '12614.12'); // expected + credit 31.00
    expect(screen.getByRole('alert')).toHaveTextContent('продажи в долг');
  });

  it('leaves an ordinary shortfall alone', async () => {
    renderForm();
    await userEvent.type(field(), '12500');
    expect(screen.getByText('Недостача')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says nothing when the till simply balances', async () => {
    renderForm();
    await userEvent.type(field(), '12583.12');
    expect(screen.getByText('Расхождение')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('lists what is not in the drawer', () => {
    renderForm();
    expect(screen.getByText(/Не в кассе за эту смену/)).toBeInTheDocument();
  });

  it('passes the typed count through untouched', async () => {
    const { onConfirm } = renderForm();
    await userEvent.type(field(), '12500.55');
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить закрытие' }));
    expect(onConfirm).toHaveBeenCalledWith('12500.55');
  });
});
