import { create } from 'zustand';
import type { LocalProduct } from './db';
import { baseUnit, cartLineKey, type LocalCartUnit } from './posUnits';

export interface CartLine {
  product: LocalProduct;
  unit: LocalCartUnit;
  quantity: number;
  discount: number; // per-unit amount subtracted from unit.price (0 = none)
}

interface CartState {
  items: CartLine[];
  addItem: (product: LocalProduct, unit?: LocalCartUnit, quantity?: number) => void;
  removeItem: (key: string) => void;
  updateQuantity: (key: string, quantity: number) => void;
  changeUnit: (key: string, unit: LocalCartUnit) => void;
  setDiscount: (key: string, discount: number) => void;
  clearCart: () => void;
  getSubtotal: () => number;
  getTax: () => number;
}

const keyOf = (line: CartLine) => cartLineKey(line.product.id, line.unit.id);
const lineSubtotal = (line: CartLine) => line.unit.price * line.quantity;

export const useCartStore = create<CartState>((set, get) => ({
  items: [],

  addItem: (product, unit, quantity = 1) =>
    set((state) => {
      const resolved = unit ?? baseUnit(product);
      const key = cartLineKey(product.id, resolved.id);
      const existing = state.items.find((line) => keyOf(line) === key);
      if (existing) {
        return {
          items: state.items.map((line) =>
            keyOf(line) === key ? { ...line, quantity: line.quantity + quantity } : line,
          ),
        };
      }
      return { items: [...state.items, { product, unit: resolved, quantity, discount: 0 }] };
    }),

  removeItem: (key) =>
    set((state) => ({ items: state.items.filter((line) => keyOf(line) !== key) })),

  updateQuantity: (key, quantity) =>
    set((state) => ({
      items: state.items.map((line) => (keyOf(line) === key ? { ...line, quantity } : line)),
    })),

  changeUnit: (key, unit) =>
    set((state) => {
      const target = state.items.find((line) => keyOf(line) === key);
      if (!target) return state;
      const newKey = cartLineKey(target.product.id, unit.id);
      const collision = state.items.find((line) => line !== target && keyOf(line) === newKey);
      if (collision) {
        // Merge quantities onto the existing line, drop the source.
        return {
          items: state.items
            .filter((line) => line !== target)
            .map((line) =>
              line === collision
                ? { ...line, quantity: line.quantity + target.quantity }
                : line,
            ),
        };
      }
      // Discount reset — it was relative to the previous unit's price.
      return {
        items: state.items.map((line) =>
          line === target ? { ...line, unit, discount: 0 } : line,
        ),
      };
    }),

  setDiscount: (key, discount) =>
    set((state) => ({
      items: state.items.map((line) => (keyOf(line) === key ? { ...line, discount } : line)),
    })),

  clearCart: () => set({ items: [] }),

  getSubtotal: () => get().items.reduce((sum, line) => sum + lineSubtotal(line), 0),

  getTax: () =>
    get().items.reduce(
      (sum, line) => sum + lineSubtotal(line) * (Number(line.product.tax_percent) / 100),
      0,
    ),
}));
