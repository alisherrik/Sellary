import type { ShopSummary, ShopCategory } from '../types';

interface Props {
  shops: ShopSummary[];
  categories: ShopCategory[];
  search: string;
  selectedShop: number | null;
  selectedCategory: number | null;
  onSearch: (q: string) => void;
  onShopChange: (id: number | null) => void;
  onCategoryChange: (id: number | null) => void;
}

export function FilterBar({
  shops, categories, search, selectedShop, selectedCategory,
  onSearch, onShopChange, onCategoryChange,
}: Props) {
  return (
    <div className="flex flex-col gap-2 p-3 bg-white border-b border-gray-100">
      <input
        type="search"
        placeholder="Поиск товаров…"
        value={search}
        onChange={e => onSearch(e.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-blue-400"
      />
      <div className="flex gap-2 overflow-x-auto pb-1">
        <select
          value={selectedShop ?? ''}
          onChange={e => onShopChange(e.target.value ? Number(e.target.value) : null)}
          className="shrink-0 px-2 py-1 rounded-lg border border-gray-200 text-sm bg-white"
        >
          <option value="">Все магазины</option>
          {shops.map(s => (
            <option key={s.company_id} value={s.company_id}>{s.name}</option>
          ))}
        </select>
        <select
          value={selectedCategory ?? ''}
          onChange={e => onCategoryChange(e.target.value ? Number(e.target.value) : null)}
          className="shrink-0 px-2 py-1 rounded-lg border border-gray-200 text-sm bg-white"
        >
          <option value="">Все категории</option>
          {categories.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
