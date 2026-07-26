import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import { ShiftTotalsPanel } from '../ShiftTotalsPanel';
import type { CashShift, ShiftTotals } from '@/lib/types';

/**
 * These numbers are the real Смена №5 of company 2 on 2026-07-26, the shift a
 * cashier reported as "not adding up". They add up; the panel just never said
 * how. Keeping the real figures here means a regression shows as the exact
 * confusion that was reported.
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
  movements_in: '0.00',
  movements_out: '0.00',
  movements: [],
  expected_cash: '12583.12',
};

const openShift: CashShift = {
  id: 8,
  shift_number: 5,
  status: 'open',
  opened_at: '2026-07-26T02:55:10Z',
  opened_by_user_id: 1,
  opening_cash: '11656.29',
  closed_at: null,
  closed_by_user_id: null,
  counted_cash: null,
  expected_cash: null,
  discrepancy: null,
  totals,
} as CashShift;

/**
 * The value rendered beside a label, as the cashier reads the row.
 * Intl groups thousands with a narrow no-break space, so the digits are
 * normalised to plain spaces before comparing.
 */
const valueFor = (label: string | RegExp) => {
  const row = screen.getByText(label).closest('div');
  const text = within(row as HTMLElement).getAllByText(/\d/).pop()?.textContent ?? '';
  return text.replace(/[   ]/g, ' ');
};

describe('ShiftTotalsPanel', () => {
  it('shows a revenue total so the breakdown can be checked against something', () => {
    render(<ShiftTotalsPanel shift={openShift} totals={totals} />);
    // 642.83 + 50.00 + 0 + 31.00 = 723.83. Debt repayment is NOT in it.
    expect(valueFor('Итого выручка')).toContain('723,83');
  });

  it('keeps the debt repayment out of revenue and in the cash movements', () => {
    render(<ShiftTotalsPanel shift={openShift} totals={totals} />);
    expect(valueFor('Итого выручка')).not.toContain('1 006');
    expect(screen.getByText('Оплата долга (Наличные)')).toBeInTheDocument();
    expect(screen.getByText(/Не входят в выручку смены/)).toBeInTheDocument();
  });

  it('spells out the drawer arithmetic instead of only its answer', () => {
    render(<ShiftTotalsPanel shift={openShift} totals={totals} />);
    // 11 656.29 + 642.83 + 284.00 = 12 583.12
    expect(valueFor('На начало')).toContain('11 656,29');
    expect(valueFor('Продажи наличными')).toContain('642,83');
    expect(valueFor('Оплата долга наличными')).toContain('284,00');
    expect(valueFor('Ожидается в кассе')).toContain('12 583,12');
  });

  it('marks credit sales as money not yet received', () => {
    render(<ShiftTotalsPanel shift={openShift} totals={totals} />);
    expect(screen.getByText(/деньги ещё не получены/)).toBeInTheDocument();
  });

  it('pads every amount to two decimals so a column can be added by eye', () => {
    render(<ShiftTotalsPanel shift={openShift} totals={totals} />);
    // The reported screenshot showed "TJS 374.3" above "TJS 7"; misaligned
    // decimal points are what made the column unreadable.
    expect(valueFor('Alif')).toContain('6,00');
    expect(valueFor('В долг')).toContain('31,00');
  });

  it('does not invent a cash movements block when there were none', () => {
    render(
      <ShiftTotalsPanel
        shift={openShift}
        totals={{ ...totals, debt_payments_by_method: {}, refunds_by_method: {} }}
      />,
    );
    expect(screen.queryByText('Прочие движения денег')).not.toBeInTheDocument();
  });

  it('subtracts a cash refund from the expected drawer', () => {
    render(
      <ShiftTotalsPanel
        shift={openShift}
        totals={{ ...totals, refunds_by_method: { cash: '4.70' }, expected_cash: '12578.42' }}
      />,
    );
    expect(valueFor('Возвраты наличными')).toContain('4,70');
    expect(valueFor('Ожидается в кассе')).toContain('12 578,42');
  });

  it('names a shortfall and an overage rather than calling both a discrepancy', () => {
    const closed = {
      ...openShift,
      status: 'closed',
      counted_cash: '12580.12',
      expected_cash: '12583.12',
      discrepancy: '-3.00',
    } as CashShift;
    render(<ShiftTotalsPanel shift={closed} totals={totals} />);
    expect(screen.getByText('Недостача')).toBeInTheDocument();
    expect(valueFor('Посчитано')).toContain('12 580,12');
  });
});

describe('ShiftTotalsPanel · cash taken in and out', () => {
  /**
   * Before cash movements existed, every one of these showed up as a
   * недостача or an излишек: the shop paid a supplier from the drawer and the
   * shift called it missing money.
   */
  const withMovements = {
    ...totals,
    movements_in: '300.00',
    movements_out: '150.00',
    movements: [
      {
        id: 1,
        direction: 'in' as const,
        amount: '300.00',
        reason: 'transfer_in',
        reason_label: 'Перевод (приход)',
        note: 'Снятие с карты',
        created_at: '2026-07-26T10:00:00Z',
      },
      {
        id: 2,
        direction: 'out' as const,
        amount: '150.00',
        reason: 'supplier_payment',
        reason_label: 'Оплата поставщику',
        note: 'Оплата за хлеб',
        created_at: '2026-07-26T14:00:00Z',
      },
    ],
    expected_cash: '12733.12',
  };

  it('lists each movement with its reason and note', () => {
    render(<ShiftTotalsPanel shift={openShift} totals={withMovements} />);
    expect(screen.getByText('Оплата поставщику')).toBeInTheDocument();
    expect(screen.getByText(/Оплата за хлеб/)).toBeInTheDocument();
    expect(screen.getByText('Перевод (приход)')).toBeInTheDocument();
  });

  it('folds them into the drawer arithmetic', () => {
    render(<ShiftTotalsPanel shift={openShift} totals={withMovements} />);
    // 11 656.29 + 642.83 + 284.00 + 300.00 − 150.00 = 12 733.12
    expect(valueFor('Внесения в кассу')).toContain('300,00');
    expect(valueFor('Изъятия из кассы')).toContain('150,00');
    expect(valueFor('Ожидается в кассе')).toContain('12 733,12');
  });

  it('says plainly that they are not revenue', () => {
    render(<ShiftTotalsPanel shift={openShift} totals={withMovements} />);
    expect(screen.getByText(/внесения и изъятия — это не торговля/)).toBeInTheDocument();
  });

  it('shows no movement rows when there were none', () => {
    render(<ShiftTotalsPanel shift={openShift} totals={totals} />);
    expect(screen.queryByText('Внесения в кассу')).not.toBeInTheDocument();
    expect(screen.queryByText('Изъятия из кассы')).not.toBeInTheDocument();
  });
});
