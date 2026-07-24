import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModuleGuard } from '../ModuleGuard';

const mockModules = vi.hoisted(() => ({ current: {} as Record<string, string> }));

vi.mock('@/lib/store', () => ({
  useModules: () => mockModules.current,
}));

describe('ModuleGuard', () => {
  it('renders children when module granted', () => {
    mockModules.current = { pos: 'user' };
    render(
      <ModuleGuard module="pos">
        <div>secret</div>
      </ModuleGuard>,
    );
    expect(screen.getByText('secret')).toBeInTheDocument();
  });

  it('renders no-access message when missing', () => {
    mockModules.current = {};
    render(
      <ModuleGuard module="inventory">
        <div>secret</div>
      </ModuleGuard>,
    );
    expect(screen.queryByText('secret')).toBeNull();
    expect(screen.getByText('Нет доступа к этому разделу')).toBeInTheDocument();
  });

  it('enforces level', () => {
    mockModules.current = { pos: 'user' };
    render(
      <ModuleGuard module="pos" level="manager">
        <div>secret</div>
      </ModuleGuard>,
    );
    expect(screen.queryByText('secret')).toBeNull();
  });
});
