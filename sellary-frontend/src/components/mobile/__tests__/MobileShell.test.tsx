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

describe('MobileShell', () => {
  it('renders header with correct title', () => {
    render(<MobileShell><div>Content</div></MobileShell>);
    expect(screen.getByRole('heading', { name: 'Товары' })).toBeInTheDocument();
  });

  it('renders children', () => {
    render(<MobileShell><div>Test Content</div></MobileShell>);
    expect(screen.getByText('Test Content')).toBeInTheDocument();
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
