import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import type { CartItem as CartItemType } from '../lib/cart';
import { getCart } from '../lib/cart';
import { CartItem } from '../components/CartItem';
import { formatPrice } from '../lib/format';

export function CartPage() {
  const [items, setItems] = useState<CartItemType[]>([]);

  const refresh = useCallback(() => {
    setItems(getCart().getItems());
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleRemove = (productId: number) => {
    getCart().removeItem(productId);
    refresh();
  };

  const handleSetQuantity = (productId: number, qty: number) => {
    getCart().setQuantity(productId, qty);
    refresh();
  };

  const total = getCart().getTotal();

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-blue-600 text-white px-4 py-3 flex items-center gap-3">
        <Link to="/" className="text-white">← Каталог</Link>
        <h1 className="font-bold">Корзина</h1>
      </header>
      <main className="flex-1 p-3 space-y-2">
        {items.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">🛒</p>
            <p className="text-gray-500">Корзина пуста</p>
            <Link to="/" className="mt-4 inline-block px-6 py-2 bg-blue-600 text-white rounded-xl">
              Перейти в каталог
            </Link>
          </div>
        ) : (
          <>
            {items.map(item => (
              <CartItem
                key={item.productId}
                item={item}
                onRemove={handleRemove}
                onSetQuantity={handleSetQuantity}
              />
            ))}
            <div className="bg-white rounded-xl p-4 mt-4 space-y-3">
              <div className="flex justify-between text-lg font-bold">
                <span>Итого:</span>
                <span className="text-blue-600">{formatPrice(total)}</span>
              </div>
              <Link
                to="/checkout"
                className="block w-full py-4 bg-blue-600 text-white rounded-xl font-semibold text-lg text-center"
              >
                Оформить заказ
              </Link>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
