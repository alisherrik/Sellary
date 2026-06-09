import { Store } from '@tauri-apps/plugin-store';

let store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!store) {
    store = await Store.load('.settings.dat');
  }
  return store;
}

export async function getStoreValue<T>(key: string): Promise<T | null> {
  const s = await getStore();
  const val = await s.get<T>(key);
  return val ?? null;
}

export async function setStoreValue<T>(key: string, value: T): Promise<void> {
  const s = await getStore();
  await s.set(key, value);
  await s.save();
}

export async function removeStoreValue(key: string): Promise<void> {
  const s = await getStore();
  await s.delete(key);
  await s.save();
}
