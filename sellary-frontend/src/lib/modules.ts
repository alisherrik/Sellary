export type ModuleKey =
  | 'register'
  | 'sales'
  | 'customers'
  | 'inventory'
  | 'purchasing'
  | 'shop'
  | 'reports'
  | 'finance'
  // ИИ-коннектор (MCP). Mirrors core/modules.py — scripts/check_module_parity.py
  // fails CI if the two drift.
  | 'ai';
export type ModuleLevel = 'user' | 'manager';
export type ModuleMap = Partial<Record<ModuleKey, ModuleLevel>>;

const LEVEL_RANK: Record<ModuleLevel, number> = { user: 1, manager: 2 };

export function canAccessModule(
  modules: ModuleMap,
  module: ModuleKey,
  level: ModuleLevel = 'user',
): boolean {
  const granted = modules[module];
  if (!granted) return false;
  return LEVEL_RANK[granted] >= LEVEL_RANK[level];
}

export function filterNavByModules<T extends { module: ModuleKey | null }>(
  items: T[],
  modules: ModuleMap,
): T[] {
  return items.filter((item) => item.module === null || canAccessModule(modules, item.module));
}
