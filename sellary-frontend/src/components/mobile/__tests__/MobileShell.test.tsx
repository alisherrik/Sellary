import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import MobileShell from '../MobileShell';

const { mockBack, mockPathname } = vi.hoisted(() => ({
  mockBack: vi.fn(),
  mockPathname: vi.fn(() => '/products'),
}));

vi.mock('next/navigation', () => ({
  usePathname: mockPathname,
  useRouter: () => ({ back: mockBack }),
}));

vi.mock('@/lib/store', () => ({
  useModules: () => ({
    pos: 'manager',
    inventory: 'manager',
    purchasing: 'manager',
    shop: 'manager',
    reports: 'manager',
  }),
  useAuthStore: (selector: (s: { currentCompany: { role: string } }) => unknown) =>
    selector({ currentCompany: { role: 'manager' } }),
}));

describe('MobileShell', () => {
  it('renders header with correct title', () => {
    render(<MobileShell><div>Content</div></MobileShell>);
    expect(screen.getByRole('heading', { name: 'Товары' })).toBeInTheDocument();
  });

  it('shows the "Sellary" wordmark on unmapped/launcher routes', () => {
    mockPathname.mockReturnValueOnce('/apps');
    render(<MobileShell><div>Content</div></MobileShell>);
    expect(screen.getByRole('heading', { name: 'Sellary' })).toBeInTheDocument();
  });

  it.each([
    ['/shifts', 'Смена'],
    ['/orders', 'Заказы'],
    ['/purchase-orders', 'Заказы поставщикам'],
  ])('titles %s from the nav registry, not a private map', (pathname, title) => {
    mockPathname.mockReturnValueOnce(pathname);
    render(<MobileShell><div>Content</div></MobileShell>);
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
  });

  it('offers an account control and a launcher link out of the current module', () => {
    render(<MobileShell><div>Content</div></MobileShell>);
    expect(screen.getByLabelText('Аккаунт и компания')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('Приложения')).toHaveAttribute('href', '/apps');
  });

  it('renders children', () => {
    render(<MobileShell><div>Test Content</div></MobileShell>);
    const content = screen.getByText('Test Content');
    expect(content).toBeInTheDocument();
    expect(content.parentElement).toHaveClass('overflow-y-auto');
  });

  it('renders bottom tab bar', () => {
    render(<MobileShell><div>Content</div></MobileShell>);
    expect(screen.getByText('Касса')).toBeInTheDocument();
  });

  it('does not show back button on top-level pages', () => {
    render(<MobileShell><div>Content</div></MobileShell>);
    expect(screen.queryByLabelText('Назад')).not.toBeInTheDocument();
  });
});
