import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

vi.mock('@tauri-apps/plugin-store', () => {
  const data = new Map<string, unknown>();
  return {
    Store: {
      load: vi.fn(async () => ({
        get: vi.fn(async (key: string) => data.get(key)),
        set: vi.fn(async (key: string, value: unknown) => {
          data.set(key, value);
        }),
        delete: vi.fn(async (key: string) => {
          data.delete(key);
        }),
        save: vi.fn(async () => undefined),
      })),
    },
  };
});
