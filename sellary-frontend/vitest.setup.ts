import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Cleanup after each test
afterEach(() => {
    cleanup();
});

// Mock IndexedDB for tests
const indexedDB = {
    open: vi.fn(() => ({
        onsuccess: null,
        onerror: null,
        result: {
            close: vi.fn(),
            transaction: vi.fn(() => ({
                objectStore: vi.fn(() => ({
                    add: vi.fn(),
                    get: vi.fn(),
                    getAll: vi.fn(),
                    put: vi.fn(),
                    delete: vi.fn(),
                    clear: vi.fn(),
                })),
            })),
            createObjectStore: vi.fn(),
            deleteObjectStore: vi.fn(),
        },
    })),
    deleteDatabase: vi.fn(() => ({
        onsuccess: null,
        onerror: null,
    })),
    databases: vi.fn(() => Promise.resolve([])),
};

// Mock window.crypto.randomUUID
Object.defineProperty(global, 'crypto', {
    value: {
        randomUUID: () => 'test-uuid-' + Math.random().toString(36).substr(2, 9),
    },
    writable: true,
    configurable: true,
});

// Mock fetch
global.fetch = vi.fn();

// Mock navigator.onLine
Object.defineProperty(window.navigator, 'onLine', {
    writable: true,
    value: true,
});

// Mock localStorage with real in-memory behavior
const localStorageState = new Map<string, string>();
const localStorageMock = {
    getItem: vi.fn((key: string) => (localStorageState.has(key) ? localStorageState.get(key)! : null)),
    setItem: vi.fn((key: string, value: string) => {
        localStorageState.set(key, String(value));
    }),
    removeItem: vi.fn((key: string) => {
        localStorageState.delete(key);
    }),
    clear: vi.fn(() => {
        localStorageState.clear();
    }),
};
global.localStorage = localStorageMock as any;
Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
    writable: true,
    configurable: true,
});
