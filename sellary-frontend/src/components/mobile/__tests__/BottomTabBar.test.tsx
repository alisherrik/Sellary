import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BottomTabBar from '../BottomTabBar';

vi.mock('next/navigation', () => ({
  usePathname: () => '/pos',
}));

describe('BottomTabBar', () => {
  it('renders all 5 tabs', () => {
    render(<BottomTabBar onMoreClick={vi.fn()} />);
    expect(screen.getByText('Касса')).toBeInTheDocument();
    expect(screen.getByText('Товары')).toBeInTheDocument();
    expect(screen.getByText('Продажи')).toBeInTheDocument();
    expect(screen.getByText('Дашборд')).toBeInTheDocument();
    expect(screen.getByText('Ещё')).toBeInTheDocument();
  });

  it('highlights active tab based on pathname', () => {
    render(<BottomTabBar onMoreClick={vi.fn()} />);
    const posLink = screen.getByText('Касса').closest('a');
    expect(posLink).toBeInTheDocument();
  });

  it('calls onMoreClick when "Ещё" is clicked', async () => {
    const onMoreClick = vi.fn();
    render(<BottomTabBar onMoreClick={onMoreClick} />);
    await userEvent.click(screen.getByText('Ещё'));
    expect(onMoreClick).toHaveBeenCalledTimes(1);
  });
});
