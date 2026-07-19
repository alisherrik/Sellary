const CART_KEY = 'sellary_shop_cart';

export interface CartProduct {
  id: number;
  name: string;
  sell_price: number;
  company_id: number;
}

export interface CartItem {
  productId: number;
  name: string;
  price: number;
  companyId: number;
  quantity: number;
}

export interface Cart {
  getItems(): CartItem[];
  addItem(product: CartProduct, quantity?: number): void;
  removeItem(productId: number): void;
  setQuantity(productId: number, quantity: number): void;
  clear(): void;
  getTotal(): number;
  getItemCount(): number;
}

function load(storage: Storage): CartItem[] {
  try {
    const raw = storage.getItem(CART_KEY);
    return raw ? (JSON.parse(raw) as CartItem[]) : [];
  } catch {
    return [];
  }
}

function save(storage: Storage, items: CartItem[]): void {
  storage.setItem(CART_KEY, JSON.stringify(items));
}

export function createCart(storage: Storage = localStorage): Cart {
  let items: CartItem[] = load(storage);

  const persist = () => save(storage, items);

  return {
    getItems: () => [...items],

    addItem(product: CartProduct, quantity = 1): void {
      const existing = items.find(i => i.productId === product.id);
      if (existing) {
        existing.quantity += quantity;
      } else {
        items.push({
          productId: product.id,
          name: product.name,
          price: product.sell_price,
          companyId: product.company_id,
          quantity,
        });
      }
      persist();
    },

    removeItem(productId: number): void {
      items = items.filter(i => i.productId !== productId);
      persist();
    },

    setQuantity(productId: number, quantity: number): void {
      if (quantity <= 0) {
        items = items.filter(i => i.productId !== productId);
      } else {
        const item = items.find(i => i.productId === productId);
        if (item) item.quantity = quantity;
      }
      persist();
    },

    clear(): void {
      items = [];
      persist();
    },

    getTotal(): number {
      return items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    },

    getItemCount(): number {
      return items.length;
    },
  };
}

let _cart: Cart | null = null;
export function getCart(): Cart {
  if (!_cart) _cart = createCart(localStorage);
  return _cart;
}
