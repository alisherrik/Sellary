import { getInitDataString } from '../telegram/initData';
import type { ShopProduct, CatalogPage } from '../types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export async function shopFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const initData = getInitDataString();
  const headers = new Headers(init.headers);
  headers.set('X-Telegram-Init-Data', initData);
  headers.set('Content-Type', 'application/json');

  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    // Surface the backend's error detail so callers can show a real message.
    // FastAPI 422 returns `detail` as an array of {type,loc,msg,input}; coerce
    // it to a string (never let a caller render the raw object).
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      const detail = body?.detail;
      if (typeof detail === 'string' && detail) {
        message = detail;
      } else if (Array.isArray(detail)) {
        const joined = detail.map((d) => d?.msg).filter(Boolean).join('; ');
        if (joined) message = joined;
      }
    } catch {
      // non-JSON body — keep the status fallback
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Order types
// ---------------------------------------------------------------------------

export interface OrderItemPayload {
  product_id: number;
  quantity: number;
  unit_price: number;
}

export interface OrderCreatePayload {
  company_id: number;
  items: OrderItemPayload[];
  fulfillment_type: 'delivery' | 'pickup';
  delivery_address: string | null;
  contact_phone: string;
  contact_name: string;
  notes: string | null;
  checkout_group_id: string | null;
}

export interface PlacedOrder {
  id: number;
  company_id: number;
  order_number: string;
  status: string;
  total_amount: number;
}

export interface CheckoutResponse {
  orders: PlacedOrder[];
}

function generateIdempotencyKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Fallback for environments where crypto.randomUUID is unavailable
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
}

export async function placeOrder(
  orders: OrderCreatePayload[],
): Promise<CheckoutResponse> {
  return shopFetch<CheckoutResponse>('/api/shop/orders', {
    method: 'POST',
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
    body: JSON.stringify({ orders }),
  });
}

/** Coerce sell_price from string (Python Decimal JSON) to number. */
export function normalizeProduct(p: ShopProduct): ShopProduct {
  return { ...p, sell_price: Number(p.sell_price) };
}

export function normalizeCatalogPage(page: CatalogPage): CatalogPage {
  return { ...page, items: page.items.map(normalizeProduct) };
}
