import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockUnlock, mockNavigate } = vi.hoisted(() => ({
  mockUnlock: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}));

import { useAuthStore } from '../../lib/auth-store';
import { PinUnlockPage } from '../PinUnlockPage';

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    unlockWithPin: mockUnlock,
    isLocked: false,
    lockedUntil: null,
  } as never);
});

describe('PinUnlockPage', () => {
  it('unlocks and navigates to /cashier on success', async () => {
    mockUnlock.mockResolvedValue(true);
    render(<MemoryRouter><PinUnlockPage /></MemoryRouter>);

    fireEvent.change(screen.getByLabelText(/PIN/i), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: /Войти|Разблокировать/i }));

    await waitFor(() => expect(mockUnlock).toHaveBeenCalledWith('1234'));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/cashier', { replace: true }));
  });

  it('shows a lockout countdown and blocks input while locked', () => {
    useAuthStore.setState({
      isLocked: true,
      lockedUntil: new Date(Date.now() + 90_000).toISOString(),
    } as never);
    render(<MemoryRouter><PinUnlockPage /></MemoryRouter>);

    expect(screen.getByText(/Слишком много попыток/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Войти|Разблокировать/i })).toBeDisabled();
  });
});
