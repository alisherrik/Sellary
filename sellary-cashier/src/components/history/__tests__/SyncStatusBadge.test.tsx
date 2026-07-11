import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SyncStatusBadge, badgeMeta } from '../SyncStatusBadge';

describe('badgeMeta', () => {
  it('maps each state to the right label', () => {
    expect(badgeMeta('synced', null).label).toBe('Синхронизировано');
    expect(badgeMeta('failed', 'permanent').label).toBe('Требует внимания');
    expect(badgeMeta('failed', 'transient').label).toBe('Повтор');
    expect(badgeMeta('syncing', null).label).toBe('Синхронизация…');
    expect(badgeMeta('pending', null).label).toBe('Ожидает');
  });
  it('uses red styling only for permanent failures', () => {
    expect(badgeMeta('failed', 'permanent').cls).toContain('red');
    expect(badgeMeta('failed', 'transient').cls).not.toContain('red');
  });
});

describe('SyncStatusBadge', () => {
  it('renders the mapped label', () => {
    render(<SyncStatusBadge syncStatus="synced" errorKind={null} />);
    expect(screen.getByText('Синхронизировано')).toBeInTheDocument();
  });
});
