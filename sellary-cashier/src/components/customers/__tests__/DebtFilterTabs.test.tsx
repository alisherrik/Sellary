import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DebtFilterTabs } from '../DebtFilterTabs';

describe('DebtFilterTabs', () => {
  it('renders the three labels with their counts', () => {
    render(<DebtFilterTabs value="all" onChange={() => {}} counts={{ all: 5, debt: 2, clear: 3 }} />);
    expect(screen.getByText('Все')).toBeInTheDocument();
    expect(screen.getByText('Есть долг')).toBeInTheDocument();
    expect(screen.getByText('Нет долга')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('fires onChange with the tab key when a tab is clicked', () => {
    const onChange = vi.fn();
    render(<DebtFilterTabs value="all" onChange={onChange} counts={{ all: 1, debt: 1, clear: 0 }} />);
    fireEvent.click(screen.getByText('Есть долг'));
    expect(onChange).toHaveBeenCalledWith('debt');
  });

  it('marks the active tab with the white pill class', () => {
    const { container } = render(
      <DebtFilterTabs value="debt" onChange={() => {}} counts={{ all: 1, debt: 1, clear: 0 }} />,
    );
    const active = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Есть долг'));
    expect(active?.className).toContain('bg-white');
  });
});
