import type { ShopProduct } from '../types';
import { formatPrice } from '../lib/format';

interface Props {
  product: ShopProduct;
  onAddToCart: (product: ShopProduct) => void;
}

export function ProductCard({ product, onAddToCart }: Props) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
      {product.image_url ? (
        <img
          src={product.image_url}
          alt={product.name}
          className="w-full h-40 object-cover"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-40 bg-gray-100 flex items-center justify-center text-gray-400 text-4xl">
          🛍️
        </div>
      )}
      <div className="p-3 flex flex-col flex-1 gap-1">
        <p className="text-xs text-gray-500">{product.company_name}</p>
        <h3 className="font-semibold text-gray-900 leading-tight">{product.name}</h3>
        {product.category_name && (
          <p className="text-xs text-gray-400">{product.category_name}</p>
        )}
        <p className="mt-auto pt-2 font-bold text-blue-600">{formatPrice(product.sell_price)}</p>
        {product.in_stock ? (
          <button
            className="mt-1 w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 active:scale-95 transition-transform"
            onClick={() => onAddToCart(product)}
          >
            В корзину
          </button>
        ) : (
          <p className="mt-1 text-center text-sm text-gray-400">Нет в наличии</p>
        )}
      </div>
    </div>
  );
}
