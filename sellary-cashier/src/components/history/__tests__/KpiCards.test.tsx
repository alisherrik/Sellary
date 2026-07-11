import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KpiCards } from '../KpiCards';

describe('KpiCards', () => {
  it('renders turnover, count, average and unsynced from props', () => {
    render(<KpiCards turnover={1000000} count={40} unsynced={3} onUnsyncedClick={() => {}} />);
    expect(screen.getByText('40')).toBeInTheDocument();          // Чеков
    expect(screen.getByText('3')).toBeInTheDocument();           // Не синхронизировано
    // average = 1000000 / 40 = 25000
    expect(screen.getByText((t) => t.replace(/\s/g, '') === '25000UZS')).toBeInTheDocument();
  });
  it('computes average = 0 when count is 0', () => {
    render(<KpiCards turnover={0} count={0} unsynced={0} onUnsyncedClick={() => {}} />);
    expect(screen.getAllByText((t) => t.replace(/\s/g, '') === '0UZS').length).toBeGreaterThan(0);
  });
  it('unsynced card is clickable', () => {
    const onClick = vi.fn();
    render(<KpiCards turnover={100} count={1} unsynced={2} onUnsyncedClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /Не синхронизировано/ }));
    expect(onClick).toHaveBeenCalled();
  });
});
