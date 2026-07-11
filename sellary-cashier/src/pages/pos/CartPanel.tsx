import { ShoppingBagIcon, TrashIcon } from '@heroicons/react/24/outline';
import type { CartLine } from '../../lib/cart-store';
import { cartLineKey } from '../../lib/posUnits';
import { formatCurrency } from '../../lib/format';
import { calculateDiscountFromEditedPrice, formatEditableAmount } from '../../lib/posPricing';

interface CartPanelProps {
  items: CartLine[];
  subtotal: number;
  tax: number;
  finalTotal: number;
  oversoldKeys: Set<string>;
  priceEdits: Record<string, string>;
  onPriceEditChange: (key: string, value: string) => void;
  onPriceEditCommit: (key: string, discount: number) => void;
  onQuantity: (key: string, quantity: number) => void;
  onRemove: (key: string) => void;
  onPay: () => void;
}

export function CartPanel({
  items, subtotal, tax, finalTotal, oversoldKeys,
  priceEdits, onPriceEditChange, onPriceEditCommit, onQuantity, onRemove, onPay,
}: CartPanelProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-5 pb-2 pt-4">
        <h2 className="text-[18px] font-extrabold text-gray-900 dark:text-white">Чек</h2>
        <span className="ml-auto text-[13px] font-semibold text-gray-400">{items.length} позиций</span>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-2">
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <ShoppingBagIcon className="mb-3 h-16 w-16 text-gray-200 dark:text-gray-600" />
            <p className="text-sm font-medium text-gray-500 dark:text-gray-300">Корзина пуста</p>
            <p className="text-xs text-gray-400">Нажмите на товар слева, чтобы добавить</p>
          </div>
        ) : (
          items.map((line) => {
            const key = cartLineKey(line.product.id, line.unit.id);
            const unitPrice = line.unit.price;
            const finalPrice = unitPrice - (line.discount || 0);
            const oversold = oversoldKeys.has(key);
            return (
              <div key={key} className="rounded-2xl bg-gray-50 p-3 dark:bg-gray-700/50">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-bold text-gray-900 dark:text-white">{line.product.name}</p>
                    <p className="text-[12px] text-gray-400">{formatCurrency(unitPrice)} / {line.unit.label}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      aria-label={`Меньше: ${line.product.name}`}
                      onClick={() => {
                        const next = line.quantity - 1;
                        if (next <= 0) onRemove(key);
                        else onQuantity(key, next);
                      }}
                      className="grid h-8 w-8 place-items-center rounded-xl bg-white text-lg font-bold text-gray-600 shadow-sm dark:bg-gray-800 dark:text-gray-200"
                    >
                      −
                    </button>
                    <span className="w-10 text-center text-sm font-extrabold text-gray-900 dark:text-white">
                      {line.quantity}
                    </span>
                    <button
                      type="button"
                      aria-label={`Больше: ${line.product.name}`}
                      onClick={() => onQuantity(key, line.quantity + 1)}
                      className="grid h-8 w-8 place-items-center rounded-xl bg-blue-600 text-lg font-bold text-white"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[11px] text-gray-400">Цена</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={`Цена: ${line.product.name}`}
                    value={priceEdits[key] ?? formatEditableAmount(finalPrice)}
                    onChange={(e) => onPriceEditChange(key, e.target.value)}
                    onBlur={() => {
                      const raw = priceEdits[key];
                      if (raw !== undefined) {
                        onPriceEditCommit(key, calculateDiscountFromEditedPrice(raw, unitPrice));
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                    className="w-24 rounded-lg border border-gray-200 bg-white px-2 py-1 text-right text-[13px] font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                  />
                  <span className="ml-auto text-[14px] font-extrabold tabular-nums text-gray-900 dark:text-white">
                    {formatCurrency(finalPrice * line.quantity)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Удалить ${line.product.name}`}
                    onClick={() => onRemove(key)}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-white hover:text-red-600 dark:hover:bg-gray-800"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
                {oversold && (
                  <div className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                    Товара не хватает на складе — продажа сохранится как перерасход.
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-gray-100 p-4 dark:border-gray-700">
        <div className="mb-1 flex justify-between text-[13px] text-gray-500">
          <span>Подытог</span><span className="tabular-nums">{formatCurrency(subtotal)}</span>
        </div>
        <div className="mb-1 flex justify-between text-[13px] text-gray-500">
          <span>Налог</span><span className="tabular-nums">{formatCurrency(tax)}</span>
        </div>
        <div className="mb-3 flex items-end justify-between">
          <span className="font-bold text-gray-900 dark:text-white">Итого</span>
          <span className="text-[28px] font-extrabold leading-none tabular-nums text-gray-900 dark:text-white">
            {formatCurrency(finalTotal)}
          </span>
        </div>
        <button
          type="button"
          onClick={onPay}
          disabled={items.length === 0}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-[17px] font-extrabold text-white shadow-lg transition-all hover:brightness-105 active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg,#22c55e,#16a34a)' }}
        >
          Оплатить →
          <kbd className="rounded bg-white/20 px-1.5 py-0.5 text-[11px] font-semibold">Enter</kbd>
        </button>
      </div>
    </div>
  );
}
