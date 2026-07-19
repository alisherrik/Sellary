import { getInitDataString } from '../telegram/initData';

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
