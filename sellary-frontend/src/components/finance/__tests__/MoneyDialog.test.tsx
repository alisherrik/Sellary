import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MoneyDialog } from '../MoneyDialog';
import type { MoneyAccount, MovementReasons } from '@/lib/types';

const accounts: MoneyAccount[] = [
  {
    id: 1,
    name: 'Касса',
    is_till: true,
    card_type: null,
    balance: '12583.12',
    opening_balance: '0.00',
    opening_at: '2026-07-20T00:00:00Z',
    is_active: true,
    sort_order: 0,
  },
  {
    id: 2,
    name: 'Банк · DC',
    is_till: false,
    card_type: 'dc',
    balance: '4120.00',
    opening_balance: '0.00',
    opening_at: '2026-05-20T00:00:00Z',
    is_active: true,
    sort_order: 1,
  },
];

const reasons: MovementReasons = {
  in: [
    { value: 'owner_deposit', label: 'Внесение владельцем' },
    { value: 'change_float', label: 'Размен' },
  ],
  out: [
    { value: 'bank_deposit', label: 'Сдача в банк' },
    { value: 'supplier_payment', label: 'Оплата поставщику' },
  ],
};

const renderDialog = (mode: 'in' | 'out' | 'transfer' | 'correct') => {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  render(
    <MoneyDialog
      mode={mode}
      accounts={accounts}
      reasons={reasons}
      submitting={false}
      onClose={onClose}
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit, onClose };
};

const amountField = (label: string | RegExp) => screen.getByLabelText(label);

describe('MoneyDialog', () => {
  it('is a labelled modal dialog', () => {
    renderDialog('in');
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Внести деньги');
  });

  it('will not submit until an amount is entered', () => {
    renderDialog('in');
    expect(screen.getByRole('button', { name: 'Записать' })).toBeDisabled();
  });

  it('refuses a zero amount', async () => {
    renderDialog('out');
    await userEvent.type(amountField('Сумма'), '0');
    expect(screen.getByRole('button', { name: 'Записать' })).toBeDisabled();
  });

  it('shows the balance before and after, so the effect is visible first', async () => {
    renderDialog('out');
    await userEvent.type(amountField('Сумма'), '150');
    // 12 583.12 − 150 = 12 433.12
    expect(screen.getByText(/12 433,12/)).toBeInTheDocument();
  });

  it('sends the direction and the chosen reason', async () => {
    const { onSubmit } = renderDialog('out');
    await userEvent.type(amountField('Сумма'), '150');
    await userEvent.selectOptions(screen.getByLabelText('Причина'), 'supplier_payment');
    await userEvent.click(screen.getByRole('button', { name: 'Записать' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'out', amount: '150', reason: 'supplier_payment' }),
    );
  });

  it('defaults to the first reason rather than sending an empty one', async () => {
    const { onSubmit } = renderDialog('in');
    await userEvent.type(amountField('Сумма'), '300');
    await userEvent.click(screen.getByRole('button', { name: 'Записать' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'owner_deposit' }),
    );
  });
});

describe('MoneyDialog · transfer', () => {
  it('shows both sides moving, so it is clear money is not created', async () => {
    renderDialog('transfer');
    await userEvent.selectOptions(screen.getByLabelText('Откуда'), '2');
    await userEvent.selectOptions(screen.getByLabelText('Куда'), '1');
    await userEvent.type(amountField('Сумма'), '300');
    // Bank 4 120.00 → 3 820.00 and till 12 583.12 → 12 883.12
    expect(screen.getByText(/3 820,00/)).toBeInTheDocument();
    expect(screen.getByText(/12 883,12/)).toBeInTheDocument();
  });

  it('refuses a transfer to the same account', async () => {
    renderDialog('transfer');
    await userEvent.selectOptions(screen.getByLabelText('Куда'), '1');
    await userEvent.type(amountField('Сумма'), '50');
    expect(screen.getByRole('alert')).toHaveTextContent('совпадают');
    expect(screen.getByRole('button', { name: 'Записать' })).toBeDisabled();
  });

  it('asks for no reason: a transfer is its own reason', () => {
    renderDialog('transfer');
    expect(screen.queryByLabelText('Причина')).not.toBeInTheDocument();
  });
});

describe('MoneyDialog · correction', () => {
  it('asks what is actually there, not what to add', async () => {
    const { onSubmit } = renderDialog('correct');
    const field = amountField('Сколько на счёте на самом деле');
    await userEvent.type(field, '12000');
    // The difference is the server's to compute; the cashier states the fact.
    expect(screen.getByText(/12 000,00/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Записать' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'correct', amount: '12000' }),
    );
  });
});
