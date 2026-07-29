import { describe, expect, it } from 'vitest';

import { HELP_BASE_URL, helpUrlFor } from '../help';

describe('helpUrlFor', () => {
  it('sends each module page to its own chapter', () => {
    expect(helpUrlFor('/shifts')).toBe(`${HELP_BASE_URL}/kassa/smena/`);
    expect(helpUrlFor('/write-offs')).toBe(`${HELP_BASE_URL}/sklad/spisaniya/`);
  });

  it('matches nested routes to the parent chapter', () => {
    expect(helpUrlFor('/purchase-orders/12/edit')).toBe(`${HELP_BASE_URL}/zakupki/zakazy/`);
  });

  it('does not confuse /orders with /purchase-orders', () => {
    expect(helpUrlFor('/orders')).toBe(`${HELP_BASE_URL}/magazin/`);
    expect(helpUrlFor('/purchase-orders')).toBe(`${HELP_BASE_URL}/zakupki/zakazy/`);
  });

  it('falls back to the index for unmapped pages', () => {
    expect(helpUrlFor('/apps')).toBe(`${HELP_BASE_URL}/`);
  });
});
