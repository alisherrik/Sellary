export type ModuleKey = 'pos' | 'inventory' | 'purchasing' | 'shop' | 'reports';
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
