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
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/** Coerce sell_price from string (Python Decimal JSON) to number. */
export function normalizeProduct(p: ShopProduct): ShopProduct {
  return { ...p, sell_price: Number(p.sell_price) };
}

export function normalizeCatalogPage(page: CatalogPage): CatalogPage {
  return { ...page, items: page.items.map(normalizeProduct) };
}
