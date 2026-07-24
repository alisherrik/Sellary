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
}));

describe('MobileShell', () => {
  it('renders header with correct title', () => {
    render(<MobileShell><div>Content</div></MobileShell>);
    expect(screen.getByRole('heading', { name: 'Товары' })).toBeInTheDocument();
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
