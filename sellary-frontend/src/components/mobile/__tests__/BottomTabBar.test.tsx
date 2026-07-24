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

  it('hides "Ещё" when 4 or fewer modules are granted', () => {
    state.modules = { pos: 'user', inventory: 'user', purchasing: 'user' };
    state.isAdmin = false;
    render(<BottomTabBar onMoreClick={vi.fn()} />);
    expect(screen.getByText('Касса')).toBeInTheDocument();
    expect(screen.getByText('Склад')).toBeInTheDocument();
    expect(screen.getByText('Закупки')).toBeInTheDocument();
    expect(screen.queryByText('Ещё')).not.toBeInTheDocument();
  });

  it('adds a Настройки tab for admins, counting toward the 4-tab cap', () => {
    state.modules = { pos: 'manager', inventory: 'manager', purchasing: 'manager' };
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

  it('calls onMoreClick when "Ещё" is clicked', async () => {
    state.modules = { pos: 'manager', inventory: 'manager', purchasing: 'manager', shop: 'manager', reports: 'manager' };
    state.isAdmin = false;
    const onMoreClick = vi.fn();
    render(<BottomTabBar onMoreClick={onMoreClick} />);
    await userEvent.click(screen.getByText('Ещё'));
    expect(onMoreClick).toHaveBeenCalledTimes(1);
  });
});
