import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import type { ShopProduct } from '../types';
import { shopFetch } from '../lib/api';
import { getCart } from '../lib/cart';
import { formatPrice } from '../lib/format';

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [product, setProduct] = useState<ShopProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    if (!id) return;
    shopFetch<ShopProduct>(`/api/shop/products/${id}`)
      .then(p => { setProduct(p); setLoading(false); })
      .catch(() => setLoading(false));
  }, [id]);

  const handleAdd = () => {
    if (!product) return;
    getCart().addItem(product, 1);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Загрузка…</div>;
  if (!product) return <div className="p-8 text-center text-red-500">Товар не найден</div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-600 text-white px-4 py-3 flex items-center gap-3">
        <a href="/" className="text-white">← Назад</a>
        <h1 className="font-bold flex-1 truncate">{product.name}</h1>
      </header>
      {product.image_url ? (
        <img src={product.image_url} alt={product.name} className="w-full max-h-64 object-cover" />
      ) : (
        <div className="w-full h-48 bg-gray-200 flex items-center justify-center text-6xl">🛍️</div>
      )}
      <div className="p-4 space-y-3">
        <div className="bg-white rounded-xl p-4 space-y-2">
          <p className="text-sm text-gray-500">{product.company_name}</p>
          <h2 className="text-xl font-bold">{product.name}</h2>
          {product.category_name && <p className="text-sm text-gray-400">{product.category_name}</p>}
          {product.description && <p className="text-gray-700">{product.description}</p>}
          <p className="text-2xl font-bold text-blue-600">{formatPrice(product.sell_price)}</p>
          <p className="text-sm text-gray-500">Ед. изм.: {product.uom}</p>
        </div>
        {product.in_stock ? (
          <button
            onClick={handleAdd}
            className="w-full py-4 bg-blue-600 text-white rounded-xl font-semibold text-lg hover:bg-blue-700 transition-colors"
          >
            {added ? '✓ Добавлено в корзину' : 'В корзину'}
          </button>
        ) : (
          <div className="w-full py-4 bg-gray-100 text-gray-400 rounded-xl font-semibold text-lg text-center">
            Нет в наличии
          </div>
        )}
      </div>
    </div>
  );
}
