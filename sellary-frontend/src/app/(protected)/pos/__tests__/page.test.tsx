import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import POS from '../page';
import { useCartStore } from '@/lib/store';

vi.mock('@/providers/ServerHealthProvider', () => ({
  useServerHealth: () => ({ isServerReachable: true }),
}));

vi.mock('@/components/pos/ProductDrawer', () => ({
  default: () => null,
}));

vi.mock('@/lib/api', () => ({
  salesApi: {
    create: vi.fn(),
  },
}));

vi.mock('@/lib/syncQueue', () => ({
  addToSyncQueue: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe('POS multi-sale sessions', () => {
  beforeEach(() => {
    localStorage.clear();
    useCartStore.getState().resetState();
  });

  it('opens a new empty sale when the cashier clicks the new sale button', async () => {
    const user = userEvent.setup();

    render(<POS />);

    expect(screen.getByRole('tab', { name: /продажа 1/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /новая продажа/i }));

    expect(screen.getByRole('tab', { name: /продажа 2/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByText('Корзина пуста')).toBeInTheDocument();
  });
});
