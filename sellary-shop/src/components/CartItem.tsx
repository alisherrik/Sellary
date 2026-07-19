import type { CartItem as CartItemType } from '../lib/cart';
import { formatPrice } from '../lib/format';

interface Props {
  item: CartItemType;
  onRemove: (productId: number) => void;
  onSetQuantity: (productId: number, quantity: number) => void;
}

export function CartItem({ item, onRemove, onSetQuantity }: Props) {
  return (
    <div className="flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-100">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900 truncate">{item.name}</p>
        <p className="text-sm text-gray-500">{formatPrice(item.price)} × {item.quantity}</p>
        <p className="font-semibold text-blue-600">{formatPrice(item.price * item.quantity)}</p>
      </div>
      <div className="flex items-center gap-2">
        <button
          aria-label="−"
          className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-700 hover:bg-gray-200"
          onClick={() => onSetQuantity(item.productId, item.quantity - 1)}
        >
          −
        </button>
        <span className="w-6 text-center font-medium">{item.quantity}</span>
        <button
          aria-label="+"
          className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 hover:bg-blue-200"
          onClick={() => onSetQuantity(item.productId, item.quantity + 1)}
        >
          +
        </button>
        <button
          aria-label="×"
          className="ml-1 w-8 h-8 rounded-full bg-red-50 flex items-center justify-center text-red-500 hover:bg-red-100"
          onClick={() => onRemove(item.productId)}
        >
          ×
        </button>
      </div>
    </div>
  );
}
