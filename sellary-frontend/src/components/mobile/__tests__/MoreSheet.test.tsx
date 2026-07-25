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
  usePathname: () => '/suppliers',
}));

vi.mock('@/lib/store', () => ({
  useModules: () => state.modules,
  useAuthStore: (selector: (s: { currentCompany: { role: string } }) => unknown) =>
    selector({ currentCompany: { role: state.isAdmin ? 'admin' : 'manager' } }),
}));

describe('MoreSheet', () => {
  it('renders nothing when closed', () => {
    state.modules = { purchasing: 'manager' };
    state.isAdmin = false;
    const { container } = render(<MoreSheet isOpen={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists every granted module, grouped, including ones already visible as tabs', () => {
    state.modules = { register: 'manager', sales: 'manager', customers: 'manager', inventory: 'manager', purchasing: 'manager', shop: 'manager', reports: 'manager' };
    state.isAdmin = false;
    render(<MoreSheet isOpen={true} onClose={vi.fn()} />);
    // pos fills one of the 4 tab slots, but still gets a full group here —
    // the sheet is no longer limited to overflow-only modules. Check one of
    // its secondary pages, since "Касса" itself is ambiguous (it labels both
    // the group header and the module's first page).
    expect(screen.getByText('История продаж')).toBeInTheDocument();
    expect(screen.getByText('Отчеты')).toBeInTheDocument();
  });

  it('lists /purchase-orders under the Закупки group and navigates there on click', async () => {
    state.modules = { purchasing: 'manager' };
    state.isAdmin = false;
    const onClose = vi.fn();
    render(<MoreSheet isOpen={true} onClose={onClose} />);
    expect(screen.getByText('Закупки')).toBeInTheDocument();
    expect(screen.getByText('Поставщики')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Заказы поставщикам'));
    expect(mockPush).toHaveBeenCalledWith('/purchase-orders');
    expect(onClose).toHaveBeenCalled();
  });

  it('adds a Настройки group for admins', () => {
    state.modules = { inventory: 'manager' };
    state.isAdmin = true;
    render(<MoreSheet isOpen={true} onClose={vi.fn()} />);
    // "Настройки" labels both the group header and its single page — assert
    // via the (unambiguous) clickable page row.
    expect(screen.getByRole('button', { name: 'Настройки' })).toBeInTheDocument();
  });

  it('closes on backdrop click', async () => {
    state.modules = { purchasing: 'manager' };
    state.isAdmin = false;
    const onClose = vi.fn();
    render(<MoreSheet isOpen={true} onClose={onClose} />);
    const backdrop = document.querySelector('.bg-black\\/50');
    expect(backdrop).not.toBeNull();
    await userEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalled();
  });

  it('is a labelled modal dialog', () => {
    state.modules = { purchasing: 'manager' };
    state.isAdmin = false;
    render(<MoreSheet isOpen={true} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Все разделы');
  });

  it('closes on Escape', async () => {
    state.modules = { purchasing: 'manager' };
    state.isAdmin = false;
    const onClose = vi.fn();
    render(<MoreSheet isOpen={true} onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes from an explicit close button, not just the fake grabber', async () => {
    state.modules = { purchasing: 'manager' };
    state.isAdmin = false;
    const onClose = vi.fn();
    render(<MoreSheet isOpen={true} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('marks the current page with aria-current', () => {
    state.modules = { purchasing: 'manager' };
    state.isAdmin = false;
    render(<MoreSheet isOpen={true} onClose={vi.fn()} />);
    // usePathname is mocked to /suppliers for this suite.
    expect(screen.getByRole('button', { name: 'Поставщики' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: 'Заказы поставщикам' })).not.toHaveAttribute(
      'aria-current',
    );
  });
});
