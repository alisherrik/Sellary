import { describe, expect, it } from 'vitest';
import { MODULE_NAV, grantedModuleDefs, pageForPath } from '../moduleNav';
import type { ModuleMap } from '../modules';

describe('MODULE_NAV after the pos split', () => {
  it('exposes the seven business domains in registry order', () => {
    expect(MODULE_NAV.map((def) => def.key)).toEqual([
      'register',
      'sales',
      'customers',
      'inventory',
      'purchasing',
      'shop',
      'reports',
      'settings',
    ]);
  });

  it('keeps Касса and Смена together under register', () => {
    const register = MODULE_NAV.find((def) => def.key === 'register');
    expect(register?.pages.map((page) => page.href)).toEqual(['/pos', '/shifts']);
  });

  it('gives an online-only company sales, customers, inventory and shop — no register', () => {
    const modules: ModuleMap = {
      sales: 'user',
      customers: 'user',
      inventory: 'user',
      shop: 'user',
    };
    const keys = grantedModuleDefs(modules, false).map((def) => def.key);
    expect(keys).toEqual(['sales', 'customers', 'inventory', 'shop']);
    expect(keys).not.toContain('register');
  });

  it('resolves /shifts to the register module', () => {
    expect(pageForPath('/shifts')?.label).toBe('Смена');
  });
});
