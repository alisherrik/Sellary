import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useReconciledFrom } from '@/lib/store';
import ReconciliationNotice, { SettledBadge } from '../ReconciliationNotice';

vi.mock('@/lib/store', () => ({
  useReconciledFrom: vi.fn(),
}));

const cutOff = (value: string | null) => {
  vi.mocked(useReconciledFrom).mockReturnValue(value);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ReconciliationNotice', () => {
  it('says nothing when the shop has never reconciled', () => {
    cutOff(null);
    const { container } = render(<ReconciliationNotice />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names the cut-off and what it means', () => {
    cutOff('2026-08-01');
    render(<ReconciliationNotice />);

    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('Сверка от 01.08.2026');
    expect(notice).toHaveTextContent('можно смотреть, но не изменять');
  });
});

describe('SettledBadge', () => {
  it('marks a row that falls in the settled period', () => {
    cutOff('2026-08-01');
    render(<SettledBadge at="2026-07-30T10:00:00" />);
    expect(screen.getByText('до сверки')).toBeInTheDocument();
  });

  it('leaves the open period unmarked, including the cut-off day itself', () => {
    cutOff('2026-08-01');
    // effective_from is the first OPEN day, so a document dated on it is not
    // settled — marking it would tell a cashier a live receipt is frozen.
    const { container } = render(<SettledBadge at="2026-08-01T09:00:00" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('marks nothing when there is no cut-off', () => {
    cutOff(null);
    const { container } = render(<SettledBadge at="2020-01-01T00:00:00" />);
    expect(container).toBeEmptyDOMElement();
  });
});
