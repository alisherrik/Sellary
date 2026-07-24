import { describe, expect, it } from 'vitest';
import { canAccessModule, filterNavByModules, type ModuleMap } from '../modules';

const navItems = [
  { name: 'Касса', href: '/pos', module: 'pos' as const },
  { name: 'Товары', href: '/products', module: 'inventory' as const },
  { name: 'Отчеты', href: '/reports', module: 'reports' as const },
  { name: 'Настройки', href: '/settings', module: null },
];

describe('canAccessModule', () => {
  const modules: ModuleMap = { pos: 'user', inventory: 'manager' };

  it('grants at same or lower level', () => {
    expect(canAccessModule(modules, 'pos')).toBe(true);
    expect(canAccessModule(modules, 'inventory', 'manager')).toBe(true);
  });

  it('denies missing module or insufficient level', () => {
    expect(canAccessModule(modules, 'reports')).toBe(false);
    expect(canAccessModule(modules, 'pos', 'manager')).toBe(false);
  });

  it('denies everything on empty map', () => {
    expect(canAccessModule({}, 'pos')).toBe(false);
  });
});

describe('filterNavByModules', () => {
  it('keeps module-less items and granted modules only', () => {
    const result = filterNavByModules(navItems, { pos: 'user' });
    expect(result.map((i) => i.href)).toEqual(['/pos', '/settings']);
  });
});
