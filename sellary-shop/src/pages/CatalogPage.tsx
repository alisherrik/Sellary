import { useState, useEffect, useCallback } from 'react';
import type { ShopProduct, ShopSummary, ShopCategory, CatalogPage as CatalogPageType } from '../types';
import { shopFetch } from '../lib/api';
import { getCart } from '../lib/cart';
import { ProductCard } from '../components/ProductCard';
import { FilterBar } from '../components/FilterBar';

const LIMIT = 24;

export function CatalogPage() {
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [shops, setShops] = useState<ShopSummary[]>([]);
  const [categories, setCategories] = useState<ShopCategory[]>([]);
  const [search, setSearch] = useState('');
  const [selectedShop, setSelectedShop] = useState<number | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [skip, setSkip] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cartCount, setCartCount] = useState(0);

  const refreshCart = useCallback(() => {
    setCartCount(getCart().getItemCount());
  }, []);

  useEffect(() => {
    refreshCart();
    Promise.all([
      shopFetch<ShopSummary[]>('/api/shop/shops'),
      shopFetch<ShopCategory[]>('/api/shop/categories'),
    ]).then(([s, c]) => { setShops(s); setCategories(c); }).catch(() => {});
  }, [refreshCart]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('skip', String(skip));
    params.set('limit', String(LIMIT));
    if (search) params.set('search', search);
    if (selectedShop !== null) params.set('company', String(selectedShop));
    if (selectedCategory !== null) params.set('category', String(selectedCategory));

    shopFetch<CatalogPageType>(`/api/shop/catalog?${params}`)
      .then(page => { setProducts(page.items); setTotal(page.total); setError(null); })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [search, selectedShop, selectedCategory, skip]);

  const handleSearch = (q: string) => { setSearch(q); setSkip(0); };
  const handleShop = (id: number | null) => { setSelectedShop(id); setSkip(0); };
  const handleCategory = (id: number | null) => { setSelectedCategory(id); setSkip(0); };

  const addToCart = (product: ShopProduct) => {
    getCart().addItem(product, 1);
    refreshCart();
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="sticky top-0 z-10 bg-blue-600 text-white px-4 py-3 flex justify-between items-center shadow">
        <h1 className="font-bold text-lg">Sellary Shop</h1>
        <a href="/cart" className="relative">
          <span className="text-2xl">🛒</span>
          {cartCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
              {cartCount}
            </span>
          )}
        </a>
      </header>
      <FilterBar
        shops={shops}
        categories={categories}
        search={search}
        selectedShop={selectedShop}
        selectedCategory={selectedCategory}
        onSearch={handleSearch}
        onShopChange={handleShop}
        onCategoryChange={handleCategory}
      />
      <main className="flex-1 p-3">
        {loading && <p className="text-center text-gray-500 py-8">Загрузка…</p>}
        {error && <p className="text-center text-red-500 py-8">{error}</p>}
        {!loading && !error && products.length === 0 && (
          <p className="text-center text-gray-500 py-8">Ничего не найдено</p>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {products.map(p => (
            <ProductCard key={p.id} product={p} onAddToCart={addToCart} />
          ))}
        </div>
        {total > skip + LIMIT && (
          <button
            className="mt-4 w-full py-3 bg-white border border-gray-200 rounded-xl text-gray-700"
            onClick={() => setSkip(s => s + LIMIT)}
          >
            Показать ещё
          </button>
        )}
      </main>
    </div>
  );
}
