import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SyncStatusTabs } from '../SyncStatusTabs';

describe('SyncStatusTabs', () => {
  it('renders all four tabs', () => {
    render(<SyncStatusTabs value="all" onChange={() => {}} />);
    ['Все', 'Синхронизировано', 'Не синхронизировано', 'Требует внимания'].forEach((t) =>
      expect(screen.getByRole('button', { name: new RegExp(t) })).toBeInTheDocument(),
    );
  });
  it('fires onChange with the tab key', () => {
    const onChange = vi.fn();
    render(<SyncStatusTabs value="all" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Не синхронизировано/ }));
    expect(onChange).toHaveBeenCalledWith('unsynced');
  });
  it('shows the needs-attention count badge when > 0', () => {
    render(<SyncStatusTabs value="all" onChange={() => {}} needsAttentionCount={3} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
