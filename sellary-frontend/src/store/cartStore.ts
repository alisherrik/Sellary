import { create } from 'zustand';
import { CartItem, Product } from '../types';

interface CartState {
  items: CartItem[];
  addItem: (product: Product, quantity?: number) => void;
  removeItem: (productId: number) => void;
  updateQuantity: (productId: number, quantity: number) => void;
  setDiscount: (productId: number, discount: number) => void;
  clearCart: () => void;
  getSubtotal: () => number;
  getTax: () => number;
  getTotal: () => number;
  getItemCount: () => number;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],

  addItem: (product, quantity = 1) => {
    set((state) => {
      const existingItem = state.items.find((item) => item.product.id === product.id);
      if (existingItem) {
        return {
          items: state.items.map((item) =>
            item.product.id === product.id
              ? { ...item, quantity: item.quantity + quantity }
              : item
          ),
        };
      }
      return {
        items: [...state.items, { product, quantity, discount: 0 }],
      };
    });
  },

  removeItem: (productId) => {
    set((state) => ({
      items: state.items.filter((item) => item.product.id !== productId),
    }));
  },

  updateQuantity: (productId, quantity) => {
    set((state) => ({
      items: state.items.map((item) =>
        item.product.id === productId ? { ...item, quantity } : item
      ),
    }));
  },

  setDiscount: (productId, discount) => {
    set((state) => ({
      items: state.items.map((item) =>
        item.product.id === productId ? { ...item, discount } : item
      ),
    }));
  },

  clearCart: () => set({ items: [] }),

  getSubtotal: () => {
    const state = get();
    return state.items.reduce((sum, item) => {
      return sum + Number(item.product.sell_price) * item.quantity;
    }, 0);
  },

  getTax: () => {
    const state = get();
    return state.items.reduce((sum, item) => {
      const itemSubtotal = Number(item.product.sell_price) * item.quantity;
      const tax = itemSubtotal * (Number(item.product.tax_percent) / 100);
      return sum + tax;
    }, 0);
  },

  getTotal: () => {
    return get().getSubtotal() + get().getTax();
  },

  getItemCount: () => {
    const state = get();
    return state.items.reduce((sum, item) => sum + item.quantity, 0);
  },
}));
