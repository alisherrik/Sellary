import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BottomTabBar from '../BottomTabBar';

const { state } = vi.hoisted(() => ({
  state: {
    modules: {} as Record<string, string>,
    isAdmin: false,
  },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/pos',
}));

vi.mock('@/lib/store', () => ({
  useModules: () => state.modules,
  useAuthStore: (selector: (s: { currentCompany: { role: string } }) => unknown) =>
    selector({ currentCompany: { role: state.isAdmin ? 'admin' : 'manager' } }),
}));

describe('BottomTabBar', () => {
  it('renders one tab per granted module, capped at 4, plus Ещё for the overflow', () => {
    state.modules = { pos: 'manager', inventory: 'manager', purchasing: 'manager', shop: 'manager', reports: 'manager' };
    state.isAdmin = false;
    render(<BottomTabBar onMoreClick={vi.fn()} />);
    expect(screen.getByText('Касса')).toBeInTheDocument();
    expect(screen.getByText('Склад')).toBeInTheDocument();
    expect(screen.getByText('Закупки')).toBeInTheDocument();
    expect(screen.getByText('Магазин')).toBeInTheDocument();
    // 5th granted module (Отчеты) is folded into "Ещё", not its own tab.
    expect(screen.queryByText('Отчеты')).not.toBeInTheDocument();
    expect(screen.getByText('Ещё')).toBeInTheDocument();
  });

  it('hides "Ещё" when granted modules fit within 4 tabs and none have secondary pages', () => {
    // inventory and shop are both single-page modules — nothing for a sheet to hold.
    state.modules = { inventory: 'user', shop: 'user' };
    state.isAdmin = false;
    render(<BottomTabBar onMoreClick={vi.fn()} />);
    expect(screen.getByText('Склад')).toBeInTheDocument();
    expect(screen.getByText('Магазин')).toBeInTheDocument();
    expect(screen.queryByText('Ещё')).not.toBeInTheDocument();
  });

  it('shows "Ещё" when a visible (non-overflowed) module has a second page', () => {
    // Only 2 modules granted (well under the 4-tab cap), but purchasing has a
    // second page (/purchase-orders) with no other mobile entry point.
    state.modules = { inventory: 'user', purchasing: 'user' };
    state.isAdmin = false;
    render(<BottomTabBar onMoreClick={vi.fn()} />);
    expect(screen.getByText('Склад')).toBeInTheDocument();
    expect(screen.getByText('Закупки')).toBeInTheDocument();
    expect(screen.getByText('Ещё')).toBeInTheDocument();
  });

  it('adds a Настройки tab for admins without showing "Ещё" when nothing overflows', () => {
    state.modules = { inventory: 'manager', shop: 'manager' };
    state.isAdmin = true;
    render(<BottomTabBar onMoreClick={vi.fn()} />);
    expect(screen.getByText('Настройки')).toBeInTheDocument();
    expect(screen.queryByText('Ещё')).not.toBeInTheDocument();
  });

  it('highlights active tab based on pathname', () => {
    state.modules = { pos: 'manager', inventory: 'manager', purchasing: 'manager', shop: 'manager', reports: 'manager' };
    state.isAdmin = false;
    render(<BottomTabBar onMoreClick={vi.fn()} />);
    const posLink = screen.getByText('Касса').closest('a');
    expect(posLink).toBeInTheDocument();
  });

  it('marks the active tab with aria-current, not colour alone', () => {
    state.modules = { pos: 'manager', inventory: 'manager', purchasing: 'manager', shop: 'manager', reports: 'manager' };
    state.isAdmin = false;
    render(<BottomTabBar onMoreClick={vi.fn()} />);
    // usePathname is mocked to /pos for this suite.
    expect(screen.getByText('Касса').closest('a')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Склад').closest('a')).not.toHaveAttribute('aria-current');
  });

  it('reports the sheet\'s open state on the "Ещё" trigger', () => {
    state.modules = { pos: 'manager', inventory: 'manager', purchasing: 'manager', shop: 'manager', reports: 'manager' };
    state.isAdmin = false;
    const { rerender } = render(<BottomTabBar onMoreClick={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Ещё' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    rerender(<BottomTabBar onMoreClick={vi.fn()} moreOpen />);
    expect(screen.getByRole('button', { name: 'Ещё' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('calls onMoreClick when "Ещё" is clicked', async () => {
    state.modules = { pos: 'manager', inventory: 'manager', purchasing: 'manager', shop: 'manager', reports: 'manager' };
    state.isAdmin = false;
    const onMoreClick = vi.fn();
    render(<BottomTabBar onMoreClick={onMoreClick} />);
    await userEvent.click(screen.getByText('Ещё'));
    expect(onMoreClick).toHaveBeenCalledTimes(1);
  });
});
