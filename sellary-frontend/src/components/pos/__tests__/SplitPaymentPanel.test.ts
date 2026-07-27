import { describe, expect, it } from 'vitest';

import {
  evaluateSplit,
  newTender,
  parseAmount,
  toPaymentsPayload,
  type SplitTender,
} from '../SplitPaymentPanel';

function tender(
  method: SplitTender['method'],
  amount: string,
  cardType: SplitTender['cardType'] = null,
): SplitTender {
  return { ...newTender(method), cardType, amount };
}

/** 50 сомони: 26 наличными, 10 DC, 10 Эсхата, 4 в долг. */
const FOUR_WAYS = [
  tender('cash', '26.00'),
  tender('card', '10.00', 'dc'),
  tender('card', '10.00', 'eskhata'),
  tender('credit', '4.00'),
];

describe('evaluateSplit', () => {
  it('accepts the worked example', () => {
    const state = evaluateSplit(FOUR_WAYS, 50, true);
    expect(state.remaining).toBe(0);
    expect(state.isValid).toBe(true);
    expect(state.problems).toEqual([]);
  });

  it('says how much is still owed rather than just refusing', () => {
    const state = evaluateSplit([tender('cash', '26.00')], 50, false);
    expect(state.remaining).toBe(24);
    expect(state.isValid).toBe(false);
    expect(state.problems[0]).toContain('24.00');
  });

  it('catches an overpayment too', () => {
    const state = evaluateSplit([tender('cash', '60.00')], 50, false);
    expect(state.remaining).toBe(-10);
    expect(state.problems[0]).toContain('больше');
  });

  it('does not trip over binary floating point', () => {
    // 0.1 + 0.2 is 0.30000000000000004, which would leave the checkout button
    // disabled on an exactly-paid sale.
    const state = evaluateSplit(
      [tender('cash', '0.1'), tender('card', '0.2', 'dc')],
      0.3,
      false,
    );
    expect(state.remaining).toBe(0);
    expect(state.isValid).toBe(true);
  });

  it('requires a client when part of the sale goes on the tab', () => {
    const state = evaluateSplit(FOUR_WAYS, 50, false);
    expect(state.hasCredit).toBe(true);
    expect(state.isValid).toBe(false);
    expect(state.problems.join(' ')).toContain('клиента');
  });

  it('refuses two debt lines', () => {
    const state = evaluateSplit(
      [tender('credit', '25.00'), tender('credit', '25.00')],
      50,
      true,
    );
    expect(state.problems.join(' ')).toContain('один раз');
  });

  it('refuses a card line with no bank', () => {
    const state = evaluateSplit([tender('card', '50.00', null)], 50, false);
    expect(state.problems.join(' ')).toContain('банк');
  });

  it('refuses an empty or zero line', () => {
    const state = evaluateSplit([tender('cash', ''), tender('cash', '50.00')], 50, false);
    expect(state.isValid).toBe(false);
    expect(state.problems.join(' ')).toContain('больше нуля');
  });
});

describe('toPaymentsPayload', () => {
  it('sends every tender at two decimals', () => {
    expect(toPaymentsPayload(FOUR_WAYS)).toEqual([
      { method: 'cash', amount: '26.00' },
      { method: 'card', card_type: 'dc', amount: '10.00' },
      { method: 'card', card_type: 'eskhata', amount: '10.00' },
      { method: 'credit', amount: '4.00' },
    ]);
  });

  it('omits card_type on non-card lines', () => {
    // The server rejects a bank on anything but a card.
    const [line] = toPaymentsPayload([tender('cash', '5')]);
    expect(line).not.toHaveProperty('card_type');
  });
});

describe('parseAmount', () => {
  it('accepts a comma decimal, which is how people type here', () => {
    expect(parseAmount('26,50')).toBe(26.5);
  });

  it('treats unparseable input as nothing rather than NaN', () => {
    expect(parseAmount('')).toBe(0);
    expect(parseAmount('abc')).toBe(0);
  });
});
