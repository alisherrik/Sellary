import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MoreSheet from '../MoreSheet';

const { mockPush, state } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  state: {
    modules: {} as Record<string, string>,
    isAdmin: false,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/lib/store', () => ({
  useModules: () => state.modules,
  useAuthStore: (selector: (s: { currentCompany: { role: string } }) => unknown) =>
    selector({ currentCompany: { role: state.isAdmin ? 'admin' : 'manager' } }),
}));

describe('MoreSheet', () => {
  it('renders nothing when closed', () => {
    state.modules = { pos: 'manager', inventory: 'manager', purchasing: 'manager', shop: 'manager', reports: 'manager' };
    state.isAdmin = false;
    const { container } = render(<MoreSheet isOpen={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the modules that overflowed past the bottom bar', () => {
    // pos, inventory, purchasing, shop fill the 4 tab slots; reports overflows here.
    state.modules = { pos: 'manager', inventory: 'manager', purchasing: 'manager', shop: 'manager', reports: 'manager' };
    state.isAdmin = false;
    render(<MoreSheet isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Отчеты')).toBeInTheDocument();
    expect(screen.queryByText('Касса')).not.toBeInTheDocument();
  });

  it('adds Настройки for admins when it overflows the tab bar', () => {
    state.modules = { pos: 'manager', inventory: 'manager', purchasing: 'manager', shop: 'manager', reports: 'manager' };
    state.isAdmin = true;
    render(<MoreSheet isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Отчеты')).toBeInTheDocument();
    expect(screen.getByText('Настройки')).toBeInTheDocument();
  });

  it('navigates to the module\'s first page and closes on item click', async () => {
    state.modules = { pos: 'manager', inventory: 'manager', purchasing: 'manager', shop: 'manager', reports: 'manager' };
    state.isAdmin = false;
    const onClose = vi.fn();
    render(<MoreSheet isOpen={true} onClose={onClose} />);
    await userEvent.click(screen.getByText('Отчеты'));
    expect(mockPush).toHaveBeenCalledWith('/dashboard');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on backdrop click', async () => {
    state.modules = { pos: 'manager', inventory: 'manager', purchasing: 'manager', shop: 'manager', reports: 'manager' };
    state.isAdmin = false;
    const onClose = vi.fn();
    render(<MoreSheet isOpen={true} onClose={onClose} />);
    const backdrop = document.querySelector('.bg-black\\/50');
    expect(backdrop).not.toBeNull();
    await userEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalled();
  });
});
