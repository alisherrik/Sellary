import type { LocalCategory } from '../../lib/db';

interface CategoryChipsProps {
  categories: LocalCategory[];
  selected: number | null;
  onSelect: (id: number | null) => void;
}

export function CategoryChips({ categories, selected, onSelect }: CategoryChipsProps) {
  return (
    <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto whitespace-nowrap px-1">
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={`h-9 shrink-0 rounded-xl px-4 text-[13px] font-bold transition-colors ${
          selected === null
            ? 'bg-gray-900 text-white dark:bg-gray-600'
            : 'border border-gray-200 bg-white text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
        }`}
      >
        Все
      </button>
      {categories.map((cat) => (
        <button
          key={cat.id}
          type="button"
          onClick={() => onSelect(cat.id === selected ? null : cat.id)}
          className={`h-9 shrink-0 rounded-xl px-4 text-[13px] font-bold transition-colors ${
            selected === cat.id
              ? 'bg-blue-600 text-white'
              : 'border border-gray-200 bg-white text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
          }`}
        >
          {cat.name}
        </button>
      ))}
    </div>
  );
}
