import type { LocalProduct } from '../../lib/db';
import { formatCurrency } from '../../lib/format';
import { stockBadge, type StockTone } from '../../lib/pos-grid';

interface ProductGridProps {
  products: LocalProduct[];
  loading: boolean;
  cartBaseByProduct: Map<number, number>;
  onAdd: (product: LocalProduct) => void;
}

const toneClass: Record<StockTone, string> = {
  ok: 'bg-emerald-100 text-emerald-700',
  empty: 'bg-amber-100 text-amber-700',
  oversold: 'bg-red-100 text-red-700',
};

export function ProductGrid({ products, loading, cartBaseByProduct, onAdd }: ProductGridProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-3 gap-2.5 xl:grid-cols-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="h-36 animate-pulse rounded-3xl border border-gray-100 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
          >
            <div className="mb-3 h-10 w-10 rounded-2xl bg-gray-200 dark:bg-gray-700" />
            <div className="mb-2 h-3 w-3/4 rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-3 w-1/2 rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return <div className="py-16 text-center text-sm text-gray-400">Товары не найдены</div>;
  }

  return (
    <div className="grid grid-cols-3 gap-2.5 xl:grid-cols-4">
      {products.map((product) => {
        const badge = stockBadge(
          Number(product.stock_quantity),
          product.uom,
          cartBaseByProduct.get(product.id) ?? 0,
        );
        return (
          <button
            key={product.id}
            type="button"
            onClick={() => onAdd(product)}
            className="group relative flex h-36 flex-col overflow-hidden rounded-3xl border border-gray-100 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-lg active:scale-95 dark:border-gray-700 dark:bg-gray-800"
          >
            <span className={`absolute right-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-bold ${toneClass[badge.tone]}`}>
              {badge.label}
            </span>
            <div className="mb-auto grid h-10 w-10 place-items-center rounded-2xl bg-gray-100 text-base font-bold text-gray-500 dark:bg-gray-700 dark:text-gray-300">
              {product.name.charAt(0).toUpperCase()}
            </div>
            <h3 className="line-clamp-2 text-[13px] font-bold leading-tight text-gray-900 dark:text-white">
              {product.name}
            </h3>
            <div className="mt-1 text-[16px] font-extrabold tabular-nums text-gray-900 dark:text-white">
              {formatCurrency(product.sell_price)}
            </div>
          </button>
        );
      })}
    </div>
  );
}
